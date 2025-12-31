-- Family Day Planner (Shared / No-Auth) schema + RLS
-- Run this in Supabase SQL Editor.
-- This creates a single shared "space" (space_id = 'default') that anyone using your publishable key can read/write.

create extension if not exists pgcrypto;

-- SETTINGS (single row per space)
create table if not exists public.settings (
  space_id text primary key default 'default',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- DAY PLANS (one row per date per space)
create table if not exists public.day_plans (
  id uuid primary key default gen_random_uuid(),
  space_id text not null default 'default',
  date date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (space_id, date)
);

-- DAY LOGS (one row per date per space)
create table if not exists public.day_logs (
  id uuid primary key default gen_random_uuid(),
  space_id text not null default 'default',
  date date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (space_id, date)
);

-- TASKS (shared list)
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  space_id text not null default 'default',
  title text not null,
  status text not null default 'open' check (status in ('open','done')),
  assigned_date date,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists tasks_space_created_idx on public.tasks(space_id, created_at desc);
create index if not exists tasks_space_status_idx on public.tasks(space_id, status);

-- RLS
alter table public.settings enable row level security;
alter table public.day_plans enable row level security;
alter table public.day_logs enable row level security;
alter table public.tasks enable row level security;

-- Policies (public read/write, limited to space_id='default')
drop policy if exists settings_rw on public.settings;
create policy settings_rw on public.settings
for all
to anon, authenticated
using (space_id = 'default')
with check (space_id = 'default');

drop policy if exists day_plans_rw on public.day_plans;
create policy day_plans_rw on public.day_plans
for all
to anon, authenticated
using (space_id = 'default')
with check (space_id = 'default');

drop policy if exists day_logs_rw on public.day_logs;
create policy day_logs_rw on public.day_logs
for all
to anon, authenticated
using (space_id = 'default')
with check (space_id = 'default');

drop policy if exists tasks_rw on public.tasks;
create policy tasks_rw on public.tasks
for all
to anon, authenticated
using (space_id = 'default')
with check (space_id = 'default');

-- Grants (usually already OK in Supabase, but harmless)
grant usage on schema public to anon, authenticated;
grant all on table public.settings to anon, authenticated;
grant all on table public.day_plans to anon, authenticated;
grant all on table public.day_logs to anon, authenticated;
grant all on table public.tasks to anon, authenticated;
