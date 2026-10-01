-- One account may take several seats at a table (Roman, 1 October 2026) and
-- play a hand on each. A round still needs two different players with a bet;
-- sitting at another table leaves the seats at the first one.

drop index game.bj_seats_wallet_key;
create index bj_seats_wallet_idx on game.bj_seats (wallet);

-- Players with a bet for the next deal: wallets, not seats.
create or replace function game.bj_step(p_table integer)
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
    select count(distinct wallet) into v_ready from game.bj_seats where table_id = p_table and bet is not null;
    if v_ready >= 2 and v_round.starts_at is null then
      update game.bj_rounds set starts_at = now() + interval '10 seconds' where id = v_round.id;
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

-- The deal: a player's bets on all their seats together must fit their balance.
create or replace function game.bj_deal(p_round bigint)
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
  v_card smallint;
begin
  select * into v_round from game.bj_rounds where id = p_round;
  -- Balances may not move under the deal: lock the players' accounts in a fixed order.
  perform 1 from game.accounts a
  where a.wallet in (select s.wallet from game.bj_seats s where s.table_id = v_round.table_id and s.bet is not null)
  order by a.wallet for update;
  -- Bets the balance cannot cover all together are dropped (all of that player's).
  update game.bj_seats s set bet = null
  where s.table_id = v_round.table_id and s.bet is not null
    and (select sum(o.bet) from game.bj_seats o where o.table_id = s.table_id and o.wallet = s.wallet)
        > (select a.balance from game.accounts a where a.wallet = s.wallet);

  if (select count(distinct wallet) from game.bj_seats where table_id = v_round.table_id and bet is not null) < 2 then
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

  -- Every hand's player's client seed, in seat order (a player with two seats appears twice).
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
    -- Drawn first: the draw itself moves the shoe on in the same row.
    v_card := game.bj_draw(p_round);
    update game.bj_rounds set dealer_cards = dealer_cards || v_card where id = p_round;
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

-- The player's place at the table: all their seats ('seat' is the first, for older pages).
create or replace function game.bj_you(p_table integer, p_wallet text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select game.bj_view(p_table) || jsonb_build_object('you', jsonb_build_object(
    'seat', (select min(s.seat) from game.bj_seats s where s.table_id = p_table and s.wallet = p_wallet),
    'seats', coalesce((select jsonb_agg(s.seat order by s.seat) from game.bj_seats s where s.table_id = p_table and s.wallet = p_wallet), '[]'::jsonb),
    'table', (select min(s.table_id) from game.bj_seats s where s.wallet = p_wallet),
    'hands', coalesce((select jsonb_agg(h.id) from game.bj_hands h
                       where h.wallet = p_wallet
                         and h.round_id in (select r.id from game.bj_rounds r where r.table_id = p_table order by r.id desc limit 3)), '[]'::jsonb),
    'balance', coalesce((select a.balance from game.accounts a where a.wallet = p_wallet), 0)));
$$;

-- Takes a seat; seats the player already has at this table stay theirs, seats at another table are left.
create or replace function game.bj_sit(p_table integer, p_seat integer, p_wallet text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_game game.games;
  v_old integer;
  v_holder text;
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

  select min(table_id) into v_old from game.bj_seats where wallet = p_wallet and table_id <> p_table;
  if v_old is not null then
    perform game.bj_lock(v_old);
    delete from game.bj_seats where wallet = p_wallet and table_id <> p_table;
  end if;
  select wallet into v_holder from game.bj_seats where table_id = p_table and seat = p_seat;
  if v_holder is not null and v_holder <> p_wallet then
    raise exception 'seat_taken';
  end if;
  if v_holder is null then
    insert into game.bj_seats (table_id, seat, wallet, name) values (p_table, p_seat, p_wallet, p_name);
  end if;
  update game.bj_seats set last_seen = now() where wallet = p_wallet;
  perform game.bj_step(p_table);
  perform game.bj_publish(p_table);
  if v_old is not null then
    perform game.bj_publish(v_old);
  end if;
  return game.bj_you(p_table, p_wallet);
end;
$$;

-- Leaves one seat, or (without a seat) every seat at the table.
drop function game.bj_leave(integer, text);
create function game.bj_leave(p_table integer, p_wallet text, p_seat integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform game.bj_lock(p_table);
  delete from game.bj_seats where table_id = p_table and wallet = p_wallet and (p_seat is null or seat = p_seat);
  perform game.bj_step(p_table);
  perform game.bj_publish(p_table);
  return game.bj_you(p_table, p_wallet);
end;
$$;

-- Sets (or with null clears) the bet for the next deal on one seat, or (without a seat) on every seat of the
-- player at the table. Nothing is taken before the deal, but all the player's bets together must fit the balance.
drop function game.bj_bet(integer, text, bigint);
create function game.bj_bet(p_table integer, p_wallet text, p_bet bigint, p_seat integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_status text;
  v_total bigint;
begin
  select * into v_settings from game.settings;
  perform game.bj_lock(p_table);
  perform game.bj_step(p_table);
  if not exists (select 1 from game.bj_seats where table_id = p_table and wallet = p_wallet and (p_seat is null or seat = p_seat)) then
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
    select coalesce(sum(case when p_seat is null or seat = p_seat then p_bet else coalesce(bet, 0) end), 0) into v_total
    from game.bj_seats where table_id = p_table and wallet = p_wallet;
    if coalesce((select balance from game.accounts where wallet = p_wallet), 0) < v_total then
      raise exception 'insufficient_balance';
    end if;
  end if;
  update game.bj_seats set bet = p_bet, last_seen = now()
  where table_id = p_table and wallet = p_wallet and (p_seat is null or seat = p_seat);
  perform game.bj_step(p_table);
  perform game.bj_publish(p_table);
  return game.bj_you(p_table, p_wallet);
end;
$$;

revoke all on function game.bj_leave(integer, text, integer) from public, anon, authenticated;
grant execute on function game.bj_leave(integer, text, integer) to game_api;
revoke all on function game.bj_bet(integer, text, bigint, integer) from public, anon, authenticated;
grant execute on function game.bj_bet(integer, text, bigint, integer) to game_api;
