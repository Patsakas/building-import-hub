-- Schema-wide guardrails for tables added later, by hand or by Lovable. These do not prove a
-- policy is correct (buildings_rls.test.sql does that for buildings); they catch the common
-- mistakes: a table exposed through the API without RLS, a policy that lets everyone in, or
-- privileges handed to anonymous visitors.
begin;
select plan(4);

select is_empty(
  $$ select table_name || ': ' || privilege_type
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' $$,
  'anon has no privileges on tables in public (grant them explicitly if a table must be public)'
);

select is_empty(
  $$ select c.relname::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every table in the public schema has Row Level Security enabled'
);

select is_empty(
  $$ select c.relname::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid) $$,
  'every table with Row Level Security has at least one policy'
);

select is_empty(
  $$ select tablename || '.' || policyname
     from pg_policies
     where schemaname = 'public'
       and (roles && array['anon', 'authenticated', 'public']::name[])
       and (qual = 'true' or with_check = 'true') $$,
  'no policy gives anon or authenticated users access to every row'
);

select * from finish();
rollback;
