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
