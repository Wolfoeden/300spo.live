-- Blackjack (Roman, 1 October 2026): up to seven players at a table, each
-- against the dealer. A round starts on its own once at least two seated
-- players have bet: 15 seconds after the second bet, so others can still join.
-- Each player then has 20 seconds per decision (hit, stand, double, split);
-- when the time runs out the hand stands. The dealer draws to 17 and stands
-- on every 17; blackjack pays 3:2, a win 1:1, a push returns the bet — all as
-- game credit, like every other game.
--
-- Requests from the players move a table along (every call first applies the
-- deadlines that have passed); a scheduled function ticks every table once a
-- minute in case nobody is looking.
--
-- Provably fair: every round commits to a fresh server seed, whose hash is
-- public while the players bet. The six-deck shoe is a Fisher–Yates shuffle
-- driven by HMAC-SHA256(server_seed, "<client seeds of the players in seat
-- order, joined by |>:<round id>:blackjack:<block>"), so no single party
-- decides the cards; the seed is revealed when the round ends.
--
-- Every change is pushed to the browsers as a public Realtime broadcast on the
-- topic "blackjack-<table>": the public table state, without the hole card,
-- the shoe or any wallet address.

alter table game.games drop constraint games_kind_check;
alter table game.games add constraint games_kind_check check (kind in ('pick', 'race', 'step', 'table'));
insert into game.games (id, name, outcomes, payout_bps, enabled, sort, kind)
values ('blackjack', 'Blackjack', 2, 25000, true, 3, 'table'); -- payout_bps: the most a hand pays (blackjack, 3:2)

create table game.bj_tables (
  id integer primary key check (id > 0),
  name text not null,
  created_at timestamptz not null default now()
);
insert into game.bj_tables (id, name) values (1, 'Table 1');

create table game.bj_seats (
  table_id integer not null references game.bj_tables (id),
  seat integer not null check (seat between 1 and 7),
  wallet text not null references game.accounts (wallet),
  -- What the table shows: the wallet's ADA Handle ($name) or the last five characters of its address.
  name text not null check (char_length(name) between 1 and 32),
  -- The bet for the next deal; null while the player sits out.
  bet bigint check (bet > 0),
  last_seen timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (table_id, seat)
);
create unique index bj_seats_wallet_key on game.bj_seats (wallet);

create table game.bj_rounds (
  id bigint generated always as identity primary key,
  table_id integer not null references game.bj_tables (id),
  status text not null default 'betting' check (status in ('betting', 'playing', 'done')),
  -- Betting: when the deal happens (set once two players have bet).
  starts_at timestamptz,
  -- Playing: whose move it is, and until when.
  turn_hand bigint,
  turn_deadline timestamptz,
  server_seed bytea not null,
  server_seed_hash text not null,
  client_seed text,
  shoe smallint[],
  next_card integer not null default 0,
  dealer_cards smallint[] not null default '{}',
  created_at timestamptz not null default now(),
  dealt_at timestamptz,
  finished_at timestamptz
);
create unique index bj_rounds_open_key on game.bj_rounds (table_id) where status <> 'done';
create index bj_rounds_table_idx on game.bj_rounds (table_id, id desc);

create table game.bj_hands (
  id bigint generated always as identity primary key,
  round_id bigint not null references game.bj_rounds (id),
  seat integer not null,
  -- 1 is the second hand after a split.
  part integer not null default 0 check (part in (0, 1)),
  wallet text not null references game.accounts (wallet),
  name text not null,
  bet bigint not null check (bet > 0),
  cards smallint[] not null default '{}',
  status text not null default 'playing' check (status in ('playing', 'stood', 'bust', 'blackjack')),
  doubled boolean not null default false,
  split boolean not null default false,
  result text check (result in ('win', 'blackjack', 'push', 'lose')),
  payout bigint not null default 0,
  history_id bigint references game.rounds (id),
  unique (round_id, seat, part)
);
create index bj_hands_wallet_idx on game.bj_hands (wallet);
create index bj_hands_history_idx on game.bj_hands (history_id);

alter table game.bj_tables enable row level security;
alter table game.bj_seats enable row level security;
alter table game.bj_rounds enable row level security;
alter table game.bj_hands enable row level security;

-- Cards are 0..311 in the shoe; card % 52 is the card itself: suit (card % 52) / 13
-- (♠ ♥ ♦ ♣) and rank (card % 52) % 13 (0 = ace, 1..9 = 2..10, 10..12 = J, Q, K).
create function game.bj_value(p_card smallint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_card % 52 % 13 = 0 then 11 else least(p_card % 52 % 13 + 1, 10) end;
$$;

-- The best total of a hand: aces count 11 unless that would bust it.
create function game.bj_total(p_cards smallint[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_aces integer := 0;
  v_card smallint;
begin
  foreach v_card in array coalesce(p_cards, '{}'::smallint[]) loop
    v_total := v_total + game.bj_value(v_card);
    if v_card % 52 % 13 = 0 then
      v_aces := v_aces + 1;
    end if;
  end loop;
  while v_total > 21 and v_aces > 0 loop
    v_total := v_total - 10;
    v_aces := v_aces - 1;
  end loop;
  return v_total;
end;
$$;

-- The six-deck shoe of a round: Fisher–Yates over 312 cards, driven by the HMAC stream.
create function game.bj_shoe(p_seed bytea, p_client_seed text, p_round bigint)
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cards smallint[] := array(select (generate_series(0, 311))::smallint);
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
  for v_i in reverse 311..1 loop
    v_n := v_i + 1;
    v_limit := (4294967296 / v_n) * v_n;
    loop
      if v_offset >= 32 then
        v_buffer := extensions.hmac(convert_to(p_client_seed || ':' || p_round::text || ':blackjack:' || v_block::text, 'UTF8'), p_seed, 'sha256');
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

-- The next card of a round's shoe.
create function game.bj_draw(p_round bigint)
returns smallint
language sql
set search_path = ''
as $$
  update game.bj_rounds set next_card = next_card + 1 where id = p_round returning shoe[next_card];
$$;

-- What everybody may see of a table: seats, the open round (or the last one), and the last finished round.
create function game.bj_view(p_table integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with current_round as (
    select r.* from game.bj_rounds r where r.table_id = p_table order by (r.status <> 'done') desc, r.id desc limit 1
  ),
  last_round as (
    select r.* from game.bj_rounds r where r.table_id = p_table and r.status = 'done' order by r.id desc limit 1
  ),
  round_json as (
    select r.id, jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'startsAt', r.starts_at,
      'turnHand', r.turn_hand,
      'turnDeadline', r.turn_deadline,
      'serverSeedHash', r.server_seed_hash,
      'serverSeed', case when r.status = 'done' then encode(r.server_seed, 'hex') end,
      'clientSeed', r.client_seed,
      -- While players decide, only the dealer's first card is up.
      'dealer', case when r.status = 'playing'
                  then jsonb_build_array(r.dealer_cards[1] % 52, null)
                  else coalesce((select jsonb_agg(c % 52 order by o) from unnest(r.dealer_cards) with ordinality d(c, o)), '[]'::jsonb) end,
      'dealerTotal', case when r.status = 'playing' then game.bj_total(r.dealer_cards[1:1]) else game.bj_total(r.dealer_cards) end,
      'hands', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', h.id, 'seat', h.seat, 'part', h.part, 'name', h.name, 'bet', h.bet,
          'cards', coalesce((select jsonb_agg(c % 52 order by o) from unnest(h.cards) with ordinality x(c, o)), '[]'::jsonb),
          'total', game.bj_total(h.cards), 'status', h.status, 'doubled', h.doubled, 'split', h.split,
          'result', h.result, 'payout', h.payout) order by h.seat, h.part)
        from game.bj_hands h where h.round_id = r.id), '[]'::jsonb),
      'finishedAt', r.finished_at) as body
    from game.bj_rounds r
    where r.id in ((select id from current_round), (select id from last_round))
  )
  select jsonb_build_object(
    'table', p_table,
    'now', now(),
    'bets', (select jsonb_build_object('min', s.min_bet, 'max', s.max_bet, 'step', s.bet_step) from game.settings s),
    'seats', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'name', s.name, 'bet', s.bet) order by s.seat)
                       from game.bj_seats s where s.table_id = p_table), '[]'::jsonb),
    'tables', (select jsonb_agg(jsonb_build_object('id', t.id, 'seated', (select count(*) from game.bj_seats s where s.table_id = t.id)) order by t.id)
               from game.bj_tables t),
    'round', (select j.body from round_json j where j.id = (select id from current_round)),
    'last', (select j.body from round_json j where j.id = (select id from last_round) and j.id <> (select id from current_round))
  );
$$;

-- Pushes the public state to every browser at the table. A failed push never stops the game.
create function game.bj_publish(p_table integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(game.bj_view(p_table), 'state', 'blackjack-' || p_table, false);
exception when others then
  null;
end;
$$;

-- A betting round with a fresh server seed, unless the table has an open round.
create function game.bj_open_round(p_table integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into game.bj_rounds (table_id, server_seed, server_seed_hash)
  select p_table, s.seed, encode(extensions.digest(s.seed, 'sha256'), 'hex')
  from (select extensions.gen_random_bytes(32) as seed) s
  on conflict do nothing;
$$;

-- The dealer plays, every hand is paid, and the next betting round opens.
create function game.bj_finish(p_round bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round game.bj_rounds;
  v_dealer smallint[];
  v_dealer_total integer;
  v_dealer_blackjack boolean;
  v_hand game.bj_hands;
  v_total integer;
  v_result text;
  v_payout bigint;
  v_history bigint;
begin
  update game.bj_hands set status = 'stood' where round_id = p_round and status = 'playing';
  select * into v_round from game.bj_rounds where id = p_round;
  v_dealer := v_round.dealer_cards;
  v_dealer_blackjack := cardinality(v_dealer) = 2 and game.bj_total(v_dealer) = 21;
  -- The dealer only draws while a standing hand can still win or lose against it.
  if not v_dealer_blackjack and exists (select 1 from game.bj_hands where round_id = p_round and status = 'stood') then
    while game.bj_total(v_dealer) < 17 loop
      v_dealer := v_dealer || game.bj_draw(p_round);
    end loop;
  end if;
  v_dealer_total := game.bj_total(v_dealer);

  for v_hand in select * from game.bj_hands where round_id = p_round order by seat, part loop
    v_total := game.bj_total(v_hand.cards);
    if v_hand.status = 'bust' then
      v_result := 'lose';
      v_payout := 0;
    elsif v_hand.status = 'blackjack' then
      v_result := case when v_dealer_blackjack then 'push' else 'blackjack' end;
      v_payout := case when v_dealer_blackjack then v_hand.bet else v_hand.bet * 5 / 2 end;
    elsif v_dealer_blackjack then
      v_result := 'lose';
      v_payout := 0;
    elsif v_dealer_total > 21 or v_total > v_dealer_total then
      v_result := 'win';
      v_payout := v_hand.bet * 2;
    elsif v_total = v_dealer_total then
      v_result := 'push';
      v_payout := v_hand.bet;
    else
      v_result := 'lose';
      v_payout := 0;
    end if;

    insert into game.rounds (wallet, game, bet, choice, outcome, payout, server_seed_hash, client_seed, nonce, odds_bps, detail)
    values (v_hand.wallet, 'blackjack', v_hand.bet, v_total, v_dealer_total, v_payout, v_round.server_seed_hash, v_round.client_seed,
            p_round::integer, case when v_payout > 0 then (v_payout * 10000 / v_hand.bet)::integer end,
            jsonb_build_object('table', v_round.table_id, 'seat', v_hand.seat, 'part', v_hand.part, 'result', v_result,
                               'cards', (select jsonb_agg(c % 52 order by o) from unnest(v_hand.cards) with ordinality x(c, o)),
                               'dealer', (select jsonb_agg(c % 52 order by o) from unnest(v_dealer) with ordinality d(c, o)),
                               'doubled', v_hand.doubled, 'split', v_hand.split))
    returning id into v_history;
    if v_payout > 0 then
      perform game.apply_delta(v_hand.wallet, v_payout, 'win', 'blackjack-' || v_hand.id);
    end if;
    update game.bj_hands set result = v_result, payout = v_payout, history_id = v_history where id = v_hand.id;
  end loop;

  update game.bj_rounds
  set status = 'done', dealer_cards = v_dealer, turn_hand = null, turn_deadline = null, finished_at = now()
  where id = p_round;
  perform game.bj_open_round(v_round.table_id);
end;
$$;

-- The next hand to move, or the dealer when every hand is done.
create function game.bj_advance(p_round bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next bigint;
begin
  select id into v_next from game.bj_hands where round_id = p_round and status = 'playing' order by seat, part limit 1;
  if v_next is null then
    perform game.bj_finish(p_round);
  else
    update game.bj_rounds set turn_hand = v_next, turn_deadline = now() + interval '20 seconds' where id = p_round;
  end if;
end;
$$;

-- The deal: bets are taken, the shoe is shuffled from the server seed and every player's client seed, two cards each.
create function game.bj_deal(p_round bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round game.bj_rounds;
  v_seat game.bj_seats;
  v_hand bigint;
  v_client_seed text;
  v_pass integer;
  v_up integer;
begin
  select * into v_round from game.bj_rounds where id = p_round;
  -- Balances may not move under the deal: lock the players' accounts in a fixed order.
  perform 1 from game.accounts a
  where a.wallet in (select s.wallet from game.bj_seats s where s.table_id = v_round.table_id and s.bet is not null)
  order by a.wallet for update;
  -- A bet the balance cannot cover is dropped.
  update game.bj_seats s set bet = null
  from game.accounts a
  where s.table_id = v_round.table_id and s.bet is not null and a.wallet = s.wallet and a.balance < s.bet;

  if (select count(*) from game.bj_seats where table_id = v_round.table_id and bet is not null) < 2 then
    update game.bj_rounds set starts_at = null where id = p_round;
    return;
  end if;

  for v_seat in select * from game.bj_seats where table_id = v_round.table_id and bet is not null order by seat loop
    perform game.ensure_seed(v_seat.wallet);
    insert into game.bj_hands (round_id, seat, wallet, name, bet) values (p_round, v_seat.seat, v_seat.wallet, v_seat.name, v_seat.bet)
    returning id into v_hand;
    perform game.apply_delta(v_seat.wallet, -v_seat.bet, 'round', 'blackjack-' || v_hand);
  end loop;
  update game.bj_seats set bet = null where table_id = v_round.table_id;

  select string_agg(sd.client_seed, '|' order by h.seat) into v_client_seed
  from game.bj_hands h join game.seeds sd on sd.wallet = h.wallet
  where h.round_id = p_round;
  update game.bj_rounds
  set status = 'playing', starts_at = null, client_seed = v_client_seed, dealt_at = now(), next_card = 0,
      shoe = game.bj_shoe(v_round.server_seed, v_client_seed, p_round)
  where id = p_round;

  -- One card to each player, one to the dealer, then the second round of cards.
  for v_pass in 1..2 loop
    for v_hand in select id from game.bj_hands where round_id = p_round order by seat loop
      update game.bj_hands set cards = cards || game.bj_draw(p_round) where id = v_hand;
    end loop;
    update game.bj_rounds set dealer_cards = dealer_cards || game.bj_draw(p_round) where id = p_round;
  end loop;
  update game.bj_hands set status = 'blackjack' where round_id = p_round and game.bj_total(cards) = 21;

  -- The dealer peeks under a ten or an ace: a dealer blackjack ends the round at once.
  select game.bj_value(dealer_cards[1]) into v_up from game.bj_rounds where id = p_round;
  if v_up >= 10 and (select game.bj_total(dealer_cards) from game.bj_rounds where id = p_round) = 21 then
    perform game.bj_finish(p_round);
  else
    perform game.bj_advance(p_round);
  end if;
end;
$$;

-- Applies whatever is due at a table: idle seats leave, the countdown starts or the deal happens, a turn runs out.
-- The caller holds the table's lock. Returns whether anything changed.
create function game.bj_step(p_table integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round game.bj_rounds;
  v_ready integer;
  v_changed boolean := false;
begin
  -- Seats nobody has looked at for two minutes are freed (a hand being played keeps its seat).
  delete from game.bj_seats s
  where s.table_id = p_table and s.last_seen < now() - interval '2 minutes'
    and not exists (select 1 from game.bj_hands h join game.bj_rounds r on r.id = h.round_id
                    where r.table_id = p_table and r.status = 'playing' and h.wallet = s.wallet);
  if found then
    v_changed := true;
  end if;

  select * into v_round from game.bj_rounds where table_id = p_table and status <> 'done';
  if v_round.id is null then
    perform game.bj_open_round(p_table);
    return true;
  end if;

  if v_round.status = 'betting' then
    select count(*) into v_ready from game.bj_seats where table_id = p_table and bet is not null;
    if v_ready >= 2 and v_round.starts_at is null then
      update game.bj_rounds set starts_at = now() + interval '15 seconds' where id = v_round.id;
      v_changed := true;
    elsif v_ready < 2 and v_round.starts_at is not null then
      update game.bj_rounds set starts_at = null where id = v_round.id;
      v_changed := true;
    elsif v_ready >= 2 and v_round.starts_at <= now() then
      perform game.bj_deal(v_round.id);
      v_changed := true;
    end if;
  elsif v_round.status = 'playing' and v_round.turn_deadline <= now() then
    update game.bj_hands set status = 'stood' where id = v_round.turn_hand and status = 'playing';
    perform game.bj_advance(v_round.id);
    v_changed := true;
  end if;
  return v_changed;
end;
$$;

-- Locks a table for one request (every change to a table goes through this lock).
create function game.bj_lock(p_table integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from game.bj_tables where id = p_table for update;
  if not found then
    raise exception 'table_not_found';
  end if;
end;
$$;

-- The table as one player sees it: the public view, their seat and their balance.
create function game.bj_you(p_table integer, p_wallet text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select game.bj_view(p_table) || jsonb_build_object('you', jsonb_build_object(
    'seat', (select s.seat from game.bj_seats s where s.table_id = p_table and s.wallet = p_wallet),
    'table', (select s.table_id from game.bj_seats s where s.wallet = p_wallet),
    'hands', coalesce((select jsonb_agg(h.id) from game.bj_hands h
                       where h.wallet = p_wallet
                         and h.round_id in (select r.id from game.bj_rounds r where r.table_id = p_table order by r.id desc limit 3)), '[]'::jsonb),
    'balance', coalesce((select a.balance from game.accounts a where a.wallet = p_wallet), 0)));
$$;

-- A player looks at a table: their seat stays theirs, due deadlines are applied.
create function game.bj_enter(p_table integer, p_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform game.bj_lock(p_table);
  update game.bj_seats set last_seen = now() where wallet = p_wallet;
  if game.bj_step(p_table) then
    perform game.bj_publish(p_table);
  end if;
  return game.bj_you(p_table, p_wallet);
end;
$$;

-- Applies due deadlines at a table (called by the players' browsers when a countdown ends, and by the scheduled tick).
create function game.bj_tick(p_table integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform game.bj_lock(p_table);
  if game.bj_step(p_table) then
    perform game.bj_publish(p_table);
  end if;
end;
$$;

create function game.bj_tick_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table integer;
  v_count integer := 0;
begin
  for v_table in select id from game.bj_tables order by id loop
    perform game.bj_tick(v_table);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Takes a seat. A wallet sits at one seat only: taking another leaves the old one. The next table opens
-- when every table is full.
create function game.bj_sit(p_table integer, p_seat integer, p_wallet text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_game game.games;
  v_old integer;
begin
  select * into v_settings from game.settings;
  select * into v_game from game.games where id = 'blackjack';
  if not v_settings.enabled or v_game.id is null or not v_game.enabled then
    raise exception 'game_disabled';
  end if;
  if p_seat is null or p_seat not between 1 and 7 or p_name is null or char_length(p_name) not between 1 and 32 then
    raise exception 'invalid_request';
  end if;
  if not exists (select 1 from game.bj_tables where id = p_table) then
    if p_table = (select max(id) + 1 from game.bj_tables)
       and not exists (select 1 from game.bj_tables t where (select count(*) from game.bj_seats s where s.table_id = t.id) < 7) then
      insert into game.bj_tables (id, name) values (p_table, 'Table ' || p_table) on conflict do nothing;
    else
      raise exception 'table_not_found';
    end if;
  end if;
  perform game.bj_lock(p_table);
  perform game.ensure_seed(p_wallet);

  select table_id into v_old from game.bj_seats where wallet = p_wallet;
  if v_old is not null and v_old <> p_table then
    perform game.bj_lock(v_old);
  end if;
  if exists (select 1 from game.bj_seats where table_id = p_table and seat = p_seat and wallet <> p_wallet) then
    raise exception 'seat_taken';
  end if;
  delete from game.bj_seats where wallet = p_wallet;
  insert into game.bj_seats (table_id, seat, wallet, name) values (p_table, p_seat, p_wallet, p_name);
  perform game.bj_step(p_table);
  perform game.bj_publish(p_table);
  if v_old is not null and v_old <> p_table then
    perform game.bj_publish(v_old);
  end if;
  return game.bj_you(p_table, p_wallet);
end;
$$;

create function game.bj_leave(p_table integer, p_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform game.bj_lock(p_table);
  delete from game.bj_seats where table_id = p_table and wallet = p_wallet;
  perform game.bj_step(p_table);
  perform game.bj_publish(p_table);
  return game.bj_you(p_table, p_wallet);
end;
$$;

-- Sets (or with null clears) the player's bet for the next deal. Nothing is taken before the deal.
create function game.bj_bet(p_table integer, p_wallet text, p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_status text;
begin
  select * into v_settings from game.settings;
  perform game.bj_lock(p_table);
  perform game.bj_step(p_table);
  if not exists (select 1 from game.bj_seats where table_id = p_table and wallet = p_wallet) then
    raise exception 'not_seated';
  end if;
  select status into v_status from game.bj_rounds where table_id = p_table and status <> 'done';
  if v_status is distinct from 'betting' then
    raise exception 'round_running';
  end if;
  if p_bet is not null then
    if p_bet < v_settings.min_bet or p_bet > v_settings.max_bet or p_bet % v_settings.bet_step <> 0 then
      raise exception 'invalid_bet';
    end if;
    if coalesce((select balance from game.accounts where wallet = p_wallet), 0) < p_bet then
      raise exception 'insufficient_balance';
    end if;
  end if;
  update game.bj_seats set bet = p_bet, last_seen = now() where table_id = p_table and wallet = p_wallet;
  perform game.bj_step(p_table);
  perform game.bj_publish(p_table);
  return game.bj_you(p_table, p_wallet);
end;
$$;

-- A decision on the hand whose turn it is: hit, stand, double or split.
create function game.bj_act(p_table integer, p_wallet text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round game.bj_rounds;
  v_hand game.bj_hands;
  v_total integer;
  v_second bigint;
  v_aces boolean;
begin
  perform game.bj_lock(p_table);
  perform game.bj_step(p_table);
  update game.bj_seats set last_seen = now() where wallet = p_wallet;
  select * into v_round from game.bj_rounds where table_id = p_table and status = 'playing';
  if v_round.id is null then
    raise exception 'round_not_open';
  end if;
  select * into v_hand from game.bj_hands where id = v_round.turn_hand;
  if v_hand.wallet is distinct from p_wallet or v_hand.status <> 'playing' then
    raise exception 'not_your_turn';
  end if;

  if p_action = 'hit' then
    update game.bj_hands set cards = cards || game.bj_draw(v_round.id) where id = v_hand.id returning * into v_hand;
    v_total := game.bj_total(v_hand.cards);
    if v_total > 21 then
      update game.bj_hands set status = 'bust' where id = v_hand.id;
      perform game.bj_advance(v_round.id);
    elsif v_total = 21 then
      update game.bj_hands set status = 'stood' where id = v_hand.id;
      perform game.bj_advance(v_round.id);
    else
      update game.bj_rounds set turn_deadline = now() + interval '20 seconds' where id = v_round.id;
    end if;

  elsif p_action = 'stand' then
    update game.bj_hands set status = 'stood' where id = v_hand.id;
    perform game.bj_advance(v_round.id);

  elsif p_action = 'double' then
    if cardinality(v_hand.cards) <> 2 then
      raise exception 'invalid_choice';
    end if;
    perform game.apply_delta(p_wallet, -v_hand.bet, 'round', 'blackjack-' || v_hand.id || '-double');
    update game.bj_hands set bet = bet * 2, doubled = true, cards = cards || game.bj_draw(v_round.id)
    where id = v_hand.id returning * into v_hand;
    update game.bj_hands set status = case when game.bj_total(cards) > 21 then 'bust' else 'stood' end where id = v_hand.id;
    perform game.bj_advance(v_round.id);

  elsif p_action = 'split' then
    if cardinality(v_hand.cards) <> 2 or v_hand.split or game.bj_value(v_hand.cards[1]) <> game.bj_value(v_hand.cards[2]) then
      raise exception 'invalid_choice';
    end if;
    v_aces := v_hand.cards[1] % 52 % 13 = 0;
    insert into game.bj_hands (round_id, seat, part, wallet, name, bet, cards, split)
    values (v_round.id, v_hand.seat, 1, v_hand.wallet, v_hand.name, v_hand.bet, array[v_hand.cards[2]], true)
    returning id into v_second;
    perform game.apply_delta(p_wallet, -v_hand.bet, 'round', 'blackjack-' || v_second);
    update game.bj_hands set cards = array[cards[1]] || game.bj_draw(v_round.id), split = true where id = v_hand.id;
    update game.bj_hands set cards = cards || game.bj_draw(v_round.id) where id = v_second;
    -- Split aces take one card each; a split hand of 21 is not a blackjack, it simply stands.
    update game.bj_hands set status = 'stood'
    where id in (v_hand.id, v_second) and (v_aces or game.bj_total(cards) = 21);
    if (select status from game.bj_hands where id = v_hand.id) = 'playing' then
      update game.bj_rounds set turn_deadline = now() + interval '20 seconds' where id = v_round.id;
    else
      perform game.bj_advance(v_round.id);
    end if;

  else
    raise exception 'invalid_choice';
  end if;

  perform game.bj_publish(p_table);
  return game.bj_you(p_table, p_wallet);
end;
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'game.bj_enter(integer, text)', 'game.bj_tick(integer)', 'game.bj_tick_all()', 'game.bj_sit(integer, integer, text, text)',
    'game.bj_leave(integer, text)', 'game.bj_bet(integer, text, bigint)', 'game.bj_act(integer, text, text)', 'game.bj_view(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
    execute format('grant execute on function %s to game_api', v_function);
  end loop;
  foreach v_function in array array[
    'game.bj_value(smallint)', 'game.bj_total(smallint[])', 'game.bj_shoe(bytea, text, bigint)', 'game.bj_draw(bigint)',
    'game.bj_publish(integer)', 'game.bj_open_round(integer)', 'game.bj_finish(bigint)', 'game.bj_advance(bigint)',
    'game.bj_deal(bigint)', 'game.bj_step(integer)', 'game.bj_lock(integer)', 'game.bj_you(integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
  end loop;
end;
$$;

select game.bj_open_round(1);
