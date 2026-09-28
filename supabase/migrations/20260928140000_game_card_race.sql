-- Card horse race replaces the five-horse race.
--
-- The 48 cards without aces are shuffled per bet (Fisher–Yates driven by
-- HMAC-SHA256(server_seed, "<client_seed>:<nonce>:race:<block>")). The first
-- seven cards lie face up as the track; the player sees them and the odds
-- before betting (game.race_preview). The rest are turned one by one: each
-- card moves the ace of its suit one step; when every ace has reached track
-- card k, the ace of that card's suit steps back once. The first ace to reach
-- step 8 wins. Odds are the exact fair payout 1/p (rounded down, capped at
-- 100×) from game.race_odds, computed by lib/game/card-race.ts (scripts/race-odds.ts).

alter table game.games add column kind text not null default 'pick' check (kind in ('pick', 'race'));
update game.games set enabled = false, name = 'Horse race (classic)', sort = 9 where id = 'horse-race';
insert into game.games (id, name, outcomes, payout_bps, enabled, sort, kind)
values ('card-race', 'Horse race', 4, 10000, true, 1, 'race');

alter table game.rounds add column odds_bps integer;

create table game.race_odds (
  -- Track suits relabelled in order of first appearance, e.g. '0120012'.
  pattern text primary key check (pattern ~ '^[0-3]{7}$'),
  -- Payout per label in basis points (0 = that ace cannot win).
  odds_bps integer[] not null check (cardinality(odds_bps) = 4)
);
alter table game.race_odds enable row level security;

create function game.race_deck(p_seed bytea, p_client_seed text, p_nonce integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_deck integer[] := array(select generate_series(0, 47));
  v_block integer := 0;
  v_buffer bytea;
  v_offset integer := 32;
  v_i integer;
  v_n bigint;
  v_limit bigint;
  v_word bigint;
  v_j integer;
  v_swap integer;
begin
  for v_i in reverse 47..1 loop
    v_n := v_i + 1;
    v_limit := (4294967296 / v_n) * v_n;
    loop
      if v_offset >= 32 then
        v_buffer := extensions.hmac(convert_to(p_client_seed || ':' || p_nonce::text || ':race:' || v_block::text, 'UTF8'), p_seed, 'sha256');
        v_block := v_block + 1;
        v_offset := 0;
      end if;
      v_word := (get_byte(v_buffer, v_offset)::bigint << 24) + (get_byte(v_buffer, v_offset + 1)::bigint << 16)
              + (get_byte(v_buffer, v_offset + 2)::bigint << 8) + get_byte(v_buffer, v_offset + 3)::bigint;
      v_offset := v_offset + 4;
      exit when v_word < v_limit;
    end loop;
    v_j := (v_word % v_n)::integer;
    v_swap := v_deck[v_i + 1];
    v_deck[v_i + 1] := v_deck[v_j + 1];
    v_deck[v_j + 1] := v_swap;
  end loop;
  return v_deck;
end;
$$;

-- Returns the winning suit and how many cards were turned.
create function game.race_run(p_deck integer[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_positions integer[] := array[0, 0, 0, 0];
  v_reached integer := 0;
  v_index integer;
  v_suit integer;
  v_back integer;
begin
  for v_index in 8..48 loop
    v_suit := p_deck[v_index] / 12;
    v_positions[v_suit + 1] := v_positions[v_suit + 1] + 1;
    if v_positions[v_suit + 1] = 8 then
      return jsonb_build_object('winner', v_suit, 'draws', v_index - 7);
    end if;
    while v_reached < 7 and least(v_positions[1], v_positions[2], v_positions[3], v_positions[4]) >= v_reached + 1 loop
      v_back := p_deck[v_reached + 1] / 12;
      v_positions[v_back + 1] := v_positions[v_back + 1] - 1;
      v_reached := v_reached + 1;
    end loop;
  end loop;
  raise exception 'race_unfinished';
end;
$$;

-- Odds per suit (♠ ♥ ♦ ♣) for the track in the deck's first seven cards.
create function game.race_odds_for(p_deck integer[])
returns integer[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_label integer[] := array[-1, -1, -1, -1];
  v_next integer := 0;
  v_pattern text := '';
  v_index integer;
  v_suit integer;
  v_odds integer[];
  v_result integer[] := array[0, 0, 0, 0];
begin
  for v_index in 1..7 loop
    v_suit := p_deck[v_index] / 12;
    if v_label[v_suit + 1] < 0 then
      v_label[v_suit + 1] := v_next;
      v_next := v_next + 1;
    end if;
    v_pattern := v_pattern || v_label[v_suit + 1]::text;
  end loop;
  for v_index in 1..4 loop
    if v_label[v_index] < 0 then
      v_label[v_index] := v_next;
      v_next := v_next + 1;
    end if;
  end loop;
  select odds_bps into v_odds from game.race_odds where pattern = v_pattern;
  if v_odds is null then
    raise exception 'race_odds_missing';
  end if;
  for v_index in 1..4 loop
    v_result[v_index] := v_odds[v_label[v_index] + 1];
  end loop;
  return v_result;
end;
$$;

-- The next race for this wallet (its next nonce): track and odds, before any bet.
create function game.race_preview(p_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed game.seeds;
  v_deck integer[];
begin
  perform game.ensure_seed(p_wallet);
  select * into v_seed from game.seeds where wallet = p_wallet;
  v_deck := game.race_deck(v_seed.server_seed, v_seed.client_seed, v_seed.nonce + 1);
  return jsonb_build_object('nonce', v_seed.nonce + 1, 'serverSeedHash', v_seed.server_seed_hash,
    'track', to_jsonb(v_deck[1:7]), 'odds', to_jsonb(game.race_odds_for(v_deck)));
end;
$$;

-- Bets on the race the player was shown. p_nonce and p_server_seed_hash come
-- from race_preview; if the deal has changed since (another bet, a new seed),
-- the bet is refused so nobody bets on odds they did not see.
create function game.play_race(p_wallet text, p_bet bigint, p_choice integer, p_nonce integer, p_server_seed_hash text)
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
  v_deck integer[];
  v_odds integer[];
  v_race jsonb;
  v_winner integer;
  v_payout bigint := 0;
  v_round bigint;
  v_balance bigint;
begin
  select * into v_settings from game.settings;
  select * into v_game from game.games where id = 'card-race';
  if not v_settings.enabled or v_game.id is null or not v_game.enabled then
    raise exception 'game_disabled';
  end if;
  if p_bet < v_settings.min_bet or p_bet > v_settings.max_bet or p_bet % v_settings.bet_step <> 0 then
    raise exception 'invalid_bet';
  end if;
  if p_choice < 0 or p_choice > 3 then
    raise exception 'invalid_choice';
  end if;

  perform game.ensure_seed(p_wallet);
  select * into v_seed from game.seeds where wallet = p_wallet for update;
  v_nonce := v_seed.nonce + 1;
  if p_nonce is distinct from v_nonce or p_server_seed_hash is distinct from v_seed.server_seed_hash then
    raise exception 'race_changed';
  end if;
  update game.seeds set nonce = v_nonce where wallet = p_wallet;

  v_deck := game.race_deck(v_seed.server_seed, v_seed.client_seed, v_nonce);
  v_odds := game.race_odds_for(v_deck);
  if v_odds[p_choice + 1] = 0 then
    raise exception 'invalid_choice';
  end if;
  v_race := game.race_run(v_deck);
  v_winner := (v_race ->> 'winner')::integer;
  if v_winner = p_choice then
    v_payout := p_bet * v_odds[p_choice + 1] / 10000;
  end if;

  insert into game.rounds (wallet, game, bet, choice, outcome, payout, server_seed_hash, client_seed, nonce, odds_bps)
  values (p_wallet, 'card-race', p_bet, p_choice, v_winner, v_payout, v_seed.server_seed_hash, v_seed.client_seed, v_nonce, v_odds[p_choice + 1])
  returning id into v_round;
  v_balance := game.apply_delta(p_wallet, -p_bet, 'round', v_round::text);
  if v_payout > 0 then
    v_balance := game.apply_delta(p_wallet, v_payout, 'win', v_round::text);
  end if;

  return jsonb_build_object('roundId', v_round, 'game', 'card-race', 'bet', p_bet, 'choice', p_choice, 'outcome', v_winner,
    'win', v_payout > 0, 'payout', v_payout, 'balance', v_balance, 'nonce', v_nonce,
    'serverSeedHash', v_seed.server_seed_hash, 'clientSeed', v_seed.client_seed,
    'race', jsonb_build_object('track', to_jsonb(v_deck[1:7]), 'draws', to_jsonb(v_deck[8:7 + (v_race ->> 'draws')::integer]),
                               'odds', to_jsonb(v_odds)));
end;
$$;

-- The pick games keep using play(); race games go through play_race().
create or replace function game.play(p_wallet text, p_game text, p_bet bigint, p_choice integer)
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
  if not v_settings.enabled or v_game.id is null or not v_game.enabled or v_game.kind <> 'pick' then
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
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'kind', g.kind, 'outcomes', g.outcomes,
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
                  'payout', r.payout, 'oddsBps', r.odds_bps, 'nonce', r.nonce, 'serverSeedHash', r.server_seed_hash,
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
  game.race_preview(text),
  game.play_race(text, bigint, integer, integer, text)
to game_api;

-- Generated by scripts/race-odds.ts
insert into game.race_odds (pattern, odds_bps) values
  ('0000000', array[0, 30000, 30000, 30000]),
  ('0000001', array[0, 42716, 26113, 26113]),
  ('0000010', array[0, 42716, 26113, 26113]),
  ('0000011', array[0, 70665, 23296, 23296]),
  ('0000012', array[0, 36161, 36161, 22375]),
  ('0000100', array[0, 42716, 26113, 26113]),
  ('0000101', array[0, 70665, 23296, 23296]),
  ('0000102', array[0, 36161, 36161, 22375]),
  ('0000110', array[0, 70665, 23296, 23296]),
  ('0000111', array[1000000, 150714, 21422, 21422]),
  ('0000112', array[1000000, 57862, 31418, 19651]),
  ('0000120', array[0, 36161, 36161, 22375]),
  ('0000121', array[1000000, 57862, 31418, 19651]),
  ('0000122', array[1000000, 31418, 57862, 19651]),
  ('0000123', array[1000000, 30001, 30001, 30001]),
  ('0001000', array[0, 42716, 26113, 26113]),
  ('0001001', array[0, 72035, 23223, 23223]),
  ('0001002', array[0, 36683, 35947, 22261]),
  ('0001010', array[0, 72035, 23223, 23223]),
  ('0001011', array[1000000, 166417, 21279, 21279]),
  ('0001012', array[1000000, 62360, 30911, 19375]),
  ('0001020', array[0, 36683, 35947, 22261]),
  ('0001021', array[1000000, 62360, 30911, 19375]),
  ('0001022', array[1000000, 33135, 56166, 19226]),
  ('0001023', array[1000000, 31685, 29224, 29224]),
  ('0001100', array[0, 72035, 23223, 23223]),
  ('0001101', array[1000000, 167273, 21272, 21272]),
  ('0001102', array[1000000, 62830, 30862, 19350]),
  ('0001110', array[1000000, 167273, 21272, 21272]),
  ('0001111', array[1000000, 736909, 20286, 20286]),
  ('0001112', array[1000000, 152950, 27618, 17478]),
  ('0001120', array[1000000, 62830, 30862, 19350]),
  ('0001121', array[1000000, 152950, 27672, 17457]),
  ('0001122', array[1000000, 59238, 46318, 16262]),
  ('0001123', array[1000000, 56507, 24408, 24214]),
  ('0001200', array[0, 36683, 35947, 22261]),
  ('0001201', array[1000000, 62128, 31218, 19279]),
  ('0001202', array[1000000, 33036, 57133, 19148]),
  ('0001203', array[1000000, 31538, 29574, 29005]),
  ('0001210', array[1000000, 62128, 31218, 19279]),
  ('0001211', array[1000000, 148405, 28492, 17205]),
  ('0001212', array[1000000, 57005, 49081, 16117]),
  ('0001213', array[1000000, 54052, 25413, 23745]),
  ('0001220', array[1000000, 33036, 57133, 19148]),
  ('0001221', array[1000000, 56452, 49457, 16121]),
  ('0001222', array[1000000, 31209, 120911, 16765]),
  ('0001223', array[1000000, 28127, 46278, 23363]),
  ('0001230', array[1000000, 31538, 29574, 29005]),
  ('0001231', array[1000000, 53115, 25335, 24000]),
  ('0001232', array[1000000, 28013, 45656, 23605]),
  ('0001233', array[1000000, 27822, 24934, 41813]),
  ('0010000', array[0, 47335, 25356, 25356]),
  ('0010001', array[0, 92397, 22427, 22427]),
  ('0010002', array[0, 44054, 33683, 21002]),
  ('0010010', array[0, 92397, 22427, 22427]),
  ('0010011', array[1000000, 267127, 20778, 20778]),
  ('0010012', array[1000000, 87423, 29207, 18409]),
  ('0010020', array[0, 44054, 33683, 21002]),
  ('0010021', array[1000000, 87423, 29207, 18409]),
  ('0010022', array[1000000, 41893, 50782, 17719]),
  ('0010023', array[1000000, 40100, 26645, 26645]),
  ('0010100', array[0, 92397, 22427, 22427]),
  ('0010101', array[1000000, 269969, 20770, 20770]),
  ('0010102', array[1000000, 88615, 29151, 18379]),
  ('0010110', array[1000000, 269969, 20770, 20770]),
  ('0010111', array[1000000, 1000000, 20124, 20124]),
  ('0010112', array[1000000, 276876, 26729, 16967]),
  ('0010120', array[1000000, 88615, 29151, 18379]),
  ('0010121', array[1000000, 276876, 26787, 16944]),
  ('0010122', array[1000000, 88088, 43039, 15296]),
  ('0010123', array[1000000, 84181, 22804, 22607]),
  ('0010200', array[0, 44054, 33683, 21002]),
  ('0010201', array[1000000, 86889, 29504, 18316]),
  ('0010202', array[1000000, 41709, 51658, 17648]),
  ('0010203', array[1000000, 39823, 26971, 26448]),
  ('0010210', array[1000000, 86889, 29504, 18316]),
  ('0010211', array[1000000, 259018, 27601, 16703]),
  ('0010212', array[1000000, 82126, 45657, 15178]),
  ('0010213', array[1000000, 77669, 23776, 22207]),
  ('0010220', array[1000000, 41709, 51658, 17648]),
  ('0010221', array[1000000, 80857, 46004, 15184]),
  ('0010222', array[1000000, 39620, 106690, 15303]),
  ('0010223', array[1000000, 35447, 41203, 21060]),
  ('0010230', array[1000000, 39823, 26971, 26448]),
  ('0010231', array[1000000, 75551, 23706, 22449]),
  ('0010232', array[1000000, 35249, 40678, 21271]),
  ('0010233', array[1000000, 34899, 22461, 37328]),
  ('0011000', array[0, 97748, 22279, 22279]),
  ('0011001', array[1000000, 298021, 20695, 20695]),
  ('0011002', array[1000000, 101009, 28665, 18112]),
  ('0011010', array[1000000, 298021, 20695, 20695]),
  ('0011011', array[1000000, 1000000, 20124, 20124]),
  ('0011012', array[1000000, 332647, 26549, 16867]),
  ('0011020', array[1000000, 101009, 28665, 18112]),
  ('0011021', array[1000000, 332647, 26609, 16843]),
  ('0011022', array[1000000, 108886, 41819, 14955]),
  ('0011023', array[1000000, 104789, 22221, 22017]),
  ('0011100', array[1000000, 298021, 20695, 20695]),
  ('0011101', array[1000000, 1000000, 20124, 20124]),
  ('0011102', array[1000000, 332647, 26549, 16867]),
  ('0011110', array[1000000, 1000000, 20124, 20124]),
  ('0011111', array[903256, 0, 20223, 20223]),
  ('0011112', array[723513, 1000000, 26226, 16665]),
  ('0011120', array[1000000, 332647, 26602, 16845]),
  ('0011121', array[723513, 1000000, 26226, 16665]),
  ('0011122', array[556567, 388839, 39489, 14223]),
  ('0011123', array[518582, 377959, 21042, 20875]),
  ('0011200', array[1000000, 100132, 29682, 17755]),
  ('0011201', array[1000000, 332647, 27762, 16411]),
  ('0011202', array[1000000, 106909, 46224, 14498]),
  ('0011203', array[1000000, 101835, 23726, 20835]),
  ('0011210', array[1000000, 332647, 27762, 16411]),
  ('0011211', array[671893, 1000000, 27146, 16342]),
  ('0011212', array[500735, 388839, 43609, 13793]),
  ('0011213', array[443368, 377959, 22463, 19769]),
  ('0011220', array[1000000, 106309, 47196, 14416]),
  ('0011221', array[487098, 388839, 44492, 13717]),
  ('0011222', array[413893, 115748, 102340, 12630]),
  ('0011223', array[308846, 103401, 38259, 16405]),
  ('0011230', array[1000000, 99554, 23265, 21305]),
  ('0011231', array[400795, 377959, 22043, 20204]),
  ('0011232', array[279320, 100023, 35575, 17148]),
  ('0011233', array[265180, 98373, 19026, 29845]),
  ('0012000', array[0, 42876, 36422, 20316]),
  ('0012001', array[1000000, 82096, 33479, 17257]),
  ('0012002', array[1000000, 40026, 63299, 16887]),
  ('0012003', array[1000000, 37294, 31003, 24433]),
  ('0012010', array[1000000, 82096, 33479, 17257]),
  ('0012011', array[1000000, 241101, 31928, 15506]),
  ('0012012', array[1000000, 77141, 58443, 14308]),
  ('0012013', array[1000000, 70402, 27906, 20030]),
  ('0012020', array[1000000, 40026, 63299, 16887]),
  ('0012021', array[1000000, 75807, 59209, 14310]),
  ('0012022', array[1000000, 38255, 160606, 14794]),
  ('0012023', array[1000000, 33010, 54279, 19513]),
  ('0012030', array[1000000, 37294, 31003, 24433]),
  ('0012031', array[1000000, 68361, 27786, 20264]),
  ('0012032', array[1000000, 32832, 53095, 19735]),
  ('0012033', array[1000000, 31391, 26543, 32858]),
  ('0012100', array[1000000, 88655, 33172, 17073]),
  ('0012101', array[1000000, 284749, 31729, 15401]),
  ('0012102', array[1000000, 89525, 57247, 14020]),
  ('0012103', array[1000000, 84278, 27240, 19459]),
  ('0012110', array[1000000, 284749, 31729, 15401]),
  ('0012111', array[565180, 1000000, 31553, 15138]),
  ('0012112', array[447725, 308988, 55663, 13060]),
  ('0012113', array[374572, 297167, 26166, 17937]),
  ('0012120', array[1000000, 89046, 59094, 13925]),
  ('0012121', array[434089, 308988, 57508, 12975]),
  ('0012122', array[402759, 91709, 156003, 12468]),
  ('0012123', array[283167, 81470, 50019, 15575]),
  ('0012130', array[1000000, 82734, 26555, 19912]),
  ('0012131', array[341327, 297167, 25508, 18347]),
  ('0012132', array[259381, 79606, 44730, 16332]),
  ('0012133', array[235342, 78015, 21705, 27128]),
  ('0012200', array[1000000, 39617, 66703, 16732]),
  ('0012201', array[1000000, 73941, 65323, 14059]),
  ('0012202', array[1000000, 37989, 176772, 14710]),
  ('0012203', array[1000000, 32145, 61270, 19035]),
  ('0012210', array[1000000, 76974, 65079, 13965]),
  ('0012211', array[417902, 239412, 64907, 12816]),
  ('0012212', array[424288, 75667, 178969, 12683]),
  ('0012213', array[286919, 63707, 58952, 15660]),
  ('0012220', array[1000000, 37989, 176772, 14710]),
  ('0012221', array[437104, 72551, 178969, 12764]),
  ('0012222', array[516476, 38493, 891921, 14091]),
  ('0012223', array[356434, 30627, 172058, 17026]),
  ('0012230', array[1000000, 31239, 60519, 19444]),
  ('0012231', array[264825, 55587, 58086, 16388]),
  ('0012232', array[327833, 29764, 172058, 17378]),
  ('0012233', array[235251, 24768, 57066, 26419]),
  ('0012300', array[1000000, 35647, 29920, 25958]),
  ('0012301', array[1000000, 61648, 25860, 22186]),
  ('0012302', array[1000000, 30012, 49154, 21598]),
  ('0012303', array[1000000, 29201, 25038, 38790]),
  ('0012310', array[1000000, 67697, 25370, 21845]),
  ('0012311', array[278196, 213612, 23583, 20275]),
  ('0012312', array[223173, 60684, 41656, 18170]),
  ('0012313', array[214263, 58580, 20807, 33110]),
  ('0012320', array[1000000, 29371, 52786, 21288]),
  ('0012321', array[224215, 50284, 48327, 18194]),
  ('0012322', array[266517, 26907, 143105, 19195]),
  ('0012323', array[211124, 23364, 46814, 32150]),
  ('0012330', array[1000000, 28673, 24655, 40768]),
  ('0012331', array[218062, 48921, 20940, 36738]),
  ('0012332', array[213855, 23492, 40614, 35543]),
  ('0012333', array[243392, 25188, 22135, 90775]),
  ('0100000', array[0, 69412, 23366, 23366]),
  ('0100001', array[0, 156153, 21368, 21368]),
  ('0100002', array[0, 62621, 30875, 19363]),
  ('0100010', array[0, 156153, 21368, 21368]),
  ('0100011', array[1000000, 562014, 20363, 20363]),
  ('0100012', array[1000000, 135734, 27874, 17619]),
  ('0100020', array[0, 62621, 30875, 19363]),
  ('0100021', array[1000000, 135734, 27874, 17619]),
  ('0100022', array[1000000, 55406, 46884, 16496]),
  ('0100023', array[1000000, 52668, 24688, 24688]),
  ('0100100', array[0, 156153, 21368, 21368]),
  ('0100101', array[1000000, 575383, 20354, 20354]),
  ('0100102', array[1000000, 138776, 27821, 17591]),
  ('0100110', array[1000000, 575383, 20354, 20354]),
  ('0100111', array[1000000, 1000000, 20073, 20073]),
  ('0100112', array[1000000, 534943, 26285, 16702]),
  ('0100120', array[1000000, 138776, 27821, 17591]),
  ('0100121', array[1000000, 534943, 26342, 16679]),
  ('0100122', array[1000000, 125835, 41396, 14767]),
  ('0100123', array[1000000, 119179, 21967, 21782]),
  ('0100200', array[0, 62621, 30875, 19363]),
  ('0100201', array[1000000, 134412, 28150, 17533]),
  ('0100202', array[1000000, 55074, 47647, 16433]),
  ('0100203', array[1000000, 52177, 24973, 24516]),
  ('0100210', array[1000000, 134412, 28150, 17533]),
  ('0100211', array[1000000, 469753, 27134, 16446]),
  ('0100212', array[1000000, 113561, 43850, 14660]),
  ('0100213', array[1000000, 106069, 22884, 21415]),
  ('0100220', array[1000000, 55074, 47647, 16433]),
  ('0100221', array[1000000, 111130, 44170, 14666]),
  ('0100222', array[1000000, 48531, 99563, 14453]),
  ('0100223', array[1000000, 42501, 38560, 19849]),
  ('0100230', array[1000000, 52177, 24973, 24516]),
  ('0100231', array[1000000, 102135, 22820, 21640]),
  ('0100232', array[1000000, 42215, 38102, 20036]),
  ('0100233', array[1000000, 41702, 21107, 35105]),
  ('0101000', array[0, 175072, 21211, 21211]),
  ('0101001', array[1000000, 748622, 20271, 20271]),
  ('0101002', array[1000000, 178332, 27311, 17308]),
  ('0101010', array[1000000, 748622, 20271, 20271]),
  ('0101011', array[1000000, 1000000, 20073, 20073]),
  ('0101012', array[1000000, 850085, 26086, 16591]),
  ('0101020', array[1000000, 178332, 27311, 17308]),
  ('0101021', array[1000000, 850085, 26145, 16567]),
  ('0101022', array[1000000, 183061, 40109, 14403]),
  ('0101023', array[1000000, 174951, 21349, 21156]),
  ('0101100', array[1000000, 748622, 20271, 20271]),
  ('0101101', array[1000000, 1000000, 20073, 20073]),
  ('0101102', array[1000000, 850085, 26086, 16591]),
  ('0101110', array[1000000, 1000000, 20073, 20073]),
  ('0101111', array[452717, 0, 20451, 20451]),
  ('0101112', array[440659, 1000000, 26359, 16745]),
  ('0101120', array[1000000, 850085, 26141, 16568]),
  ('0101121', array[440659, 1000000, 26359, 16745]),
  ('0101122', array[401441, 985702, 39115, 14098]),
  ('0101123', array[379204, 959525, 20851, 20677]),
  ('0101200', array[1000000, 175382, 28278, 16968]),
  ('0101201', array[1000000, 850085, 27289, 16138]),
  ('0101202', array[1000000, 177125, 44330, 13963]),
  ('0101203', array[1000000, 166263, 22798, 20022]),
  ('0101210', array[1000000, 850085, 27289, 16138]),
  ('0101211', array[421080, 1000000, 27296, 16416]),
  ('0101212', array[371478, 985702, 43237, 13667]),
  ('0101213', array[337251, 959525, 22272, 19571]),
  ('0101220', array[1000000, 175397, 45264, 13883]),
  ('0101221', array[363708, 985702, 44136, 13590]),
  ('0101222', array[333470, 180315, 99334, 12286]),
  ('0101223', array[260824, 154010, 37167, 15931]),
  ('0101230', array[1000000, 159950, 22354, 20476]),
  ('0101231', array[311377, 959525, 21845, 20012]),
  ('0101232', array[238813, 146269, 34535, 16661]),
  ('0101233', array[228280, 142526, 18486, 28977]),
  ('0102000', array[0, 60050, 33290, 18758]),
  ('0102001', array[1000000, 122433, 31885, 16538]),
  ('0102002', array[1000000, 51950, 57929, 15751]),
  ('0102003', array[1000000, 47591, 28590, 22723]),
  ('0102010', array[1000000, 122433, 31885, 16538]),
  ('0102011', array[1000000, 410347, 31382, 15271]),
  ('0102012', array[1000000, 103619, 55953, 13831]),
  ('0102013', array[1000000, 92113, 26828, 19345]),
  ('0102020', array[1000000, 51950, 57929, 15751]),
  ('0102021', array[1000000, 101203, 56654, 13833]),
  ('0102022', array[1000000, 46361, 147682, 13986]),
  ('0102023', array[1000000, 38816, 50419, 18434]),
  ('0102030', array[1000000, 47591, 28590, 22723]),
  ('0102031', array[1000000, 88624, 26719, 19565]),
  ('0102032', array[1000000, 38570, 49397, 18631]),
  ('0102033', array[1000000, 36472, 24880, 31024]),
  ('0102100', array[1000000, 138763, 31589, 16357]),
  ('0102101', array[1000000, 567313, 31178, 15163]),
  ('0102102', array[1000000, 129081, 54792, 13545]),
  ('0102103', array[1000000, 119387, 26177, 18781]),
  ('0102110', array[1000000, 567313, 31178, 15163]),
  ('0102111', array[378145, 1000000, 31724, 15207]),
  ('0102112', array[342798, 562986, 55136, 12958]),
  ('0102113', array[297490, 535401, 25937, 17788]),
  ('0102120', array[1000000, 128049, 56541, 13454]),
  ('0102121', array[334581, 562986, 56997, 12871]),
  ('0102122', array[327609, 123039, 150566, 12168]),
  ('0102123', array[243603, 105733, 48506, 15192]),
  ('0102130', array[1000000, 116190, 25523, 19218]),
  ('0102131', array[275693, 535401, 25272, 18203]),
  ('0102132', array[225377, 102497, 43379, 15935]),
  ('0102133', array[207173, 99655, 21111, 26475]),
  ('0102200', array[1000000, 51238, 60842, 15614]),
  ('0102201', array[1000000, 97803, 62335, 13595]),
  ('0102202', array[1000000, 45958, 161561, 13910]),
  ('0102203', array[1000000, 37589, 56549, 17999]),
  ('0102210', array[1000000, 103324, 62107, 13505]),
  ('0102211', array[325366, 361313, 64285, 12722]),
  ('0102212', array[342514, 94665, 172091, 12390]),
  ('0102213', array[247272, 76567, 56985, 15302]),
  ('0102220', array[1000000, 45958, 161561, 13910]),
  ('0102221', array[350953, 89735, 172091, 12469]),
  ('0102222', array[404459, 44985, 820812, 13498]),
  ('0102223', array[302783, 34258, 159698, 16327]),
  ('0102230', array[1000000, 36335, 55902, 18371]),
  ('0102231', array[230838, 64935, 56180, 16008]),
  ('0102232', array[281840, 33166, 159698, 16655]),
  ('0102233', array[211321, 26892, 53653, 25352]),
  ('0102300', array[1000000, 44834, 27648, 24082]),
  ('0102301', array[1000000, 77314, 24910, 21394]),
  ('0102302', array[1000000, 34608, 45914, 20338]),
  ('0102303', array[1000000, 33451, 23531, 36426]),
  ('0102310', array[1000000, 87356, 24443, 21068]),
  ('0102311', array[233768, 307199, 23391, 20113]),
  ('0102312', array[198428, 72074, 40533, 17725]),
  ('0102313', array[191511, 68932, 20295, 32258]),
  ('0102320', array[1000000, 33744, 49116, 20060]),
  ('0102321', array[199527, 57615, 46913, 17757]),
  ('0102322', array[235439, 29558, 134114, 18360]),
  ('0102323', array[191700, 25197, 44366, 30715]),
  ('0102330', array[1000000, 32748, 23189, 38190]),
  ('0102331', array[194809, 55708, 20434, 35740]),
  ('0102332', array[193955, 25347, 38705, 33832]),
  ('0102333', array[217524, 27370, 21163, 86079]),
  ('0110000', array[0, 255308, 20815, 20815]),
  ('0110001', array[1000000, 1000000, 20167, 20167]),
  ('0110002', array[1000000, 282797, 26690, 16950]),
  ('0110010', array[1000000, 1000000, 20167, 20167]),
  ('0110011', array[1000000, 1000000, 20184, 20184]),
  ('0110012', array[1000000, 1000000, 26096, 16596]),
  ('0110020', array[1000000, 282797, 26690, 16950]),
  ('0110021', array[1000000, 1000000, 26151, 16574]),
  ('0110022', array[1000000, 291185, 39389, 14193]),
  ('0110023', array[1000000, 279107, 20995, 20818]),
  ('0110100', array[1000000, 1000000, 20167, 20167]),
  ('0110101', array[1000000, 1000000, 20184, 20184]),
  ('0110102', array[1000000, 1000000, 26096, 16596]),
  ('0110110', array[1000000, 1000000, 20184, 20184]),
  ('0110111', array[241822, 0, 20862, 20862]),
  ('0110112', array[222947, 1000000, 27007, 17119]),
  ('0110120', array[1000000, 1000000, 26155, 16573]),
  ('0110121', array[222947, 1000000, 27007, 17119]),
  ('0110122', array[214785, 1000000, 39904, 14330]),
  ('0110123', array[203564, 1000000, 21240, 21050]),
  ('0110200', array[1000000, 274716, 27645, 16615]),
  ('0110201', array[1000000, 1000000, 27299, 16144]),
  ('0110202', array[1000000, 275270, 43552, 13758]),
  ('0110203', array[1000000, 255952, 22430, 19701]),
  ('0110210', array[1000000, 1000000, 27299, 16144]),
  ('0110211', array[218313, 1000000, 27957, 16786]),
  ('0110212', array[206602, 1000000, 44088, 13893]),
  ('0110213', array[191816, 1000000, 22677, 19926]),
  ('0110220', array[1000000, 271002, 44462, 13680]),
  ('0110221', array[204252, 1000000, 45011, 13814]),
  ('0110222', array[203686, 266733, 99476, 12301]),
  ('0110223', array[169827, 219355, 37217, 15953]),
  ('0110230', array[1000000, 240844, 21997, 20146]),
  ('0110231', array[183451, 1000000, 22238, 20376]),
  ('0110232', array[160460, 203642, 34582, 16683]),
  ('0110233', array[155945, 196009, 18510, 29016]),
  ('0111000', array[1000000, 1000000, 20167, 20167]),
  ('0111001', array[817752, 1000000, 20268, 20268]),
  ('0111002', array[667620, 1000000, 26299, 16710]),
  ('0111010', array[817752, 1000000, 20268, 20268]),
  ('0111011', array[206626, 0, 21017, 21017]),
  ('0111012', array[163643, 1000000, 27514, 17401]),
  ('0111020', array[667620, 1000000, 26355, 16687]),
  ('0111021', array[163643, 1000000, 27514, 17401]),
  ('0111022', array[139261, 1000000, 41199, 14696]),
  ('0111023', array[131049, 1000000, 21862, 21680]),
  ('0111100', array[791011, 1000000, 20276, 20276]),
  ('0111101', array[206626, 0, 21017, 21017]),
  ('0111102', array[159430, 1000000, 27566, 17429]),
  ('0111110', array[206626, 0, 21017, 21017]),
  ('0111111', array[91680, 0, 22448, 22448]),
  ('0111112', array[73916, 0, 29989, 18822]),
  ('0111120', array[159430, 1000000, 27566, 17429]),
  ('0111121', array[73916, 0, 29989, 18822]),
  ('0111122', array[60959, 1000000, 45989, 16183]),
  ('0111123', array[57611, 1000000, 24218, 24218]),
  ('0111200', array[569243, 1000000, 27138, 16458]),
  ('0111201', array[157615, 1000000, 27834, 17345]),
  ('0111202', array[124412, 1000000, 43605, 14592]),
  ('0111203', array[115402, 1000000, 22761, 21323]),
  ('0111210', array[157615, 1000000, 27834, 17345]),
  ('0111211', array[73916, 0, 29989, 18822]),
  ('0111212', array[60559, 1000000, 46718, 16123]),
  ('0111213', array[57026, 1000000, 24491, 24054]),
  ('0111220', array[121534, 1000000, 43917, 14598]),
  ('0111221', array[60559, 1000000, 46718, 16123]),
  ('0111222', array[51460, 1000000, 98362, 14293]),
  ('0111223', array[44584, 1000000, 38103, 19645]),
  ('0111230', array[110815, 1000000, 22700, 21542]),
  ('0111231', array[57026, 1000000, 24491, 24054]),
  ('0111232', array[44274, 1000000, 37662, 19825]),
  ('0111233', array[43713, 1000000, 20864, 34754]),
  ('0112000', array[1000000, 256297, 32145, 15388]),
  ('0112001', array[719480, 1000000, 31181, 15173]),
  ('0112002', array[668130, 259662, 55537, 13046]),
  ('0112003', array[628790, 233012, 26120, 17910]),
  ('0112010', array[719480, 1000000, 31181, 15173]),
  ('0112011', array[163623, 1000000, 31203, 16190]),
  ('0112012', array[143337, 1000000, 54432, 13486]),
  ('0112013', array[131346, 1000000, 26024, 18706]),
  ('0112020', array[668130, 254950, 57418, 12959]),
  ('0112021', array[142068, 1000000, 56154, 13395]),
  ('0112022', array[132857, 263241, 150546, 12190]),
  ('0112023', array[112440, 207461, 48534, 15224]),
  ('0112030', array[628790, 219507, 25447, 18329]),
  ('0112031', array[127491, 1000000, 25378, 19138]),
  ('0112032', array[108794, 194167, 43415, 15968]),
  ('0112033', array[105573, 180732, 21136, 26536]),
  ('0112100', array[483710, 1000000, 31385, 15281]),
  ('0112101', array[141261, 1000000, 31493, 16368]),
  ('0112102', array[112494, 1000000, 55582, 13770]),
  ('0112103', array[98958, 1000000, 26670, 19269]),
  ('0112110', array[141261, 1000000, 31493, 16368]),
  ('0112111', array[70325, 0, 32278, 18248]),
  ('0112112', array[56771, 1000000, 56619, 15465]),
  ('0112113', array[51547, 1000000, 27981, 22321]),
  ('0112120', array[109681, 1000000, 56266, 13772]),
  ('0112121', array[56771, 1000000, 56619, 15465]),
  ('0112122', array[49009, 1000000, 145286, 13836]),
  ('0112123', array[40518, 1000000, 49697, 18256]),
  ('0112130', array[94985, 1000000, 26564, 19483]),
  ('0112131', array[51547, 1000000, 27981, 22321]),
  ('0112132', array[40253, 1000000, 48717, 18447]),
  ('0112133', array[37962, 1000000, 24564, 30744]),
  ('0112200', array[401542, 249700, 64762, 12810]),
  ('0112201', array[112151, 1000000, 61630, 13448]),
  ('0112202', array[100327, 272767, 171936, 12414]),
  ('0112203', array[79977, 210228, 56976, 15340]),
  ('0112210', array[105696, 1000000, 61854, 13537]),
  ('0112211', array[55919, 1000000, 59402, 15332]),
  ('0112212', array[48559, 1000000, 158684, 13761]),
  ('0112213', array[39183, 1000000, 55637, 17830]),
  ('0112220', array[94832, 278052, 171936, 12493]),
  ('0112221', array[48559, 1000000, 158684, 13761]),
  ('0112222', array[47138, 315414, 811662, 13443]),
  ('0112223', array[35289, 254849, 158103, 16282]),
  ('0112230', array[67424, 198380, 56179, 16044]),
  ('0112231', array[37828, 1000000, 55014, 18193]),
  ('0112232', array[34138, 239996, 158103, 16606]),
  ('0112233', array[27490, 188204, 53238, 25299]),
  ('0112300', array[335361, 192527, 23557, 20253]),
  ('0112301', array[93471, 1000000, 24319, 20973]),
  ('0112302', array[75077, 174227, 40594, 17759]),
  ('0112303', array[71659, 168993, 20331, 32317]),
  ('0112310', array[82099, 1000000, 24779, 21294]),
  ('0112311', array[48319, 1000000, 27078, 23633]),
  ('0112312', array[35953, 1000000, 45332, 20119]),
  ('0112313', array[34697, 1000000, 23251, 36037]),
  ('0112320', array[59577, 175110, 46946, 17792]),
  ('0112321', array[35026, 1000000, 48431, 19849]),
  ('0112322', array[30333, 205921, 133056, 18294]),
  ('0112323', array[25724, 172676, 44107, 30615]),
  ('0112330', array[57530, 171572, 20472, 35786]),
  ('0112331', array[33945, 1000000, 22919, 37753]),
  ('0112332', array[25880, 174485, 38542, 33687]),
  ('0112333', array[28025, 192370, 21076, 85670]),
  ('0120000', array[0, 53935, 43902, 17041]),
  ('0120001', array[1000000, 109154, 41103, 15036]),
  ('0120002', array[1000000, 48217, 86454, 14773]),
  ('0120003', array[1000000, 42342, 36720, 20347]),
  ('0120010', array[1000000, 109154, 41103, 15036]),
  ('0120011', array[1000000, 371461, 39008, 14073]),
  ('0120012', array[1000000, 96831, 78638, 13098]),
  ('0120013', array[1000000, 82866, 32746, 17609]),
  ('0120020', array[1000000, 48217, 86454, 14773]),
  ('0120021', array[1000000, 94748, 80056, 13099]),
  ('0120022', array[1000000, 44957, 268795, 13628]),
  ('0120023', array[1000000, 36333, 70686, 17330]),
  ('0120030', array[1000000, 42342, 36720, 20347]),
  ('0120031', array[1000000, 80085, 32584, 17788]),
  ('0120032', array[1000000, 36131, 68669, 17503]),
  ('0120033', array[1000000, 32952, 30063, 27936]),
  ('0120100', array[1000000, 123186, 40549, 14877]),
  ('0120101', array[1000000, 507685, 38659, 13976]),
  ('0120102', array[1000000, 120254, 76119, 12831]),
  ('0120103', array[1000000, 106377, 31677, 17116]),
  ('0120110', array[1000000, 507685, 38659, 13976]),
  ('0120111', array[238348, 1000000, 38748, 14302]),
  ('0120112', array[221812, 533916, 73615, 12494]),
  ('0120113', array[200562, 484730, 30624, 16584]),
  ('0120120', array[1000000, 119289, 79834, 12742]),
  ('0120121', array[218187, 533916, 77222, 12407]),
  ('0120122', array[208578, 121370, 255749, 12040]),
  ('0120123', array[172289, 100350, 63939, 14579]),
  ('0120130', array[1000000, 103757, 30673, 17496]),
  ('0120131', array[190427, 484730, 29659, 16957]),
  ('0120132', array[163337, 97487, 54849, 15293]),
  ('0120133', array[155120, 91159, 23929, 24513]),
  ('0120200', array[1000000, 47468, 94771, 14624]),
  ('0120201', array[1000000, 91178, 94838, 12841]),
  ('0120202', array[1000000, 44502, 331343, 13540]),
  ('0120203', array[1000000, 35044, 86569, 16867]),
  ('0120210', array[1000000, 96523, 94244, 12752]),
  ('0120211', array[213313, 345736, 94364, 12221]),
  ('0120212', array[213713, 93536, 341759, 12239]),
  ('0120213', array[172684, 73002, 83164, 14601]),
  ('0120220', array[1000000, 44502, 331343, 13540]),
  ('0120221', array[217175, 88318, 341759, 12323]),
  ('0120222', array[221853, 45597, 1000000, 13656]),
  ('0120223', array[191798, 33728, 328687, 16104]),
  ('0120230', array[1000000, 33835, 84867, 17231]),
  ('0120231', array[163946, 61467, 81256, 15308]),
  ('0120232', array[182654, 32574, 328687, 16451]),
  ('0120233', array[152836, 25488, 77714, 24180]),
  ('0120300', array[1000000, 40011, 34980, 21544]),
  ('0120301', array[1000000, 70299, 29647, 19440]),
  ('0120302', array[1000000, 32497, 61440, 19111]),
  ('0120303', array[1000000, 30345, 27907, 32660]),
  ('0120310', array[1000000, 78889, 28955, 19163]),
  ('0120311', array[169964, 284169, 26878, 18729]),
  ('0120312', array[149188, 68901, 49991, 17012]),
  ('0120313', array[146395, 63784, 22793, 29745]),
  ('0120320', array[1000000, 31674, 67834, 18847]),
  ('0120321', array[149320, 55205, 60863, 17018]),
  ('0120322', array[163467, 29156, 224399, 18139]),
  ('0120323', array[143955, 24127, 57302, 29278]),
  ('0120330', array[1000000, 29749, 27404, 34129]),
  ('0120331', array[148316, 52021, 22978, 32770]),
  ('0120332', array[145686, 24321, 47699, 32199]),
  ('0120333', array[161107, 25468, 23988, 77863]),
  ('0121000', array[1000000, 187505, 39274, 14450]),
  ('0121001', array[623644, 994519, 38669, 13979]),
  ('0121002', array[625932, 187555, 74190, 12564]),
  ('0121003', array[557879, 172360, 30833, 16674]),
  ('0121010', array[623644, 994519, 38669, 13979]),
  ('0121011', array[141793, 1000000, 40020, 14731]),
  ('0121012', array[132207, 1000000, 75603, 12771]),
  ('0121013', array[115333, 1000000, 31496, 17042]),
  ('0121020', array[625932, 184967, 77846, 12476]),
  ('0121021', array[131042, 1000000, 79265, 12683]),
  ('0121022', array[130713, 183814, 255932, 12047]),
  ('0121023', array[106119, 155800, 63996, 14591]),
  ('0121030', array[557879, 164851, 29857, 17050]),
  ('0121031', array[112259, 1000000, 30503, 17419]),
  ('0121032', array[102924, 148468, 54902, 15305]),
  ('0121033', array[95767, 141754, 23953, 24536]),
  ('0121100', array[429257, 994519, 39020, 14077]),
  ('0121101', array[123407, 1000000, 40564, 14888]),
  ('0121102', array[104319, 1000000, 78101, 13037]),
  ('0121103', array[88093, 1000000, 32558, 17534]),
  ('0121110', array[123407, 1000000, 40564, 14888]),
  ('0121111', array[61824, 0, 42376, 16603]),
  ('0121112', array[52217, 1000000, 84150, 14513]),
  ('0121113', array[45278, 1000000, 35884, 20005]),
  ('0121120', array[101922, 1000000, 79486, 13038]),
  ('0121121', array[52217, 1000000, 84150, 14513]),
  ('0121122', array[47387, 1000000, 263331, 13478]),
  ('0121123', array[37741, 1000000, 69619, 17160]),
  ('0121130', array[84980, 1000000, 32400, 17709]),
  ('0121131', array[45278, 1000000, 35884, 20005]),
  ('0121132', array[37525, 1000000, 67680, 17328]),
  ('0121133', array[34059, 1000000, 29690, 27682]),
  ('0121200', array[381574, 181519, 95184, 12290]),
  ('0121201', array[103958, 1000000, 93437, 12695]),
  ('0121202', array[98913, 187802, 341657, 12249]),
  ('0121203', array[75935, 156196, 83178, 14618]),
  ('0121210', array[97796, 1000000, 94020, 12783]),
  ('0121211', array[51337, 1000000, 92022, 14369]),
  ('0121212', array[46881, 1000000, 323053, 13392]),
  ('0121213', array[36350, 1000000, 84971, 16707]),
  ('0121220', array[93112, 190457, 341657, 12333]),
  ('0121221', array[46881, 1000000, 323053, 13392]),
  ('0121222', array[47763, 195662, 1000000, 13585]),
  ('0121223', array[34676, 174156, 324396, 16041]),
  ('0121230', array[63568, 149085, 81285, 15323]),
  ('0121231', array[35055, 1000000, 83339, 17063]),
  ('0121232', array[33462, 166641, 324396, 16384]),
  ('0121233', array[25973, 142114, 77090, 24101]),
  ('0121300', array[307268, 149495, 27058, 18832]),
  ('0121301', array[83591, 1000000, 28816, 19072]),
  ('0121302', array[71496, 136877, 50078, 17024]),
  ('0121303', array[65932, 134585, 22830, 29760]),
  ('0121310', array[74028, 1000000, 29500, 19345]),
  ('0121311', array[42613, 1000000, 34219, 21164]),
  ('0121312', array[33615, 1000000, 60656, 18904]),
  ('0121313', array[31277, 1000000, 27587, 32314]),
  ('0121320', array[56897, 137013, 60924, 17032]),
  ('0121321', array[32738, 1000000, 66849, 18647]),
  ('0121322', array[29867, 150671, 222526, 18054]),
  ('0121323', array[24562, 134476, 56991, 29150]),
  ('0121330', array[53474, 136221, 23017, 32771]),
  ('0121331', array[30646, 1000000, 27099, 33745]),
  ('0121332', array[24763, 135975, 47526, 32028]),
  ('0121333', array[25965, 148718, 23897, 77417]),
  ('0122000', array[1000000, 45815, 125269, 14247]),
  ('0122001', array[624291, 88687, 127717, 12611]),
  ('0122002', array[599020, 44572, 469292, 13556]),
  ('0122003', array[545655, 34113, 121498, 16495]),
  ('0122010', array[624291, 93885, 126539, 12524]),
  ('0122011', array[133076, 347515, 123573, 12267]),
  ('0122012', array[128705, 96838, 486947, 12523]),
  ('0122013', array[106213, 73396, 113671, 14670]),
  ('0122020', array[599020, 44572, 469292, 13556]),
  ('0122021', array[129817, 91476, 486947, 12608]),
  ('0122022', array[134157, 47474, 1000000, 14055]),
  ('0122023', array[111232, 34893, 505771, 16563]),
  ('0122030', array[545655, 32945, 117849, 16855]),
  ('0122031', array[103129, 61829, 109899, 15377]),
  ('0122032', array[108432, 33699, 505771, 16912]),
  ('0122033', array[94435, 25635, 108084, 24301]),
  ('0122100', array[383402, 120893, 124894, 12328]),
  ('0122101', array[100844, 532184, 125218, 12465]),
  ('0122102', array[102554, 119625, 486947, 12525]),
  ('0122103', array[76294, 100415, 113708, 14675]),
  ('0122110', array[94878, 532184, 126370, 12552]),
  ('0122111', array[49387, 1000000, 120759, 14003]),
  ('0122112', array[46946, 525520, 453756, 13406]),
  ('0122113', array[35328, 487285, 118622, 16336]),
  ('0122120', array[96569, 120582, 486947, 12610]),
  ('0122121', array[46946, 525520, 453756, 13406]),
  ('0122122', array[49808, 124766, 1000000, 13973]),
  ('0122123', array[35888, 105685, 496527, 16485]),
  ('0122130', array[63892, 97675, 109957, 15380]),
  ('0122131', array[34080, 487285, 115153, 16688]),
  ('0122132', array[34629, 103168, 496527, 16830]),
  ('0122133', array[26101, 90738, 106988, 24201]),
  ('0122200', array[417640, 45043, 469292, 13647]),
  ('0122201', array[102932, 95186, 486947, 12865]),
  ('0122202', array[117481, 48253, 1000000, 14199]),
  ('0122203', array[85692, 36212, 505771, 17024]),
  ('0122210', array[100695, 97179, 486947, 12865]),
  ('0122211', array[47466, 381195, 453756, 13494]),
  ('0122212', array[50663, 110297, 1000000, 14114]),
  ('0122213', array[37278, 82472, 496527, 16938]),
  ('0122220', array[117481, 48253, 1000000, 14199]),
  ('0122221', array[50663, 110297, 1000000, 14114]),
  ('0122222', array[57591, 54119, 0, 15586]),
  ('0122223', array[43107, 41642, 1000000, 19057]),
  ('0122230', array[82869, 36025, 505771, 17182]),
  ('0122231', array[37079, 79859, 496527, 17095]),
  ('0122232', array[43107, 41642, 1000000, 19057]),
  ('0122233', array[33171, 32482, 534612, 26883]),
  ('0122300', array[304643, 29575, 110158, 18577]),
  ('0122301', array[71875, 55787, 103737, 17087]),
  ('0122302', array[81414, 31636, 505771, 18473]),
  ('0122303', array[65467, 24356, 104068, 29361]),
  ('0122310', array[57407, 69326, 103750, 17088]),
  ('0122311', array[30464, 286321, 107773, 18381]),
  ('0122312', array[32434, 78522, 496527, 18375]),
  ('0122313', array[24758, 63782, 103008, 29219]),
  ('0122320', array[72475, 32447, 505771, 18724]),
  ('0122321', array[33286, 70190, 496527, 18622]),
  ('0122322', array[40678, 39379, 1000000, 20117]),
  ('0122323', array[30541, 29964, 534612, 31236]),
  ('0122330', array[53410, 24566, 105013, 32207]),
  ('0122331', array[24972, 52302, 103921, 32036]),
  ('0122332', array[29953, 29398, 534612, 32542]),
  ('0122333', array[25846, 25458, 112953, 75887]),
  ('0123000', array[1000000, 34470, 30809, 25954]),
  ('0123001', array[596361, 60428, 26257, 22888]),
  ('0123002', array[584643, 28316, 53994, 22495]),
  ('0123003', array[556061, 27559, 25607, 43733]),
  ('0123010', array[596361, 67438, 25672, 22450]),
  ('0123011', array[108745, 248834, 24621, 21658]),
  ('0123012', array[98077, 61107, 45398, 19450]),
  ('0123013', array[94530, 59401, 21557, 38168]),
  ('0123020', array[584643, 27641, 59464, 22077]),
  ('0123021', array[98132, 49456, 54938, 19459]),
  ('0123022', array[105216, 26395, 202504, 20976]),
  ('0123023', array[93136, 22694, 53860, 37547]),
  ('0123030', array[556061, 26946, 25080, 47124]),
  ('0123031', array[94758, 48369, 21608, 44453]),
  ('0123032', array[93308, 22738, 44699, 43604]),
  ('0123033', array[97331, 25013, 23597, 135690]),
  ('0123100', array[265788, 100763, 24755, 21778]),
  ('0123101', array[70697, 512844, 25549, 22338]),
  ('0123102', array[63014, 93182, 45427, 19460]),
  ('0123103', array[61163, 90052, 21570, 38188]),
  ('0123110', array[63038, 512844, 26128, 22771]),
  ('0123111', array[36312, 1000000, 30201, 25452]),
  ('0123112', array[29107, 518102, 53351, 22236]),
  ('0123113', array[28286, 495976, 25324, 43207]),
  ('0123120', array[50714, 93243, 54943, 19471]),
  ('0123121', array[28396, 518102, 58666, 21829]),
  ('0123122', array[26931, 100297, 200804, 20869]),
  ('0123123', array[23045, 89560, 53535, 37366]),
  ('0123130', array[49546, 90268, 21624, 44455]),
  ('0123131', array[27643, 495976, 24810, 46504]),
  ('0123132', array[23090, 89718, 44502, 43335]),
  ('0123133', array[25463, 93240, 23486, 134660]),
  ('0123200', array[262468, 26629, 82975, 21465]),
  ('0123201', array[63037, 49650, 78405, 19515]),
  ('0123202', array[68882, 27521, 341087, 21637]),
  ('0123203', array[60472, 22773, 76946, 37654]),
  ('0123210', array[50883, 61132, 78412, 19517]),
  ('0123211', array[27317, 248990, 81522, 21226]),
  ('0123212', array[28093, 66871, 336624, 21514]),
  ('0123213', array[23112, 59063, 76319, 37453]),
  ('0123220', array[61683, 28187, 341087, 22036]),
  ('0123221', array[28785, 60078, 336624, 21908]),
  ('0123222', array[34795, 33873, 1000000, 24140]),
  ('0123223', array[27605, 27150, 338833, 41680]),
  ('0123230', array[49246, 22832, 77101, 43617]),
  ('0123231', array[23170, 48325, 76464, 43345]),
  ('0123232', array[27002, 26567, 338833, 44694]),
  ('0123233', array[25233, 24867, 79692, 131422]),
  ('0123300', array[253313, 26182, 24426, 59105]),
  ('0123301', array[61238, 49070, 21873, 56903]),
  ('0123302', array[60527, 23036, 45288, 55591]),
  ('0123303', array[64451, 26147, 24589, 179481]),
  ('0123310', array[50248, 59475, 21875, 56907]),
  ('0123311', array[26829, 240857, 24163, 58172]),
  ('0123312', array[23384, 59114, 45057, 55169]),
  ('0123313', array[26629, 62753, 24457, 177768]),
  ('0123320', array[49778, 23050, 53918, 55610]),
  ('0123321', array[23396, 48835, 53588, 55184]),
  ('0123322', array[26189, 25781, 199062, 55536]),
  ('0123323', array[26315, 25914, 56769, 172528]),
  ('0123330', array[58386, 26711, 25085, 179481]),
  ('0123331', array[27214, 57000, 24946, 177768]),
  ('0123332', array[26879, 26460, 52060, 172528]),
  ('0123333', array[31615, 30901, 28618, 936527]);
