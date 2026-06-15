-- ============ Table des swipes ============
create table public.swipes (
  id uuid primary key default gen_random_uuid(),
  swiper_id uuid not null references public.profiles(id) on delete cascade,
  swipee_id uuid not null references public.profiles(id) on delete cascade,
  direction text not null check (direction in ('like', 'pass')),
  created_at timestamptz not null default now(),
  unique (swiper_id, swipee_id)
);
create index swipes_swiper_created_idx on public.swipes (swiper_id, created_at);

alter table public.swipes enable row level security;
create policy "swipes: select own" on public.swipes
  for select to authenticated using (auth.uid() = swiper_id);
create policy "swipes: insert own" on public.swipes
  for insert to authenticated with check (auth.uid() = swiper_id);
create policy "swipes: update own" on public.swipes
  for update to authenticated using (auth.uid() = swiper_id) with check (auth.uid() = swiper_id);
create policy "swipes: delete own" on public.swipes
  for delete to authenticated using (auth.uid() = swiper_id);

-- ============ Candidats du deck (réservé au rôle service via l'Edge Function) ============
create function public.deck_candidates(p_user uuid, p_limit int default 10, p_offset int default 0)
returns table (
  id uuid, display_name text, age int, distance_km int, bio text, photo_paths text[]
)
language sql security definer set search_path = public, extensions as $$
  with me as (
    select pr.id, pr.gender_id, pr.birthdate, pr.location,
           prefs.age_min, prefs.age_max, prefs.max_distance_km
    from public.profiles pr
    join public.preferences prefs on prefs.profile_id = pr.id
    where pr.id = p_user
  )
  select
    c.id,
    c.display_name,
    date_part('year', age(c.birthdate))::int as age,
    round(extensions.st_distance(me.location, c.location) / 1000.0)::int as distance_km,
    c.bio,
    array(
      select pp.storage_path from public.profile_photos pp
      where pp.profile_id = c.id order by pp.position
    ) as photo_paths
  from me, public.profiles c
  join public.preferences cp on cp.profile_id = c.id
  where c.id <> me.id
    and c.location is not null
    and exists (select 1 from public.profile_photos pp where pp.profile_id = c.id)
    and c.gender_id in (select gender_id from public.preference_genders where profile_id = me.id)
    and date_part('year', age(c.birthdate))::int between me.age_min and me.age_max
    and extensions.st_dwithin(me.location, c.location, me.max_distance_km * 1000)
    and me.gender_id in (select gender_id from public.preference_genders where profile_id = c.id)
    and date_part('year', age(me.birthdate))::int between cp.age_min and cp.age_max
    and not exists (select 1 from public.swipes s where s.swiper_id = me.id and s.swipee_id = c.id)
  order by extensions.st_distance(me.location, c.location) asc
  limit p_limit offset p_offset;
$$;

-- ============ Enregistrer un swipe (quota de likes autoritatif) ============
create function public.record_swipe(p_target uuid, p_direction text)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_used int;
  v_limit constant int := 20;
begin
  if p_direction not in ('like', 'pass') then
    raise exception 'INVALID_DIRECTION';
  end if;
  if p_direction = 'like' then
    select count(*) into v_used from public.swipes
      where swiper_id = auth.uid() and direction = 'like' and created_at >= date_trunc('day', now());
    if v_used >= v_limit then
      raise exception 'QUOTA_EXCEEDED';
    end if;
  end if;
  insert into public.swipes (swiper_id, swipee_id, direction)
    values (auth.uid(), p_target, p_direction)
    on conflict (swiper_id, swipee_id) do update set direction = excluded.direction, created_at = now();
  select greatest(v_limit - count(*), 0) into v_used from public.swipes
    where swiper_id = auth.uid() and direction = 'like' and created_at >= date_trunc('day', now());
  return v_used;
end;
$$;

-- ============ Rewind ============
create function public.rewind_last_swipe()
returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_swipee uuid;
begin
  delete from public.swipes where id = (
    select id from public.swipes where swiper_id = auth.uid() order by created_at desc limit 1
  ) returning swipee_id into v_swipee;
  return v_swipee;
end;
$$;

-- ============ Likes restants aujourd'hui ============
create function public.likes_remaining_today()
returns int
language sql security invoker set search_path = public as $$
  select greatest(20 - count(*), 0)::int from public.swipes
    where swiper_id = auth.uid() and direction = 'like' and created_at >= date_trunc('day', now());
$$;

-- ============ Grants ============
revoke execute on function public.deck_candidates(uuid, int, int) from public, authenticated;
grant execute on function public.deck_candidates(uuid, int, int) to service_role;
revoke execute on function public.record_swipe(uuid, text) from public;
grant execute on function public.record_swipe(uuid, text) to authenticated;
revoke execute on function public.rewind_last_swipe() from public;
grant execute on function public.rewind_last_swipe() to authenticated;
revoke execute on function public.likes_remaining_today() from public;
grant execute on function public.likes_remaining_today() to authenticated;
