-- ============ Catalogues (lecture authentifiée, comme genders) ============
create table public.interests (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);
alter table public.interests enable row level security;
create policy "interests: lecture authentifiée" on public.interests
  for select to authenticated using (true);
insert into public.interests (key, label, sort_order) values
  ('sport','Sport',1),('musique','Musique',2),('voyage','Voyage',3),('cuisine','Cuisine',4),
  ('cinema','Cinéma',5),('jeux_video','Jeux vidéo',6),('lecture','Lecture',7),('art','Art',8),
  ('nature','Nature',9),('animaux','Animaux',10),('sorties','Sorties',11),('fitness','Fitness',12),
  ('photographie','Photographie',13),('danse','Danse',14),('tech','Tech',15),('mode','Mode',16),
  ('cafe','Café',17),('vin','Vin',18),('yoga','Yoga',19),('festivals','Festivals',20);

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  question text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);
alter table public.prompts enable row level security;
create policy "prompts: lecture authentifiée" on public.prompts
  for select to authenticated using (true);
insert into public.prompts (key, question, sort_order) values
  ('dimanche_ideal','Le dimanche idéal…',1),
  ('on_matche_si','On matche si…',2),
  ('passion_inavouable','Ma passion inavouable…',3),
  ('jamais_sans','Je ne pars jamais sans…',4),
  ('me_fait_rire','Ce qui me fait rire…',5),
  ('plat_signature','Mon plat signature…',6),
  ('voyage_reve','Mon prochain voyage de rêve…',7),
  ('petit_plaisir','Mon petit plaisir coupable…',8),
  ('fier_de','Je suis fier·e de…',9),
  ('week_end_parfait','Un week-end parfait…',10);

-- ============ Tables de liaison (RLS propre-ligne) ============
create table public.profile_interests (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  primary key (profile_id, interest_id)
);
alter table public.profile_interests enable row level security;
create policy "profile_interests: select own" on public.profile_interests
  for select to authenticated using (auth.uid() = profile_id);
create policy "profile_interests: insert own" on public.profile_interests
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "profile_interests: delete own" on public.profile_interests
  for delete to authenticated using (auth.uid() = profile_id);

create table public.profile_prompts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  prompt_id uuid not null references public.prompts(id),
  answer text not null check (length(btrim(answer)) between 1 and 200),
  position int not null check (position between 0 and 2),
  unique (profile_id, position),
  unique (profile_id, prompt_id)
);
alter table public.profile_prompts enable row level security;
create policy "profile_prompts: select own" on public.profile_prompts
  for select to authenticated using (auth.uid() = profile_id);
create policy "profile_prompts: insert own" on public.profile_prompts
  for insert to authenticated with check (auth.uid() = profile_id);
create policy "profile_prompts: update own" on public.profile_prompts
  for update to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "profile_prompts: delete own" on public.profile_prompts
  for delete to authenticated using (auth.uid() = profile_id);

-- ============ Colonnes riches sur profiles ============
alter table public.profiles
  add column if not exists job text check (job is null or length(job) <= 50),
  add column if not exists education text check (education is null or length(education) <= 50),
  add column if not exists height_cm int check (height_cm is null or height_cm between 120 and 230);

-- ============ set_my_interests (remplacement atomique, ≤5) ============
create function public.set_my_interests(p_interest_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if coalesce(array_length(p_interest_ids, 1), 0) > 5 then raise exception 'TOO_MANY_INTERESTS'; end if;
  delete from public.profile_interests where profile_id = v_me;
  insert into public.profile_interests (profile_id, interest_id)
    select v_me, i.id from public.interests i
    where i.id = any(p_interest_ids) and i.is_active
    on conflict do nothing;
end;
$$;
revoke execute on function public.set_my_interests(uuid[]) from public;
grant execute on function public.set_my_interests(uuid[]) to authenticated;

-- ============ set_my_prompts (remplacement atomique, ≤3, réponses 1..200) ============
create function public.set_my_prompts(p_prompt_ids uuid[], p_answers text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_n int := coalesce(array_length(p_prompt_ids, 1), 0);
  i int;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_n > 3 or v_n <> coalesce(array_length(p_answers, 1), 0) then raise exception 'INVALID_PROMPTS'; end if;
  if v_n <> (select count(distinct x) from unnest(p_prompt_ids) x) then raise exception 'DUPLICATE_PROMPT'; end if;
  delete from public.profile_prompts where profile_id = v_me;
  for i in 1 .. v_n loop
    if length(btrim(p_answers[i])) = 0 or length(p_answers[i]) > 200 then raise exception 'INVALID_ANSWER'; end if;
    if not exists (select 1 from public.prompts pr where pr.id = p_prompt_ids[i] and pr.is_active) then
      raise exception 'UNKNOWN_PROMPT';
    end if;
    insert into public.profile_prompts (profile_id, prompt_id, answer, position)
      values (v_me, p_prompt_ids[i], btrim(p_answers[i]), i - 1);
  end loop;
end;
$$;
revoke execute on function public.set_my_prompts(uuid[], text[]) from public;
grant execute on function public.set_my_prompts(uuid[], text[]) to authenticated;
