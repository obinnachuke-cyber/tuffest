-- TUFFEST cloud setup (Supabase). Run this ONCE:
--   Supabase dashboard -> SQL Editor -> New query -> paste everything -> Run.
-- Safe to run again; it won't duplicate anything.
--
-- What it creates
--   spaces   a shared "room" for your vibes (you and your partner join the same one with a short code)
--   members  who belongs to which space
--   vibes    one row per vibe (date, title, caption, photo list)
--   photos   a private storage bucket for the images
-- Row Level Security means nobody can read or change a space they aren't a member of.

-- ---------- tables ----------
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (space_id, user_id)
);

create table if not exists public.vibes (
  id text primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  date date not null,
  title text not null default '',
  caption jsonb not null default '[]',
  gps jsonb,
  unfiled boolean not null default false,
  photos jsonb not null default '[]',      -- [{ "path": "...", "w": 1200, "h": 900 }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vibes_space_date on public.vibes (space_id, date desc);

-- ---------- membership check used by every policy ----------
create or replace function public.is_member(sid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.members where space_id = sid and user_id = auth.uid())
$$;

-- ---------- row level security ----------
alter table public.spaces  enable row level security;
alter table public.members enable row level security;
alter table public.vibes   enable row level security;

drop policy if exists "members read their space" on public.spaces;
create policy "members read their space" on public.spaces
  for select to authenticated using (public.is_member(id));

drop policy if exists "read own membership" on public.members;
create policy "read own membership" on public.members
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "members manage vibes" on public.vibes;
create policy "members manage vibes" on public.vibes
  for all to authenticated
  using (public.is_member(space_id)) with check (public.is_member(space_id));

-- ---------- create / join a space ----------
create or replace function public.my_space()
returns setof public.spaces language sql security definer set search_path = public stable as $$
  select s.* from public.spaces s join public.members m on m.space_id = s.id
  where m.user_id = auth.uid() limit 1
$$;

create or replace function public.create_space()
returns setof public.spaces language plpgsql security definer set search_path = public as $$
declare s public.spaces;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select sp.* into s from public.spaces sp join public.members m on m.space_id = sp.id where m.user_id = auth.uid() limit 1;
  if not found then
    insert into public.spaces default values returning * into s;
    insert into public.members (space_id, user_id) values (s.id, auth.uid());
  end if;
  return next s;
end $$;

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
  insert into public.members (space_id, user_id) values (s.id, auth.uid()) on conflict do nothing;
  return next s;
end $$;

revoke execute on function public.my_space(), public.create_space(), public.join_space(text) from public, anon;
grant  execute on function public.my_space(), public.create_space(), public.join_space(text) to authenticated;

-- ---------- photo storage ----------
-- files live at  <space id>/<vibe id>/<file>.jpg  and only that space's members can touch them
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "members use their photos" on storage.objects;
create policy "members use their photos" on storage.objects
  for all to authenticated
  using      (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
-- TUFFEST: shareable vibe links. Run this ONCE in Supabase -> SQL Editor -> New query -> Run.
-- (Run supabase-setup.sql first if you haven't.) Safe to run again.
--
-- A shared vibe is a SNAPSHOT: when you tap "Share as a link", a copy of the vibe (date, title,
-- caption and photos) is stored here under a long random token. Anyone with the link can view that
-- one vibe, and nothing else in your space. "Stop sharing" deletes the copy.

-- ---------- the snapshots ----------
create table if not exists public.shares (
  token text primary key,
  vibe_id text not null,
  space_id uuid not null references public.spaces(id) on delete cascade,
  date date not null,
  title text not null default '',
  caption jsonb not null default '[]',
  photos jsonb not null default '[]',      -- [{ "url": "...", "w": 1200, "h": 900 }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shares enable row level security;

-- only members of the space can create / change / delete their shares
drop policy if exists "members manage shares" on public.shares;
create policy "members manage shares" on public.shares
  for all to authenticated
  using (public.is_member(space_id)) with check (public.is_member(space_id));

-- anyone (even signed out) can read ONE share, but only if they know its token.
-- There is no way to list or search shares.
create or replace function public.get_share(t text)
returns table (date date, title text, caption jsonb, photos jsonb)
language sql security definer set search_path = public stable as $$
  select s.date, s.title, s.caption, s.photos from public.shares s where s.token = t limit 1
$$;
revoke execute on function public.get_share(text) from public;
grant  execute on function public.get_share(text) to anon, authenticated;

-- ---------- public copies of the photos ----------
-- files live at  <space id>/<token>/<n>.jpg . Anyone can open a file if they know the exact address;
-- only members of the space can add, replace or remove them.
insert into storage.buckets (id, name, public) values ('shared', 'shared', true)
on conflict (id) do update set public = true;

drop policy if exists "members manage shared photos" on storage.objects;
create policy "members manage shared photos" on storage.objects
  for all to authenticated
  using      (bucket_id = 'shared' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'shared' and public.is_member(((storage.foldername(name))[1])::uuid));
