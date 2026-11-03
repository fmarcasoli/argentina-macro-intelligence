-- =============================================================================
-- Seguridad a nivel de fila (RLS) para Supabase.
--
-- Solo se aplica si existe el esquema `auth` (es decir, en Supabase). En el
-- Postgres local de desarrollo este bloque no hace nada.
--
-- Modelo:
--   * Catálogo, fuentes y observaciones: lectura pública (anon + authenticated).
--   * Escritura de datos: solo el backend (rol postgres / service_role, que
--     omiten RLS). Ningún cliente del navegador puede escribir datos económicos.
--   * Tablas de usuario: cada usuario ve y edita solo sus filas.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    raise notice 'Esquema auth no encontrado: se omite la configuración de RLS (entorno local).';
    return;
  end if;

  -- Tablas de datos públicos -------------------------------------------------
  alter table sources               enable row level security;
  alter table indicators            enable row level security;
  alter table indicator_metadata    enable row level security;
  alter table observations          enable row level security;
  alter table observation_revisions enable row level security;
  alter table sync_runs             enable row level security;
  alter table sync_errors           enable row level security;
  alter table app_settings          enable row level security;

  execute 'drop policy if exists public_read on sources';
  execute 'create policy public_read on sources for select using (true)';
  execute 'drop policy if exists public_read on indicators';
  execute 'create policy public_read on indicators for select using (true)';
  execute 'drop policy if exists public_read on indicator_metadata';
  execute 'create policy public_read on indicator_metadata for select using (true)';
  execute 'drop policy if exists public_read on observations';
  execute 'create policy public_read on observations for select using (true)';
  execute 'drop policy if exists public_read on observation_revisions';
  execute 'create policy public_read on observation_revisions for select using (true)';
  execute 'drop policy if exists public_read on sync_runs';
  execute 'create policy public_read on sync_runs for select using (true)';
  execute 'drop policy if exists auth_read on sync_errors';
  execute 'create policy auth_read on sync_errors for select to authenticated using (true)';
  execute 'drop policy if exists public_read on app_settings';
  execute 'create policy public_read on app_settings for select using (true)';

  -- Tablas de usuario ---------------------------------------------------------
  alter table profiles       enable row level security;
  alter table user_settings  enable row level security;
  alter table favorites      enable row level security;
  alter table saved_analyses enable row level security;

  execute 'drop policy if exists own_profile on profiles';
  execute 'create policy own_profile on profiles for all to authenticated
             using (id = auth.uid()) with check (id = auth.uid())';
  execute 'drop policy if exists own_settings on user_settings';
  execute 'create policy own_settings on user_settings for all to authenticated
             using (user_id = auth.uid()) with check (user_id = auth.uid())';
  execute 'drop policy if exists own_favorites on favorites';
  execute 'create policy own_favorites on favorites for all to authenticated
             using (user_id = auth.uid()) with check (user_id = auth.uid())';
  execute 'drop policy if exists own_analyses on saved_analyses';
  execute 'create policy own_analyses on saved_analyses for all to authenticated
             using (user_id = auth.uid()) with check (user_id = auth.uid())';

  -- Vincula profiles con auth.users y crea el perfil al registrarse -----------
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_auth_user_fk'
  ) then
    execute 'alter table profiles alter column id drop default';
    execute 'alter table profiles add constraint profiles_auth_user_fk
               foreign key (id) references auth.users(id) on delete cascade';
  end if;

  execute $f$
    create or replace function public.handle_new_user() returns trigger
    language plpgsql security definer set search_path = public as $body$
    begin
      insert into public.profiles (id, email) values (new.id, new.email)
      on conflict (id) do nothing;
      return new;
    end $body$;
  $f$;
  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute 'create trigger on_auth_user_created after insert on auth.users
             for each row execute function public.handle_new_user()';
end $$;
