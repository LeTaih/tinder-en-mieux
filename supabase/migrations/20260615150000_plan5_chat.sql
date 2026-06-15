-- ============ Colonne d'activité sur matches ============
alter table public.matches add column if not exists last_message_at timestamptz;

-- ============ Table des messages (texte XOR image) ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  image_path text,
  created_at timestamptz not null default now(),
  constraint messages_body_xor_image check (
    (body is not null and image_path is null) or
    (body is null and image_path is not null)
  )
  ,
  constraint messages_body_len check (body is null or length(body) <= 2000)
);
create index messages_match_created_idx on public.messages (match_id, created_at);

alter table public.messages enable row level security;
-- Lecture réservée aux participants (match actif OU expiré -> archive consultable).
create policy "messages: select participant" on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.matches m
    where m.id = messages.match_id and (m.user_a = auth.uid() or m.user_b = auth.uid())
  ));
-- Aucune policy insert/update/delete : écriture uniquement via send_message (SECURITY DEFINER).

-- ============ RPC d'envoi (sécurisée, serveur-autoritaire) ============
create function public.send_message(p_match_id uuid, p_body text, p_image_path text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_msg public.messages;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Participant + match actif (lecture seule à l'expiration garantie ici).
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

  -- XOR texte/image.
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

  -- Une image doit vivre dans le dossier du match.
  if p_image_path is not null and split_part(p_image_path, '/', 1) <> p_match_id::text then
    raise exception 'INVALID_IMAGE_PATH';
  end if;

  insert into public.messages (match_id, sender_id, body, image_path)
    values (p_match_id, v_me, p_body, p_image_path)
    returning * into v_msg;

  -- Reset du timer (le coeur du produit).
  update public.matches
    set expires_at = now() + interval '60 minutes', last_message_at = now()
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

revoke execute on function public.send_message(uuid, text, text) from public;
grant execute on function public.send_message(uuid, text, text) to authenticated;

-- ============ Storage : bucket privé chat-media + policies par participation ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "chat-media: select participant" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1 from public.matches m
      where m.id::text = (storage.foldername(name))[1]
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );
create policy "chat-media: insert participant actif" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and exists (
      select 1 from public.matches m
      where m.id::text = (storage.foldername(name))[1]
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
        and m.expires_at > now()
    )
  );

-- ============ Realtime : diffuser les inserts de messages (gouverné par la RLS select) ============
alter publication supabase_realtime add table public.messages;
