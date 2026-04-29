begin;

alter table public.producer_payments
  add column if not exists stripe_connect_id_test text,
  add column if not exists stripe_connect_id_live text,
  add column if not exists onboarding_complete_test boolean not null default false,
  add column if not exists onboarding_complete_live boolean not null default false,
  add column if not exists payout_enabled_test boolean not null default false,
  add column if not exists payout_enabled_live boolean not null default false,
  add column if not exists charges_enabled_test boolean not null default false,
  add column if not exists charges_enabled_live boolean not null default false,
  add column if not exists details_submitted_test boolean not null default false,
  add column if not exists details_submitted_live boolean not null default false;

update public.producer_payments
set
  stripe_connect_id_test = coalesce(stripe_connect_id_test, stripe_connect_id),
  onboarding_complete_test = coalesce(onboarding_complete_test, onboarding_complete, false),
  payout_enabled_test = coalesce(payout_enabled_test, payout_enabled, false),
  charges_enabled_test = coalesce(charges_enabled_test, charges_enabled, false),
  details_submitted_test = coalesce(details_submitted_test, details_submitted, false)
where stripe_connect_id is not null
   or onboarding_complete is not null
   or payout_enabled is not null
   or charges_enabled is not null
   or details_submitted is not null;

alter table public.purchases
  add column if not exists environment text,
  add column if not exists is_test boolean;

update public.purchases
set
  environment = coalesce(environment, 'test'),
  is_test = coalesce(is_test, true)
where environment is null
   or is_test is null;

alter table public.purchases
  alter column environment set default 'test',
  alter column is_test set default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchases_environment_check'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_environment_check
      check (environment in ('test', 'live'));
  end if;
end $$;

create index if not exists purchases_environment_idx
  on public.purchases (environment, created_at desc);

create index if not exists purchases_seller_user_environment_idx
  on public.purchases (seller_user_id, environment, created_at desc);

create index if not exists purchases_user_beats_environment_idx
  on public.purchases (user_id, beats_id, environment, created_at desc);

commit;
