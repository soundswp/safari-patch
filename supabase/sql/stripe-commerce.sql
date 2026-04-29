begin;

create extension if not exists pgcrypto;

create table if not exists public.producer_payments (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_connect_id text,
  stripe_connect_id_test text,
  stripe_connect_id_live text,
  onboarding_complete boolean not null default false,
  onboarding_complete_test boolean not null default false,
  onboarding_complete_live boolean not null default false,
  payout_enabled boolean not null default false,
  payout_enabled_test boolean not null default false,
  payout_enabled_live boolean not null default false,
  charges_enabled boolean not null default false,
  charges_enabled_test boolean not null default false,
  charges_enabled_live boolean not null default false,
  details_submitted boolean not null default false,
  details_submitted_test boolean not null default false,
  details_submitted_live boolean not null default false,
  payout_schedule text,
  country text,
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.purchases
  add column if not exists status text default 'completed',
  add column if not exists seller_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists seller_stripe_account_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists environment text default 'test',
  add column if not exists is_test boolean default true,
  add column if not exists product_type text,
  add column if not exists entitlement_files text[] default '{}'::text[],
  add column if not exists entitlement_payload jsonb default '{}'::jsonb,
  add column if not exists buyer_email text,
  add column if not exists beat_title text,
  add column if not exists producer_name text,
  add column if not exists completed_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_error text;

create unique index if not exists purchases_checkout_session_key
  on public.purchases (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index if not exists purchases_seller_user_id_idx
  on public.purchases (seller_user_id, created_at desc);

create index if not exists purchases_user_id_beats_id_idx
  on public.purchases (user_id, beats_id, created_at desc);

create index if not exists purchases_environment_idx
  on public.purchases (environment, created_at desc);

create index if not exists purchases_seller_user_environment_idx
  on public.purchases (seller_user_id, environment, created_at desc);

commit;
