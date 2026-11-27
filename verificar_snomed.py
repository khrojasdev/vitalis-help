"""
Vitalis Help · verifica el catálogo snomed.js contra un servidor terminológico FHIR (por ejemplo Snowstorm).

Para cada concepto revisa:
  1. que el SCTID exista y esté activo,
  2. que el nombre en inglés (FSN) coincida con el del servidor.

Uso (en la terminal, dentro de esta carpeta):
  python verificar_snomed.py
  python verificar_snomed.py http://localhost:8080/fhir

Por defecto usa la dirección de la variable SNOMED_FHIR del archivo .env, o http://localhost:8080/fhir.
El resultado queda en verificacion_snomed.csv para revisarlo en Excel.
"""
import csv
import json
import os
import re
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

CARPETA = Path(__file__).resolve().parent
load_dotenv(CARPETA / ".env")
SERVIDOR = (sys.argv[1] if len(sys.argv) > 1 else os.getenv("SNOMED_FHIR", "http://localhost:8080/fhir")).rstrip("/")


def leer_catalogo():
    texto = (CARPETA / "snomed.js").read_text(encoding="utf-8")
    inicio = texto.index("[", texto.index("VITALIS_SNOMED"))
    fin = texto.rindex("]") + 1
    return json.loads(texto[inicio:fin])


def buscar_concepto(sctid):
    r = requests.get(f"{SERVIDOR}/CodeSystem/$lookup",
                     params={"system": "http://snomed.info/sct", "code": sctid, "property": "inactive"},
                     headers={"Accept": "application/fhir+json"}, timeout=20)
    if r.status_code == 404 or (r.status_code == 400 and "not found" in r.text.lower()):
        return None, None
    r.raise_for_status()
    nombre, inactivo = "", False
    for p in r.json().get("parameter", []):
        if p.get("name") == "display":
            nombre = p.get("valueString", "")
        if p.get("name") == "property":
            partes = {x.get("name"): x for x in p.get("part", [])}
            if partes.get("code", {}).get("valueCode") == "inactive":
                inactivo = partes.get("value", {}).get("valueBoolean", False)
    return nombre, inactivo


def main():
    catalogo = leer_catalogo()
    print(f"Verificando {len(catalogo)} conceptos en {SERVIDOR} ...")
    filas, problemas = [], 0
    for sctid, termino, fsn, _frases in catalogo:
        try:
            nombre, inactivo = buscar_concepto(sctid)
        except requests.RequestException as e:
            sys.exit(f"No se pudo consultar el servidor ({e}). Revise que Snowstorm esté iniciado.")
        if nombre is None:
            resultado = "NO EXISTE"
        elif inactivo:
            resultado = "INACTIVO"
        elif re.sub(r"\s+", " ", nombre).lower() != fsn.lower() and nombre.lower() not in fsn.lower():
            resultado = "NOMBRE DISTINTO"
        else:
            resultado = "OK"
        if resultado != "OK":
            problemas += 1
            print(f"  {resultado:<16} {sctid:<12} {termino}  (servidor: {nombre or '—'})")
        filas.append([sctid, termino, fsn, nombre or "", resultado])
    with open(CARPETA / "verificacion_snomed.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["SCTID", "Término", "FSN en la app", "Nombre en el servidor", "Resultado"])
        w.writerows(filas)
    print(f"Listo: {len(catalogo) - problemas} conceptos sin observaciones y {problemas} para revisar. Detalle en verificacion_snomed.csv")


if __name__ == "__main__":
    main()
