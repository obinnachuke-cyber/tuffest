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
