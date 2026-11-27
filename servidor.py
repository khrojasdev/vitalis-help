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
import os
import re
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
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
    allow_methods=["GET"],
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
