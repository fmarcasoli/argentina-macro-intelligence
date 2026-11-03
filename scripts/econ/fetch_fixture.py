"""Descarga series oficiales del INDEC (API Series de Tiempo) para los tests econométricos.

Uso: .venv-econ/bin/python -I scripts/econ/fetch_fixture.py
Guarda tests/fixtures/econ/indec-real.json con los valores tal como los publica la API.
"""
import datetime
import json
import pathlib
import urllib.request

SERIES = {
    "ipc": "148.3_INIVELNAL_DICI_M_26",
    "emae": "143.3_NO_PR_2004_A_21",
    "salarios": "149.1_TL_INDIIOS_OCTU_0_21",
}
url = (
    "https://apis.datos.gob.ar/series/api/series/?ids="
    + ",".join(SERIES.values())
    + "&start_date=2017-01-01&end_date=2026-06-01&format=json&limit=1000"
)
req = urllib.request.Request(url, headers={"User-Agent": "argentina-macro-intelligence/0.1 (tests)"})
with urllib.request.urlopen(req, timeout=60) as r:
    payload = json.load(r)
rows = payload["data"]
out = {
    "note": f"API Series de Tiempo (apis.datos.gob.ar), descargado {datetime.date.today()}. Valores sin transformar.",
    "url": url,
    "series": {
        name: [[row[0], row[i + 1]] for row in rows if row[i + 1] is not None]
        for i, name in enumerate(SERIES)
    },
}
dest = pathlib.Path(__file__).resolve().parents[2] / "tests/fixtures/econ/indec-real.json"
dest.write_text(json.dumps(out, indent=0) + "\n")
print({k: (len(v), v[0], v[-1]) for k, v in out["series"].items()})
