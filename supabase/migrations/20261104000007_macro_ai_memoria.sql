-- Fase 4: memoria de investigación de MACRO AI.
-- Pertenece al espacio de trabajo (cookie del navegador, solo se guarda su hash).
-- Nada de esto es accesible por la Data API de Supabase: solo el backend lo lee.

create table if not exists research_spaces (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  description   text check (description is null or char_length(description) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ix_research_spaces_ws on research_spaces (workspace_id, updated_at desc);

create table if not exists ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  space_id      uuid references research_spaces(id) on delete set null,
  title         text not null check (char_length(title) between 1 and 160),
  turns         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ix_ai_conversations_ws on ai_conversations (workspace_id, updated_at desc);

create table if not exists research_notes (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  space_id         uuid references research_spaces(id) on delete set null,
  conversation_id  uuid references ai_conversations(id) on delete set null,
  title            text not null check (char_length(title) between 1 and 160),
  body             text not null check (char_length(body) <= 20000),
  -- Gráficos y tablas asociados a la conclusión, y las series que la respaldan.
  blocks           jsonb not null default '[]'::jsonb,
  sources          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists ix_research_notes_ws on research_notes (workspace_id, created_at desc);

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    alter table public.research_spaces enable row level security;
    alter table public.ai_conversations enable row level security;
    alter table public.research_notes enable row level security;
    revoke all on public.research_spaces from anon, authenticated;
    revoke all on public.ai_conversations from anon, authenticated;
    revoke all on public.research_notes from anon, authenticated;
  end if;
end
$$;
