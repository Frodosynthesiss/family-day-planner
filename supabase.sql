-- Family Day Planner schema + RLS (run in Supabase SQL Editor)
create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our household',
  join_code text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create table if not exists public.settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  status text not null default 'open' check (status in ('open','done')),
  assigned_date date null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);
create index if not exists tasks_household_idx on public.tasks(household_id);
create index if not exists tasks_assigned_idx on public.tasks(household_id, assigned_date);

create table if not exists public.day_plans (
  household_id uuid not null references public.households(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (household_id, date)
);

create table if not exists public.day_logs (
  household_id uuid not null references public.households(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (household_id, date)
);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists touch_settings on public.settings;
create trigger touch_settings before update on public.settings
for each row execute function public.touch_updated_at();

drop trigger if exists touch_day_plans on public.day_plans;
create trigger touch_day_plans before update on public.day_plans
for each row execute function public.touch_updated_at();

drop trigger if exists touch_day_logs on public.day_logs;
create trigger touch_day_logs before update on public.day_logs
for each row execute function public.touch_updated_at();

-- Join household by join_code (security definer)
create or replace function public.join_household(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare hh_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select id into hh_id from public.households where join_code = upper(p_join_code) limit 1;
  if hh_id is null then raise exception 'Invalid join code'; end if;

  insert into public.household_members (household_id, user_id, role)
  values (hh_id, auth.uid(), 'member')
  on conflict (household_id, user_id) do nothing;

  return hh_id;
end;
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.settings enable row level security;
alter table public.tasks enable row level security;
alter table public.day_plans enable row level security;
alter table public.day_logs enable row level security;

create or replace function public.is_household_member(hh uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hh and m.user_id = auth.uid()
  );
$$;

-- Policies
drop policy if exists households_select on public.households;
create policy households_select on public.households
for select using (public.is_household_member(id));

drop policy if exists households_insert on public.households;
create policy households_insert on public.households
for insert with check (created_by = auth.uid());

drop policy if exists households_update on public.households;
create policy households_update on public.households
for update using (public.is_household_member(id))
with check (public.is_household_member(id));

drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
for select using (public.is_household_member(household_id) or user_id = auth.uid());

drop policy if exists household_members_insert_self on public.household_members;
create policy household_members_insert_self on public.household_members
for insert with check (user_id = auth.uid());

drop policy if exists settings_rw on public.settings;
create policy settings_rw on public.settings
for all using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists tasks_rw on public.tasks;
create policy tasks_rw on public.tasks
for all using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists day_plans_rw on public.day_plans;
create policy day_plans_rw on public.day_plans
for all using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists day_logs_rw on public.day_logs;
create policy day_logs_rw on public.day_logs
for all using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));
