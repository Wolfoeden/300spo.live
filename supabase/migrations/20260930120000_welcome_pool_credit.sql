-- Starting credit by delegation: a wallet delegated to the 300 stake pool gets
-- the pool amount (30,000 300), a wallet that only delegates to the 300 DRep
-- keeps the base amount (3,000). A wallet that was credited less than it is
-- now entitled to (the 3,000 of before) is topped up by the difference, once.
-- The minimum ADA balance applies to both, as before.

alter table game.welcome_settings add column pool_amount bigint not null default 30000 check (pool_amount > 0);

-- p_pool: the wallet delegates to the 300 stake pool (read from the chain by the caller).
create function game.claim_welcome(p_wallet text, p_lovelace bigint, p_pool boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.welcome_settings;
  v_target bigint;
  v_had bigint;
  v_balance bigint;
begin
  select * into v_settings from game.welcome_settings;
  if not v_settings.enabled then
    return jsonb_build_object('status', 'disabled');
  end if;
  v_target := case when p_pool then v_settings.pool_amount else v_settings.amount end;
  -- Locks an earlier credit, so two claims at once cannot both top it up.
  select amount into v_had from game.welcome_credits where wallet = p_wallet for update;
  if v_had >= v_target then
    return jsonb_build_object('status', 'claimed');
  end if;
  if p_lovelace < v_settings.min_lovelace then
    return jsonb_build_object('status', 'not_eligible');
  end if;
  insert into game.accounts (wallet) values (p_wallet) on conflict do nothing;

  if v_had is null then
    insert into game.welcome_credits (wallet, amount, lovelace) values (p_wallet, v_target, p_lovelace)
    on conflict do nothing;
    if not found then
      return jsonb_build_object('status', 'claimed');
    end if;
    v_balance := game.apply_delta(p_wallet, v_target, 'bonus', 'welcome:' || p_wallet, 'starting credit for delegating to 300');
    return jsonb_build_object('status', 'granted', 'amount', v_target, 'total', v_target, 'balance', v_balance);
  end if;

  update game.welcome_credits set amount = v_target where wallet = p_wallet;
  v_balance := game.apply_delta(p_wallet, v_target - v_had, 'bonus', 'welcome:' || p_wallet || ':' || v_target,
    'starting credit raised for delegating to the 300 pool');
  return jsonb_build_object('status', 'granted', 'amount', v_target - v_had, 'total', v_target, 'balance', v_balance);
end;
$$;

create function game.admin_update_welcome(p_enabled boolean, p_amount bigint, p_pool_amount bigint, p_min_lovelace bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update game.welcome_settings
  set enabled = p_enabled, amount = p_amount, pool_amount = p_pool_amount, min_lovelace = p_min_lovelace, updated_at = now();
$$;

-- The public offer (landing page, delegation dialog) names both amounts.
create or replace function game.welcome_offer()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('enabled', enabled, 'amount', amount, 'poolAmount', pool_amount) from game.welcome_settings;
$$;

-- In the player's state, "claimed" means the wallet already has the pool amount;
-- anything less is asked for again, and the database decides what is due.
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
    'welcome', (select jsonb_build_object('enabled', w.enabled, 'amount', w.amount, 'poolAmount', w.pool_amount,
                  'claimed', exists (select 1 from game.welcome_credits c where c.wallet = p_wallet and c.amount >= w.pool_amount))
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
    'welcome', (select jsonb_build_object('enabled', w.enabled, 'amount', w.amount, 'poolAmount', w.pool_amount, 'minLovelace', w.min_lovelace,
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

revoke all on function game.claim_welcome(text, bigint, boolean) from public, anon, authenticated;
revoke all on function game.admin_update_welcome(boolean, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function game.claim_welcome(text, bigint, boolean), game.admin_update_welcome(boolean, bigint, bigint, bigint) to game_api;
