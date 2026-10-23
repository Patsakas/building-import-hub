-- Speed up filtering buildings by city.
create index buildings_city_idx on public.buildings (city);
