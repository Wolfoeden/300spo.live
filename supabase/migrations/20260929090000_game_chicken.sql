-- Chicken: the blue cock crosses lanes one by one; each lane raises the
-- multiplier, the player collects whenever they like, and a car ends the
-- round. Mechanically this is "mines" on 25 cells: the difficulty hides
-- 1 / 3 / 5 / 10 cars among 25 cells, and the walk visits the cells in a
-- shuffled order. Surviving k lanes has probability C(25-h, k) / C(25, k), so
-- the fair multiplier is C(25, k) / C(25-h, k) (rounded down to a basis point;
-- lanes stop before the multiplier passes 100,000×).
--
-- Provably fair like the other games: the order of the 25 cells is a
-- Fisher–Yates shuffle driven by HMAC-SHA256(server_seed,
-- "<client_seed>:<nonce>:chicken:<block>"); cells 0 … h-1 are the cars and the
-- round ends on the lane of the first car in that order. The round takes its
-- nonce at the start; the server seed cannot be revealed while it is open.

alter table game.games drop constraint games_kind_check;
alter table game.games add constraint games_kind_check check (kind in ('pick', 'race', 'step'));
insert into game.games (id, name, outcomes, payout_bps, enabled, sort, kind)
values ('chicken', 'Chicken', 4, 10000, true, 2, 'step'); -- outcomes: the four difficulties

alter table game.rounds add column detail jsonb;

create table game.chicken_rounds (
  id bigint generated always as identity primary key,
  wallet text not null references game.accounts (wallet),
  bet bigint not null check (bet > 0),
  hazards integer not null check (hazards in (1, 3, 5, 10)),
  lanes integer not null check (lanes between 1 and 24),
  crash_lane integer not null,
  step integer not null default 0,
  status text not null default 'open' check (status in ('open', 'lost', 'collected')),
  payout bigint not null default 0,
  nonce integer not null,
  server_seed_hash text not null,
  client_seed text not null,
  round_id bigint references game.rounds (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index chicken_rounds_one_open on game.chicken_rounds (wallet) where status = 'open';
alter table game.chicken_rounds enable row level security;

-- Multiplier after `k` safe lanes with `h` cars among 25 cells, in basis points.
create function game.chicken_multiplier(p_hazards integer, p_step integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value numeric := 1;
  v_index integer;
begin
  for v_index in 0..p_step - 1 loop
    v_value := v_value * (25 - v_index) / (25 - p_hazards - v_index);
  end loop;
  return floor(v_value * 10000 + 0.000001)::bigint;
end;
$$;

-- Lanes on the road: every safe step while the multiplier stays within 100,000×.
create function game.chicken_lanes(p_hazards integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select max(k) from generate_series(1, 25 - p_hazards) k where game.chicken_multiplier(p_hazards, k) <= 1000000000;
$$;

-- Lane (1-based) on which the first car sits in the shuffled walk.
create function game.chicken_crash_lane(p_seed bytea, p_client_seed text, p_nonce integer, p_hazards integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cells integer[] := array(select generate_series(0, 24));
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
  for v_i in reverse 24..1 loop
    v_n := v_i + 1;
    v_limit := (4294967296 / v_n) * v_n;
    loop
      if v_offset >= 32 then
        v_buffer := extensions.hmac(convert_to(p_client_seed || ':' || p_nonce::text || ':chicken:' || v_block::text, 'UTF8'), p_seed, 'sha256');
        v_block := v_block + 1;
        v_offset := 0;
      end if;
      v_word := (get_byte(v_buffer, v_offset)::bigint << 24) + (get_byte(v_buffer, v_offset + 1)::bigint << 16)
              + (get_byte(v_buffer, v_offset + 2)::bigint << 8) + get_byte(v_buffer, v_offset + 3)::bigint;
      v_offset := v_offset + 4;
      exit when v_word < v_limit;
    end loop;
    v_j := (v_word % v_n)::integer;
    v_swap := v_cells[v_i + 1];
    v_cells[v_i + 1] := v_cells[v_j + 1];
    v_cells[v_j + 1] := v_swap;
  end loop;
  for v_i in 1..25 loop
    if v_cells[v_i] < p_hazards then
      return v_i;
    end if;
  end loop;
  raise exception 'chicken_no_car';
end;
$$;

create function game.chicken_view(p_round game.chicken_rounds)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_round.id, 'bet', p_round.bet, 'hazards', p_round.hazards, 'lanes', p_round.lanes, 'step', p_round.step,
    'status', p_round.status, 'payout', p_round.payout, 'nonce', p_round.nonce,
    'serverSeedHash', p_round.server_seed_hash, 'clientSeed', p_round.client_seed,
    -- The car's lane stays secret until the round is over.
    'crashLane', case when p_round.status = 'open' then null else p_round.crash_lane end,
    'multipliers', (select jsonb_agg(game.chicken_multiplier(p_round.hazards, k) order by k) from generate_series(1, p_round.lanes) k));
$$;

create function game.chicken_state(p_wallet text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'open', (select game.chicken_view(r) from game.chicken_rounds r where r.wallet = p_wallet and r.status = 'open'),
    'difficulties', (select jsonb_agg(jsonb_build_object('hazards', h, 'lanes', game.chicken_lanes(h),
                       'multipliers', (select jsonb_agg(game.chicken_multiplier(h, k) order by k) from generate_series(1, game.chicken_lanes(h)) k))
                       order by h) from unnest(array[1, 3, 5, 10]) h));
$$;

-- Closes a round: records it with the other rounds so history and the fairness check see it.
create function game.chicken_finish(p_round game.chicken_rounds, p_status text, p_payout bigint)
returns game.chicken_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round_id bigint;
  v_result game.chicken_rounds;
begin
  insert into game.rounds (wallet, game, bet, choice, outcome, payout, server_seed_hash, client_seed, nonce, odds_bps, detail)
  values (p_round.wallet, 'chicken', p_round.bet, p_round.step, p_round.crash_lane, p_payout, p_round.server_seed_hash, p_round.client_seed,
          p_round.nonce, case when p_payout > 0 then game.chicken_multiplier(p_round.hazards, p_round.step) else null end,
          jsonb_build_object('hazards', p_round.hazards, 'lanes', p_round.lanes, 'steps', p_round.step, 'crashLane', p_round.crash_lane))
  returning id into v_round_id;
  if p_payout > 0 then
    perform game.apply_delta(p_round.wallet, p_payout, 'win', 'chicken-' || p_round.id);
  end if;
  update game.chicken_rounds
  set status = p_status, payout = p_payout, round_id = v_round_id, finished_at = now()
  where id = p_round.id
  returning * into v_result;
  return v_result;
end;
$$;

create function game.chicken_start(p_wallet text, p_bet bigint, p_hazards integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_game game.games;
  v_seed game.seeds;
  v_round game.chicken_rounds;
begin
  select * into v_settings from game.settings;
  select * into v_game from game.games where id = 'chicken';
  if not v_settings.enabled or v_game.id is null or not v_game.enabled then
    raise exception 'game_disabled';
  end if;
  if p_bet < v_settings.min_bet or p_bet > v_settings.max_bet or p_bet % v_settings.bet_step <> 0 then
    raise exception 'invalid_bet';
  end if;
  if p_hazards is null or p_hazards not in (1, 3, 5, 10) then
    raise exception 'invalid_choice';
  end if;
  perform game.ensure_seed(p_wallet);
  select * into v_seed from game.seeds where wallet = p_wallet for update;
  if exists (select 1 from game.chicken_rounds where wallet = p_wallet and status = 'open') then
    raise exception 'round_open';
  end if;
  update game.seeds set nonce = v_seed.nonce + 1 where wallet = p_wallet;

  insert into game.chicken_rounds (wallet, bet, hazards, lanes, crash_lane, nonce, server_seed_hash, client_seed)
  values (p_wallet, p_bet, p_hazards, game.chicken_lanes(p_hazards),
          game.chicken_crash_lane(v_seed.server_seed, v_seed.client_seed, v_seed.nonce + 1, p_hazards),
          v_seed.nonce + 1, v_seed.server_seed_hash, v_seed.client_seed)
  returning * into v_round;
  perform game.apply_delta(p_wallet, -p_bet, 'round', 'chicken-' || v_round.id);
  return game.chicken_view(v_round) || jsonb_build_object('balance', (select balance from game.accounts where wallet = p_wallet));
end;
$$;

-- One more lane. Hitting the car ends the round; the last lane collects by itself.
create function game.chicken_step(p_wallet text, p_round_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round game.chicken_rounds;
begin
  select * into v_round from game.chicken_rounds where id = p_round_id and wallet = p_wallet for update;
  if v_round.id is null or v_round.status <> 'open' then
    raise exception 'round_not_open';
  end if;
  v_round.step := v_round.step + 1;
  update game.chicken_rounds set step = v_round.step where id = v_round.id;
  if v_round.step = v_round.crash_lane then
    v_round := game.chicken_finish(v_round, 'lost', 0);
  elsif v_round.step = v_round.lanes then
    v_round := game.chicken_finish(v_round, 'collected', v_round.bet * game.chicken_multiplier(v_round.hazards, v_round.step) / 10000);
  end if;
  return game.chicken_view(v_round) || jsonb_build_object('balance', (select balance from game.accounts where wallet = p_wallet));
end;
$$;

create function game.chicken_collect(p_wallet text, p_round_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round game.chicken_rounds;
begin
  select * into v_round from game.chicken_rounds where id = p_round_id and wallet = p_wallet for update;
  if v_round.id is null or v_round.status <> 'open' then
    raise exception 'round_not_open';
  end if;
  if v_round.step < 1 then
    raise exception 'invalid_choice';
  end if;
  v_round := game.chicken_finish(v_round, 'collected', v_round.bet * game.chicken_multiplier(v_round.hazards, v_round.step) / 10000);
  return game.chicken_view(v_round) || jsonb_build_object('balance', (select balance from game.accounts where wallet = p_wallet));
end;
$$;

-- Revealing the server seed would give away the car in an open round.
create or replace function game.rotate_seed(p_wallet text, p_client_seed text)
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
  if exists (select 1 from game.chicken_rounds where wallet = p_wallet and status = 'open') then
    raise exception 'round_open';
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
                  'payout', r.payout, 'oddsBps', r.odds_bps, 'detail', r.detail, 'nonce', r.nonce, 'serverSeedHash', r.server_seed_hash,
                  'clientSeed', r.client_seed, 'createdAt', r.created_at) order by r.created_at desc)
      from (select * from game.rounds where wallet = p_wallet order by id desc limit 15) r), '[]'::jsonb)
  )
  from game.settings s;
$$;

revoke all on all functions in schema game from public, anon, authenticated;
revoke all on all tables in schema game from public, anon, authenticated;
grant execute on function
  game.chicken_state(text),
  game.chicken_start(text, bigint, integer),
  game.chicken_step(text, bigint),
  game.chicken_collect(text, bigint)
to game_api;
