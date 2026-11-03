# Modelo de datos

Esquema PostgreSQL en `supabase/migrations/`. Corre igual en Supabase y en el
Postgres local de desarrollo.

```
sources ──< indicators ──< observations ──< observation_revisions
               │   └──< indicator_metadata
               ├──< sync_runs ──< sync_errors
               └──< favorites >── profiles ──< user_settings
                                     └──< saved_analyses
app_settings · schema_migrations
```

## Tablas

| Tabla | Contenido | Claves / restricciones |
|---|---|---|
| `sources` | Fuentes oficiales (BCRA, INDEC): API, URL base, límites | PK `id` |
| `indicators` | **Catálogo**: una fila por serie (ID interno, institución, nombre, categoría, subcategoría, descripción, unidad, frecuencia, código de origen, endpoint, fecha inicial, fecha del último dato, metodología, estado de actualización) | PK `id`; único `(source_id, source_code, value_kind)`; checks: una serie calculada debe tener `derivation`, una con `scale ≠ 1` debe ser `normalized` |
| `indicator_metadata` | Payload de metadatos crudo de la fuente, versionado por hash | único `(indicator_id, content_hash)` |
| `observations` | Valores históricos | PK `(indicator_id, ref_date)` → **imposible duplicar** |
| `observation_revisions` | Valor anterior cada vez que la fuente corrige un dato | lo llena un trigger |
| `sync_runs` | Historial de sincronización (modo, rango, recibidos/nuevos/revisados/rechazados, duración) | índice por fecha e indicador |
| `sync_errors` | Errores por etapa: `fetch`, `parse`, `validate`, `persist`, `derive`, `catalog` | índice por fecha e indicador |
| `profiles` | Usuarios (en Supabase, FK a `auth.users`) | |
| `user_settings` | Configuración por usuario (clave/valor JSON) | PK `(user_id, key)` |
| `app_settings` | Configuración global (ventanas de revisión, umbrales) | PK `key` |
| `favorites` | Series favoritas por usuario | PK `(user_id, indicator_id)` |
| `saved_analyses` | Análisis guardados (definición JSON) | índice por usuario |

## Calidad de datos

| Regla | Implementación |
|---|---|
| Diferenciar original / normalizado / calculado / estimado | `value_kind` en `indicators` y en cada observación |
| Trazabilidad dato → fuente | `observations.raw_value` (texto exacto recibido), `source_ref_date` (fecha exacta de la fuente), `sync_run_id` (qué corrida lo trajo), `indicators.endpoint` + `source_code`, `indicator_metadata.payload` |
| No reemplazar faltantes por cero | `value` admite `NULL`; el normalizador convierte `null`/`""`/`NaN` en `NULL` y el cálculo de variaciones propaga `NULL` (y no emite puntos si falta el período base) |
| Período de referencia ≠ publicación | `ref_date` = inicio del período de referencia. `publication_date` es otra columna: `NULL` para el histórico de la carga inicial (desconocida), y en actualizaciones la fecha en que la plataforma vio el dato por primera vez (`publication_origin = 'first_seen'`). Ninguna de las dos APIs informa fecha de publicación por dato |
| Preservar revisiones | Trigger `trg_observations_revision`: si cambia `value`, guarda el valor anterior en `observation_revisions` e incrementa `revision_count` |
| Datos programados | `is_scheduled = true` para fechas futuras publicadas por adelantado (UVA, CER); se excluyen de "último dato" y de los cálculos |
| Validación | Fechas imposibles, valores no numéricos, fechas fuera de rango y duplicados por período se rechazan y se registran en `sync_errors` (etapa `validate`) con muestra y conteo por motivo |

## Agregar una serie nueva (sin tocar la estructura)

1. **Desde el catálogo descubierto**: todas las series de ambas fuentes están
   registradas (`npm run catalog:discover`). Para activarla:
   ```sql
   update indicators set is_tracked = true where id = 'indec-74.3_IET_0_M_16';
   ```
   y `npm run sync -- indec-74.3_IET_0_M_16`.
2. **Con nombre curado**: agregar una entrada en `src/lib/catalog/registry.ts`
   y correr `npm run catalog:seed -- <id>` y `npm run sync -- <id>`.
3. **Serie calculada**: agregar en `DERIVED_SERIES` una `derivation`
   (`pct_change` o `ratio`).

El motor de sincronización lee la lista de series de la tabla `indicators`, no
del código.
