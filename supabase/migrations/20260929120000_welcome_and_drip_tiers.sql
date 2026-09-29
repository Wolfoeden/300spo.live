-- 1. Starting credit: a wallet delegated to the 300 pool gets a one-time game
--    credit. The minimum ADA balance is a server-side rule; the site does not
--    name it as a requirement, so it never leaves this schema.
-- 2. Drip tiers: holding 300 alone earns the holder rewards (300 and the meme
--    coins the treasury holds); holders who also delegate at least tier 1 /
--    tier 2 ADA to the pool earn the staker rewards (ADA, NIGHT, …) on top.

-- ---------------------------------------------------------------- starting credit

alter table game.ledger drop constraint ledger_kind_check;
alter table game.ledger add constraint ledger_kind_check check (kind in ('deposit', 'round', 'win', 'adjustment', 'bonus'));

create table game.welcome_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  amount bigint not null default 3000 check (amount > 0),
  min_lovelace bigint not null default 100000000 check (min_lovelace >= 0),
  updated_at timestamptz not null default now()
);
insert into game.welcome_settings default values;

create table game.welcome_credits (
  wallet text primary key references game.accounts (wallet),
  amount bigint not null check (amount > 0),
  lovelace bigint not null,
  created_at timestamptz not null default now()
);

alter table game.welcome_settings enable row level security;
alter table game.welcome_credits enable row level security;

-- p_lovelace: the wallet's ADA balance, read from the chain by the caller after
-- it confirmed the delegation to the 300 pool.
create function game.claim_welcome(p_wallet text, p_lovelace bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.welcome_settings;
  v_balance bigint;
begin
  select * into v_settings from game.welcome_settings;
  if not v_settings.enabled then
    return jsonb_build_object('status', 'disabled');
  end if;
  if exists (select 1 from game.welcome_credits where wallet = p_wallet) then
    return jsonb_build_object('status', 'claimed');
  end if;
  if p_lovelace < v_settings.min_lovelace then
    return jsonb_build_object('status', 'not_eligible');
  end if;
  insert into game.accounts (wallet) values (p_wallet) on conflict do nothing;
  insert into game.welcome_credits (wallet, amount, lovelace) values (p_wallet, v_settings.amount, p_lovelace)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('status', 'claimed');
  end if;
  v_balance := game.apply_delta(p_wallet, v_settings.amount, 'bonus', 'welcome:' || p_wallet, 'starting credit for delegating to 300');
  return jsonb_build_object('status', 'granted', 'amount', v_settings.amount, 'balance', v_balance);
end;
$$;

create function game.admin_update_welcome(p_enabled boolean, p_amount bigint, p_min_lovelace bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update game.welcome_settings set enabled = p_enabled, amount = p_amount, min_lovelace = p_min_lovelace, updated_at = now();
$$;

create or replace function game.state(p_wallet text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.enabled and s.treasury_address is not null,
    'minDeposit', s.min_deposit,
    'treasuryAddress', s.treasury_address,
    'bets', jsonb_build_object('min', s.min_bet, 'max', s.max_bet, 'step', s.bet_step),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'outcomes', g.outcomes,
                  'payoutBps', g.payout_bps, 'enabled', g.enabled) order by g.sort) from game.games g), '[]'::jsonb),
    'balance', coalesce((select a.balance from game.accounts a where a.wallet = p_wallet), 0),
    'welcome', (select jsonb_build_object('enabled', w.enabled, 'amount', w.amount,
                  'claimed', exists (select 1 from game.welcome_credits c where c.wallet = p_wallet))
                from game.welcome_settings w),
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', d.reference, 'requested', d.requested, 'received', d.received,
        'status', d.status, 'note', d.note, 'txHash', d.tx_hash, 'createdAt', d.created_at) order by d.created_at desc)
      from (select * from game.deposits where wallet = p_wallet and (status <> 'open' or created_at > now() - interval '1 hour')
            order by created_at desc limit 10) d), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'game', r.game, 'bet', r.bet, 'choice', r.choice, 'outcome', r.outcome,
                  'payout', r.payout, 'oddsBps', r.odds_bps, 'detail', r.detail, 'nonce', r.nonce, 'serverSeedHash', r.server_seed_hash,
                  'clientSeed', r.client_seed, 'createdAt', r.created_at) order by r.created_at desc)
      from (select * from game.rounds where wallet = p_wallet order by id desc limit 15) r), '[]'::jsonb)
  )
  from game.settings s;
$$;

create or replace function game.admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('enabled', enabled, 'minBet', min_bet, 'maxBet', max_bet, 'betStep', bet_step,
                  'minDeposit', min_deposit, 'treasuryAddress', treasury_address, 'scannedBlockHeight', scanned_block_height,
                  'lastScanAt', last_scan_at, 'lastScanResult', last_scan_result) from game.settings),
    'welcome', (select jsonb_build_object('enabled', w.enabled, 'amount', w.amount, 'minLovelace', w.min_lovelace,
                  'granted', (select count(*) from game.welcome_credits),
                  'total', (select coalesce(sum(amount), 0) from game.welcome_credits))
                from game.welcome_settings w),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'outcomes', g.outcomes,
                  'payoutBps', g.payout_bps, 'enabled', g.enabled, 'rounds', (select count(*) from game.rounds r where r.game = g.id),
                  'bets', (select coalesce(sum(bet), 0) from game.rounds r where r.game = g.id),
                  'payouts', (select coalesce(sum(payout), 0) from game.rounds r where r.game = g.id)) order by g.sort)
                from game.games g), '[]'::jsonb),
    'totals', jsonb_build_object(
      'accounts', (select count(*) from game.accounts),
      'balances', (select coalesce(sum(balance), 0) from game.accounts),
      'deposited', (select coalesce(sum(received), 0) from game.deposits where status = 'confirmed'),
      'rounds', (select count(*) from game.rounds),
      'bets', (select coalesce(sum(bet), 0) from game.rounds),
      'payouts', (select coalesce(sum(payout), 0) from game.rounds)),
    'deposits', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc)
      from (select reference, wallet, requested, received, status, note, tx_hash, created_at, confirmed_at
            from game.deposits where status <> 'open' order by created_at desc limit 50) d), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at desc)
      from (select tx_hash, quantity, block_height, created_at from game.unmatched_transfers
            where assigned_wallet is null order by created_at desc limit 50) u), '[]'::jsonb)
  );
$$;

revoke all on all functions in schema game from public, anon, authenticated;
revoke all on all tables in schema game from public, anon, authenticated;
grant execute on function
  game.claim_welcome(text, bigint),
  game.admin_update_welcome(boolean, bigint, bigint)
to game_api;

-- ---------------------------------------------------------------- drip tiers

alter table drip.settings
  add column tier1_lovelace bigint not null default 10000000000 check (tier1_lovelace > 0),
  add column tier2_lovelace bigint not null default 100000000000,
  add column excluded text[] not null default '{}',
  add constraint settings_tiers_check check (tier2_lovelace > tier1_lovelace);
-- The treasury holds 300 itself; it must not pay rewards to its own stake key.
update drip.settings set excluded = array['stake1uyxnc9y2tyh2w2qxq49gs34jnllnfuq9n44tel7a89q8yysjnntem'];

-- A reward line is a unit, the lowest tier that receives it and how that
-- tier's budget is split. The same unit may appear once per tier: a tier 2
-- line comes on top of the tier 1 line.
alter table drip.rewards
  add column tier smallint not null default 1 check (tier between 0 and 2),
  add column distribution text not null default 'equal' check (distribution in ('equal', 'tokens', 'stake'));
update drip.rewards set distribution = (select distribution from drip.settings);
alter table drip.rewards drop constraint rewards_pkey;
alter table drip.rewards add primary key (unit, tier);
alter table drip.settings drop column distribution;

insert into drip.rewards (unit, label, decimals, per_epoch, sort, tier, distribution) values
  ('8de0817b91cb94a0c69d5eaf63d306ad21012455d3e75b007c50ae06333030', '300', 0, 0, 0, 0, 'tokens'),
  ('lovelace', 'ADA', 6, 0, 0, 2, 'equal'),
  ('0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa4e49474854', 'NIGHT', 6, 0, 1, 2, 'equal')
on conflict do nothing;

alter table drip.snapshots add column tiers jsonb;
alter table drip.allocations add column tier smallint not null default 1 check (tier between 0 and 2);

create or replace function drip.config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.enabled,
    'minTokens', s.min_tokens,
    'tier1Lovelace', s.tier1_lovelace,
    'tier2Lovelace', s.tier2_lovelace,
    'excluded', to_jsonb(s.excluded),
    'lastSnapshotEpoch', (select max(epoch) from drip.snapshots),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('unit', r.unit, 'label', r.label, 'decimals', r.decimals,
                  'perEpoch', r.per_epoch::text, 'tier', r.tier, 'distribution', r.distribution) order by r.tier, r.sort, r.label)
                from drip.rewards r), '[]'::jsonb)
  )
  from drip.settings s;
$$;

-- p_summary: {holders, delegators, eligible, tiers, minTokens, budgets};
-- p_allocations: [{stake, address, unit, amount, tokens, tier}] computed by the runner.
create or replace function drip.record_snapshot(p_epoch integer, p_summary jsonb, p_allocations jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from drip.snapshots where epoch = p_epoch) then
    return 'exists';
  end if;
  insert into drip.snapshots (epoch, holders, delegators, eligible, distribution, min_tokens, budgets, tiers)
  values (p_epoch, (p_summary->>'holders')::integer, (p_summary->>'delegators')::integer, (p_summary->>'eligible')::integer,
          'tiered', (p_summary->>'minTokens')::bigint, p_summary->'budgets', p_summary->'tiers');
  insert into drip.allocations (epoch, stake_address, payout_address, unit, amount, tokens, tier)
  select p_epoch, a->>'stake', a->>'address', a->>'unit', (a->>'amount')::bigint, (a->>'tokens')::bigint, coalesce((a->>'tier')::smallint, 1)
  from jsonb_array_elements(p_allocations) a
  where (a->>'amount')::bigint > 0;
  return 'recorded';
end;
$$;

create or replace function drip.status_for(p_stake text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'config', drip.config() - 'excluded',
    'lastSnapshot', (select jsonb_build_object('epoch', epoch, 'eligible', eligible, 'tiers', tiers, 'takenAt', taken_at)
                     from drip.snapshots order by epoch desc limit 1),
    'includedInLastSnapshot', exists (select 1 from drip.allocations a
                                      where a.stake_address = p_stake and a.epoch = (select max(epoch) from drip.snapshots)),
    'tierInLastSnapshot', (select max(a.tier) from drip.allocations a
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

create or replace function drip.admin_overview()
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
                  from (select epoch, taken_at, holders, delegators, eligible, distribution, tiers, budgets from drip.snapshots
                        order by epoch desc limit 12) s), '[]'::jsonb),
    'unpaid', coalesce((select jsonb_agg(jsonb_build_object('unit', unit, 'amount', amount::text, 'wallets', wallets))
                  from (select unit, sum(amount) as amount, count(distinct stake_address) as wallets
                        from drip.allocations where payout_id is null group by unit) u), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc)
                  from (select tx_hash, status, recipients, created_at, confirmed_at from drip.payouts
                        order by created_at desc limit 20) p), '[]'::jsonb)
  );
$$;

drop function drip.admin_update(boolean, bigint, text, jsonb);

-- p_rewards: [{unit, label, decimals, perEpoch, tier, distribution}] replaces the reward list.
create function drip.admin_update(p_enabled boolean, p_min_tokens bigint, p_tier1_lovelace bigint, p_tier2_lovelace bigint,
                                  p_excluded text[], p_rewards jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update drip.settings set enabled = p_enabled, min_tokens = p_min_tokens, tier1_lovelace = p_tier1_lovelace,
         tier2_lovelace = p_tier2_lovelace, excluded = p_excluded, updated_at = now();
  delete from drip.rewards r
  where not exists (select 1 from jsonb_array_elements(p_rewards) x where x->>'unit' = r.unit and (x->>'tier')::smallint = r.tier);
  insert into drip.rewards (unit, label, decimals, per_epoch, sort, tier, distribution)
  select r->>'unit', r->>'label', (r->>'decimals')::integer, (r->>'perEpoch')::bigint, idx::integer,
         (r->>'tier')::smallint, r->>'distribution'
  from jsonb_array_elements(p_rewards) with ordinality as x(r, idx)
  on conflict (unit, tier) do update set label = excluded.label, decimals = excluded.decimals, per_epoch = excluded.per_epoch,
                                         sort = excluded.sort, distribution = excluded.distribution;
end;
$$;

revoke all on all functions in schema drip from public, anon, authenticated;
revoke all on all tables in schema drip from public, anon, authenticated;
grant execute on function drip.admin_update(boolean, bigint, bigint, bigint, text[], jsonb) to game_api;
