-- =============================================================================
-- ARGENTINA MACRO INTELLIGENCE — Esquema central (Fase 1)
-- Compatible con PostgreSQL 15+ (Supabase) y con el Postgres local de desarrollo.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
do $$ begin
  create type frequency as enum ('D', 'W', 'M', 'Q', 'S', 'A');
exception when duplicate_object then null; end $$;
comment on type frequency is 'D diaria, W semanal, M mensual, Q trimestral, S semestral, A anual';

do $$ begin
  -- original   : valor tal cual lo publica la fuente (solo cambia el tipo de dato)
  -- normalized : valor de la fuente re-escalado/convertido (ej. fracción -> %)
  -- calculated : derivado por la plataforma a partir de otras series
  -- estimated  : estimación propia (no se usa en Fase 1)
  create type value_kind as enum ('original', 'normalized', 'calculated', 'estimated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type update_status as enum ('pending', 'ok', 'stale', 'error', 'discontinued');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sync_status as enum ('running', 'success', 'partial', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sync_mode as enum ('full', 'incremental');
exception when duplicate_object then null; end $$;

do $$ begin
  -- source     : la fuente informa la fecha de publicación
  -- first_seen : la fuente no la informa; se usa la fecha en que la plataforma vio el dato por primera vez
  create type publication_date_origin as enum ('source', 'first_seen');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Utilidad: updated_at automático
-- -----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Fuentes oficiales
-- -----------------------------------------------------------------------------
create table if not exists sources (
  id              text primary key,                  -- 'BCRA', 'INDEC'
  name            text not null,
  institution     text not null,
  api_name        text not null,
  base_url        text not null,
  docs_url        text,
  auth_required   boolean not null default false,
  rate_limit_note text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create or replace trigger trg_sources_updated before update on sources
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- Catálogo de indicadores
-- -----------------------------------------------------------------------------
create table if not exists indicators (
  id                 text primary key,               -- ID interno estable, ej. 'bcra.reservas'
  source_id          text not null references sources(id),
  source_code        text,                           -- ID en la fuente (null en series calculadas)
  name               text not null,
  category           text not null,
  subcategory        text,
  description        text,
  unit               text not null,
  frequency          frequency not null,
  currency           text,
  endpoint           text,                           -- URL de la serie en la API de origen
  start_date         date,                           -- primer dato almacenado
  last_date          date,                           -- último dato almacenado (fecha de referencia)
  last_value         numeric,
  source_start_date  date,                           -- primer dato según la fuente
  source_last_date   date,                           -- último dato según la fuente
  methodology        text,
  methodology_url    text,
  value_kind         value_kind not null default 'original',
  scale              numeric not null default 1,     -- factor aplicado al normalizar (1 = sin cambios)
  derivation         jsonb,                          -- definición de series calculadas
  update_status      update_status not null default 'pending',
  is_tracked         boolean not null default true,  -- se sincroniza automáticamente
  observation_count  integer not null default 0,
  last_synced_at     timestamptz,
  last_error         text,
  tags               text[] not null default '{}',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint indicators_scale_consistent
    check ((scale = 1) or value_kind = 'normalized'),
  constraint indicators_source_code_required
    check (value_kind = 'calculated' or source_code is not null),
  constraint indicators_derivation_required
    check (value_kind <> 'calculated' or derivation is not null)
);
-- Una misma serie de origen no puede registrarse dos veces con el mismo tipo de valor
create unique index if not exists ux_indicators_source_code
  on indicators (source_id, source_code, value_kind) where source_code is not null;
create index if not exists ix_indicators_category on indicators (category, subcategory);
create index if not exists ix_indicators_status on indicators (update_status);
create or replace trigger trg_indicators_updated before update on indicators
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- Metadatos crudos de la fuente (versionados)
-- Guarda el payload de metadatos tal cual lo devuelve la API, para auditoría.
-- -----------------------------------------------------------------------------
create table if not exists indicator_metadata (
  id            bigint generated always as identity primary key,
  indicator_id  text not null references indicators(id) on delete cascade,
  fetched_at    timestamptz not null default now(),
  content_hash  text not null,
  payload       jsonb not null,
  unique (indicator_id, content_hash)
);
create index if not exists ix_indicator_metadata_ind on indicator_metadata (indicator_id, fetched_at desc);

-- -----------------------------------------------------------------------------
-- Historial de sincronización
-- -----------------------------------------------------------------------------
create table if not exists sync_runs (
  id              bigint generated always as identity primary key,
  source_id       text references sources(id),
  indicator_id    text references indicators(id) on delete set null,
  mode            sync_mode not null,
  status          sync_status not null default 'running',
  triggered_by    text not null default 'manual',     -- manual | cron | cli
  requested_from  date,
  requested_to    date,
  rows_fetched    integer not null default 0,
  rows_inserted   integer not null default 0,
  rows_updated    integer not null default 0,
  rows_unchanged  integer not null default 0,
  rows_rejected   integer not null default 0,
  error_count     integer not null default 0,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     integer generated always as
                    ((extract(epoch from (finished_at - started_at)) * 1000)::integer) stored
);
create index if not exists ix_sync_runs_started on sync_runs (started_at desc);
create index if not exists ix_sync_runs_indicator on sync_runs (indicator_id, started_at desc);

-- -----------------------------------------------------------------------------
-- Errores
-- -----------------------------------------------------------------------------
create table if not exists sync_errors (
  id            bigint generated always as identity primary key,
  sync_run_id   bigint references sync_runs(id) on delete cascade,
  indicator_id  text references indicators(id) on delete set null,
  stage         text not null check (stage in ('fetch', 'parse', 'validate', 'persist', 'derive', 'catalog')),
  message       text not null,
  http_status   integer,
  details       jsonb,
  occurred_at   timestamptz not null default now()
);
create index if not exists ix_sync_errors_time on sync_errors (occurred_at desc);
create index if not exists ix_sync_errors_indicator on sync_errors (indicator_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Observaciones históricas
-- Una fila por (indicador, fecha de referencia). La fecha de referencia es el
-- período al que corresponde el dato (primer día del período para M/Q/A),
-- nunca la fecha de publicación.
-- -----------------------------------------------------------------------------
create table if not exists observations (
  indicator_id        text not null references indicators(id) on delete cascade,
  ref_date            date not null,              -- inicio del período de referencia (normalizado)
  source_ref_date     date,                       -- fecha tal como la informa la fuente (ej. fin de mes en BCRA)
  value               numeric,                        -- NULL = dato faltante (nunca 0)
  raw_value           text,                           -- valor exactamente como llegó de la fuente
  value_kind          value_kind not null,
  is_scheduled        boolean not null default false, -- fecha futura publicada por adelantado (ej. UVA/CER)
  publication_date    date,
  publication_origin  publication_date_origin not null default 'first_seen',
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  revision_count      integer not null default 0,
  sync_run_id         bigint references sync_runs(id) on delete set null,
  primary key (indicator_id, ref_date)
);
create index if not exists ix_observations_ind_date_desc on observations (indicator_id, ref_date desc);

-- -----------------------------------------------------------------------------
-- Revisiones: cada vez que la fuente cambia un valor ya publicado se guarda
-- el valor anterior. Así se preserva el historial de revisiones.
-- -----------------------------------------------------------------------------
create table if not exists observation_revisions (
  id            bigint generated always as identity primary key,
  indicator_id  text not null,
  ref_date      date not null,
  old_value     numeric,
  new_value     numeric,
  old_raw_value text,
  new_raw_value text,
  revised_at    timestamptz not null default now(),
  sync_run_id   bigint references sync_runs(id) on delete set null,
  foreign key (indicator_id, ref_date) references observations(indicator_id, ref_date) on delete cascade
);
create index if not exists ix_obs_revisions on observation_revisions (indicator_id, ref_date, revised_at desc);

create or replace function track_observation_revision() returns trigger
language plpgsql as $$
begin
  if new.value is distinct from old.value then
    insert into observation_revisions
      (indicator_id, ref_date, old_value, new_value, old_raw_value, new_raw_value, sync_run_id)
    values
      (old.indicator_id, old.ref_date, old.value, new.value, old.raw_value, new.raw_value, new.sync_run_id);
    new.revision_count := old.revision_count + 1;
  end if;
  return new;
end $$;

create or replace trigger trg_observations_revision before update on observations
  for each row execute function track_observation_revision();

-- -----------------------------------------------------------------------------
-- Usuarios, configuración y análisis guardados
-- En Supabase, profiles.id coincide con auth.users.id (ver migración de RLS).
-- -----------------------------------------------------------------------------
create table if not exists profiles (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  display_name  text,
  role          text not null default 'analyst' check (role in ('admin', 'analyst', 'viewer')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create or replace trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

create table if not exists user_settings (
  user_id     uuid not null references profiles(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

create table if not exists favorites (
  user_id       uuid not null references profiles(id) on delete cascade,
  indicator_id  text not null references indicators(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, indicator_id)
);

create table if not exists saved_analyses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  title       text not null,
  kind        text not null,                     -- 'chart' | 'indicator' | 'regression' | ...
  definition  jsonb not null,
  indicator_ids text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ix_saved_analyses_user on saved_analyses (user_id, updated_at desc);
create or replace trigger trg_saved_analyses_updated before update on saved_analyses
  for each row execute function set_updated_at();
