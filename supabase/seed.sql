-- Local development and CI only: `supabase db reset` runs this after the migrations.
-- `supabase db push` never applies seed data, so these accounts never reach a hosted project.
--
-- Two confirmed users that can sign in to the local app (password: password123):
--   alice@test.local  owns two sample buildings
--   bob@test.local    owns none (used to check users cannot see each other's data)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  crypt('password123', gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', ''
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'alice@test.local'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'bob@test.local')
) as u (id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now()
from auth.users u
where u.email in ('alice@test.local', 'bob@test.local');

insert into public.buildings (user_id, name, address, city, country, floors, year_built)
values
  ('11111111-1111-1111-1111-111111111111', 'Acropolis View', '12 Dionysiou Areopagitou', 'Athens', 'Greece', 6, 1975),
  ('11111111-1111-1111-1111-111111111111', 'Harbour House', '3 Akti Miaouli', 'Piraeus', 'Greece', 9, 2004);
