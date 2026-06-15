-- ============ Blocages (RLS propre-ligne ; source de vérité unique) ============
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_distinct check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;
create policy "blocks: select own" on public.blocks
  for select to authenticated using (auth.uid() = blocker_id);
create policy "blocks: insert own" on public.blocks
  for insert to authenticated with check (auth.uid() = blocker_id);
create policy "blocks: delete own" on public.blocks
  for delete to authenticated using (auth.uid() = blocker_id);

-- ============ Signalements (insert propre-ligne uniquement ; AUCUNE lecture client) ============
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam', 'inapproprie', 'harcelement', 'faux_profil', 'autre')),
  created_at timestamptz not null default now(),
  constraint reports_distinct check (reporter_id <> reported_id)
);
create index reports_reported_idx on public.reports (reported_id);

alter table public.reports enable row level security;
-- Pas de policy select : la modération lit côté service_role / dashboard.
create policy "reports: insert own" on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);

-- ============ block_user : bloque une personne (en son propre nom) ============
create function public.block_user(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_target = v_me then raise exception 'CANNOT_BLOCK_SELF'; end if;
  insert into public.blocks (blocker_id, blocked_id)
    values (v_me, p_target)
    on conflict do nothing;
end;
$$;
revoke execute on function public.block_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;

-- ============ report_user : signale (motif prédéfini) ET bloque dans la foulée ============
create function public.report_user(p_target uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_target = v_me then raise exception 'CANNOT_REPORT_SELF'; end if;
  if p_reason not in ('spam', 'inapproprie', 'harcelement', 'faux_profil', 'autre') then
    raise exception 'INVALID_REASON';
  end if;
  insert into public.reports (reporter_id, reported_id, reason)
    values (v_me, p_target, p_reason);
  insert into public.blocks (blocker_id, blocked_id)
    values (v_me, p_target)
    on conflict do nothing;
end;
$$;
revoke execute on function public.report_user(uuid, text) from public;
grant execute on function public.report_user(uuid, text) to authenticated;

-- ============ deck_candidates : exclure les paires bloquées (deux sens) ============
create or replace function public.deck_candidates(p_user uuid, p_limit int default 10, p_offset int default 0)
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
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = me.id and b.blocked_id = c.id)
         or (b.blocker_id = c.id and b.blocked_id = me.id)
    )
  order by extensions.st_distance(me.location, c.location) asc
  limit p_limit offset p_offset;
$$;
revoke execute on function public.deck_candidates(uuid, int, int) from public, authenticated;
grant execute on function public.deck_candidates(uuid, int, int) to service_role;

-- ============ record_swipe : pas de match si blocage (défense en profondeur) ============
create or replace function public.record_swipe(p_target uuid, p_direction text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_used int;
  v_limit constant int := 20;
  v_matched boolean := false;
  v_match_id uuid := null;
  v_a uuid;
  v_b uuid;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_direction not in ('like', 'pass') then raise exception 'INVALID_DIRECTION'; end if;
  if p_target = v_me then raise exception 'CANNOT_SWIPE_SELF'; end if;

  if p_direction = 'like' then
    select count(*) into v_used from public.swipes
      where swiper_id = v_me and direction = 'like' and created_at >= date_trunc('day', now());
    if v_used >= v_limit then raise exception 'QUOTA_EXCEEDED'; end if;
  end if;

  insert into public.swipes (swiper_id, swipee_id, direction)
    values (v_me, p_target, p_direction)
    on conflict (swiper_id, swipee_id) do update set direction = excluded.direction, created_at = now();

  if p_direction = 'like'
     and not exists (
       select 1 from public.blocks b
       where (b.blocker_id = v_me and b.blocked_id = p_target)
          or (b.blocker_id = p_target and b.blocked_id = v_me)
     )
     and exists (
       select 1 from public.swipes s
       where s.swiper_id = p_target and s.swipee_id = v_me and s.direction = 'like'
     ) then
    v_a := least(v_me, p_target);
    v_b := greatest(v_me, p_target);
    if not exists (
      select 1 from public.matches m
      where m.user_a = v_a and m.user_b = v_b and m.expires_at > now()
    ) then
      insert into public.matches (user_a, user_b, expires_at)
        values (v_a, v_b, now() + interval '60 minutes')
        returning id into v_match_id;
      v_matched := true;
    end if;
  end if;

  select greatest(v_limit - count(*), 0) into v_used from public.swipes
    where swiper_id = v_me and direction = 'like' and created_at >= date_trunc('day', now());

  return json_build_object('likes_remaining', v_used, 'matched', v_matched, 'match_id', v_match_id);
end;
$$;
revoke execute on function public.record_swipe(uuid, text) from public;
grant execute on function public.record_swipe(uuid, text) to authenticated;

-- ============ my_matches : exclure les matchs d'une paire bloquée ============
create or replace function public.my_matches(p_user uuid)
returns table (
  match_id uuid, other_id uuid, display_name text, photo_path text,
  expires_at timestamptz, is_active boolean
)
language sql security definer set search_path = public as $$
  select
    m.id as match_id,
    other.id as other_id,
    other.display_name,
    (select pp.storage_path from public.profile_photos pp
       where pp.profile_id = other.id order by pp.position limit 1) as photo_path,
    m.expires_at,
    (m.expires_at > now()) as is_active
  from public.matches m
  join public.profiles other
    on other.id = case when m.user_a = p_user then m.user_b else m.user_a end
  where (m.user_a = p_user or m.user_b = p_user)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = p_user and b.blocked_id = other.id)
         or (b.blocker_id = other.id and b.blocked_id = p_user)
    )
  order by m.expires_at desc;
$$;
revoke execute on function public.my_matches(uuid) from public, authenticated;
grant execute on function public.my_matches(uuid) to service_role;

-- ============ send_message : refuser si blocage entre les participants ============
create or replace function public.send_message(p_match_id uuid, p_body text, p_image_path text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_msg public.messages;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and (m.user_a = v_me or m.user_b = v_me)
      and m.expires_at > now()
  ) then
    if exists (
      select 1 from public.matches m
      where m.id = p_match_id and (m.user_a = v_me or m.user_b = v_me)
    ) then
      raise exception 'MATCH_EXPIRED';
    else
      raise exception 'NOT_A_PARTICIPANT';
    end if;
  end if;

  if exists (
    select 1 from public.matches m
    join public.blocks b
      on (b.blocker_id = v_me and b.blocked_id = case when m.user_a = v_me then m.user_b else m.user_a end)
      or (b.blocked_id = v_me and b.blocker_id = case when m.user_a = v_me then m.user_b else m.user_a end)
    where m.id = p_match_id
  ) then
    raise exception 'MATCH_UNAVAILABLE';
  end if;

  if (p_body is null and p_image_path is null)
     or (p_body is not null and p_image_path is not null) then
    raise exception 'INVALID_MESSAGE_CONTENT';
  end if;
  if p_body is not null and length(btrim(p_body)) = 0 then
    raise exception 'EMPTY_MESSAGE';
  end if;
  if p_body is not null and length(p_body) > 2000 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  if p_image_path is not null and split_part(p_image_path, '/', 1) <> p_match_id::text then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  insert into public.messages (match_id, sender_id, body, image_path)
    values (p_match_id, v_me, p_body, p_image_path)
    returning * into v_msg;

  update public.matches
    set expires_at = now() + interval '60 minutes',
        last_message_at = now(),
        notified_expiring = false
    where id = p_match_id;

  return json_build_object(
    'id', v_msg.id,
    'match_id', v_msg.match_id,
    'sender_id', v_msg.sender_id,
    'body', v_msg.body,
    'image_path', v_msg.image_path,
    'created_at', v_msg.created_at
  );
end;
$$;
