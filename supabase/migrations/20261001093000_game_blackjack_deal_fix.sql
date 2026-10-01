-- The deal drew the dealer card while updating the same round row; the card is drawn first now.

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
