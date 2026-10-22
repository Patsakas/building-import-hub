-- Row Level Security on public.buildings: every user sees and changes only their own buildings,
-- and anonymous visitors cannot touch the table at all. Run with `supabase test db`.
begin;
select plan(14);

-- Table privileges: RLS is not the only barrier. anon has none; authenticated has exactly the
-- operations RLS governs (no TRUNCATE, which bypasses RLS).
select table_privs_are(
  'public', 'buildings', 'anon', array[]::text[],
  'anon has no privileges on buildings'
);
select table_privs_are(
  'public', 'buildings', 'authenticated', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'authenticated has only the privileges that RLS governs'
);

insert into auth.users (id, email)
values
  ('0a11ce00-0000-4000-8000-000000000001', 'rls-alice@test.local'),
  ('0b0b0000-0000-4000-8000-000000000002', 'rls-bob@test.local');

-- Alice: can insert her own buildings, user_id defaults to her id.
set local role authenticated;
set local request.jwt.claims = '{"sub": "0a11ce00-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.buildings (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Alice Tower') $$,
  'a user can insert a building'
);
select is(
  (select user_id from public.buildings where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '0a11ce00-0000-4000-8000-000000000001'::uuid,
  'user_id defaults to the signed-in user'
);
select throws_ok(
  $$ insert into public.buildings (name, floors) values ('Underground', -1) $$,
  '23514', null,
  'check constraints reject invalid values'
);
select throws_ok(
  $$ insert into public.buildings (name, user_id) values ('Forged', '0b0b0000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'a user cannot insert a building owned by someone else'
);
select throws_ok(
  $$ update public.buildings set user_id = '0b0b0000-0000-4000-8000-000000000002'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a user cannot hand a building over to someone else'
);

-- Bob: cannot see, change or delete Alice's building.
set local request.jwt.claims = '{"sub": "0b0b0000-0000-4000-8000-000000000002", "role": "authenticated"}';

select is_empty(
  $$ select id from public.buildings $$,
  'another user cannot read the building'
);
select is_empty(
  $$ update public.buildings set name = 'Hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning id $$,
  'another user cannot update the building'
);
select is_empty(
  $$ delete from public.buildings where id = 'aaaaaaaa-0000-0000-0000-000000000001' returning id $$,
  'another user cannot delete the building'
);

-- Anonymous visitors have no privileges on the table.
reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok(
  $$ select * from public.buildings $$,
  '42501', null,
  'anonymous visitors cannot read buildings'
);
select throws_ok(
  $$ insert into public.buildings (name) values ('Anon Tower') $$,
  '42501', null,
  'anonymous visitors cannot insert buildings'
);

-- Back to Alice: her building is untouched.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "0a11ce00-0000-4000-8000-000000000001", "role": "authenticated"}';

select is(
  (select name from public.buildings where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Alice Tower',
  'the owner still sees the unchanged building'
);
select is(
  (select count(*)::int from public.buildings),
  1,
  'the owner sees only her own buildings'
);

select * from finish();
rollback;
