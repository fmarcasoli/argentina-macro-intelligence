-- Fase 2: categorías de panel, espacios de trabajo anónimos, favoritos y análisis guardados.

-- 1. Categoría de panel (INDEC/BCRA) calculada por src/lib/catalog/panels.ts.
--    Es una clasificación propia de la plataforma: la categoría original de la
--    fuente sigue en indicators.category.
alter table indicators add column if not exists panel text;
create index if not exists ix_indicators_panel on indicators (source_id, panel);

-- Series que se empezaron a sincronizar porque alguien las consultó (no son núcleo).
alter table indicators add column if not exists tracked_on_demand_at timestamptz;

-- 2. Espacios de trabajo: identifican un navegador sin login. La cookie guarda
--    un token aleatorio; en la base solo se guarda su hash SHA-256.
create table if not exists workspaces (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table if not exists workspace_favorites (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  indicator_id  text not null references indicators(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, indicator_id)
);

-- 3. Los análisis guardados pueden pertenecer a un usuario (Supabase Auth, fase
--    futura) o a un espacio de trabajo anónimo.
alter table saved_analyses alter column user_id drop not null;
alter table saved_analyses add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
do $$ begin
  alter table saved_analyses add constraint saved_analyses_owner
    check (user_id is not null or workspace_id is not null);
exception when duplicate_object then null; end $$;
create index if not exists ix_saved_analyses_workspace on saved_analyses (workspace_id, updated_at desc);

-- 4. En Supabase: sin acceso desde la Data API (solo el backend lee y escribe).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    alter table public.workspaces enable row level security;
    alter table public.workspace_favorites enable row level security;
    revoke all on public.workspaces from anon, authenticated;
    revoke all on public.workspace_favorites from anon, authenticated;
  end if;
end
$$;
