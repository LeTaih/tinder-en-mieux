-- ============ Extensions ============
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ============ Tokens de push (RLS propre-ligne) ============
create table public.push_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text primary key,
  platform text,
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
create policy "push_tokens: select own" on public.push_tokens
  for select to authenticated using (auth.uid() = user_id);
create policy "push_tokens: insert own" on public.push_tokens
  for insert to authenticated with check (auth.uid() = user_id);
create policy "push_tokens: update own" on public.push_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_tokens: delete own" on public.push_tokens
  for delete to authenticated using (auth.uid() = user_id);

-- ============ Badge (compteur serveur) ============
create table public.user_notification_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  badge_count int not null default 0
);
alter table public.user_notification_state enable row level security;
create policy "notif_state: select own" on public.user_notification_state
  for select to authenticated using (auth.uid() = user_id);
-- Pas d'insert/update/delete client : clear_badge (definer) remet à 0, send-push (service) incrémente.

create function public.clear_badge() returns void
language sql security definer set search_path = public as $$
  insert into public.user_notification_state (user_id, badge_count)
  values (auth.uid(), 0)
  on conflict (user_id) do update set badge_count = 0;
$$;
revoke execute on function public.clear_badge() from public;
grant execute on function public.clear_badge() to authenticated;

create function public.increment_badge(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.user_notification_state (user_id, badge_count)
  values (p_user, 1)
  on conflict (user_id) do update set badge_count = public.user_notification_state.badge_count + 1
  returning badge_count into v;
  return v;
end;
$$;
revoke execute on function public.increment_badge(uuid) from public, authenticated;
grant execute on function public.increment_badge(uuid) to service_role;

-- ============ Anti-doublon du push « 10 min » ============
alter table public.matches add column if not exists notified_expiring boolean not null default false;

-- ============ send_message : reset notified_expiring quand le timer repart ============
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

-- ============ Appel générique de l'Edge Function send-push (via pg_net + Vault) ============
create function public.call_send_push(p_user_ids uuid[], p_title text, p_body text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_internal_secret';
  if v_url is null or v_secret is null then return; end if;
  -- Une notif ne doit JAMAIS bloquer une écriture métier (message/match) ni la boucle cron :
  -- on avale toute erreur d'envoi.
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
      body := jsonb_build_object(
        'user_ids', to_jsonb(p_user_ids),
        'title', p_title,
        'body', p_body,
        'data', coalesce(p_data, '{}'::jsonb)
      )
    );
  exception when others then
    null;
  end;
end;
$$;
revoke execute on function public.call_send_push(uuid[], text, text, jsonb) from public, authenticated;

-- ============ Trigger : nouveau message -> push au destinataire ============
create function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid;
  v_sender_name text;
  v_body text;
begin
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
    into v_recipient from public.matches m where m.id = new.match_id;
  select display_name into v_sender_name from public.profiles where id = new.sender_id;
  v_body := case when new.image_path is not null then '📷 Photo' else left(new.body, 80) end;
  perform public.call_send_push(
    array[v_recipient],
    coalesce(v_sender_name, 'Nouveau message'),
    v_body,
    jsonb_build_object('type', 'message', 'matchId', new.match_id::text)
  );
  return new;
end;
$$;
create trigger trg_notify_new_message after insert on public.messages
  for each row execute function public.notify_new_message();

-- ============ Trigger : nouveau match -> push aux deux ============
create function public.notify_new_match() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.call_send_push(
    array[new.user_a, new.user_b],
    'C''est un match !',
    'Vous avez un nouveau match — vous avez 1 h pour discuter !',
    jsonb_build_object('type', 'match', 'matchId', new.id::text)
  );
  return new;
end;
$$;
create trigger trg_notify_new_match after insert on public.matches
  for each row execute function public.notify_new_match();

-- ============ Cron : « 10 min restantes » ============
create function public.notify_expiring_matches() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select id, user_a, user_b from public.matches
    where expires_at > now()
      and expires_at <= now() + interval '10 minutes'
      and notified_expiring = false
  loop
    perform public.call_send_push(
      array[r.user_a, r.user_b],
      '⏳ Plus que 10 minutes !',
      'Ton match expire bientôt — écris-lui pour le garder en vie !',
      jsonb_build_object('type', 'expiring', 'matchId', r.id::text)
    );
    update public.matches set notified_expiring = true where id = r.id;
  end loop;
end;
$$;
revoke execute on function public.notify_expiring_matches() from public, authenticated;

select cron.schedule('notify-expiring-matches', '* * * * *', $$select public.notify_expiring_matches()$$);
