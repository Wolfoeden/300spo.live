-- Every watcher run records when it ran and what it found, so the admin page
-- (and anyone checking) can see that the scheduled scan is alive.

alter table game.settings
  add column last_scan_at timestamptz,
  add column last_scan_result jsonb;

create function game.record_scan(p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update game.settings set last_scan_at = now(), last_scan_result = p_result;
$$;

create or replace function game.admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('enabled', enabled, 'roundCost', round_cost, 'minDeposit', min_deposit,
                  'treasuryAddress', treasury_address, 'scannedBlockHeight', scanned_block_height,
                  'lastScanAt', last_scan_at, 'lastScanResult', last_scan_result) from game.settings),
    'totals', jsonb_build_object(
      'accounts', (select count(*) from game.accounts),
      'balances', (select coalesce(sum(balance), 0) from game.accounts),
      'deposited', (select coalesce(sum(received), 0) from game.deposits where status = 'confirmed'),
      'rounds', (select count(*) from game.rounds),
      'spent', (select coalesce(sum(cost), 0) from game.rounds)),
    'deposits', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc)
      from (select reference, wallet, requested, received, status, tx_hash, created_at, confirmed_at
            from game.deposits where status <> 'open' order by created_at desc limit 50) d), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at desc)
      from (select tx_hash, quantity, block_height, created_at from game.unmatched_transfers
            where assigned_wallet is null order by created_at desc limit 50) u), '[]'::jsonb)
  );
$$;

revoke all on function game.record_scan(jsonb) from public, anon, authenticated;
grant execute on function game.record_scan(jsonb) to game_api;
