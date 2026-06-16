-- ============ Fix : réenregistrement d'un token push entre comptes ============
-- Problème : push_tokens a `token` en clé primaire. Sur un même appareil, le token Expo est
-- stable ; en changeant de compte, l'upsert (on conflict token) devient un UPDATE et la policy
-- RLS `update own` (USING auth.uid() = user_id) est évaluée sur l'ANCIENNE ligne (ancien
-- propriétaire) → refus 42501. On veut au contraire réattribuer le token au compte courant.
--
-- Solution : RPC SECURITY DEFINER qui upserte en forçant user_id = auth.uid(). Sûr car la
-- ligne est toujours attribuée à l'appelant authentifié ; aucune fuite possible.
create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  insert into public.push_tokens (user_id, token, platform, updated_at)
  values (auth.uid(), p_token, p_platform, now())
  on conflict (token) do update
    set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
end;
$$;
revoke execute on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;
