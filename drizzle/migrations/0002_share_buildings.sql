-- Let signed-in users browse every building, not only their own.
create policy "Signed-in users can view all buildings" on public.buildings
  for select to authenticated using (true);
