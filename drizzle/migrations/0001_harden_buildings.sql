-- Hardening for public.buildings. Kept identical in supabase/migrations and drizzle/migrations.

-- Least privilege. Supabase's default privileges give anon and authenticated ALL privileges on
-- every new table in public, so the GRANT in the first migration restricted nothing: RLS was the
-- only barrier for anonymous requests, and TRUNCATE (which RLS does not cover) was granted too.
revoke all on public.buildings from anon;
revoke truncate, references, trigger on public.buildings from authenticated;

-- Future tables: anon gets nothing unless a migration grants it explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- Integrity, matching the validation in the import-buildings Edge Function. NOT VALID enforces
-- them for new and updated rows without rejecting this migration on a database whose existing
-- rows we have not seen (such as Lovable's backend); run VALIDATE CONSTRAINT once checked.
alter table public.buildings
  add constraint buildings_name_length check (char_length(btrim(name)) between 1 and 200) not valid,
  add constraint buildings_address_length check (char_length(address) <= 300) not valid,
  add constraint buildings_city_length check (char_length(city) <= 100) not valid,
  add constraint buildings_country_length check (char_length(country) <= 100) not valid,
  add constraint buildings_floors_range check (floors between 0 and 200) not valid,
  add constraint buildings_year_built_range check (year_built between 1000 and 2100) not valid;

-- Deleting a user deletes their buildings instead of leaving orphaned rows.
alter table public.buildings
  add constraint buildings_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade not valid;

-- Evaluate auth.uid() once per statement instead of once per row (Supabase advisor
-- "auth_rls_initplan"). Same rules as before.
alter policy "Users read own buildings" on public.buildings
  using ((select auth.uid()) = user_id);
alter policy "Users insert own buildings" on public.buildings
  with check ((select auth.uid()) = user_id);
alter policy "Users update own buildings" on public.buildings
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy "Users delete own buildings" on public.buildings
  using ((select auth.uid()) = user_id);
