-- Family Day Planner (shared space, no individual sign-ins)
-- Run this in Supabase SQL Editor.

-- Extensions
create extension if not exists pgcrypto;

-- One shared namespace for all data (matches SPACE_ID in app.js)
create table if not exists public.spaces (
  id text primary key,
  created_at timestamptz not null default now()
);

insert into public.spaces(id) values ('family_shared_v1')
on conflict (id) do nothing;

-- Settings (single row per space)
create table if not exists public.settings (
  space text primary key references public.spaces(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Tasks
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  space text not null references public.spaces(id) on delete cascade,
  title text not null,
  status text not null default 'open',
  assigned_date date null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

-- Plans (per day)
create table if not exists public.day_plans (
  space text not null references public.spaces(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (space, date)
);

-- Logs (per day)
create table if not exists public.day_logs (
  space text not null references public.spaces(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (space, date)
);

-- Updated-at triggers
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_settings_touch on public.settings;
create trigger trg_settings_touch
before update on public.settings
for each row execute function public.touch_updated_at();

drop trigger if exists trg_day_plans_touch on public.day_plans;
create trigger trg_day_plans_touch
before update on public.day_plans
for each row execute function public.touch_updated_at();

drop trigger if exists trg_day_logs_touch on public.day_logs;
create trigger trg_day_logs_touch
before update on public.day_logs
for each row execute function public.touch_updated_at();

-- RLS: allow anonymous read/write (app uses a password gate in the UI)
alter table public.spaces enable row level security;
alter table public.settings enable row level security;
alter table public.tasks enable row level security;
alter table public.day_plans enable row level security;
alter table public.day_logs enable row level security;

-- Spaces: allow read (space row already created above)
drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces
for select using (true);

-- Settings
drop policy if exists settings_select on public.settings;
drop policy if exists settings_insert on public.settings;
drop policy if exists settings_update on public.settings;
drop policy if exists settings_delete on public.settings;

create policy settings_select on public.settings for select using (true);
create policy settings_insert on public.settings for insert with check (true);
create policy settings_update on public.settings for update using (true) with check (true);
create policy settings_delete on public.settings for delete using (true);

-- Tasks
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;

create policy tasks_select on public.tasks for select using (true);
create policy tasks_insert on public.tasks for insert with check (true);
create policy tasks_update on public.tasks for update using (true) with check (true);
create policy tasks_delete on public.tasks for delete using (true);

-- Day plans
drop policy if exists day_plans_select on public.day_plans;
drop policy if exists day_plans_insert on public.day_plans;
drop policy if exists day_plans_update on public.day_plans;
drop policy if exists day_plans_delete on public.day_plans;

create policy day_plans_select on public.day_plans for select using (true);
create policy day_plans_insert on public.day_plans for insert with check (true);
create policy day_plans_update on public.day_plans for update using (true) with check (true);
create policy day_plans_delete on public.day_plans for delete using (true);

-- Day logs
drop policy if exists day_logs_select on public.day_logs;
drop policy if exists day_logs_insert on public.day_logs;
drop policy if exists day_logs_update on public.day_logs;
drop policy if exists day_logs_delete on public.day_logs;

create policy day_logs_select on public.day_logs for select using (true);
create policy day_logs_insert on public.day_logs for insert with check (true);
create policy day_logs_update on public.day_logs for update using (true) with check (true);
create policy day_logs_delete on public.day_logs for delete using (true);
