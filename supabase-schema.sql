-- Run this entire script in Supabase → SQL Editor → New Query → Run

-- ── OATH Violations ──────────────────────────────────────────────────────
create table public.oath_violations (
  id               bigserial primary key,
  created_at       timestamptz default now(),
  oath_ticket_number text default '',
  date_issued      date not null,
  violation_type   text not null default 'IDLING',
  vehicle          text default '',
  driver           text default '',
  location         text default '',
  borough          text default 'Manhattan',
  fine_amount      numeric(8,2) default 350,
  status           text default 'OPEN',
  hearing_date     timestamptz,
  motive_event_id  text default '',
  job_ticket       text default '',
  telematics_pulled boolean default false,
  notes            text default '',
  resolved_date    date
);

-- ── Motive Idle Events ────────────────────────────────────────────────────
create table public.motive_events (
  id               bigserial primary key,
  created_at       timestamptz default now(),
  motive_id        text default '',
  start_time       text default '',
  event_date       date,
  vehicle          text default '',
  vehicle_type     text default 'UNKNOWN',
  driver           text default 'Unidentified',
  location         text default '',
  idle_mins        numeric(8,2) default 0,
  idle_fuel        numeric(8,3) default 0,
  long_idle        boolean default false,
  alert_triggered  boolean default false,
  risk_level       text default 'OK',
  boom_confirmed   text default 'unreviewed',
  job_ticket       text default '',
  linked_violation_id bigint references public.oath_violations(id),
  notes            text default ''
);

-- ── Fleet Vehicles ────────────────────────────────────────────────────────
create table public.fleet_vehicles (
  id               bigserial primary key,
  vehicle_id       text unique not null,
  description      text default '',
  vehicle_type     text default 'UNKNOWN',
  make_model       text default '',
  license_plate    text default '',
  exempt_idle      boolean default false,
  idle_alert_set   boolean default false,
  notes            text default ''
);

-- ── Row Level Security (lets your app read/write) ─────────────────────────
alter table public.oath_violations enable row level security;
alter table public.motive_events enable row level security;
alter table public.fleet_vehicles enable row level security;

create policy "Allow all for authenticated users" on public.oath_violations
  for all using (true) with check (true);

create policy "Allow all for authenticated users" on public.motive_events
  for all using (true) with check (true);

create policy "Allow all for authenticated users" on public.fleet_vehicles
  for all using (true) with check (true);

-- ── Pre-populate your fleet ───────────────────────────────────────────────
insert into public.fleet_vehicles (vehicle_id, description, vehicle_type, exempt_idle) values
  ('B-11', 'Boom Truck',  'BOOM_CRANE', true),
  ('B-12', 'Boom Truck',  'BOOM_CRANE', true),
  ('B8',   'Flatbed',     'FLATBED',    false),
  ('B10',  'Flatbed',     'FLATBED',    false),
  ('GC-1', 'Box Truck',   'BOX_TRUCK',  false),
  ('GC-2', 'Box Truck',   'BOX_TRUCK',  false),
  ('GC3',  'Box Truck',   'BOX_TRUCK',  false),
  ('FB-1', 'Flatbed',     'FLATBED',    false),
  ('FB-2', 'Flatbed',     'FLATBED',    false);
