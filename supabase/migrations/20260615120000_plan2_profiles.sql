-- PostGIS pour la géolocalisation
create extension if not exists postgis with schema extensions;

-- ============ Table de référence des genres (configurable) ============
create table public.genders (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);
alter table public.genders enable row level security;
create policy "genders: lecture authentifiée" on public.genders
  for select to authenticated using (true);

insert into public.genders (key, label, sort_order) values
  ('homme', 'Homme', 1),
  ('femme', 'Femme', 2);

-- ============ Profils ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  birthdate date,
  gender_id uuid references public.genders(id),
  bio text,
  location extensions.geography(Point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint birthdate_18plus
    check (birthdate is null or birthdate <= (current_date - interval '18 years'))
);
alter table public.profiles enable row level security;
create policy "profiles: select own" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles: delete own" on public.profiles
  for delete to authenticated using (auth.uid() = id);

-- ============ Photos ============
create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  position int not null check (position between 0 and 5),
  created_at timestamptz not null default now(),
  unique (profile_id, position)
);
alter table public.profile_photos enable row level security;
create policy "photos: select own" on public.profile_photos
  for select to authenticated using (auth.uid() = profile_id);
create policy "photos: insert own" on public.profile_photos
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "photos: update own" on public.profile_photos
  for update to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "photos: delete own" on public.profile_photos
  for delete to authenticated using (auth.uid() = profile_id);

create function public.enforce_max_photos() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.profile_photos where profile_id = new.profile_id) >= 6 then
    raise exception 'Maximum 6 photos par profil';
  end if;
  return new;
end;
$$;
create trigger trg_enforce_max_photos
  before insert on public.profile_photos
  for each row execute function public.enforce_max_photos();

-- ============ Préférences ============
create table public.preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  age_min int not null check (age_min >= 18),
  age_max int not null,
  max_distance_km int not null check (max_distance_km > 0),
  constraint age_range check (age_max >= age_min)
);
alter table public.preferences enable row level security;
create policy "prefs: select own" on public.preferences
  for select to authenticated using (auth.uid() = profile_id);
create policy "prefs: insert own" on public.preferences
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "prefs: update own" on public.preferences
  for update to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create table public.preference_genders (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  gender_id uuid not null references public.genders(id),
  primary key (profile_id, gender_id)
);
alter table public.preference_genders enable row level security;
create policy "pref_genders: select own" on public.preference_genders
  for select to authenticated using (auth.uid() = profile_id);
create policy "pref_genders: insert own" on public.preference_genders
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "pref_genders: delete own" on public.preference_genders
  for delete to authenticated using (auth.uid() = profile_id);

-- ============ RPC: enregistrer sa position ============
create function public.set_my_location(lng double precision, lat double precision)
returns void
language sql security definer set search_path = public, extensions as $$
  update public.profiles
  set location = extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
      updated_at = now()
  where id = auth.uid();
$$;

-- RPC: enregistrer ses préférences de façon atomique (upsert + remplacement des genres recherchés)
create function public.set_my_preferences(
  p_age_min int, p_age_max int, p_max_distance_km int, p_gender_ids uuid[]
) returns void
language plpgsql security invoker as $$
begin
  insert into public.preferences (profile_id, age_min, age_max, max_distance_km)
  values (auth.uid(), p_age_min, p_age_max, p_max_distance_km)
  on conflict (profile_id) do update
    set age_min = excluded.age_min, age_max = excluded.age_max, max_distance_km = excluded.max_distance_km;
  delete from public.preference_genders where profile_id = auth.uid();
  if array_length(p_gender_ids, 1) is not null then
    insert into public.preference_genders (profile_id, gender_id)
    select auth.uid(), unnest(p_gender_ids);
  end if;
end;
$$;

-- ============ Storage : bucket privé + policies ============
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

create policy "photos storage: select own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos storage: insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos storage: delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Hygiène anti-abus : EXECUTE réservé aux utilisateurs authentifiés
revoke execute on function public.set_my_location(double precision, double precision) from public;
grant execute on function public.set_my_location(double precision, double precision) to authenticated;
revoke execute on function public.set_my_preferences(int, int, int, uuid[]) from public;
grant execute on function public.set_my_preferences(int, int, int, uuid[]) to authenticated;
