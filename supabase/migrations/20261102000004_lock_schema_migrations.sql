-- Registro interno de migraciones: sin acceso desde la Data API de Supabase.
-- RLS activo y sin políticas = ni lectura ni escritura para anon/authenticated.
-- Solo corre en Supabase (si existe el esquema auth); en Postgres local no hace nada.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth')
     and to_regclass('public.schema_migrations') is not null then
    alter table public.schema_migrations enable row level security;
    revoke all on public.schema_migrations from anon, authenticated;
  end if;
end
$$;
