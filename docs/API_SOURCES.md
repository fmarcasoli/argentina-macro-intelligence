# Fuentes oficiales: documentación de APIs

Todo lo que figura acá fue **verificado contra las APIs en vivo el 2026-11-02**
(con `curl` y con los tests de `tests/live`). Donde la documentación de terceros
decía otra cosa, prevalece lo observado y se indica.

| | BCRA | INDEC |
|---|---|---|
| API | Estadísticas Monetarias **v4.0** | API de **Series de Tiempo** de la República Argentina |
| Base URL | `https://api.bcra.gob.ar/estadisticas/v4.0` | `https://apis.datos.gob.ar/series/api` |
| Responsable | BCRA | Dirección Nacional de Datos e Información Pública (publica las series del INDEC) |
| Autenticación | No | No |
| Formato | JSON | JSON / CSV |
| Máx. por llamada | 3000 registros (`Limit`) | 5000 valores por serie (`limit`), 40 series por llamada |
| Rate limit publicado | No | No |
| Conector | `src/lib/connectors/bcra.ts` → `BCRAConnector` | `src/lib/connectors/indec.ts` → `INDECConnector` |

> **Sobre el INDEC.** El INDEC no expone una API REST propia para sus series
> estadísticas: las publica a través de la API oficial de Series de Tiempo del
> Estado Nacional (`apis.datos.gob.ar`), que es la fuente que usa el
> `INDECConnector`. Solo se consideran del INDEC las series cuyo campo
> `dataset.source` es "Instituto Nacional de Estadística y Censos (INDEC)".

---

## 1. BCRA — Estadísticas Monetarias v4.0

Documentación oficial: <https://www.bcra.gob.ar/apis-banco-central/>

### Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/Monetarias` | Catálogo de variables (1610 al 2026-11-02) |
| GET | `/Monetarias/{IdVariable}` | Serie histórica de una variable |
| GET | `/Metodologia` | Índice de fichas metodológicas |
| GET | `/Metodologia/{IdVariable}` | Ficha metodológica de una variable |

### Parámetros

`/Monetarias` (catálogo): `IdVariable`, `Categoria`, `Periodicidad`, `Moneda`,
`TipoSerie`, `UnidadExpresion`, `Limit` (≤ 3000), `Offset`.

`/Monetarias/{id}` (serie): `Desde` y `Hasta` (`YYYY-MM-DD`, inclusivos),
`Limit` (≤ 3000; con 3001 responde `400 "El límite no puede superar los 3000 registros."`), `Offset`.

### Respuesta

```json
{
  "status": 200,
  "metadata": { "resultset": { "count": 7590, "offset": 0, "limit": 3 } },
  "results": [{ "idVariable": 1, "detalle": [{ "fecha": "2026-10-29", "valor": 50164.0 }] }]
}
```

- `detalle` viene ordenado **de la fecha más reciente a la más antigua**.
- `metadata.resultset.count` informa el total → el conector pagina con `Offset`
  hasta completarlo y la sincronización completa valida que se recibió todo.
- Catálogo: `idVariable, descripcion, categoria, tipoSerie, periodicidad (D|M), unidadExpresion, moneda, primerFechaInformada, ultFechaInformada, ultValorInformado`.
- Errores: `{"status":400,"errorMessages":["Parámetro erróneo: ..."]}` con HTTP 400.

### Frecuencias, fechas y unidades

| Periodicidad | Fecha informada | Cómo se guarda |
|---|---|---|
| `D` diaria | el día | `ref_date` = ese día |
| `M` mensual | **último día del mes** (ej. `2026-08-31`) | `ref_date` = `2026-08-01`, `source_ref_date` = `2026-08-31` |

- Las unidades son texto libre (`En millones de USD`, `En miles de ARS`,
  `En porcentaje nominal anual`, `Índice base 2.2.02=1`…). Se guardan sin convertir.
- **CER, UVA, UVI, ICL y bandas cambiarias se publican con fechas futuras**
  (valores ya determinados). Se guardan con `is_scheduled = true` y pasan a
  observados cuando llega la fecha (hora de Buenos Aires).

### Hallazgos de la verificación

- **El WAF del BCRA responde `502` si el `User-Agent` contiene caracteres no ASCII.** El cliente usa un UA ASCII (hay un test que lo garantiza).
- La guía de terceros indicaba que el ID 26 era la tasa de política monetaria: **es "Préstamos de las entidades financieras al sector privado"**.
- La tasa de política monetaria (IDs 160/161) no tiene datos desde **2025-07-10**.
- M1/M2/M3 diarios del Informe Monetario Diario (IDs 1232–1234) dejaron de actualizarse en mayo 2026. Se usan los **mensuales vigentes** (1612, 1618, 1624, en miles de ARS) y el M2 diario de la planilla de series (109).

### Series sincronizadas (BCRA)

| ID interno | IdVariable | Serie | Frec. | Unidad |
|---|---|---|---|---|
| bcra.reservas | 1 | Reservas internacionales | D | Millones de USD |
| bcra.tc_minorista | 4 | Tipo de cambio minorista (promedio vendedor) | D | $/USD |
| bcra.tc_mayorista | 5 | Tipo de cambio mayorista de referencia | D | $/USD |
| bcra.banda_inferior / superior | 1187 / 1188 | Bandas cambiarias | D | $/USD |
| bcra.base_monetaria | 15 | Base monetaria | D | Millones de ARS |
| bcra.circulacion | 16 | Circulación monetaria | D | Millones de ARS |
| bcra.m1 / m2 / m3 | 1612 / 1618 / 1624 | Agregados en moneda local | M | Miles de ARS |
| bcra.m2_diario | 109 | M2 | D | Millones de ARS |
| bcra.m2_privado_yoy | 25 | Var. i.a. M2 privado (prom. 30 d) | D | % |
| bcra.prestamos_privados | 26 | Préstamos al sector privado | D | Millones de ARS |
| bcra.cer | 30 | CER | D | Índice 2.2.02=1 |
| bcra.uva / uvi | 31 / 32 | UVA / UVI | D | ARS |
| bcra.icl | 40 | Índice para Contratos de Locación | D | Índice |
| bcra.badlar / tm20 / tamar | 7 / 8 / 44 | Tasas de bancos privados | D | % TNA |
| bcra.plazo_fijo_30d | 12 | Depósitos a 30 días | D | % TNA |
| bcra.baibar | 11 | Interbancaria | D | % TNA |
| bcra.pases_terceros_1d | 150 | Pases entre terceros 1 día | D | % TNA |
| bcra.adelantos / personales | 13 / 14 | Tasas activas | D | % TNA |
| bcra.tasa_politica | 160 | Tasa de política monetaria (discontinuada) | D | % TNA |
| bcra.inflacion_mensual / interanual | 27 / 28 | Inflación publicada por BCRA | M | % |
| bcra.rem_inflacion_12m | 29 | REM: inflación esperada 12 meses | M | % |
| bcra.m2_transaccional | 197 | M2 transaccional del sector privado | D | Millones de ARS |
| bcra.depositos_privados_pesos | 100 | Depósitos del sector privado en pesos (incluye CEDROS) | D | Millones de ARS |
| bcra.depositos_privados_usd | 108 | Depósitos del sector privado en dólares | D | Millones de USD |
| bcra.prestamos_privados_usd | 125 | Préstamos al sector privado en dólares | D | Millones de USD |
| bcra.prestamos_personales / tarjetas / hipotecarios | 114 / 115 / 112 | Préstamos por línea (pesos) | D | Millones de ARS |
| bcra.liquidez_pesos | 1221 | Liquidez en pesos de las entidades | D | % de depósitos |

---

## 2. INDEC — API de Series de Tiempo

Documentación oficial: <https://datosgobar.github.io/series-tiempo-ar-api/> ·
Código: <https://github.com/datosgobar/series-tiempo-ar-api>

### Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/series/` | Valores de una o más series |
| GET | `/search/` | Búsqueda de series por texto (`q`, `limit`) |
| GET | `/dump/series-tiempo-metadatos.csv/` | Catálogo completo (~26 MB, ~34.600 series; 10.527 del INDEC) |

### Parámetros de `/series/`

| Parámetro | Uso |
|---|---|
| `ids` | IDs separados por coma (máx. **40**; con 41 responde `400`) |
| `start_date`, `end_date` | Rango (`YYYY-MM-DD`) |
| `limit` | Valores por serie (máx. **5000**; con 5001 responde `400`) |
| `start` | Offset para paginar |
| `last` | Últimos N valores (incompatible con `limit`/`start`/`sort`) |
| `metadata` | `none` · `only` · `simple` · `full` |
| `representation_mode` | `value`, `percent_change`, `percent_change_a_year_ago`, … (no se usa: los cálculos se hacen y registran en la plataforma) |
| `collapse`, `collapse_aggregation` | Agregación temporal (no se usa) |
| `format` | `json` · `csv` |

### Respuesta

```json
{ "data": [["2026-08-01", 8882.58]], "count": 416,
  "meta": [{ "frequency": "month", "start_date": "...", "end_date": "..." },
           { "dataset": {...}, "distribution": {...}, "field": {...} }] }
```

- `data` es una lista de pares `[fecha, valor]`; el valor puede ser `null` (se conserva como faltante).
- Las fechas son **el inicio del período** (`2026-08-01` = agosto 2026; trimestres `2026-04-01` = T2).
- `field` trae `units`, `frequency` (`R/P1M`, `R/P3M`, …), `time_index_start/end`, `is_percentage`.
- Errores: `{"errors":[{"error":"Serie inexistente: X"}]}` con HTTP 400.

### Hallazgos de la verificación

- **`is_percentage` no es confiable**: la variación mensual del IPC (`145.3_INGNACUAL_DICI_M_38`) viene como proporción (`0.0166` = 1,66 %) y la API informa `is_percentage: false`. Por eso el factor de escala (`scale = 100`) se declara explícitamente en el registro y el dato se marca como `normalized`.
- Lo mismo ocurre con las tasas de la EPH (desocupación `0.079`, empleo, actividad) y la pobreza (`0.323`), aunque la unidad publicada dice "Porcentaje". En las series núcleo se normalizan (×100); las series del catálogo abiertas a pedido conservan el valor tal como lo publica la fuente.
- La serie de la API puede llevar un rezago respecto del calendario del INDEC (ej. EMAE y salarios al 2026-11-02 llegan hasta julio). La plataforma lo refleja con el estado **Desactualizada**.

### Series sincronizadas (INDEC)

| ID interno | ID de serie | Serie | Frec. |
|---|---|---|---|
| indec.ipc_nivel_general | 148.3_INIVELNAL_DICI_M_26 | IPC Nivel General Nacional (dic-2016=100) | M |
| indec.ipc_nucleo | 148.3_INUCLEONAL_DICI_M_19 | IPC Núcleo Nacional | M |
| indec.ipc_regulados | 148.3_IREGULANAL_DICI_M_22 | IPC Regulados Nacional | M |
| indec.ipc_var_mensual | 145.3_INGNACUAL_DICI_M_38 | IPC variación mensual (×100, normalizada) | M |
| indec.emae | 143.3_NO_PR_2004_A_21 | EMAE original (2004=100) | M |
| indec.emae_desest | 143.3_NO_PR_2004_A_31 | EMAE desestacionalizado | M |
| indec.pib_real | 4.2_OGP_2004_T_17 | PIB a precios de 2004 | Q |
| indec.pib_nominal | 166.2_PPIB_0_0_3 | PIB a precios corrientes | Q |
| indec.consumo_publico_real | 4.2_DGCP_2004_T_30 | Consumo público a precios de 2004 | Q |
| indec.salarios | 149.1_TL_INDIIOS_OCTU_0_21 | Índice de salarios total (oct-2016=100) | M |
| indec.salarios_registrado | 149.1_TL_REGIADO_OCTU_0_16 | Índice de salarios registrado | M |
| indec.salarios_privado_reg | 149.1_SOR_PRIADO_OCTU_0_25 | Índice de salarios privado registrado | M |
| indec.salarios_publico | 149.1_SOR_PUBICO_OCTU_0_14 | Índice de salarios sector público | M |
| indec.exportaciones | 74.3_IET_0_M_16 | Exportaciones totales (millones USD) | M |
| indec.importaciones | 74.3_IIT_0_M_25 | Importaciones totales (millones USD) | M |
| indec.saldo_comercial | 74.3_ISC_0_M_19 | Saldo comercial (millones USD) | M |
| indec.desempleo | 45.2_ECTDT_0_T_33 | Tasa de desocupación, 31 aglomerados (EPH; ×100, normalizada) | Q |
| indec.tasa_empleo | 44.2_ECTET_0_T_30 | Tasa de empleo (×100, normalizada) | Q |
| indec.tasa_actividad | 43.2_ECTAT_0_T_33 | Tasa de actividad (×100, normalizada) | Q |
| indec.pobreza | 64.2_POBLACION_NUA_0_0_34_74 | Personas bajo la línea de pobreza, total aglomerados (×100, normalizada) | S |
| indec.gini | 65.1_CGI_0_0_21 | Coeficiente de Gini del ingreso per cápita familiar | Q |
| indec.isac / isac_desest | 33.2_ISAC_NIVELRAL_0_M_18_63 / 33.2_ISAC_SIN_EDAD_0_M_23_56 | ISAC nivel general / desestacionalizado | M |
| indec.ipi_manufacturero / _desest | 453.1_SERIE_ORIGNAL_0_0_14_46 / 453.1_SERIE_DESEADA_0_0_24_58 | IPI manufacturero | M |
| indec.ventas_supermercados | 455.1_VENTAS_TOTNTA_0_M_26_88 | Ventas totales en supermercados (miles de pesos) | M |
| indec.poblacion | 9.2_P_2004_T_9 | Población de Argentina | Q |
| indec.pib_per_capita_usd | 9.2_PPCDC_2004_T_33 | PIB per cápita en dólares corrientes | Q |
| indec.viajeros / pernoctaciones | 457.1_VIAJEROS_TLES_0_M_16_50 / 457.1_PERNOCTACILES_0_M_22_51 | Encuesta de Ocupación Hotelera | M |

### Series calculadas por la plataforma

| ID | Cálculo | Base |
|---|---|---|
| calc.ipc_var_mensual | (IPCₜ / IPCₜ₋₁ − 1) × 100 | indec.ipc_nivel_general |
| calc.ipc_var_interanual | (IPCₜ / IPCₜ₋₁₂ − 1) × 100 | indec.ipc_nivel_general |
| calc.ipc_nucleo_var_mensual | variación mensual | indec.ipc_nucleo |
| calc.emae_var_interanual | variación interanual | indec.emae |
| calc.emae_desest_var_mensual | variación mensual | indec.emae_desest |
| calc.pib_real_var_interanual | variación vs. mismo trimestre año anterior | indec.pib_real |
| calc.salarios_var_interanual | variación interanual | indec.salarios |
| calc.ipc_var_acumulada | (IPCₜ / IPC_dic(año−1) − 1) × 100 | indec.ipc_nivel_general |
| calc.salarios_reales | (Wₜ / W_dic16) / (IPCₜ / IPC_dic16) × 100 | indec.salarios, indec.ipc_nivel_general |
| calc.salarios_reales_var_interanual | variación interanual | calc.salarios_reales |

Validación cruzada: `calc.ipc_var_mensual` coincide con la variación publicada
por el INDEC (`indec.ipc_var_mensual`) hasta la 12.ª cifra, y con la del BCRA
(`bcra.inflacion_mensual`, redondeada a un decimal).

---

## 3. Métodos de actualización

| Modo | Cómo | Qué descarga |
|---|---|---|
| Completa | `npm run sync:full` | Todo el histórico disponible |
| Incremental | `npm run sync` · Vercel Cron → `/api/sync?source=…` | Desde `último dato − ventana de revisión` |

Ventanas de revisión (tabla `app_settings`, clave `sync.revision_lookback`):
diaria 45 días · mensual 730 días · trimestral 1460 días. Re-descargar esa
ventana permite capturar revisiones de la fuente: si un valor cambia, el
anterior queda en `observation_revisions`.

Umbrales de "desactualizada" (`sync.stale_after_days`): días sin dato nuevo
contados desde el **fin** del período de referencia (diaria 7, mensual 75,
trimestral 200).

### Descarga a pedido (Fase 2)

Las ~12.000 series del catálogo se registran sin datos. La primera vez que
alguien abre una de ellas (ficha del indicador o constructor de análisis) se
descarga su histórico completo con el mismo motor de ingesta
(`src/lib/ingest/on-demand.ts`): normalización, validación, registro de la
corrida (`sync_runs.triggered_by = 'on_demand'`) y de los errores. Desde ese
momento queda incluida en la actualización diaria
(`indicators.tracked_on_demand_at`).

Para respetar el tiempo máximo de la función (300 s), el cron procesa las
series de origen de la menos a la más recientemente sincronizada y deja de
descargar a los 220 s; las pendientes siguen en la ejecución siguiente. Las
series calculadas se recalculan siempre, en orden de dependencias.
