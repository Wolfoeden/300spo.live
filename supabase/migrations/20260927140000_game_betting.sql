-- Betting games: the player bets game balance on an outcome; a correct pick
-- pays bet × multiplier back into the game balance. Winnings stay game credit:
-- there are still no withdrawals.
--
-- Outcomes are provably fair: each wallet has a secret server seed whose
-- SHA-256 hash is shown in advance, a client seed it may choose and a nonce.
-- outcome = floor(u32(HMAC-SHA256(server_seed, "<client_seed>:<nonce>")[0..4]) × outcomes / 2^32).
-- Rotating the seed reveals the old server seed so past rounds can be checked.

alter table game.settings
  add column min_bet bigint not null default 300 check (min_bet > 0),
  add column max_bet bigint not null default 3000 check (max_bet > 0),
  add column bet_step bigint not null default 300 check (bet_step > 0);

create table game.games (
  id text primary key check (id ~ '^[a-z0-9-]{1,32}$'),
  name text not null,
  outcomes integer not null check (outcomes between 2 and 20),
  -- Payout including the stake, in basis points: 20000 = 2.00×.
  payout_bps integer not null check (payout_bps between 10000 and 1000000),
  enabled boolean not null default true,
  sort integer not null default 0
);
alter table game.games enable row level security;
insert into game.games (id, name, outcomes, payout_bps, sort) values
  ('coin-flip', 'Coin flip', 2, 20000, 0),
  ('horse-race', 'Horse race', 5, 50000, 1),
  ('xerxes-vs-robot', 'Xerxes vs AI robot', 2, 20000, 2);

create table game.seeds (
  wallet text primary key references game.accounts (wallet),
  server_seed bytea not null,
  server_seed_hash text not null,
  client_seed text not null,
  nonce integer not null default 0,
  created_at timestamptz not null default now()
);
alter table game.seeds enable row level security;

create table game.revealed_seeds (
  id bigint generated always as identity primary key,
  wallet text not null references game.accounts (wallet),
  server_seed text not null,
  server_seed_hash text not null,
  client_seed text not null,
  last_nonce integer not null,
  revealed_at timestamptz not null default now()
);
create index revealed_seeds_wallet_idx on game.revealed_seeds (wallet, revealed_at desc);
alter table game.revealed_seeds enable row level security;

-- The placeholder rounds become bets (no production rounds exist yet).
delete from game.ledger where kind = 'round';
delete from game.rounds;
alter table game.rounds rename column cost to bet;
alter table game.rounds
  add column choice integer not null,
  add column outcome integer not null,
  add column payout bigint not null default 0 check (payout >= 0),
  add column server_seed_hash text not null,
  add column client_seed text not null,
  add column nonce integer not null,
  add constraint rounds_game_fkey foreign key (game) references game.games (id);
create index rounds_game_idx on game.rounds (game);

alter table game.ledger drop constraint ledger_kind_check;
alter table game.ledger add constraint ledger_kind_check check (kind in ('deposit', 'round', 'win', 'adjustment'));

drop function game.start_round(text, text);

create function game.ensure_seed(p_wallet text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into game.accounts (wallet) values (p_wallet) on conflict do nothing;
  insert into game.seeds (wallet, server_seed, server_seed_hash, client_seed)
  select p_wallet, s.seed, encode(extensions.digest(s.seed, 'sha256'), 'hex'), encode(extensions.gen_random_bytes(8), 'hex')
  from (select extensions.gen_random_bytes(32) as seed) s
  on conflict (wallet) do nothing;
$$;

create function game.fairness(p_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform game.ensure_seed(p_wallet);
  return (
    select jsonb_build_object(
      'serverSeedHash', s.server_seed_hash, 'clientSeed', s.client_seed, 'nonce', s.nonce,
      'revealed', coalesce((select jsonb_agg(jsonb_build_object('serverSeed', r.server_seed, 'serverSeedHash', r.server_seed_hash,
                    'clientSeed', r.client_seed, 'lastNonce', r.last_nonce, 'revealedAt', r.revealed_at) order by r.revealed_at desc)
                  from (select * from game.revealed_seeds where wallet = p_wallet order by revealed_at desc limit 5) r), '[]'::jsonb))
    from game.seeds s where s.wallet = p_wallet
  );
end;
$$;

-- Reveals the current server seed and starts a new pair (optionally with the player's client seed).
create function game.rotate_seed(p_wallet text, p_client_seed text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed game.seeds;
  v_new bytea := extensions.gen_random_bytes(32);
begin
  if p_client_seed is not null and p_client_seed !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid_client_seed';
  end if;
  perform game.ensure_seed(p_wallet);
  select * into v_seed from game.seeds where wallet = p_wallet for update;
  insert into game.revealed_seeds (wallet, server_seed, server_seed_hash, client_seed, last_nonce)
  values (p_wallet, encode(v_seed.server_seed, 'hex'), v_seed.server_seed_hash, v_seed.client_seed, v_seed.nonce);
  update game.seeds
  set server_seed = v_new,
      server_seed_hash = encode(extensions.digest(v_new, 'sha256'), 'hex'),
      client_seed = coalesce(p_client_seed, encode(extensions.gen_random_bytes(8), 'hex')),
      nonce = 0,
      created_at = now()
  where wallet = p_wallet;
  return game.fairness(p_wallet);
end;
$$;

create function game.play(p_wallet text, p_game text, p_bet bigint, p_choice integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_game game.games;
  v_seed game.seeds;
  v_nonce integer;
  v_hmac bytea;
  v_outcome integer;
  v_payout bigint := 0;
  v_round bigint;
  v_balance bigint;
begin
  select * into v_settings from game.settings;
  select * into v_game from game.games where id = p_game;
  if not v_settings.enabled or v_game.id is null or not v_game.enabled then
    raise exception 'game_disabled';
  end if;
  if p_bet < v_settings.min_bet or p_bet > v_settings.max_bet or p_bet % v_settings.bet_step <> 0 then
    raise exception 'invalid_bet';
  end if;
  if p_choice < 0 or p_choice >= v_game.outcomes then
    raise exception 'invalid_choice';
  end if;

  perform game.ensure_seed(p_wallet);
  select * into v_seed from game.seeds where wallet = p_wallet for update;
  v_nonce := v_seed.nonce + 1;
  update game.seeds set nonce = v_nonce where wallet = p_wallet;

  v_hmac := extensions.hmac(convert_to(v_seed.client_seed || ':' || v_nonce::text, 'UTF8'), v_seed.server_seed, 'sha256');
  v_outcome := floor(('x' || encode(substring(v_hmac from 1 for 4), 'hex'))::bit(32)::bigint::numeric * v_game.outcomes / 4294967296)::integer;
  if v_outcome = p_choice then
    v_payout := p_bet * v_game.payout_bps / 10000;
  end if;

  insert into game.rounds (wallet, game, bet, choice, outcome, payout, server_seed_hash, client_seed, nonce)
  values (p_wallet, p_game, p_bet, p_choice, v_outcome, v_payout, v_seed.server_seed_hash, v_seed.client_seed, v_nonce)
  returning id into v_round;
  v_balance := game.apply_delta(p_wallet, -p_bet, 'round', v_round::text);
  if v_payout > 0 then
    v_balance := game.apply_delta(p_wallet, v_payout, 'win', v_round::text);
  end if;

  return jsonb_build_object('roundId', v_round, 'game', p_game, 'bet', p_bet, 'choice', p_choice, 'outcome', v_outcome,
    'win', v_payout > 0, 'payout', v_payout, 'balance', v_balance, 'nonce', v_nonce,
    'serverSeedHash', v_seed.server_seed_hash, 'clientSeed', v_seed.client_seed);
end;
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
        'status', d.status, 'txHash', d.tx_hash, 'createdAt', d.created_at) order by d.created_at desc)
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
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'outcomes', g.outcomes, 'payoutBps', g.payout_bps,
                  'enabled', g.enabled, 'rounds', (select count(*) from game.rounds r where r.game = g.id),
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
      from (select reference, wallet, requested, received, status, tx_hash, created_at, confirmed_at
            from game.deposits where status <> 'open' order by created_at desc limit 50) d), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at desc)
      from (select tx_hash, quantity, block_height, created_at from game.unmatched_transfers
            where assigned_wallet is null order by created_at desc limit 50) u), '[]'::jsonb)
  );
$$;

drop function game.admin_update_settings(boolean, bigint, bigint, text);
create function game.admin_update_settings(p_enabled boolean, p_min_bet bigint, p_max_bet bigint, p_bet_step bigint,
                                           p_min_deposit bigint, p_treasury_address text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_min_bet > p_max_bet or p_min_bet % p_bet_step <> 0 or p_max_bet % p_bet_step <> 0 then
    raise exception 'invalid_bet_limits';
  end if;
  update game.settings
  set enabled = p_enabled,
      min_bet = p_min_bet,
      max_bet = p_max_bet,
      bet_step = p_bet_step,
      min_deposit = p_min_deposit,
      scanned_block_height = case when treasury_address is distinct from p_treasury_address then 0 else scanned_block_height end,
      treasury_address = p_treasury_address,
      updated_at = now();
end;
$$;

create function game.admin_update_game(p_id text, p_enabled boolean, p_payout_bps integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update game.games set enabled = p_enabled, payout_bps = p_payout_bps where id = p_id;
  if not found then
    raise exception 'game_not_found';
  end if;
end;
$$;

revoke all on all functions in schema game from public, anon, authenticated;
revoke all on all tables in schema game from public, anon, authenticated;
grant execute on function
  game.fairness(text),
  game.rotate_seed(text, text),
  game.play(text, text, bigint, integer),
  game.state(text),
  game.admin_overview(),
  game.admin_update_settings(boolean, bigint, bigint, bigint, bigint, text),
  game.admin_update_game(text, boolean, integer)
to game_api;
