-- Starting credit: 3,000 300 for every wallet that delegates to the 300 stake
-- pool and/or the 300 DRep, without an ADA minimum (Roman, 30 September 2026).
-- Wallets that already got more keep it.
--
-- Every claim is logged with its outcome (granted, already claimed, not
-- delegated, …), so the admin page shows why a wallet got nothing.

update game.welcome_settings set amount = 3000, pool_amount = 3000, min_lovelace = 0, updated_at = now();
alter table game.welcome_settings alter column pool_amount set default 3000;

create table game.welcome_attempts (
  wallet text primary key,
  status text not null,
  pool boolean not null default false,
  drep boolean not null default false,
  lovelace bigint,
  attempts integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
alter table game.welcome_attempts enable row level security;

create function game.log_welcome_attempt(p_wallet text, p_status text, p_pool boolean, p_drep boolean, p_lovelace bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into game.welcome_attempts (wallet, status, pool, drep, lovelace)
  values (p_wallet, left(p_status, 32), p_pool, p_drep, p_lovelace)
  on conflict (wallet) do update
  set status = excluded.status, pool = excluded.pool, drep = excluded.drep, lovelace = excluded.lovelace,
      attempts = game.welcome_attempts.attempts + 1, last_at = now();
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
                  'total', (select coalesce(sum(amount), 0) from game.welcome_credits),
                  'attempts', coalesce((select jsonb_agg(to_jsonb(a) order by a.last_at desc)
                    from (select wallet, status, pool, drep, lovelace, attempts, last_at from game.welcome_attempts
                          order by last_at desc limit 30) a), '[]'::jsonb))
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

revoke all on function game.log_welcome_attempt(text, text, boolean, boolean, bigint) from public, anon, authenticated;
grant execute on function game.log_welcome_attempt(text, text, boolean, boolean, bigint) to game_api;
