-- TUFFEST: pair AFTER you already have an account. Run this ONCE in Supabase -> SQL Editor -> New query -> Run.
-- (Run supabase-setup.sql, supabase-share.sql and supabase-pair.sql first.) Safe to run again.
--
-- An account that has only ever been on its own (a space with just that one person) can now join
-- someone else's space through their invite link or pairing code. Its own empty space is closed.
-- An account that is already paired with another person cannot move, and a space still holds two people.

-- ---------- a read-only check, run before anything is moved ----------
create or replace function public.check_pairing(t text default null, c text default null)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public stable as $$
declare target uuid; mine uuid;
begin
  if auth.uid() is null then return query select false, 'not_signed_in'; return; end if;
  if t is not null and t <> '' then
    select space_id into target from public.shares where token = t and invite and (expires_at is null or expires_at > now());
    if target is null then return query select false, 'invite_expired'; return; end if;
  else
    select id into target from public.spaces where code = lower(trim(coalesce(c, '')));
    if target is null then return query select false, 'code_unknown'; return; end if;
  end if;
  select space_id into mine from public.members where user_id = auth.uid() limit 1;
  if mine = target then return query select false, 'already_in_space'; return; end if;
  if (select count(*) from public.members where space_id = target) >= 2 then return query select false, 'space_full'; return; end if;
  if mine is not null and (select count(*) from public.members where space_id = mine) > 1 then return query select false, 'already_paired'; return; end if;
  return query select true, 'ok';
end $$;

-- ---------- joining through an invite link ----------
create or replace function public.join_via_invite(t text)
returns setof public.spaces language plpgsql security definer set search_path = public as $$
declare sh public.shares; sp public.spaces; mine uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into sh from public.shares where token = t and invite and (expires_at is null or expires_at > now());
  if not found then raise exception 'This invite has expired or doesn''t exist'; end if;
  select * into sp from public.spaces where id = sh.space_id;
  select space_id into mine from public.members where user_id = auth.uid() limit 1;
  if mine is not null and mine <> sp.id then
    if (select count(*) from public.members where space_id = mine) > 1 then
      raise exception 'This account is already paired with someone else';
    end if;
    delete from public.spaces where id = mine;      -- its own solo space; members, vibes and invites go with it
  end if;
  if (select count(*) from public.members where space_id = sp.id) >= 2
     and not exists (select 1 from public.members where space_id = sp.id and user_id = auth.uid()) then
    raise exception 'This space is already paired with two people';
  end if;
  insert into public.members (space_id, user_id) values (sp.id, auth.uid()) on conflict do nothing;
  return next sp;
end $$;

-- ---------- joining by typing a pairing code ----------
create or replace function public.join_space(invite text)
returns setof public.spaces language plpgsql security definer set search_path = public as $$
declare s public.spaces; mine uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into s from public.spaces where code = lower(trim(invite));
  if not found then raise exception 'That space code doesn''t exist'; end if;
  select space_id into mine from public.members where user_id = auth.uid() limit 1;
  if mine is not null and mine <> s.id then
    if (select count(*) from public.members where space_id = mine) > 1 then
      raise exception 'This account is already paired with someone else';
    end if;
    delete from public.spaces where id = mine;
  end if;
  if (select count(*) from public.members where space_id = s.id) >= 2
     and not exists (select 1 from public.members where space_id = s.id and user_id = auth.uid()) then
    raise exception 'This space is already paired with two people';
  end if;
  insert into public.members (space_id, user_id) values (s.id, auth.uid()) on conflict do nothing;
  return next s;
end $$;

revoke execute on function public.check_pairing(text, text), public.join_via_invite(text), public.join_space(text) from public, anon;
grant  execute on function public.check_pairing(text, text), public.join_via_invite(text), public.join_space(text) to authenticated;
