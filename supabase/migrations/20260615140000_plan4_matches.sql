-- ============ Table des matchs ============
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint matches_ordered_pair check (user_a < user_b)
);
create index matches_user_a_idx on public.matches (user_a);
create index matches_user_b_idx on public.matches (user_b);
create index matches_expires_idx on public.matches (expires_at);

alter table public.matches enable row level security;
create policy "matches: select participant" on public.matches
  for select to authenticated using (auth.uid() = user_a or auth.uid() = user_b);

-- ============ record_swipe : SECURITY DEFINER + crée le match sur like mutuel ============
drop function if exists public.record_swipe(uuid, text);

create function public.record_swipe(p_target uuid, p_direction text)
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

-- ============ my_matches (réservée au rôle service) ============
create function public.my_matches(p_user uuid)
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
  where m.user_a = p_user or m.user_b = p_user
  order by m.expires_at desc;
$$;

revoke execute on function public.my_matches(uuid) from public, authenticated;
grant execute on function public.my_matches(uuid) to service_role;
