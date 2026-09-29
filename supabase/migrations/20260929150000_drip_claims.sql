-- Drip rewards are claimed: a signed-in wallet claims what it has earned, and
-- only claimed allocations go into the payout batch the admin signs. Unclaimed
-- allocations stay available. Also a public read of the starting-credit offer
-- for the delegation dialog.

alter table drip.allocations add column claimed_at timestamptz;

-- Marks everything the wallet has earned and not yet claimed as claimed.
create function drip.claim(p_stake text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update drip.allocations set claimed_at = now()
    where stake_address = p_stake and claimed_at is null and payout_id is null
    returning 1
  )
  select jsonb_build_object('claimed', (select count(*) from claimed));
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
    -- claimable: earned, not claimed yet; pending: claimed, waiting for the payout; paid: confirmed on chain.
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object('unit', t.unit, 'claimable', t.claimable::text, 'pending', t.pending::text, 'paid', t.paid::text))
      from (select a.unit,
                   sum(a.amount) filter (where a.claimed_at is null and a.payout_id is null) as claimable,
                   sum(a.amount) filter (where a.claimed_at is not null and p.status is distinct from 'confirmed') as pending,
                   sum(a.amount) filter (where p.status = 'confirmed') as paid
            from drip.allocations a left join drip.payouts p on p.id = a.payout_id
            where a.stake_address = p_stake group by a.unit) t), '[]'::jsonb)
  );
$$;

-- Recipients with claimed, unpaid allocations, oldest first; one output per wallet.
create or replace function drip.unpaid_batch(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recipients as (
    select a.stake_address, min(a.epoch) as first_epoch, max(a.epoch) as last_epoch
    from drip.allocations a
    where a.payout_id is null and a.claimed_at is not null
    group by a.stake_address
    order by min(a.claimed_at), a.stake_address
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'stake', r.stake_address,
    'address', (select a.payout_address from drip.allocations a where a.stake_address = r.stake_address order by a.epoch desc limit 1),
    'amounts', (select jsonb_object_agg(u.unit, u.amount::text)
                from (select unit, sum(amount) as amount from drip.allocations
                      where stake_address = r.stake_address and payout_id is null and claimed_at is not null group by unit) u),
    'allocationIds', (select jsonb_agg(a.id order by a.id) from drip.allocations a
                      where a.stake_address = r.stake_address and a.payout_id is null and a.claimed_at is not null),
    'firstEpoch', r.first_epoch, 'lastEpoch', r.last_epoch) order by r.first_epoch, r.stake_address), '[]'::jsonb)
  from recipients r;
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
    -- Claimed and waiting for a payout.
    'unpaid', coalesce((select jsonb_agg(jsonb_build_object('unit', unit, 'amount', amount::text, 'wallets', wallets))
                  from (select unit, sum(amount) as amount, count(distinct stake_address) as wallets
                        from drip.allocations where payout_id is null and claimed_at is not null group by unit) u), '[]'::jsonb),
    -- Earned but not claimed yet.
    'unclaimed', coalesce((select jsonb_agg(jsonb_build_object('unit', unit, 'amount', amount::text, 'wallets', wallets))
                  from (select unit, sum(amount) as amount, count(distinct stake_address) as wallets
                        from drip.allocations where payout_id is null and claimed_at is null group by unit) u), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc)
                  from (select tx_hash, status, recipients, created_at, confirmed_at from drip.payouts
                        order by created_at desc limit 20) p), '[]'::jsonb)
  );
$$;

create function game.welcome_offer()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('enabled', enabled, 'amount', amount) from game.welcome_settings;
$$;

revoke all on all functions in schema drip from public, anon, authenticated;
revoke all on all functions in schema game from public, anon, authenticated;
grant execute on function drip.claim(text), game.welcome_offer() to game_api;
