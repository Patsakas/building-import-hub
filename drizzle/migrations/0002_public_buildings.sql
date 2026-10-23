-- Make the buildings list readable without signing in.
grant select on public.buildings to anon;
create policy "Anyone can view buildings" on public.buildings
  for select to anon using (true);
