"""
Vitalis Help · servidor local con conexión a la API CIE-11 de la OMS.

Qué hace:
  1. Guarda la clave de la API (client_id y client_secret) en el servidor, nunca en el navegador.
  2. Pide el token de acceso a la OMS y lo reutiliza mientras está vigente (dura ~1 hora).
  3. Expone dos rutas simples para la app:
       GET /api/cie11/codificar?texto=Hipertensión arterial  → el código CIE-11 más probable
       GET /api/cie11/buscar?q=diabetes                      → lista de códigos para elegir
  4. Sirve la app (index.html, ficha.html, etc.) en http://localhost:8000

Cómo se usa:
  pip install -r requirements.txt
  copiar .env.ejemplo como .env y poner ahí el cliente y la clave
  uvicorn servidor:app --reload
  abrir http://localhost:8000

Solo se envía a la OMS el nombre del diagnóstico (por ejemplo «Hipertensión arterial»),
nunca el dictado ni datos del paciente.
"""
import json
import os
import re
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

CARPETA = Path(__file__).resolve().parent
# La clave va en el archivo .env, en la misma carpeta que servidor.py
load_dotenv(CARPETA / ".env")

CLIENT_ID = os.getenv("ICD_CLIENT_ID", "").strip()
CLIENT_SECRET = os.getenv("ICD_CLIENT_SECRET", "").strip()
RELEASE = os.getenv("ICD_RELEASE", "2026-01").strip()          # versión de la CIE-11 MMS
IDIOMA = os.getenv("ICD_IDIOMA", "es").strip()
# Si la clínica instala la API de la OMS en sus propios servidores (Docker), se cambia esta URL
# y no hace falta token: ICD_API_BASE=http://localhost:8382  ICD_SIN_TOKEN=1
API_BASE = os.getenv("ICD_API_BASE", "https://id.who.int").rstrip("/")
SIN_TOKEN = os.getenv("ICD_SIN_TOKEN", "0") == "1"

# IA opcional para repartir el dictado de la atención completa en los campos de la ficha
IA_CLAVE = os.getenv("ANTHROPIC_API_KEY", "").strip()
IA_MODELO = os.getenv("IA_MODELO", "claude-haiku-5-5").strip()

TOKEN_URL = "https://icdaccessmanagement.who.int/connect/token"
TIEMPO_ESPERA = 15  # segundos

app = FastAPI(title="Vitalis Help · API CIE-11")

# Permite usar la app también desde Live Server (puerto 5500) mientras se desarrolla y, si este servidor
# se publica en internet, desde la página publicada (por ejemplo CORS_ORIGINS=https://khrojasdev.github.io)
ORIGENES = ["http://127.0.0.1:5500", "http://localhost:5500"] + [
    o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENES,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------- Token de la OMS (se guarda en memoria y se renueva solo) ----------------
_token = {"valor": None, "vence": 0.0}


def obtener_token() -> str:
    if _token["valor"] and time.time() < _token["vence"]:
        return _token["valor"]
    if not CLIENT_ID or not CLIENT_SECRET:
        raise HTTPException(503, "Falta configurar ICD_CLIENT_ID y ICD_CLIENT_SECRET en el archivo .env")
    try:
        r = requests.post(
            TOKEN_URL,
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "scope": "icdapi_access",
                "grant_type": "client_credentials",
            },
            timeout=TIEMPO_ESPERA,
        )
    except requests.RequestException:
        raise HTTPException(502, "No se pudo conectar con el servidor de acceso de la OMS")
    if r.status_code != 200:
        raise HTTPException(502, "La OMS rechazó el cliente o la clave (revise el archivo .env)")
    datos = r.json()
    _token["valor"] = datos["access_token"]
    _token["vence"] = time.time() + int(datos.get("expires_in", 3600)) - 60  # renovar 1 min antes
    return _token["valor"]


def consultar_oms(ruta: str, parametros: dict) -> dict:
    """Llama a la API CIE-11 con los encabezados que pide la OMS."""
    encabezados = {
        "Accept": "application/json",
        "Accept-Language": IDIOMA,
        "API-Version": "v2",
    }
    if not SIN_TOKEN:
        encabezados["Authorization"] = "Bearer " + obtener_token()
    url = f"{API_BASE}/icd/release/11/{RELEASE}/mms/{ruta}"
    try:
        r = requests.get(url, params=parametros, headers=encabezados, timeout=TIEMPO_ESPERA)
    except requests.RequestException:
        raise HTTPException(502, "No se pudo conectar con la API CIE-11 de la OMS")
    if r.status_code == 401 and not SIN_TOKEN:          # token vencido: se pide otro y se reintenta una vez
        _token["valor"] = None
        encabezados["Authorization"] = "Bearer " + obtener_token()
        r = requests.get(url, params=parametros, headers=encabezados, timeout=TIEMPO_ESPERA)
    if r.status_code != 200:
        raise HTTPException(502, f"La API CIE-11 respondió con error {r.status_code}")
    return r.json()


def limpiar(texto) -> str:
    """Quita las marcas HTML que la OMS usa para resaltar palabras."""
    if isinstance(texto, dict):               # a veces el título viene como {"@value": "..."}
        texto = texto.get("@value", "")
    return re.sub(r"<[^>]+>", "", texto or "").strip()


def buscar_en_oms(q: str, maximo: int) -> list:
    datos = consultar_oms(
        "search",
        {"q": q, "useFlexisearch": "true", "flatResults": "true", "highlightingEnabled": "false"},
    )
    resultados = []
    for e in datos.get("destinationEntities", []):
        codigo = e.get("theCode")
        if not codigo:                          # capítulos y bloques no tienen código
            continue
        resultados.append({
            "codigo": codigo,
            "titulo": limpiar(e.get("title")),
            "uri": e.get("id", ""),
            "puntaje": round(float(e.get("score", 0)), 3),
        })
        if len(resultados) >= maximo:
            break
    return resultados


# ---------------- Rutas que usa la app ----------------
@app.get("/api/cie11/estado")
def estado():
    """La app consulta esto al abrir la ficha para saber si la conexión está lista."""
    return {"configurado": SIN_TOKEN or bool(CLIENT_ID and CLIENT_SECRET), "version": RELEASE, "idioma": IDIOMA}


@app.get("/api/cie11/buscar")
def buscar(q: str = Query(..., min_length=2, max_length=120), maximo: int = Query(8, ge=1, le=20)):
    """Lista de códigos CIE-11 para que el médico elija."""
    return {"version": RELEASE, "resultados": buscar_en_oms(q, maximo)}


@app.get("/api/cie11/codificar")
def codificar(texto: str = Query(..., min_length=2, max_length=120)):
    """Código CIE-11 más probable para un diagnóstico (autocodificación de la OMS)."""
    datos = consultar_oms("autocode", {"searchText": texto, "matchThreshold": "0.75"})
    if datos.get("theCode"):
        return {
            "version": RELEASE,
            "codigo": datos["theCode"],
            "titulo": limpiar(datos.get("matchingText")) or texto,
            "uri": datos.get("linearizationURI", ""),
            "puntaje": round(float(datos.get("matchScore", 0)), 3),
            "origen": "autocodificación OMS",
        }
    # Si la autocodificación no encuentra nada, se usa el primer resultado de la búsqueda
    lista = buscar_en_oms(texto, 1)
    if lista:
        return {"version": RELEASE, **lista[0], "origen": "búsqueda OMS"}
    return {"version": RELEASE, "codigo": None}


# ---------------- IA: repartir el dictado de la atención completa ----------------
# La clave queda en .env (ANTHROPIC_API_KEY), nunca en el navegador. Solo se envía el texto dictado.
# Prototipo con datos ficticios: en la clínica se usaría un modelo instalado en sus propios servidores.
DERIVACIONES = ["Sin derivación", "Cardiología", "Nefrología", "Endocrinología", "Gastroenterología", "Traumatología", "Psiquiatría", "Broncopulmonar"]
CONTROLES = ["Sin control", "En 1 semana", "En 2 semanas", "En 1 mes", "En 3 meses"]
TABACO = ["No fuma", "Fuma", "Exfumador"]
ALCOHOL = ["No consume", "Ocasional", "Frecuente"]

INSTRUCCIONES_IA = f"""Eres un asistente de registro clínico ambulatorio en Chile. Recibes el dictado de un médico sobre una atención
y lo repartes en los campos de una ficha clínica con esquema SOAP. Reglas:
- Usa solo lo que se dijo. No inventes, no interpretes y no agregues diagnósticos, dosis ni datos que no estén en el dictado.
- Conserva las palabras del médico; solo corrige puntuación, mayúsculas y errores evidentes del reconocimiento de voz.
- Lo que cuenta el paciente (síntomas, lo que refiere o niega, antecedentes y medicamentos que usa) va en los campos del relato.
  Lo que observa o decide el médico va en examen, diagnóstico e indicaciones.
- Las negaciones («se descarta ACV», «niega fiebre») se mantienen tal cual en el texto del campo que corresponda.
- Los medicamentos que el paciente ya usa van en "medicamentos"; los que el médico indica hoy van en "recetas".
- Si algo no se dijo, deja el texto vacío "" o el número en null.
Responde SOLO con un objeto JSON, sin texto antes ni después, con estas claves:
{{"motivo": "", "enfermedad_actual": "", "antecedentes": "", "medicamentos": "",
 "tabaco": una de {TABACO} o null, "alcohol": una de {ALCOHOL} o null,
 "signos_vitales": {{"pas": null, "pad": null, "fc": null, "fr": null, "temp": null, "sat": null, "peso": null, "talla": null}},
 "examen_fisico": "", "diagnostico": "", "indicaciones": "", "examenes": "",
 "derivacion": una de {DERIVACIONES[1:]} o null, "control": una de {CONTROLES[1:]} o null,
 "reposo": false, "licencia": false, "dias": null,
 "recetas": [{{"medicamento": "", "dosis": "", "frecuencia": "", "duracion": ""}}]}}
En signos_vitales usa números (temperatura y talla con decimales, talla en metros). El diagnóstico va como lo dijo el médico."""


def _texto(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _num(v):
    try:
        return str(v).replace(".", ",") if v not in (None, "") and float(str(v).replace(",", ".")) > 0 else None
    except ValueError:
        return None


def _indice(v, lista):
    v = (v or "").strip().lower()
    for i, o in enumerate(lista):
        if v and v == o.lower():
            return i
    return None


@app.get("/api/ia/estado")
def ia_estado():
    """La ficha consulta esto para saber si puede ofrecer «Repartir con IA»."""
    return {"configurado": bool(IA_CLAVE), "modelo": IA_MODELO if IA_CLAVE else ""}


@app.post("/api/ia/repartir")
def ia_repartir(datos: dict = Body(...)):
    """Reparte el dictado en los campos de la ficha. Devuelve el mismo formato que las reglas de dictado.js."""
    texto = _texto(datos.get("texto"))
    if len(texto) < 10:
        raise HTTPException(400, "El dictado está vacío o es muy corto")
    if len(texto) > 12000:
        raise HTTPException(400, "El dictado es demasiado largo (máximo 12.000 caracteres)")
    if not IA_CLAVE:
        raise HTTPException(503, "Falta configurar ANTHROPIC_API_KEY en el archivo .env")
    try:
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": IA_CLAVE, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": IA_MODELO, "max_tokens": 3000, "system": INSTRUCCIONES_IA,
                  "messages": [{"role": "user", "content": "Dictado del médico:\n" + texto}]},
            timeout=60,
        )
    except requests.RequestException:
        raise HTTPException(502, "No se pudo conectar con el servicio de IA")
    if r.status_code != 200:
        raise HTTPException(502, f"El servicio de IA respondió con error {r.status_code}")
    salida = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
    m = re.search(r"\{.*\}", salida, re.S)
    try:
        j = json.loads(m.group(0)) if m else None
    except ValueError:
        j = None
    if not isinstance(j, dict):
        raise HTTPException(502, "La IA no devolvió un resultado válido")
    sv = j.get("signos_vitales") or {}
    recetas = []
    for x in j.get("recetas") or []:
        if isinstance(x, dict) and _texto(x.get("medicamento")):
            recetas.append({"med": _texto(x.get("medicamento")), "dosis": _texto(x.get("dosis")),
                            "frec": _texto(x.get("frecuencia")), "dur": _texto(x.get("duracion"))})
    dias = _num(j.get("dias"))
    return {
        "motivo": _texto(j.get("motivo")), "ea": _texto(j.get("enfermedad_actual")),
        "ant": _texto(j.get("antecedentes")), "med": _texto(j.get("medicamentos")),
        "tab": _indice(j.get("tabaco"), TABACO), "alc": _indice(j.get("alcohol"), ALCOHOL),
        "vit": {k: _num(sv.get(k)) for k in ("pas", "pad", "fc", "fr", "temp", "sat", "peso", "talla") if _num(sv.get(k))},
        "ef": _texto(j.get("examen_fisico")), "dx": _texto(j.get("diagnostico")),
        "ind": _texto(j.get("indicaciones")), "exa": _texto(j.get("examenes")),
        "der": _indice(j.get("derivacion"), DERIVACIONES) or None, "ctrl": _indice(j.get("control"), CONTROLES) or None,
        "rep": bool(j.get("reposo")), "lic": bool(j.get("licencia")), "dias": dias.split(",")[0] if dias else None,
        "rx": recetas, "via": "ia", "modelo": IA_MODELO,
    }


# La app (archivos html, css y js) se sirve desde la misma carpeta. Va al final para no tapar /api.
# Solo se entregan archivos de la página: nunca .env, servidor.py ni otros archivos ocultos.
PERMITIDOS = (".html", ".css", ".js", ".png", ".svg", ".ico", ".jpg")


class ArchivosApp(StaticFiles):
    async def get_response(self, path, scope):
        nombre = path.replace("\\", "/")
        es_inicio = nombre in ("", ".")
        oculto = any(parte.startswith(".") for parte in nombre.split("/") if parte not in ("", "."))
        if not es_inicio and (oculto or not nombre.lower().endswith(PERMITIDOS)):
            raise HTTPException(404, "No encontrado")
        return await super().get_response(path, scope)


app.mount("/", ArchivosApp(directory=CARPETA, html=True), name="app")
