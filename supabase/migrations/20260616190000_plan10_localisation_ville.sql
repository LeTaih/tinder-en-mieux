-- ============ Plan 10 : libellé de ville + contrôle de dérive de localisation ============
-- Objectif : afficher une ville (jamais les coordonnées brutes) sur les profils, et proposer
-- au lancement de mettre à jour sa position si elle a beaucoup changé. La logique de distance
-- vit côté serveur (RPC) pour ne jamais exposer les coordonnées stockées au client.

-- Libellé de ville (coarse), saisi par géocodage inverse côté appareil. Jamais de coordonnées.
alter table public.profiles
  add column if not exists location_label text
    check (location_label is null or length(location_label) <= 80);

-- ============ set_my_location : accepte désormais un libellé de ville optionnel ============
-- Le libellé n'est mis à jour que s'il est fourni (un géocodage échoué ne doit pas l'effacer).
drop function if exists public.set_my_location(double precision, double precision);
create function public.set_my_location(lng double precision, lat double precision, label text default null)
returns void
language sql security definer set search_path = public, extensions as $$
  update public.profiles
  set location = extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
      location_label = coalesce(nullif(btrim(coalesce(label, '')), ''), location_label),
      updated_at = now()
  where id = auth.uid();
$$;
revoke execute on function public.set_my_location(double precision, double precision, text) from public;
grant execute on function public.set_my_location(double precision, double precision, text) to authenticated;

-- ============ location_drift_km : distance (km) entre un point et ma position stockée ============
-- Renvoie NULL si je n'ai pas encore de position. N'expose jamais mes coordonnées : seul un
-- entier de distance sort. Sert au contrôle « tu sembles avoir changé d'endroit » au lancement.
create function public.location_drift_km(lng double precision, lat double precision)
returns int
language sql security definer set search_path = public, extensions as $$
  select case
    when p.location is null then null
    else round(extensions.st_distance(
      p.location,
      extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
    ) / 1000.0)::int
  end
  from public.profiles p
  where p.id = auth.uid();
$$;
revoke execute on function public.location_drift_km(double precision, double precision) from public;
grant execute on function public.location_drift_km(double precision, double precision) to authenticated;

-- ============ deck_candidates : + location_label (conserve filtres swipes + blocage) ============
drop function if exists public.deck_candidates(uuid, int, int);
create function public.deck_candidates(p_user uuid, p_limit int default 10, p_offset int default 0)
returns table (
  id uuid, display_name text, age int, distance_km int, bio text, photo_paths text[],
  job text, education text, height_cm int, interests text[], prompts jsonb, location_label text
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
    ) as photo_paths,
    c.job, c.education, c.height_cm,
    array(
      select i.label from public.profile_interests pi
      join public.interests i on i.id = pi.interest_id
      where pi.profile_id = c.id order by i.sort_order
    ) as interests,
    coalesce((
      select jsonb_agg(jsonb_build_object('question', pr.question, 'answer', ppr.answer) order by ppr.position)
      from public.profile_prompts ppr join public.prompts pr on pr.id = ppr.prompt_id
      where ppr.profile_id = c.id
    ), '[]'::jsonb) as prompts,
    c.location_label
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

-- ============ my_matches : + location_label (conserve filtre blocage) ============
drop function if exists public.my_matches(uuid);
create function public.my_matches(p_user uuid)
returns table (
  match_id uuid, other_id uuid, display_name text, photo_path text, photo_paths text[],
  expires_at timestamptz, is_active boolean,
  job text, education text, height_cm int, interests text[], prompts jsonb, location_label text
)
language sql security definer set search_path = public as $$
  select
    m.id as match_id,
    other.id as other_id,
    other.display_name,
    (select pp.storage_path from public.profile_photos pp
       where pp.profile_id = other.id order by pp.position limit 1) as photo_path,
    array(select pp.storage_path from public.profile_photos pp
       where pp.profile_id = other.id order by pp.position) as photo_paths,
    m.expires_at,
    (m.expires_at > now()) as is_active,
    other.job, other.education, other.height_cm,
    array(
      select i.label from public.profile_interests pi
      join public.interests i on i.id = pi.interest_id
      where pi.profile_id = other.id order by i.sort_order
    ) as interests,
    coalesce((
      select jsonb_agg(jsonb_build_object('question', pr.question, 'answer', ppr.answer) order by ppr.position)
      from public.profile_prompts ppr join public.prompts pr on pr.id = ppr.prompt_id
      where ppr.profile_id = other.id
    ), '[]'::jsonb) as prompts,
    other.location_label
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
