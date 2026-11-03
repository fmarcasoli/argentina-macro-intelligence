# Python en el proyecto

Los módulos de Econometría y Simulador (Fase 3) se implementaron en
TypeScript (`src/lib/econ/`) y corren en un Web Worker del navegador: así los
cálculos no bloquean las funciones de Vercel ni exceden sus límites de tamaño
(statsmodels + numpy + scipy no entran en una función del plan Hobby).

Python se usa **solo localmente**, como referencia de verificación:
`scripts/econ/` exporta las tablas de valores críticos de statsmodels y genera
los resultados con los que los tests comparan el motor. Ver
[`docs/ECONOMETRICS.md`](../docs/ECONOMETRICS.md).

```bash
npm run econ:setup       # crea .venv-econ (statsmodels 0.14.4, scipy, numpy, pandas)
npm run econ:reference   # regenera tests/fixtures/econ/reference.json
```
