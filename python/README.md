# Procesos estadísticos en Python (fases futuras)

Reservado para los módulos de Econometría y Simulador. En la Fase 1 no hay
código Python: la ingesta y la normalización están en TypeScript.

Cuando se implemente, los procesos leerán directamente de PostgreSQL con la
misma `DATABASE_URL` y escribirán resultados como series calculadas
(`indicators.value_kind = 'calculated'` con su `derivation`) o como
`saved_analyses`, manteniendo la trazabilidad hasta las series de origen.

Dependencias previstas (open source): `pandas`, `numpy`, `statsmodels`, `psycopg[binary]`.
