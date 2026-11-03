# ARGENTINA MACRO INTELLIGENCE

Plataforma profesional de análisis macroeconómico de Argentina, construida sobre
datos oficiales del **INDEC** y del **BCRA**.

**Fase 1 — Fundación:** infraestructura de datos (fuentes, catálogo, ingesta,
calidad), base de datos, interfaz y navegación. Los módulos analíticos
(econometría, simulador, MACRO AI, etc.) están identificados como “en
construcción” y se desarrollan en fases posteriores.

| | |
|---|---|
| Frontend | Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS 4 · shadcn/ui · Recharts |
| Datos | PostgreSQL (Supabase en producción; Postgres embebido en desarrollo) |
| Ingesta | Conectores TypeScript `BCRAConnector` e `INDECConnector` |
| Despliegue | Vercel (Hobby) + Supabase (Free) |
| Tests | Vitest: conectores, normalizadores, cálculos, integración con Postgres, verificación en vivo |

## Estado de los datos (2026-11-02)

- **12.145 series** en el catálogo (1.610 BCRA + 10.527 INDEC; 905 discontinuadas por la fuente).
- **52 series sincronizadas** (29 BCRA + 16 INDEC + 7 calculadas), **125.199 observaciones** históricas.
- Todas las series sincronizadas verificadas contra las APIs en vivo (`npm run test:live`).

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
| `npm run sync` | Actualización incremental (con ventana de revisión) |
| `npm run sync:full` | Recarga completa del histórico |
| `npm run sync -- --source=BCRA` | Solo una fuente |
| `npm run sync -- bcra.reservas indec.emae` | Solo algunos indicadores |
| `npm run setup` | `db:migrate` + `catalog:seed` + `sync:full` |
| `npm test` | Tests unitarios (+ integración si hay `TEST_DATABASE_URL`) |
| `npm run test:live` | Verifica cada serie del registro contra las APIs reales |
| `npm run typecheck` · `npm run lint` | Chequeos estáticos |

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

---

## Estructura

```
src/
  app/                      páginas (App Router) y rutas /api
  components/               layout, gráficos (Recharts), UI
  lib/
    connectors/             BCRAConnector, INDECConnector, cliente HTTP
    normalize/              normalización, validación, fechas, series derivadas
    ingest/                 catálogo y motor de sincronización
    catalog/registry.ts     series núcleo (semilla del catálogo)
    data/queries.ts         lecturas para la interfaz
    db/                     cliente Postgres y migrador
scripts/                    CLI: db local, migraciones, catálogo, sync
supabase/migrations/        esquema SQL
tests/                      unitarios, integración, en vivo y fixtures reales
docs/                       documentación de APIs y modelo de datos
python/                     reservado para procesos estadísticos (fases futuras)
```

## Navegación

| # | Sección | Estado |
|---|---|---|
| 01 | Overview | ✅ |
| 02 | INDEC | ✅ |
| 03 | Banco Central | ✅ |
| 04 | Análisis integrado | 🚧 |
| 05 | Constructor de indicadores | 🚧 |
| 06 | Econometría | 🚧 |
| 07 | Simulador macroeconómico | 🚧 |
| 08 | Calculadoras económicas | 🚧 |
| 09 | MACRO AI | 🚧 |
| 10 | Reportes | 🚧 |
| 11 | Favoritos | 🚧 (tabla lista; requiere autenticación) |
| 12 | Configuración | ✅ (estado de fuentes, sincronizaciones y errores) |

Además: catálogo navegable (`/catalogo`) y ficha por indicador
(`/indicadores/{id}`) con metadatos, metodología, últimas observaciones,
revisiones, historial de sincronización y descarga CSV.

## Limitaciones conocidas

- Ninguna de las dos APIs informa la **fecha de publicación** de cada dato. Para el histórico queda vacía; para datos nuevos se registra la fecha en que la plataforma los vio por primera vez (identificada como tal).
- La API de Series de Tiempo puede tener rezago respecto del calendario del INDEC; esas series se marcan como **Desactualizadas**.
- Autenticación de usuarios: el esquema está listo (Supabase Auth + RLS), pero el login no se implementa en la Fase 1.
