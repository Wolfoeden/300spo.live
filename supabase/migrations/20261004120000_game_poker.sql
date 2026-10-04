-- Poker room (Roman, 4 October 2026): Texas Hold'em, no limit, up to six players at a table, behind a room
-- code. Players bring chips from their game credit to the table (a buy-in between the table's minimum and
-- maximum) and take what is left back when they leave. A hand starts on its own once two players sit with
-- chips; each decision has 20 seconds — when the time runs out the hand checks if it can and folds
-- otherwise, and the player sits out until they come back. No rake: every pot goes to the players in full.
-- All of it is game credit, like every other game.
--
-- The room code is a bcrypt hash in game.pk_room, set outside this repository (the repository is public).
-- Wrong codes are counted: five per wallet and sixty in all within 15 minutes, then entry waits.
--
-- Provably fair: every hand commits to a fresh server seed, whose hash is public before the deal. The deck is
-- a Fisher–Yates shuffle of 52 cards driven by HMAC-SHA256(server_seed, "<client seeds of the players in
-- seat order, joined by |>:<hand id>:poker:<block>"); the seed is revealed when the hand ends.
--
-- The public state goes out as a Realtime broadcast on "poker-<topic>", a random topic per table that only
-- players who entered the code learn: seats, stacks, bets and the board, and hole cards only at the
-- showdown. Each player gets their own cards from the API.

insert into game.games (id, name, outcomes, payout_bps, enabled, sort, kind)
values ('poker', 'Poker', 2, 10000, true, 4, 'table');

-- Chips going to a table and back are their own kind of ledger entry.
alter table game.ledger drop constraint ledger_kind_check;
alter table game.ledger add constraint ledger_kind_check check (kind in ('deposit', 'round', 'win', 'adjustment', 'bonus', 'table'));
create sequence game.pk_moves;

create table game.pk_room (
  id boolean primary key default true check (id),
  -- bcrypt hash of the room code; null keeps the room closed.
  code_hash text,
  -- A new code raises the version: everyone enters the new one.
  code_version integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into game.pk_room default values;

create table game.pk_access (
  wallet text primary key references game.accounts (wallet),
  code_version integer not null,
  granted_at timestamptz not null default now()
);

create table game.pk_attempts (
  id bigint generated always as identity primary key,
  wallet text not null,
  at timestamptz not null default now()
);
create index pk_attempts_at_idx on game.pk_attempts (at);

create table game.pk_tables (
  id integer primary key check (id > 0),
  name text not null,
  small_blind bigint not null check (small_blind > 0),
  big_blind bigint not null check (big_blind >= small_blind),
  min_buyin bigint not null check (min_buyin >= big_blind),
  max_buyin bigint not null check (max_buyin >= min_buyin),
  -- The broadcast topic, random: only players who entered the room code learn it.
  topic text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  -- The dealer button of the last hand.
  button integer,
  created_at timestamptz not null default now()
);
insert into game.pk_tables (id, name, small_blind, big_blind, min_buyin, max_buyin) values (1, 'Table 1', 150, 300, 3000, 30000);

create table game.pk_seats (
  table_id integer not null references game.pk_tables (id),
  seat integer not null check (seat between 1 and 6),
  wallet text not null references game.accounts (wallet),
  -- What the table shows: the wallet's ADA Handle ($name) or the last five characters of its address.
  name text not null check (char_length(name) between 1 and 32),
  -- The chips in front of the player (taken from the balance at the buy-in, given back when they leave).
  stack bigint not null check (stack >= 0),
  -- Skipped when cards are dealt: after a missed turn, or by choice.
  sitting_out boolean not null default false,
  last_seen timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (table_id, seat)
);
-- One seat per wallet in the room.
create unique index pk_seats_wallet_key on game.pk_seats (wallet);

create table game.pk_hands (
  id bigint generated always as identity primary key,
  table_id integer not null references game.pk_tables (id),
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'done')),
  -- Waiting: when the cards come (set once two players sit with chips).
  starts_at timestamptz,
  street text not null default 'preflop' check (street in ('preflop', 'flop', 'turn', 'river', 'showdown')),
  button integer,
  small_blind_seat integer,
  big_blind_seat integer,
  small_blind bigint,
  big_blind bigint,
  -- Playing: whose move it is, and until when.
  turn_seat integer,
  turn_deadline timestamptz,
  -- The highest amount put in during this betting round, and the smallest raise on top of it.
  current_bet bigint not null default 0,
  min_raise bigint not null default 0,
  -- Everything put in so far, all betting rounds.
  pot bigint not null default 0,
  board smallint[] not null default '{}',
  server_seed bytea not null,
  server_seed_hash text not null,
  client_seed text,
  deck smallint[],
  next_card integer not null default 0,
  created_at timestamptz not null default now(),
  dealt_at timestamptz,
  finished_at timestamptz
);
create unique index pk_hands_open_key on game.pk_hands (table_id) where status <> 'done';
create index pk_hands_table_idx on game.pk_hands (table_id, id desc);

create table game.pk_players (
  hand_id bigint not null references game.pk_hands (id),
  seat integer not null,
  wallet text not null references game.accounts (wallet),
  name text not null,
  cards smallint[] not null default '{}',
  -- Put in during this betting round, and during the whole hand.
  street_bet bigint not null default 0,
  total_bet bigint not null default 0,
  status text not null default 'active' check (status in ('active', 'folded', 'allin')),
  -- Has acted since the last bet or raise.
  acted boolean not null default false,
  -- What the table shows next to the player: small blind, big blind, check, call, bet, raise, all in, fold.
  last_action text,
  won bigint not null default 0,
  -- The score of the best five cards, at the showdown (see game.pk_rank).
  rank bigint,
  history_id bigint references game.rounds (id),
  primary key (hand_id, seat)
);
create index pk_players_wallet_idx on game.pk_players (wallet);
create index pk_players_history_idx on game.pk_players (history_id);

alter table game.pk_room enable row level security;
alter table game.pk_access enable row level security;
alter table game.pk_attempts enable row level security;
alter table game.pk_tables enable row level security;
alter table game.pk_seats enable row level security;
alter table game.pk_hands enable row level security;
alter table game.pk_players enable row level security;

-- Cards are 0..51: suit card / 13 (♠ ♥ ♦ ♣), rank card % 13 (0 = ace, 1..9 = 2..10, 10..12 = J, Q, K).
-- In poker a card is worth 2..14, the ace high.
create function game.pk_value(p_card smallint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_card % 13 = 0 then 14 else p_card % 13 + 1 end;
$$;

-- The top card of the highest straight among the values (an ace also counts as one), or 0.
create function game.pk_straight(p_values integer[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_values integer[] := p_values || case when 14 = any (p_values) then array[1] else '{}'::integer[] end;
  v_high integer;
begin
  for v_high in reverse 14..5 loop
    if (select count(distinct v) from unnest(v_values) v where v between v_high - 4 and v_high) = 5 then
      return v_high;
    end if;
  end loop;
  return 0;
end;
$$;

-- A comparable score: the category (0 high card, 1 pair, 2 two pair, 3 three of a kind, 4 straight, 5 flush,
-- 6 full house, 7 four of a kind, 8 straight flush) times 16^5, plus up to five deciding values, 4 bits each.
create function game.pk_score(p_category integer, p_values integer[])
returns bigint
language sql
immutable
set search_path = ''
as $$
  select p_category::bigint * 1048576
       + coalesce((select sum(v::bigint * (16 ^ (5 - o))::bigint) from unnest(p_values[1:5]) with ordinality x(v, o)), 0);
$$;

-- The best five of five to seven cards, as a score: the higher wins, equal scores split.
create function game.pk_rank(p_cards smallint[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_suit integer;
  v_flush integer[];
  v_high integer;
  v_values integer[];
  v_counts integer[];
  v_distinct integer[];
begin
  -- Five or more of one suit (in seven cards only one suit can have five).
  for v_suit in 0..3 loop
    v_flush := array(select game.pk_value(c) from unnest(p_cards) c where c / 13 = v_suit order by 1 desc);
    exit when cardinality(v_flush) >= 5;
    v_flush := null;
  end loop;
  if v_flush is not null then
    v_high := game.pk_straight(v_flush);
    if v_high > 0 then
      return game.pk_score(8, array[v_high]);
    end if;
  end if;

  -- The values grouped, the most frequent first, then the highest: four of a kind, a set, pairs.
  select array_agg(g.v order by g.n desc, g.v desc), array_agg(g.n order by g.n desc, g.v desc)
  into v_values, v_counts
  from (select game.pk_value(c) as v, count(*)::integer as n from unnest(p_cards) c group by 1) g;
  v_distinct := array(select distinct game.pk_value(c) from unnest(p_cards) c order by 1 desc);

  if v_counts[1] = 4 then
    return game.pk_score(7, array[v_values[1], (select max(v) from unnest(v_distinct) v where v <> v_values[1])]);
  end if;
  if v_counts[1] = 3 and v_counts[2] >= 2 then
    return game.pk_score(6, array[v_values[1], v_values[2]]);
  end if;
  if v_flush is not null then
    return game.pk_score(5, v_flush[1:5]);
  end if;
  v_high := game.pk_straight(v_distinct);
  if v_high > 0 then
    return game.pk_score(4, array[v_high]);
  end if;
  if v_counts[1] = 3 then
    return game.pk_score(3, array[v_values[1]] || array(select v from unnest(v_distinct) v where v <> v_values[1] order by v desc limit 2));
  end if;
  if v_counts[1] = 2 and v_counts[2] = 2 then
    return game.pk_score(2, array[v_values[1], v_values[2],
                                  (select max(v) from unnest(v_distinct) v where v not in (v_values[1], v_values[2]))]);
  end if;
  if v_counts[1] = 2 then
    return game.pk_score(1, array[v_values[1]] || array(select v from unnest(v_distinct) v where v <> v_values[1] order by v desc limit 3));
  end if;
  return game.pk_score(0, v_distinct[1:5]);
end;
$$;

-- The deck of a hand: Fisher–Yates over 52 cards, driven by the HMAC stream (as game.bj_shoe).
create function game.pk_deck(p_seed bytea, p_client_seed text, p_hand bigint)
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cards smallint[] := array(select (generate_series(0, 51))::smallint);
  v_block integer := 0;
  v_buffer bytea;
  v_offset integer := 32;
  v_i integer;
  v_n bigint;
  v_limit bigint;
  v_word bigint;
  v_j integer;
  v_swap smallint;
begin
  for v_i in reverse 51..1 loop
    v_n := v_i + 1;
    v_limit := (4294967296 / v_n) * v_n;
    loop
      if v_offset >= 32 then
        v_buffer := extensions.hmac(convert_to(p_client_seed || ':' || p_hand::text || ':poker:' || v_block::text, 'UTF8'), p_seed, 'sha256');
        v_block := v_block + 1;
        v_offset := 0;
      end if;
      v_word := (get_byte(v_buffer, v_offset)::bigint << 24) + (get_byte(v_buffer, v_offset + 1)::bigint << 16)
              + (get_byte(v_buffer, v_offset + 2)::bigint << 8) + get_byte(v_buffer, v_offset + 3)::bigint;
      v_offset := v_offset + 4;
      exit when v_word < v_limit;
    end loop;
    v_j := (v_word % v_n)::integer;
    v_swap := v_cards[v_i + 1];
    v_cards[v_i + 1] := v_cards[v_j + 1];
    v_cards[v_j + 1] := v_swap;
  end loop;
  return v_cards;
end;
$$;

-- The next card of a hand's deck.
create function game.pk_draw(p_hand bigint)
returns smallint
language sql
set search_path = ''
as $$
  update game.pk_hands set next_card = next_card + 1 where id = p_hand returning deck[next_card];
$$;

-- A hand as everybody may see it.
create function game.pk_hand_json(p_hand bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', h.id,
    'status', h.status,
    'startsAt', h.starts_at,
    'street', h.street,
    'button', h.button,
    'smallBlindSeat', h.small_blind_seat,
    'bigBlindSeat', h.big_blind_seat,
    'turnSeat', h.turn_seat,
    'turnDeadline', h.turn_deadline,
    'currentBet', h.current_bet,
    'minRaise', h.min_raise,
    'pot', h.pot,
    'board', to_jsonb(h.board),
    'serverSeedHash', h.server_seed_hash,
    'serverSeed', case when h.status = 'done' then encode(h.server_seed, 'hex') end,
    'clientSeed', h.client_seed,
    'finishedAt', h.finished_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat', p.seat, 'name', p.name, 'bet', p.street_bet, 'total', p.total_bet, 'status', p.status,
        'action', p.last_action, 'won', p.won,
        -- Hole cards only at the showdown, and only of the hands still in it.
        'cards', case when h.status = 'done' and h.street = 'showdown' and p.status <> 'folded' then to_jsonb(p.cards) end,
        'rank', case when h.status = 'done' and h.street = 'showdown' and p.status <> 'folded' then p.rank end) order by p.seat)
      from game.pk_players p where p.hand_id = h.id), '[]'::jsonb))
  from game.pk_hands h
  where h.id = p_hand;
$$;

-- What everybody at a table may see: seats and stacks, the open hand (or the last one) and the last finished hand.
-- 'now' is the time it was read, so pages keep the newest of two states.
create function game.pk_view(p_table integer)
returns jsonb
language sql
volatile -- clock_timestamp()
security definer
set search_path = ''
as $$
  with current_hand as (
    select h.id from game.pk_hands h where h.table_id = p_table order by (h.status <> 'done') desc, h.id desc limit 1
  ),
  last_hand as (
    select h.id from game.pk_hands h where h.table_id = p_table and h.status = 'done' order by h.id desc limit 1
  )
  select jsonb_build_object(
    'table', t.id,
    'now', clock_timestamp(),
    'blinds', jsonb_build_object('small', t.small_blind, 'big', t.big_blind),
    'buyIn', jsonb_build_object('min', t.min_buyin, 'max', t.max_buyin),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object('seat', s.seat, 'name', s.name, 'stack', s.stack, 'sittingOut', s.sitting_out,
               -- Only whether the player is a high roller leaves the server, never the balance.
               'highRoller', coalesce((select a.balance + s.stack > 1000000 from game.accounts a where a.wallet = s.wallet), false)) order by s.seat)
      from game.pk_seats s where s.table_id = p_table), '[]'::jsonb),
    'hand', (select game.pk_hand_json(c.id) from current_hand c),
    'last', (select game.pk_hand_json(l.id) from last_hand l where l.id is distinct from (select c.id from current_hand c)))
  from game.pk_tables t
  where t.id = p_table;
$$;

-- Pushes the public state to every browser at the table. A failed push never stops the game.
create function game.pk_publish(p_table integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(game.pk_view(p_table), 'state', 'poker-' || (select t.topic from game.pk_tables t where t.id = p_table), false);
exception when others then
  null;
end;
$$;

-- A waiting hand with a fresh server seed, unless the table has an open hand.
create function game.pk_open_hand(p_table integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into game.pk_hands (table_id, server_seed, server_seed_hash)
  select p_table, s.seed, encode(extensions.digest(s.seed, 'sha256'), 'hex')
  from (select extensions.gen_random_bytes(32) as seed) s
  on conflict do nothing;
$$;

-- Chips between a balance and a table (negative: to the table).
create function game.pk_move(p_wallet text, p_delta bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_delta <> 0 then
    perform game.apply_delta(p_wallet, p_delta, 'table', 'poker-' || nextval('game.pk_moves'));
  end if;
end;
$$;

-- A player puts chips in: from their stack into the pot. A player whose stack runs out is all in.
create function game.pk_commit(p_hand bigint, p_seat integer, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stack bigint;
begin
  update game.pk_seats s set stack = s.stack - p_amount
  from game.pk_hands h
  where h.id = p_hand and s.table_id = h.table_id and s.seat = p_seat
  returning s.stack into v_stack;
  update game.pk_players
  set street_bet = street_bet + p_amount, total_bet = total_bet + p_amount,
      status = case when v_stack = 0 then 'allin' else status end
  where hand_id = p_hand and seat = p_seat;
  update game.pk_hands set pot = pot + p_amount where id = p_hand;
end;
$$;

-- The next seat after p_after (round the table) whose player still has to act in this betting round.
create function game.pk_next_to_act(p_hand bigint, p_after integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select p.seat
  from game.pk_players p join game.pk_hands h on h.id = p.hand_id
  where p.hand_id = p_hand and p.status = 'active' and (not p.acted or p.street_bet < h.current_bet)
  order by (p.seat <= p_after), p.seat
  limit 1;
$$;

-- The hand ends: the showdown if more than one player is left, the pots are paid, the next hand opens.
create function game.pk_finish(p_hand bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hand game.pk_hands;
  v_live integer;
  v_level bigint;
  v_previous bigint := 0;
  v_amount bigint;
  v_best bigint;
  v_winners integer[];
  v_share bigint;
  v_category integer;
  v_player game.pk_players;
  v_result text;
  v_history bigint;
begin
  select * into v_hand from game.pk_hands where id = p_hand;
  select count(*) into v_live from game.pk_players where hand_id = p_hand and status <> 'folded';
  if v_live > 1 then
    update game.pk_hands set street = 'showdown' where id = p_hand;
    update game.pk_players set rank = game.pk_rank(cards || v_hand.board) where hand_id = p_hand and status <> 'folded';
  end if;

  -- The pots: for each amount a player still in the hand has put in, from the smallest up, what everybody put
  -- in up to it goes to the best hand among those who put in at least that much. A tie splits it; an odd chip
  -- goes to the first of the winners after the button.
  for v_level in select distinct total_bet from game.pk_players where hand_id = p_hand and status <> 'folded' order by 1 loop
    select sum(least(total_bet, v_level) - least(total_bet, v_previous)) into v_amount from game.pk_players where hand_id = p_hand;
    if v_amount > 0 then
      select max(coalesce(rank, 0)) into v_best
      from game.pk_players where hand_id = p_hand and status <> 'folded' and total_bet >= v_level;
      v_winners := array(
        select seat from game.pk_players
        where hand_id = p_hand and status <> 'folded' and total_bet >= v_level and coalesce(rank, 0) = v_best
        order by (seat <= v_hand.button), seat);
      v_share := v_amount / cardinality(v_winners);
      update game.pk_players
      set won = won + v_share + case when seat = v_winners[1] then v_amount - v_share * cardinality(v_winners) else 0 end
      where hand_id = p_hand and seat = any (v_winners);
    end if;
    v_previous := v_level;
  end loop;
  -- What nobody still in the hand matched goes back (an uncalled bet).
  update game.pk_players set won = won + (total_bet - least(total_bet, v_previous)) where hand_id = p_hand and total_bet > v_previous;

  v_category := case when v_live > 1 then ((select max(rank) from game.pk_players where hand_id = p_hand) / 1048576)::integer else -1 end;
  for v_player in select * from game.pk_players where hand_id = p_hand order by seat loop
    if v_player.won > 0 then
      update game.pk_seats set stack = stack + v_player.won
      where table_id = v_hand.table_id and seat = v_player.seat and wallet = v_player.wallet;
      if not found then
        -- The player has left the table: the chips go straight to the balance.
        perform game.pk_move(v_player.wallet, v_player.won);
      end if;
    end if;
    if v_player.total_bet > 0 then
      v_result := case when v_player.status = 'folded' then 'fold'
                       when v_player.won > v_player.total_bet then 'win'
                       when v_player.won = v_player.total_bet then 'split'
                       else 'lose' end;
      insert into game.rounds (wallet, game, bet, choice, outcome, payout, server_seed_hash, client_seed, nonce, odds_bps, detail)
      values (v_player.wallet, 'poker', v_player.total_bet,
              case when v_player.rank is null then -1 else (v_player.rank / 1048576)::integer end,
              v_category, v_player.won, v_hand.server_seed_hash, v_hand.client_seed, p_hand::integer,
              case when v_player.won > 0 then (v_player.won * 10000 / v_player.total_bet)::integer end,
              jsonb_build_object('table', v_hand.table_id, 'seat', v_player.seat, 'result', v_result, 'pot', v_hand.pot,
                                 'cards', to_jsonb(v_player.cards), 'board', to_jsonb(v_hand.board), 'rank', v_player.rank))
      returning id into v_history;
      update game.pk_players set history_id = v_history where hand_id = p_hand and seat = v_player.seat;
    end if;
  end loop;

  update game.pk_hands set status = 'done', turn_seat = null, turn_deadline = null, finished_at = now() where id = p_hand;
  perform game.pk_open_hand(v_hand.table_id);
end;
$$;

-- After every move: the next player, or the next betting round, or the end of the hand. While fewer than two
-- players can still bet, the board runs out to the river.
create function game.pk_advance(p_hand bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hand game.pk_hands;
  v_next integer;
  v_cards smallint[];
begin
  select * into v_hand from game.pk_hands where id = p_hand;
  if (select count(*) from game.pk_players where hand_id = p_hand and status <> 'folded') <= 1 then
    perform game.pk_finish(p_hand);
    return;
  end if;
  v_next := game.pk_next_to_act(p_hand, v_hand.turn_seat);
  if v_next is not null then
    update game.pk_hands set turn_seat = v_next, turn_deadline = now() + interval '20 seconds' where id = p_hand;
    return;
  end if;

  loop
    if v_hand.street = 'river' then
      perform game.pk_finish(p_hand);
      return;
    end if;
    -- Three cards on the flop, one on the turn and one on the river.
    select h.deck[h.next_card + 1 : h.next_card + case when h.street = 'preflop' then 3 else 1 end] into v_cards
    from game.pk_hands h where h.id = p_hand;
    update game.pk_hands
    set board = board || v_cards, next_card = next_card + cardinality(v_cards),
        street = case street when 'preflop' then 'flop' when 'flop' then 'turn' else 'river' end,
        current_bet = 0, min_raise = big_blind, turn_seat = null, turn_deadline = null
    where id = p_hand
    returning * into v_hand;
    update game.pk_players
    set street_bet = 0, acted = false, last_action = case when status = 'active' then null else last_action end
    where hand_id = p_hand;
    if (select count(*) from game.pk_players where hand_id = p_hand and status = 'active') >= 2 then
      -- After the flop the first player after the button starts.
      update game.pk_hands set turn_seat = game.pk_next_to_act(p_hand, v_hand.button), turn_deadline = now() + interval '20 seconds'
      where id = p_hand;
      return;
    end if;
  end loop;
end;
$$;

-- The deal: the button moves on, the blinds go in, the deck is shuffled from the server seed and every
-- player's client seed, two cards each.
create function game.pk_deal(p_hand bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hand game.pk_hands;
  v_table game.pk_tables;
  v_seats integer[];
  v_order integer[];
  v_button integer;
  v_small integer;
  v_big integer;
  v_client_seed text;
  v_pass integer;
  v_seat integer;
begin
  select * into v_hand from game.pk_hands where id = p_hand;
  select * into v_table from game.pk_tables where id = v_hand.table_id;
  v_seats := array(select s.seat from game.pk_seats s where s.table_id = v_hand.table_id and not s.sitting_out and s.stack > 0 order by s.seat);
  if cardinality(v_seats) < 2 then
    update game.pk_hands set starts_at = null where id = p_hand;
    return;
  end if;
  v_button := coalesce((select s from unnest(v_seats) s where s > coalesce(v_table.button, 0) order by s limit 1), v_seats[1]);
  -- The seats in the order of the deal: from the one after the button round to the button.
  v_order := array(select s from unnest(v_seats) s order by (s <= v_button), s);
  -- Heads-up the button posts the small blind and acts first before the flop.
  if cardinality(v_seats) = 2 then
    v_small := v_button;
    v_big := v_order[1];
  else
    v_small := v_order[1];
    v_big := v_order[2];
  end if;

  insert into game.pk_players (hand_id, seat, wallet, name)
  select p_hand, s.seat, s.wallet, s.name from game.pk_seats s where s.table_id = v_hand.table_id and s.seat = any (v_seats);
  perform game.ensure_seed(p.wallet) from game.pk_players p where p.hand_id = p_hand;
  select string_agg(sd.client_seed, '|' order by p.seat) into v_client_seed
  from game.pk_players p join game.seeds sd on sd.wallet = p.wallet
  where p.hand_id = p_hand;
  update game.pk_hands
  set status = 'playing', starts_at = null, street = 'preflop', client_seed = v_client_seed, dealt_at = now(), next_card = 0,
      deck = game.pk_deck(v_hand.server_seed, v_client_seed, p_hand),
      button = v_button, small_blind_seat = v_small, big_blind_seat = v_big,
      small_blind = v_table.small_blind, big_blind = v_table.big_blind,
      -- A short big blind still makes the others call the full big blind.
      current_bet = v_table.big_blind, min_raise = v_table.big_blind
  where id = p_hand;
  update game.pk_tables set button = v_button where id = v_hand.table_id;

  -- One card at a time, starting after the button, twice round.
  for v_pass in 1..2 loop
    foreach v_seat in array v_order loop
      update game.pk_players set cards = cards || game.pk_draw(p_hand) where hand_id = p_hand and seat = v_seat;
    end loop;
  end loop;

  -- The blinds; a short stack puts in what it has and is all in.
  perform game.pk_commit(p_hand, v_small, least(v_table.small_blind, (select stack from game.pk_seats where table_id = v_hand.table_id and seat = v_small)));
  perform game.pk_commit(p_hand, v_big, least(v_table.big_blind, (select stack from game.pk_seats where table_id = v_hand.table_id and seat = v_big)));
  update game.pk_players
  set last_action = case when status = 'allin' then 'allin' when seat = v_small then 'small blind' else 'big blind' end
  where hand_id = p_hand and seat in (v_small, v_big);

  -- The first to act sits after the big blind.
  update game.pk_hands set turn_seat = v_big where id = p_hand;
  perform game.pk_advance(p_hand);
end;
$$;

-- Applies whatever is due at a table: idle seats leave, the countdown starts or the deal happens, a turn runs out.
-- The caller holds the table's lock. Returns whether anything changed.
create function game.pk_step(p_table integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat game.pk_seats;
  v_hand game.pk_hands;
  v_player game.pk_players;
  v_ready integer;
  v_last timestamptz;
  v_changed boolean := false;
begin
  -- Seats nobody has looked at for two minutes are freed and their chips go back to the balance (a player
  -- still in a running hand keeps the seat until it ends).
  for v_seat in
    select s.* from game.pk_seats s
    where s.table_id = p_table and s.last_seen < now() - interval '2 minutes'
      and not exists (select 1 from game.pk_players p join game.pk_hands h on h.id = p.hand_id
                      where h.table_id = p_table and h.status = 'playing' and p.wallet = s.wallet and p.status <> 'folded')
  loop
    delete from game.pk_seats where table_id = p_table and seat = v_seat.seat;
    perform game.pk_move(v_seat.wallet, v_seat.stack);
    v_changed := true;
  end loop;

  select * into v_hand from game.pk_hands where table_id = p_table and status <> 'done';
  if v_hand.id is null then
    perform game.pk_open_hand(p_table);
    return true;
  end if;

  if v_hand.status = 'waiting' then
    select count(*) into v_ready from game.pk_seats where table_id = p_table and not sitting_out and stack > 0;
    if v_ready >= 2 and v_hand.starts_at is null then
      -- A few seconds to sit down, and time to look at the last showdown.
      select max(finished_at) into v_last from game.pk_hands where table_id = p_table and status = 'done';
      update game.pk_hands set starts_at = greatest(now() + interval '5 seconds', coalesce(v_last + interval '8 seconds', now()))
      where id = v_hand.id;
      v_changed := true;
    elsif v_ready < 2 and v_hand.starts_at is not null then
      update game.pk_hands set starts_at = null where id = v_hand.id;
      v_changed := true;
    elsif v_ready >= 2 and v_hand.starts_at <= now() then
      perform game.pk_deal(v_hand.id);
      v_changed := true;
    end if;
  elsif v_hand.status = 'playing' and v_hand.turn_deadline <= now() then
    -- Time is up: a check if it costs nothing, a fold otherwise; the player sits out from the next hand.
    select * into v_player from game.pk_players where hand_id = v_hand.id and seat = v_hand.turn_seat;
    if v_player.street_bet >= v_hand.current_bet then
      update game.pk_players set acted = true, last_action = 'check' where hand_id = v_hand.id and seat = v_player.seat;
    else
      update game.pk_players set status = 'folded', acted = true, last_action = 'fold' where hand_id = v_hand.id and seat = v_player.seat;
    end if;
    update game.pk_seats set sitting_out = true where table_id = p_table and seat = v_player.seat and wallet = v_player.wallet;
    perform game.pk_advance(v_hand.id);
    v_changed := true;
  end if;
  return v_changed;
end;
$$;

-- Locks a table for one request (every change to a table goes through this lock).
create function game.pk_lock(p_table integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from game.pk_tables where id = p_table for update;
  if not found then
    raise exception 'table_not_found';
  end if;
end;
$$;

-- Only wallets that entered the current room code come in.
create function game.pk_require(p_wallet text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from game.pk_access a join game.pk_room r on r.code_version = a.code_version
                 where a.wallet = p_wallet and r.code_hash is not null) then
    raise exception 'room_locked';
  end if;
end;
$$;

-- The table as one player sees it: the public view, their seat, their own cards, their balance and the topic.
create function game.pk_you(p_table integer, p_wallet text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select game.pk_view(p_table) || jsonb_build_object('you', jsonb_build_object(
    'seat', (select s.seat from game.pk_seats s where s.table_id = p_table and s.wallet = p_wallet),
    'table', (select s.table_id from game.pk_seats s where s.wallet = p_wallet),
    'topic', 'poker-' || (select t.topic from game.pk_tables t where t.id = p_table),
    -- The player's cards in the running hand, or in the last one they played.
    'hand', (select jsonb_build_object('id', p.hand_id, 'seat', p.seat, 'cards', to_jsonb(p.cards))
             from game.pk_players p join game.pk_hands h on h.id = p.hand_id
             where h.table_id = p_table and p.wallet = p_wallet
             order by p.hand_id desc limit 1),
    'balance', coalesce((select a.balance from game.accounts a where a.wallet = p_wallet), 0)));
$$;

-- The room code: right once, the wallet comes in until the code changes.
create function game.pk_unlock(p_wallet text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room game.pk_room;
begin
  select * into v_room from game.pk_room for update;
  if v_room.code_hash is null then
    return jsonb_build_object('ok', false, 'error', 'room_closed');
  end if;
  if exists (select 1 from game.pk_access where wallet = p_wallet and code_version = v_room.code_version) then
    return jsonb_build_object('ok', true);
  end if;
  delete from game.pk_attempts where at < now() - interval '1 day';
  if (select count(*) from game.pk_attempts where wallet = p_wallet and at > now() - interval '15 minutes') >= 5
     or (select count(*) from game.pk_attempts where at > now() - interval '15 minutes') >= 60 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;
  if p_code is null or p_code !~ '^[0-9A-Za-z]{1,32}$' or extensions.crypt(p_code, v_room.code_hash) <> v_room.code_hash then
    insert into game.pk_attempts (wallet) values (p_wallet);
    return jsonb_build_object('ok', false, 'error', 'wrong_code');
  end if;
  insert into game.accounts (wallet) values (p_wallet) on conflict do nothing;
  insert into game.pk_access (wallet, code_version) values (p_wallet, v_room.code_version)
  on conflict (wallet) do update set code_version = excluded.code_version, granted_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- A player looks at a table: their seat stays theirs, due deadlines are applied.
create function game.pk_enter(p_table integer, p_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform game.pk_require(p_wallet);
  perform game.pk_lock(p_table);
  update game.pk_seats set last_seen = now() where wallet = p_wallet;
  if game.pk_step(p_table) then
    perform game.pk_publish(p_table);
  end if;
  return game.pk_you(p_table, p_wallet);
end;
$$;

-- Applies due deadlines at a table (called by the players' browsers when a countdown ends, and by the scheduled tick).
create function game.pk_tick(p_table integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform game.pk_lock(p_table);
  if game.pk_step(p_table) then
    perform game.pk_publish(p_table);
  end if;
end;
$$;

create function game.pk_tick_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table integer;
  v_count integer := 0;
begin
  for v_table in select id from game.pk_tables order by id loop
    perform game.pk_tick(v_table);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Sits down with a buy-in: the chips leave the balance for the table.
create function game.pk_sit(p_table integer, p_seat integer, p_wallet text, p_name text, p_buyin bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_game game.games;
  v_table game.pk_tables;
begin
  perform game.pk_require(p_wallet);
  select * into v_settings from game.settings;
  select * into v_game from game.games where id = 'poker';
  if not v_settings.enabled or v_game.id is null or not v_game.enabled then
    raise exception 'game_disabled';
  end if;
  if p_seat is null or p_seat not between 1 and 6 or p_name is null or char_length(p_name) not between 1 and 32 then
    raise exception 'invalid_request';
  end if;
  perform game.pk_lock(p_table);
  select * into v_table from game.pk_tables where id = p_table;
  if p_buyin is null or p_buyin < v_table.min_buyin or p_buyin > v_table.max_buyin then
    raise exception 'invalid_bet';
  end if;
  if exists (select 1 from game.pk_seats where wallet = p_wallet) then
    raise exception 'already_seated';
  end if;
  if exists (select 1 from game.pk_seats where table_id = p_table and seat = p_seat) then
    raise exception 'seat_taken';
  end if;
  perform game.ensure_seed(p_wallet);
  perform game.pk_move(p_wallet, -p_buyin);
  insert into game.pk_seats (table_id, seat, wallet, name, stack) values (p_table, p_seat, p_wallet, p_name, p_buyin);
  perform game.pk_step(p_table);
  perform game.pk_publish(p_table);
  return game.pk_you(p_table, p_wallet);
end;
$$;

-- More chips from the balance, up to the table's maximum, while the player is not in a running hand.
create function game.pk_add_chips(p_table integer, p_wallet text, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat game.pk_seats;
  v_table game.pk_tables;
begin
  perform game.pk_require(p_wallet);
  perform game.pk_lock(p_table);
  select * into v_table from game.pk_tables where id = p_table;
  select * into v_seat from game.pk_seats where table_id = p_table and wallet = p_wallet;
  if v_seat.seat is null then
    raise exception 'not_seated';
  end if;
  if exists (select 1 from game.pk_players p join game.pk_hands h on h.id = p.hand_id
             where h.table_id = p_table and h.status = 'playing' and p.wallet = p_wallet and p.status <> 'folded') then
    raise exception 'hand_running';
  end if;
  if p_amount is null or p_amount <= 0 or v_seat.stack + p_amount > v_table.max_buyin then
    raise exception 'invalid_bet';
  end if;
  perform game.pk_move(p_wallet, -p_amount);
  update game.pk_seats set stack = stack + p_amount, last_seen = now() where table_id = p_table and seat = v_seat.seat;
  perform game.pk_step(p_table);
  perform game.pk_publish(p_table);
  return game.pk_you(p_table, p_wallet);
end;
$$;

-- Sits out from the next hands, or comes back.
create function game.pk_sit_out(p_table integer, p_wallet text, p_out boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform game.pk_require(p_wallet);
  perform game.pk_lock(p_table);
  update game.pk_seats set sitting_out = coalesce(p_out, false), last_seen = now() where table_id = p_table and wallet = p_wallet;
  if not found then
    raise exception 'not_seated';
  end if;
  perform game.pk_step(p_table);
  perform game.pk_publish(p_table);
  return game.pk_you(p_table, p_wallet);
end;
$$;

-- Leaves the table: the stack goes back to the balance. In a running hand the player folds first; a player
-- who is all in waits for the end of the hand.
create function game.pk_leave(p_table integer, p_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat game.pk_seats;
  v_hand game.pk_hands;
  v_player game.pk_players;
begin
  perform game.pk_lock(p_table);
  select * into v_seat from game.pk_seats where table_id = p_table and wallet = p_wallet;
  if v_seat.seat is null then
    return game.pk_you(p_table, p_wallet);
  end if;
  select * into v_hand from game.pk_hands where table_id = p_table and status = 'playing';
  if v_hand.id is not null then
    select * into v_player from game.pk_players where hand_id = v_hand.id and seat = v_seat.seat and wallet = p_wallet;
    if v_player.status = 'allin' then
      raise exception 'hand_running';
    end if;
    if v_player.status = 'active' then
      update game.pk_players set status = 'folded', acted = true, last_action = 'fold' where hand_id = v_hand.id and seat = v_seat.seat;
    end if;
  end if;
  delete from game.pk_seats where table_id = p_table and seat = v_seat.seat;
  perform game.pk_move(p_wallet, v_seat.stack);
  if v_player.status = 'active' then
    if v_hand.turn_seat = v_seat.seat then
      perform game.pk_advance(v_hand.id);
    elsif (select count(*) from game.pk_players where hand_id = v_hand.id and status <> 'folded') <= 1 then
      perform game.pk_finish(v_hand.id);
    end if;
  end if;
  perform game.pk_step(p_table);
  perform game.pk_publish(p_table);
  return game.pk_you(p_table, p_wallet);
end;
$$;

-- A decision of the player whose turn it is: fold, check, call, raise (to a total for this betting round) or all in.
create function game.pk_act(p_table integer, p_wallet text, p_action text, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hand game.pk_hands;
  v_player game.pk_players;
  v_action text := p_action;
  v_amount bigint := p_amount;
  v_stack bigint;
  v_to_call bigint;
  v_max bigint;
begin
  perform game.pk_require(p_wallet);
  perform game.pk_lock(p_table);
  perform game.pk_step(p_table);
  update game.pk_seats set last_seen = now() where wallet = p_wallet;
  select * into v_hand from game.pk_hands where table_id = p_table and status = 'playing';
  if v_hand.id is null then
    raise exception 'round_not_open';
  end if;
  select * into v_player from game.pk_players where hand_id = v_hand.id and seat = v_hand.turn_seat;
  if v_player.wallet is distinct from p_wallet or v_player.status <> 'active' then
    raise exception 'not_your_turn';
  end if;
  select stack into v_stack from game.pk_seats where table_id = p_table and seat = v_player.seat;
  v_to_call := greatest(v_hand.current_bet - v_player.street_bet, 0);
  -- The most this player can have in this betting round.
  v_max := v_player.street_bet + v_stack;

  if v_action = 'allin' then
    v_action := case when v_max > v_hand.current_bet then 'raise' else 'call' end;
    v_amount := v_max;
  end if;

  if v_action = 'fold' then
    update game.pk_players set status = 'folded', acted = true, last_action = 'fold' where hand_id = v_hand.id and seat = v_player.seat;
  elsif v_action = 'check' then
    if v_to_call > 0 then
      raise exception 'invalid_choice';
    end if;
    update game.pk_players set acted = true, last_action = 'check' where hand_id = v_hand.id and seat = v_player.seat;
  elsif v_action = 'call' then
    if v_to_call = 0 then
      raise exception 'invalid_choice';
    end if;
    perform game.pk_commit(v_hand.id, v_player.seat, least(v_to_call, v_stack));
    update game.pk_players set acted = true, last_action = case when status = 'allin' then 'allin' else 'call' end
    where hand_id = v_hand.id and seat = v_player.seat;
  elsif v_action = 'raise' then
    if v_amount is null or v_amount <= v_hand.current_bet or v_amount > v_max then
      raise exception 'invalid_bet';
    end if;
    -- Less than a full raise only all in.
    if v_amount < v_hand.current_bet + v_hand.min_raise and v_amount < v_max then
      raise exception 'invalid_bet';
    end if;
    perform game.pk_commit(v_hand.id, v_player.seat, v_amount - v_player.street_bet);
    update game.pk_hands set min_raise = greatest(min_raise, v_amount - current_bet), current_bet = v_amount where id = v_hand.id;
    -- Everybody else still in acts again.
    update game.pk_players set acted = false where hand_id = v_hand.id and status = 'active' and seat <> v_player.seat;
    update game.pk_players
    set acted = true, last_action = case when status = 'allin' then 'allin' when v_hand.current_bet = 0 then 'bet' else 'raise' end
    where hand_id = v_hand.id and seat = v_player.seat;
  else
    raise exception 'invalid_choice';
  end if;

  perform game.pk_advance(v_hand.id);
  perform game.pk_publish(p_table);
  return game.pk_you(p_table, p_wallet);
end;
$$;

-- The rewards board counts what was lost to the house; at the poker table the players play each other.
create or replace function game.loss_board(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cutoff as (
    select (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as at
  ),
  players as (
    select r.wallet, sum(greatest(r.bet - r.payout, 0)) as lost, count(*) as rounds
    from game.rounds r, cutoff c
    where r.created_at < c.at and r.game <> 'poker'
    group by r.wallet
    having sum(greatest(r.bet - r.payout, 0)) > 0
  )
  select jsonb_build_object(
    'asOf', c.at,
    'nextAt', c.at + interval '1 day',
    'revealAt', (select s.reveal_at from game.rewards_settings s),
    'jackpot', (select coalesce(sum(greatest(r.bet - r.payout, 0)), 0) from game.rounds r where r.game <> 'poker'),
    'total', coalesce((select sum(p.lost) from players p), 0),
    'players', (select count(*) from players),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('wallet', top.wallet, 'lost', top.lost, 'rounds', top.rounds) order by top.lost desc, top.wallet)
      from (select * from players order by lost desc, wallet limit greatest(1, least(p_limit, 500))) top
    ), '[]'::jsonb)
  )
  from cutoff c;
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'game.pk_enter(integer, text)', 'game.pk_tick(integer)', 'game.pk_tick_all()', 'game.pk_unlock(text, text)',
    'game.pk_sit(integer, integer, text, text, bigint)', 'game.pk_add_chips(integer, text, bigint)',
    'game.pk_sit_out(integer, text, boolean)', 'game.pk_leave(integer, text)', 'game.pk_act(integer, text, text, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
    execute format('grant execute on function %s to game_api', v_function);
  end loop;
  foreach v_function in array array[
    'game.pk_value(smallint)', 'game.pk_straight(integer[])', 'game.pk_score(integer, integer[])', 'game.pk_rank(smallint[])',
    'game.pk_deck(bytea, text, bigint)', 'game.pk_draw(bigint)', 'game.pk_hand_json(bigint)', 'game.pk_view(integer)',
    'game.pk_publish(integer)', 'game.pk_open_hand(integer)', 'game.pk_move(text, bigint)', 'game.pk_commit(bigint, integer, bigint)',
    'game.pk_next_to_act(bigint, integer)', 'game.pk_finish(bigint)', 'game.pk_advance(bigint)', 'game.pk_deal(bigint)',
    'game.pk_step(integer)', 'game.pk_lock(integer)', 'game.pk_require(text)', 'game.pk_you(integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
  end loop;
end;
$$;

select game.pk_open_hand(1);
