-- TUFFEST: pairing with your person. Run this ONCE in Supabase -> SQL Editor -> New query -> Run.
-- (Run supabase-setup.sql and supabase-share.sql first.) Safe to run again.
--
-- What it does
--   * a space holds exactly two people (you and your person)
--   * an invite is a private link you send; it shows one vibe, and signing up from it pairs her to you
--   * each of you can set what you call the other, and vibes remember who added them

-- ---------- new columns ----------
alter table public.shares  add column if not exists invite boolean not null default false;
alter table public.shares  add column if not exists expires_at timestamptz;
alter table public.vibes   add column if not exists author uuid;
alter table public.members add column if not exists partner_nickname text not null default '';

-- ---------- reading an invite (signed out is fine; you still need its long random token) ----------
drop function if exists public.get_share(text);
create or replace function public.get_share(t text)
returns table (date date, title text, caption jsonb, photos jsonb, invite boolean)
language sql security definer set search_path = public stable as $$
  select s.date, s.title, s.caption, s.photos, s.invite
  from public.shares s
  where s.token = t and (s.expires_at is null or s.expires_at > now()) limit 1
$$;
revoke execute on function public.get_share(text) from public;
grant  execute on function public.get_share(text) to anon, authenticated;

-- ---------- two people per space ----------
create or replace function public.join_space(invite text)
returns setof public.spaces language plpgsql security definer set search_path = public as $$
declare s public.spaces;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into s from public.spaces where code = lower(trim(invite));
  if not found then raise exception 'That space code doesn''t exist'; end if;
  if exists (select 1 from public.members where user_id = auth.uid() and space_id <> s.id) then
    raise exception 'This account already belongs to a different space';
  end if;
  if (select count(*) from public.members where space_id = s.id) >= 2
     and not exists (select 1 from public.members where space_id = s.id and user_id = auth.uid()) then
    raise exception 'This space is already paired with two people';
  end if;
  insert into public.members (space_id, user_id) values (s.id, auth.uid()) on conflict do nothing;
  return next s;
end $$;

-- ---------- pairing through an invite link ----------
create or replace function public.join_via_invite(t text)
returns setof public.spaces language plpgsql security definer set search_path = public as $$
declare sh public.shares; sp public.spaces;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into sh from public.shares where token = t and invite and (expires_at is null or expires_at > now());
  if not found then raise exception 'This invite has expired or doesn''t exist'; end if;
  select * into sp from public.spaces where id = sh.space_id;
  if exists (select 1 from public.members where user_id = auth.uid() and space_id <> sp.id) then
    raise exception 'This account already belongs to a different space';
  end if;
  if (select count(*) from public.members where space_id = sp.id) >= 2
     and not exists (select 1 from public.members where space_id = sp.id and user_id = auth.uid()) then
    raise exception 'This space is already paired with two people';
  end if;
  insert into public.members (space_id, user_id) values (sp.id, auth.uid()) on conflict do nothing;
  return next sp;
end $$;

-- ---------- who am I paired with, and what do I call them ----------
create or replace function public.my_pair()
returns table (partner_email text, nickname text)
language sql security definer set search_path = public stable as $$
  select u.email::text, me.partner_nickname
  from public.members me
  left join public.members other on other.space_id = me.space_id and other.user_id <> me.user_id
  left join auth.users u on u.id = other.user_id
  where me.user_id = auth.uid() limit 1
$$;

create or replace function public.set_partner_nickname(n text)
returns void language sql security definer set search_path = public as $$
  update public.members set partner_nickname = left(coalesce(n, ''), 40) where user_id = auth.uid()
$$;

revoke execute on function public.join_space(text), public.join_via_invite(text), public.my_pair(), public.set_partner_nickname(text) from public, anon;
grant  execute on function public.join_space(text), public.join_via_invite(text), public.my_pair(), public.set_partner_nickname(text) to authenticated;
