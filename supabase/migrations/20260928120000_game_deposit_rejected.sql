-- A deposit sent from the treasury wallet to itself moves no tokens. The
-- watcher ignores such transfers; this closes the deposit as "rejected" with
-- a reason, so the player sees why instead of "confirming" forever.

alter table game.deposits drop constraint deposits_status_check;
alter table game.deposits add constraint deposits_status_check check (status in ('open', 'submitted', 'confirmed', 'rejected'));
alter table game.deposits add column note text;

create function game.reject_deposit(p_reference uuid, p_tx_hash text, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  update game.deposits
  set status = 'rejected', tx_hash = p_tx_hash, note = p_note
  where reference = p_reference
    and status in ('open', 'submitted')
    and (tx_hash is null or tx_hash = p_tx_hash);
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
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'outcomes', g.outcomes,
                  'payoutBps', g.payout_bps, 'enabled', g.enabled) order by g.sort) from game.games g), '[]'::jsonb),
    'balance', coalesce((select a.balance from game.accounts a where a.wallet = p_wallet), 0),
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', d.reference, 'requested', d.requested, 'received', d.received,
        'status', d.status, 'note', d.note, 'txHash', d.tx_hash, 'createdAt', d.created_at) order by d.created_at desc)
      from (select * from game.deposits where wallet = p_wallet and (status <> 'open' or created_at > now() - interval '1 hour')
            order by created_at desc limit 10) d), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'game', r.game, 'bet', r.bet, 'choice', r.choice, 'outcome', r.outcome,
                  'payout', r.payout, 'nonce', r.nonce, 'serverSeedHash', r.server_seed_hash, 'clientSeed', r.client_seed,
                  'createdAt', r.created_at) order by r.created_at desc)
      from (select * from game.rounds where wallet = p_wallet order by id desc limit 15) r), '[]'::jsonb)
  )
  from game.settings s;
$$;

revoke all on function game.reject_deposit(uuid, text, text) from public, anon, authenticated;
grant execute on function game.reject_deposit(uuid, text, text) to game_api;
