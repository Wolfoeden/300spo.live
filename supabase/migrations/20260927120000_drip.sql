-- Drip: every epoch, wallets that are delegated to the 300 pool and hold at
-- least `min_tokens` 300 tokens receive a share of the per-epoch reward
-- budgets (ADA, NIGHT, …). Allocations accumulate until the admin signs a
-- batch payout with the distribution wallet in the browser; no key lives on
-- the server. Like the game schema, only SECURITY DEFINER functions touch the
-- tables and `game_api` may execute them.

create schema drip;
revoke all on schema drip from public;

create table drip.settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  min_tokens bigint not null default 3000000 check (min_tokens > 0),
  distribution text not null default 'equal' check (distribution in ('equal', 'tokens', 'stake')),
  last_run_at timestamptz,
  last_run_result jsonb,
  updated_at timestamptz not null default now()
);
insert into drip.settings default values;

-- Per-epoch budgets in base units (lovelace for ADA, smallest unit for tokens).
create table drip.rewards (
  unit text primary key check (unit = 'lovelace' or unit ~ '^[0-9a-f]{56}([0-9a-f]{2}){0,32}$'),
  label text not null check (length(label) between 1 and 20),
  decimals integer not null default 0 check (decimals between 0 and 18),
  per_epoch bigint not null default 0 check (per_epoch >= 0),
  sort integer not null default 0
);
insert into drip.rewards (unit, label, decimals, per_epoch, sort) values
  ('lovelace', 'ADA', 6, 0, 0),
  ('0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa4e49474854', 'NIGHT', 6, 0, 1);

create table drip.snapshots (
  epoch integer primary key,
  taken_at timestamptz not null default now(),
  holders integer not null,
  delegators integer not null,
  eligible integer not null,
  distribution text not null,
  min_tokens bigint not null,
  budgets jsonb not null
);

create table drip.payouts (
  id bigint generated always as identity primary key,
  tx_hash text not null unique check (tx_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'built' check (status in ('built', 'submitted', 'confirmed', 'failed')),
  recipients integer not null check (recipients > 0),
  block_height bigint,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz
);

create table drip.allocations (
  id bigint generated always as identity primary key,
  epoch integer not null references drip.snapshots (epoch),
  stake_address text not null check (stake_address ~ '^stake1[02-9ac-hj-np-z]{53}$'),
  payout_address text not null check (payout_address ~ '^addr1[02-9ac-hj-np-z]{50,120}$'),
  unit text not null,
  amount bigint not null check (amount > 0),
  tokens bigint not null check (tokens >= 0),
  payout_id bigint references drip.payouts (id),
  unique (epoch, stake_address, unit)
);
create index allocations_stake_address_idx on drip.allocations (stake_address);
create index allocations_payout_id_idx on drip.allocations (payout_id);

alter table drip.settings enable row level security;
alter table drip.rewards enable row level security;
alter table drip.snapshots enable row level security;
alter table drip.payouts enable row level security;
alter table drip.allocations enable row level security;

create function drip.config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.enabled,
    'minTokens', s.min_tokens,
    'distribution', s.distribution,
    'lastSnapshotEpoch', (select max(epoch) from drip.snapshots),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('unit', r.unit, 'label', r.label, 'decimals', r.decimals,
                  'perEpoch', r.per_epoch::text) order by r.sort, r.label) from drip.rewards r), '[]'::jsonb)
  )
  from drip.settings s;
$$;

-- p_allocations: [{stake, address, unit, amount, tokens}] computed by the runner.
create function drip.record_snapshot(p_epoch integer, p_summary jsonb, p_allocations jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from drip.snapshots where epoch = p_epoch) then
    return 'exists';
  end if;
  insert into drip.snapshots (epoch, holders, delegators, eligible, distribution, min_tokens, budgets)
  values (p_epoch, (p_summary->>'holders')::integer, (p_summary->>'delegators')::integer, (p_summary->>'eligible')::integer,
          p_summary->>'distribution', (p_summary->>'minTokens')::bigint, p_summary->'budgets');
  insert into drip.allocations (epoch, stake_address, payout_address, unit, amount, tokens)
  select p_epoch, a->>'stake', a->>'address', a->>'unit', (a->>'amount')::bigint, (a->>'tokens')::bigint
  from jsonb_array_elements(p_allocations) a
  where (a->>'amount')::bigint > 0;
  return 'recorded';
end;
$$;

create function drip.record_run(p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update drip.settings set last_run_at = now(), last_run_result = p_result;
$$;

-- Everything a wallet may see about its own drip rewards.
create function drip.status_for(p_stake text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'config', drip.config(),
    'lastSnapshot', (select jsonb_build_object('epoch', epoch, 'eligible', eligible, 'takenAt', taken_at)
                     from drip.snapshots order by epoch desc limit 1),
    'includedInLastSnapshot', exists (select 1 from drip.allocations a
                                      where a.stake_address = p_stake and a.epoch = (select max(epoch) from drip.snapshots)),
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object('unit', t.unit, 'unpaid', t.unpaid::text, 'paid', t.paid::text))
      from (select a.unit,
                   sum(a.amount) filter (where p.status is distinct from 'confirmed') as unpaid,
                   sum(a.amount) filter (where p.status = 'confirmed') as paid
            from drip.allocations a left join drip.payouts p on p.id = a.payout_id
            where a.stake_address = p_stake group by a.unit) t), '[]'::jsonb)
  );
$$;

-- Recipients with unpaid allocations, oldest first; one output per wallet.
create function drip.unpaid_batch(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recipients as (
    select a.stake_address, min(a.epoch) as first_epoch, max(a.epoch) as last_epoch
    from drip.allocations a
    where a.payout_id is null
    group by a.stake_address
    order by min(a.epoch), a.stake_address
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'stake', r.stake_address,
    'address', (select a.payout_address from drip.allocations a where a.stake_address = r.stake_address order by a.epoch desc limit 1),
    'amounts', (select jsonb_object_agg(u.unit, u.amount::text)
                from (select unit, sum(amount) as amount from drip.allocations
                      where stake_address = r.stake_address and payout_id is null group by unit) u),
    'allocationIds', (select jsonb_agg(a.id order by a.id) from drip.allocations a
                      where a.stake_address = r.stake_address and a.payout_id is null),
    'firstEpoch', r.first_epoch, 'lastEpoch', r.last_epoch) order by r.first_epoch, r.stake_address), '[]'::jsonb)
  from recipients r;
$$;

-- Reserves allocations for a transaction before it is signed, so they can
-- never be paid twice. Released again if the transaction never lands.
create function drip.reserve_payout(p_tx_hash text, p_allocation_ids bigint[], p_recipients integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout bigint;
  v_taken integer;
begin
  perform 1 from drip.allocations where id = any(p_allocation_ids) for update;
  select count(*) into v_taken from drip.allocations where id = any(p_allocation_ids) and payout_id is not null;
  if v_taken > 0 then
    raise exception 'allocation_taken';
  end if;
  insert into drip.payouts (tx_hash, recipients) values (p_tx_hash, p_recipients) returning id into v_payout;
  update drip.allocations set payout_id = v_payout where id = any(p_allocation_ids);
  return v_payout;
end;
$$;

create function drip.mark_payout_submitted(p_tx_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  update drip.payouts set status = 'submitted', submitted_at = now() where tx_hash = p_tx_hash and status = 'built';
$$;

create function drip.confirm_payout(p_tx_hash text, p_block_height bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update drip.payouts set status = 'confirmed', block_height = p_block_height, confirmed_at = now()
  where tx_hash = p_tx_hash and status in ('built', 'submitted');
$$;

create function drip.release_payout(p_tx_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout bigint;
begin
  update drip.payouts set status = 'failed' where tx_hash = p_tx_hash and status in ('built', 'submitted') returning id into v_payout;
  if v_payout is not null then
    update drip.allocations set payout_id = null where payout_id = v_payout;
  end if;
end;
$$;

create function drip.pending_payouts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('txHash', tx_hash, 'status', status, 'createdAt', created_at)), '[]'::jsonb)
  from drip.payouts where status in ('built', 'submitted');
$$;

create function drip.admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'config', drip.config(),
    'lastRunAt', (select last_run_at from drip.settings),
    'lastRunResult', (select last_run_result from drip.settings),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(s) order by s.epoch desc)
                  from (select epoch, taken_at, holders, delegators, eligible, distribution, budgets from drip.snapshots
                        order by epoch desc limit 12) s), '[]'::jsonb),
    'unpaid', coalesce((select jsonb_agg(jsonb_build_object('unit', unit, 'amount', amount::text, 'wallets', wallets))
                  from (select unit, sum(amount) as amount, count(distinct stake_address) as wallets
                        from drip.allocations where payout_id is null group by unit) u), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc)
                  from (select tx_hash, status, recipients, created_at, confirmed_at from drip.payouts
                        order by created_at desc limit 20) p), '[]'::jsonb)
  );
$$;

-- p_rewards: [{unit, label, decimals, perEpoch}] replaces the reward list.
create function drip.admin_update(p_enabled boolean, p_min_tokens bigint, p_distribution text, p_rewards jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update drip.settings set enabled = p_enabled, min_tokens = p_min_tokens, distribution = p_distribution, updated_at = now();
  delete from drip.rewards where unit not in (select r->>'unit' from jsonb_array_elements(p_rewards) r);
  insert into drip.rewards (unit, label, decimals, per_epoch, sort)
  select r->>'unit', r->>'label', (r->>'decimals')::integer, (r->>'perEpoch')::bigint, idx::integer
  from jsonb_array_elements(p_rewards) with ordinality as x(r, idx)
  on conflict (unit) do update set label = excluded.label, decimals = excluded.decimals,
                                   per_epoch = excluded.per_epoch, sort = excluded.sort;
end;
$$;

revoke all on all functions in schema drip from public, anon, authenticated;
revoke all on all tables in schema drip from public, anon, authenticated;
alter default privileges in schema drip revoke execute on functions from public;

grant usage on schema drip to game_api;
grant execute on function
  drip.config(),
  drip.record_snapshot(integer, jsonb, jsonb),
  drip.record_run(jsonb),
  drip.status_for(text),
  drip.unpaid_batch(integer),
  drip.reserve_payout(text, bigint[], integer),
  drip.mark_payout_submitted(text),
  drip.confirm_payout(text, bigint),
  drip.release_payout(text),
  drip.pending_payouts(),
  drip.admin_overview(),
  drip.admin_update(boolean, bigint, text, jsonb)
to game_api;
