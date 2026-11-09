-- School progress (ADR-046/047): one row per user, visible and writable only by its owner.
-- Run once in the Supabase SQL Editor (done 2026-11-09).
create table if not exists public.school_progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.school_progress enable row level security;

create policy "own progress: read"   on public.school_progress
  for select to authenticated using (auth.uid() = user_id);
create policy "own progress: insert" on public.school_progress
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own progress: update" on public.school_progress
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- tables are not exposed automatically: grant only what the policies allow, only to signed-in users
grant select, insert, update on public.school_progress to authenticated;
revoke all on public.school_progress from anon;
