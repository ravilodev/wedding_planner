-- ============================================================
-- Wedding Budget AI Planner — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor → New query
-- ============================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

create table if not exists plans (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid(),
  groom            text not null,
  bride            text not null,
  city             text not null,
  wedding_date     date not null,
  budget           bigint not null,
  guests           integer not null,
  concept          text not null,
  allocation       jsonb not null,
  checklist        jsonb not null,
  readiness_score  integer not null default 0,
  created_at       timestamptz not null default now()
);

alter table plans enable row level security;

-- Each browser gets an anonymous Supabase Auth identity (no login form
-- needed — see script.js's ensureSession()). These policies make sure
-- a plan is only ever readable/writable by the identity that created it,
-- so wedding budgets aren't publicly listable through the anon key.

create policy "Owner can insert own plan"
  on plans for insert
  with check (auth.uid() = owner_id);

create policy "Owner can read own plan"
  on plans for select
  using (auth.uid() = owner_id);

create policy "Owner can update own plan"
  on plans for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- No delete policy on purpose — the app never deletes plans, and
-- omitting the policy means delete requests are denied by default.

-- ============================================================
-- After running this file, also enable Anonymous Sign-Ins:
-- Dashboard → Authentication → Sign In / Providers → Anonymous → Enable
-- ============================================================
