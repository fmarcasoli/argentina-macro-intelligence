# ARGENTINA MACRO INTELLIGENCE

Plataforma profesional de análisis macroeconómico de Argentina, construida sobre
datos oficiales del **INDEC** y del **BCRA**.

- **Fase 1 — Fundación:** infraestructura de datos (fuentes, catálogo, ingesta,
  calidad), base de datos, interfaz y navegación.
- **Fase 2 — Dashboards y análisis:** dashboard ejecutivo, paneles INDEC y BCRA
  por categorías con buscador, fichas con gráfico interactivo, motor de
  gráficos (transformaciones, frecuencia común, zoom, exportaciones), constructor
  de análisis integrado INDEC + BCRA, calculadoras económicas y guardado de
  análisis y favoritos. Detalle en [`docs/ANALYSIS.md`](docs/ANALYSIS.md).
- **Fase 3 — Motor econométrico y simulador:** estadística descriptiva,
  transformaciones reproducibles, correlaciones, regresiones MCO con
  diagnósticos, raíz unitaria (ADF, KPSS), ARIMA, VAR (Granger,
  impulso-respuesta), cointegración (Engle-Granger, Johansen, VECM),
  proyecciones con bandas, backtesting sin información futura y simulador
  macroeconómico (identidades, escenarios del usuario y shocks en un VAR).
  Verificado contra statsmodels. Detalle en [`docs/ECONOMETRICS.md`](docs/ECONOMETRICS.md).

- **Fase 4 — MACRO AI:** asistente de investigación con herramientas
  validadas sobre los datos (búsqueda, cálculos, comparaciones, correlaciones,
  regresiones, rezagos, econometría, proyecciones, gráficos, anomalías e
  informes), modelo local gratuito con Ollama (o sin modelo, con reglas),
  verificación de cifras, memoria de investigación con controles de
  privacidad e informes automáticos exportables a PDF, Excel y CSV. Detalle en
  [`docs/MACRO_AI.md`](docs/MACRO_AI.md).

El constructor de indicadores sigue “en construcción”.

### MACRO AI en 3 pasos (opcional, gratis)

```bash
brew install ollama        # o https://ollama.com/download
ollama pull qwen2.5:7b     # ~4,7 GB; requiere ~8 GB de memoria libre
ollama serve               # la app de escritorio lo deja corriendo sola
```

Abrir `/macro-ai` → **Modelo** → "Ollama local". Para usarlo desde la versión
publicada, autorizar el origen (`OLLAMA_ORIGINS`), ver
[`docs/MACRO_AI.md`](docs/MACRO_AI.md). Sin Ollama, MACRO AI responde igual con
reglas y cálculos, y los informes no requieren ningún modelo.

| | |
|---|---|
| Frontend | Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS 4 · shadcn/ui · Recharts |
| Datos | PostgreSQL (Supabase en producción; Postgres embebido en desarrollo) |
| Ingesta | Conectores TypeScript `BCRAConnector` e `INDECConnector` |
| Despliegue | Vercel (Hobby) + Supabase (Free) |
| Econometría | Motor TypeScript propio en un Web Worker (sin cálculo en Vercel) · Python/statsmodels solo local, como referencia de los tests |
| Tests | Vitest: conectores, normalizadores, cálculos, econometría contra statsmodels, integración con Postgres, verificación en vivo |

## Estado de los datos (2026-11-03)

- **12.145 series** en el catálogo (1.610 BCRA + 10.527 INDEC; 905 discontinuadas por la fuente), clasificadas en 26 categorías de panel.
- **77 series núcleo** sincronizadas (37 BCRA + 30 INDEC + 10 calculadas), **~166.000 observaciones** históricas.
- Cualquier otra serie del catálogo se **descarga a pedido** al abrirla y desde entonces se actualiza todos los días.
- Las 67 series de origen verificadas contra las APIs en vivo (`npm run test:live`).

Detalle de endpoints, parámetros, límites y hallazgos: [`docs/API_SOURCES.md`](docs/API_SOURCES.md).
Esquema y reglas de calidad: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

---

## Ejecución local

Requisitos: **Node.js ≥ 20.9** (probado con 24). No hace falta Docker ni
instalar PostgreSQL: el proyecto incluye un Postgres embebido open source.

```bash
npm install
cp .env.example .env.local
```

En una terminal, levantar la base local (queda corriendo; datos en `.data/postgres`):

```bash
npm run db:start
```

En otra terminal, crear el esquema, registrar el catálogo y descargar el histórico (~30 s):

```bash
npm run setup
```

Opcional: registrar en el catálogo **todas** las series de ambas fuentes (~12.000, sin descargar sus datos):

```bash
npm run catalog:discover
```

Levantar la aplicación en <http://localhost:3000>:

```bash
npm run dev
```

### Scripts

| Script | Qué hace |
|---|---|
| `npm run db:start` | Postgres local embebido en el puerto 54329 |
| `npm run db:migrate` | Aplica las migraciones pendientes de `supabase/migrations` |
| `npm run catalog:seed` | Registra/actualiza las series núcleo, verificándolas contra la fuente |
| `npm run catalog:discover` | Registra todas las series publicadas por BCRA e INDEC (no sincronizadas) |
| `npm run catalog:classify` | Recalcula la categoría de panel de todo el catálogo |
| `npm run sync` | Actualización incremental (con ventana de revisión) |
| `npm run sync:full` | Recarga completa del histórico |
| `npm run sync -- --source=BCRA` | Solo una fuente |
| `npm run sync -- bcra.reservas indec.emae` | Solo algunos indicadores |
| `npm run setup` | `db:migrate` + `catalog:seed` + `sync:full` |
| `npm test` | Tests unitarios (+ integración si hay `TEST_DATABASE_URL`) |
| `npm run test:live` | Verifica cada serie del registro contra las APIs reales |
| `npm run typecheck` · `npm run lint` | Chequeos estáticos |
| `npm run econ:setup` | Crea `.venv-econ` con statsmodels (solo para regenerar referencias) |
| `npm run econ:fixtures` · `econ:tables` · `econ:reference` | Descarga datos oficiales de prueba, exporta tablas de valores críticos y regenera los resultados de referencia de statsmodels |

### Tests

```bash
npm test
```

Para incluir los tests de integración contra Postgres (la base indicada se **borra**):

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/ami_test npm test
```

(crear antes la base `ami_test` en el Postgres local). Cubren: paginación y
errores de ambos conectores con respuestas reales grabadas
(`tests/fixtures`), normalización de fechas/valores, rechazo y registro de
datos inválidos, preservación de faltantes, cálculos derivados, revisiones,
actualización incremental y restricciones de la base.

Fase 2: cambio de frecuencia y períodos incompletos, transformaciones
(variaciones, base 100, valores reales), detección de períodos faltantes,
unidades y advertencias metodológicas, calculadoras (inflación validada contra
el 117,8 % oficial de 2024 y contra la variación mensual publicada, Fisher,
devaluación, salarios reales), clasificación de categorías, descarga a pedido,
orden de series derivadas, límite de tiempo del cron y espacios de trabajo.

Fase 3: cada método econométrico se compara contra statsmodels/scipy sobre
datos oficiales del INDEC y datos sintéticos con semilla fija
(`tests/econ-reference.test.ts`: MCO y errores robustos, diagnósticos, ADF,
KPSS, MacKinnon, Engle-Granger, descomposición, HP, ACF/PACF, ARIMA, VAR,
Granger, impulso-respuesta, FEVD, Johansen y VECM), más propiedades propias
(`tests/econ-engine.test.ts`: recetas reproducibles, alineación, ausencia de
información futura en el backtesting, vintages, identidades del simulador).

---

## Despliegue

### 1. Supabase (plan gratuito)

1. Crear un proyecto en <https://supabase.com>.
2. Aplicar las migraciones. Opción A, con este repo:
   ```bash
   DATABASE_URL="postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" npm run db:migrate
   ```
   Opción B, con la CLI de Supabase: `supabase link` y `supabase db push`.
   La migración `…_supabase_rls.sql` detecta el esquema `auth` y activa
   **Row Level Security**: lectura pública de catálogo y observaciones,
   escritura solo desde el backend, y tablas de usuario visibles solo por su dueño.
3. Cargar los datos desde tu máquina (la carga completa no entra en el tiempo
   máximo de una función serverless):
   ```bash
   DATABASE_URL="…:5432/postgres" npm run catalog:seed
   ```
   ```bash
   DATABASE_URL="…:5432/postgres" npm run sync:full
   ```

Uso estimado: ~125 mil observaciones + 12 mil series de catálogo ≈ 40–60 MB,
dentro de los 500 MB del plan gratuito.

### 2. Vercel (plan Hobby)

1. Importar el repositorio en Vercel (framework: Next.js, sin cambios de build).
2. Variables de entorno:
   - `DATABASE_URL`: cadena del **Transaction pooler** de Supabase (puerto **6543**). El cliente desactiva los prepared statements automáticamente para el pooler.
   - `CRON_SECRET`: valor aleatorio (`openssl rand -hex 32`). Vercel lo envía en `Authorization: Bearer …` a los cron jobs.
3. `vercel.json` define dos cron jobs diarios (Hobby permite una ejecución
   diaria por job): `/api/sync?source=BCRA` a las 22:00 UTC y
   `/api/sync?source=INDEC` a las 22:30 UTC. Cada uno es incremental, tarda
   ~5–15 s y tiene `maxDuration = 300` (máximo del plan Hobby con Fluid Compute).

Las páginas se sirven con un shell estático y los datos se leen en cada
request (sin congelar datos en el build), por lo que el build no necesita
acceso a la base.

### Variables de entorno

| Variable | Requerida | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión PostgreSQL |
| `CRON_SECRET` | En producción | Protege `/api/sync` |
| `DATABASE_POOL_MAX` | No | Tamaño del pool (por defecto 5; 3 con pooler) |
| `TEST_DATABASE_URL` | No | Habilita tests de integración |
| `LIVE_API_TESTS` | No | `1` habilita tests contra las APIs reales |

No hay credenciales en el código: `.env*` está en `.gitignore` (salvo `.env.example`).

---

## API interna

| Endpoint | Descripción |
|---|---|
| `GET /api/health` | Estado de la base y conteos |
| `GET /api/indicators?q=&source=&tracked=&freq=&limit=&offset=` | Catálogo |
| `GET /api/indicators/{id}/observations?from=&to=&format=json\|csv` | Observaciones con trazabilidad (valor crudo, fecha de la fuente, tipo, publicación, revisiones) |
| `GET /api/sync?source=BCRA\|INDEC` | Sincronización incremental (requiere `Authorization: Bearer $CRON_SECRET`) |
| `GET /api/series?ids=a,b&ipc=1` | Series para el motor de gráficos (descarga a pedido las que no tienen datos) |
| `GET /api/ai/status` · `POST /api/ai/chat` | Estado de MACRO AI y modo servidor (reenvía al modelo configurado) |
| `GET/POST /api/ai/conversations` · `/{id}` · `/api/ai/spaces` · `/api/ai/notes` | Memoria de investigación del espacio de trabajo |
| `GET/DELETE /api/ai/memory` | Exportar o borrar toda la memoria |
| `GET /api/series/vintages?id=` | Disponibilidad de cada observación y su historial de revisiones (backtesting sin información futura) |
| `GET/POST /api/workspace/analyses` · `/{id}` | Análisis guardados del espacio de trabajo |
| `GET/POST/DELETE /api/workspace/favorites` | Series favoritas |

---

## Estructura

```
src/
  app/                      páginas (App Router) y rutas /api
  components/               layout, gráficos (Recharts), UI
  lib/
    analysis/               motor de análisis y calculadoras (funciones puras)
    econ/                   motor econométrico y simulador (funciones puras + Web Worker)
    ai/                     MACRO AI: herramientas, agente, planificador, informes, anomalías
    connectors/             BCRAConnector, INDECConnector, cliente HTTP
    normalize/              normalización, validación, fechas, series derivadas
    ingest/                 catálogo, motor de sincronización y descarga a pedido
    catalog/registry.ts     series núcleo (semilla del catálogo)
    catalog/panels.ts       categorías de los paneles INDEC y BCRA
    data/queries.ts         lecturas para la interfaz
    db/                     cliente Postgres y migrador
scripts/                    CLI: db local, migraciones, catálogo, sync
scripts/econ/               Python local: tablas de valores críticos y referencias statsmodels
supabase/migrations/        esquema SQL
tests/                      unitarios, integración, en vivo y fixtures reales
docs/                       documentación de APIs, modelo de datos, análisis y econometría
```

## Navegación

| # | Sección | Estado |
|---|---|---|
| 01 | Dashboard | ✅ (ejecutivo, 25 indicadores en 6 secciones) |
| 02 | INDEC | ✅ (12 categorías, buscador, fichas) |
| 03 | Banco Central | ✅ (14 categorías, buscador, fichas) |
| 04 | Análisis integrado | ✅ (constructor INDEC + BCRA) |
| 05 | Constructor de indicadores | 🚧 |
| 06 | Econometría | ✅ (descriptiva, correlaciones, MCO, series temporales, VAR, VECM, proyecciones, backtesting) |
| 07 | Simulador macroeconómico | ✅ (aritmético, escenarios del usuario, shocks en VAR estimado) |
| 08 | Calculadoras económicas | ✅ (inflación, tasas reales, devaluación, salarios y agregados reales) |
| 09 | MACRO AI | ✅ (asistente con herramientas, Ollama local o sin modelo, memoria de investigación) |
| 10 | Reportes | ✅ (9 informes automáticos, PDF/Excel/CSV) |
| 11 | Favoritos | ✅ (análisis guardados y series favoritas, sin login) |
| 12 | Configuración | ✅ (estado de fuentes, sincronizaciones y errores) |

Además: catálogo navegable (`/catalogo`) y ficha por indicador
(`/indicadores/{id}`) con metadatos, metodología, últimas observaciones,
revisiones, historial de sincronización y descarga CSV.

## Limitaciones conocidas

- Ninguna de las dos APIs informa la **fecha de publicación** de cada dato. Para el histórico queda vacía; para datos nuevos se registra la fecha en que la plataforma los vio por primera vez (identificada como tal).
- La API de Series de Tiempo puede tener rezago respecto del calendario del INDEC; esas series se marcan como **Desactualizadas**.
- Autenticación de usuarios: el esquema está listo (Supabase Auth + RLS), pero el login no está implementado. Favoritos y análisis guardados se asocian al navegador (cookie); si se borran las cookies se pierde el acceso a ellos.
- Algunas series del INDEC publican porcentajes como proporción (0,079) con unidad "Porcentaje". Las series núcleo se normalizan; las abiertas a pedido se muestran tal como las publica la fuente.
- El "tipo de cambio real" del constructor es el tipo de cambio nominal deflactado por el IPC local (no incluye inflación externa): se indica en el ejemplo.
- El backtesting usa versiones históricas (vintages) solo desde que la plataforma registra publicaciones y revisiones de cada serie; para fechas anteriores usa los datos vigentes y lo advierte.
- La desestacionalización propia es la descomposición clásica por medias móviles: no reemplaza al X-13ARIMA-SEATS del INDEC (usar las series desestacionalizadas oficiales cuando existan).
