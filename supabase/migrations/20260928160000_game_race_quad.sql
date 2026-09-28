-- Four horse races at once (like the "Pharao" machine): the player sees four
-- deals (the wallet's next four nonces), picks an ace on any of them and plays
-- them in one transaction with the same bet each. Deals without a pick use up
-- their nonce without a bet. Each played race is an ordinary card-race round,
-- so the fairness check is unchanged.
--
-- "Xerxes vs AI robot" is marked coming soon on /play and closed here too.

update game.games set enabled = false where id = 'xerxes-vs-robot';

create function game.race_previews(p_wallet text, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed game.seeds;
  v_deck integer[];
  v_deals jsonb := '[]'::jsonb;
  v_index integer;
begin
  if p_count < 1 or p_count > 4 then
    raise exception 'invalid_request';
  end if;
  perform game.ensure_seed(p_wallet);
  select * into v_seed from game.seeds where wallet = p_wallet;
  for v_index in 1..p_count loop
    v_deck := game.race_deck(v_seed.server_seed, v_seed.client_seed, v_seed.nonce + v_index);
    v_deals := v_deals || jsonb_build_array(jsonb_build_object('track', to_jsonb(v_deck[1:7]), 'odds', to_jsonb(game.race_odds_for(v_deck))));
  end loop;
  return jsonb_build_object('nonce', v_seed.nonce + 1, 'serverSeedHash', v_seed.server_seed_hash, 'deals', v_deals);
end;
$$;

-- p_choices: one entry per deal shown, the picked suit (0–3) or -1 to skip it.
-- p_nonce / p_server_seed_hash identify the deals the player saw.
create function game.play_race_multi(p_wallet text, p_bet bigint, p_choices integer[], p_nonce integer, p_server_seed_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_game game.games;
  v_seed game.seeds;
  v_count integer := coalesce(cardinality(p_choices), 0);
  v_picked integer := 0;
  v_choice integer;
  v_index integer;
  v_nonce integer;
  v_deck integer[];
  v_odds integer[];
  v_race jsonb;
  v_winner integer;
  v_payout bigint;
  v_round bigint;
  v_results jsonb := '[]'::jsonb;
begin
  select * into v_settings from game.settings;
  select * into v_game from game.games where id = 'card-race';
  if not v_settings.enabled or v_game.id is null or not v_game.enabled then
    raise exception 'game_disabled';
  end if;
  if p_bet < v_settings.min_bet or p_bet > v_settings.max_bet or p_bet % v_settings.bet_step <> 0 then
    raise exception 'invalid_bet';
  end if;
  if v_count < 1 or v_count > 4 then
    raise exception 'invalid_choice';
  end if;
  foreach v_choice in array p_choices loop
    if v_choice is null or v_choice < -1 or v_choice > 3 then
      raise exception 'invalid_choice';
    end if;
    if v_choice >= 0 then
      v_picked := v_picked + 1;
    end if;
  end loop;
  if v_picked = 0 then
    raise exception 'invalid_choice';
  end if;

  perform game.ensure_seed(p_wallet);
  select * into v_seed from game.seeds where wallet = p_wallet for update;
  if p_nonce is distinct from v_seed.nonce + 1 or p_server_seed_hash is distinct from v_seed.server_seed_hash then
    raise exception 'race_changed';
  end if;
  -- The whole stake must be there up front; winnings of one race never fund another.
  if coalesce((select balance from game.accounts where wallet = p_wallet), 0) < p_bet * v_picked then
    raise exception 'insufficient_balance';
  end if;
  update game.seeds set nonce = v_seed.nonce + v_count where wallet = p_wallet;

  for v_index in 1..v_count loop
    v_choice := p_choices[v_index];
    if v_choice < 0 then
      v_results := v_results || jsonb_build_array(null);
      continue;
    end if;
    v_nonce := v_seed.nonce + v_index;
    v_deck := game.race_deck(v_seed.server_seed, v_seed.client_seed, v_nonce);
    v_odds := game.race_odds_for(v_deck);
    if v_odds[v_choice + 1] = 0 then
      raise exception 'invalid_choice';
    end if;
    v_race := game.race_run(v_deck);
    v_winner := (v_race ->> 'winner')::integer;
    v_payout := case when v_winner = v_choice then p_bet * v_odds[v_choice + 1] / 10000 else 0 end;

    insert into game.rounds (wallet, game, bet, choice, outcome, payout, server_seed_hash, client_seed, nonce, odds_bps)
    values (p_wallet, 'card-race', p_bet, v_choice, v_winner, v_payout, v_seed.server_seed_hash, v_seed.client_seed, v_nonce, v_odds[v_choice + 1])
    returning id into v_round;
    perform game.apply_delta(p_wallet, -p_bet, 'round', v_round::text);
    if v_payout > 0 then
      perform game.apply_delta(p_wallet, v_payout, 'win', v_round::text);
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'roundId', v_round, 'game', 'card-race', 'bet', p_bet, 'choice', v_choice, 'outcome', v_winner,
      'win', v_payout > 0, 'payout', v_payout, 'nonce', v_nonce,
      'race', jsonb_build_object('track', to_jsonb(v_deck[1:7]), 'draws', to_jsonb(v_deck[8:7 + (v_race ->> 'draws')::integer]),
                                 'odds', to_jsonb(v_odds))));
  end loop;

  return jsonb_build_object('results', v_results,
    'balance', (select balance from game.accounts where wallet = p_wallet),
    'serverSeedHash', v_seed.server_seed_hash, 'clientSeed', v_seed.client_seed);
end;
$$;

revoke all on function game.race_previews(text, integer) from public, anon, authenticated;
revoke all on function game.play_race_multi(text, bigint, integer[], integer, text) from public, anon, authenticated;
grant execute on function game.race_previews(text, integer), game.play_race_multi(text, bigint, integer[], integer, text) to game_api;
