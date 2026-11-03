"""Exporta tablas de valores críticos de statsmodels a JSON.

Uso (local, no se ejecuta en Vercel):
    .venv-econ/bin/python -I scripts/econ/export_tables.py

Fuentes:
  - MacKinnon (1994, 2010): p-valores y valores críticos de Dickey-Fuller
    (statsmodels.tsa.adfvalues).
  - Osterwald-Lenum (1992) / MacKinnon-Haug-Michelis: valores críticos de las
    pruebas de traza y máximo autovalor de Johansen
    (statsmodels.tsa.coint_tables).
"""
import json
import pathlib

import numpy as np
import statsmodels
import statsmodels.tsa.adfvalues as a
import statsmodels.tsa.coint_tables as ct

out = {
    "source": f"statsmodels {statsmodels.__version__}",
    "adf": {
        reg: {
            "max": [None if np.isinf(v) else float(v) for v in a._tau_maxs[reg]],  # inf → null
            "min": list(map(float, a._tau_mins[reg])),
            "star": list(map(float, a._tau_stars[reg])),
            "smallp": [list(map(float, r)) for r in a._tau_smallps[reg]],
            "largep": [list(map(float, r)) for r in a._tau_largeps[reg]],
            # crit2010[N-1][nivel 1%,5%,10%][coef 0..3]
            "crit2010": a.tau_2010s[reg].tolist(),
        }
        for reg in ("n", "c", "ct", "ctt")
    },
    "johansen": {
        str(p): {
            "maxeig": [ct.c_sja(n, p).tolist() for n in range(1, 13)],
            "trace": [ct.c_sjt(n, p).tolist() for n in range(1, 13)],
        }
        for p in (-1, 0, 1)
    },
}
dest = pathlib.Path(__file__).resolve().parents[2] / "src/lib/econ/tables.json"
dest.write_text(json.dumps(out, separators=(",", ":")) + "\n")
print("ok", dest, dest.stat().st_size, "bytes")
