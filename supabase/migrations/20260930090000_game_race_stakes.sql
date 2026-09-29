-- Chips on lanes: the player may stake any lanes of a race, each with its own
-- amount (bet rules apply per lane: min bet to max bet in bet steps). Every
-- staked lane is an ordinary card-race round on that race's nonce, so a race
-- with two chips gives two rounds with the same outcome and the fairness
-- check is unchanged. Races without a chip use up their nonce without a bet,
-- as in play_race_multi.

-- p_stakes: four amounts per race shown (♠ ♥ ♦ ♣), 0 for no chip.
-- p_nonce / p_server_seed_hash identify the races the player saw (race_previews).
create function game.play_race_stakes(p_wallet text, p_stakes bigint[], p_nonce integer, p_server_seed_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_game game.games;
  v_seed game.seeds;
  v_size integer := coalesce(cardinality(p_stakes), 0);
  v_count integer;
  v_total bigint := 0;
  v_stake bigint;
  v_board integer;
  v_suit integer;
  v_nonce integer;
  v_deck integer[];
  v_odds integer[];
  v_race jsonb;
  v_winner integer;
  v_payout bigint;
  v_round bigint;
  v_rounds jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  select * into v_settings from game.settings;
  select * into v_game from game.games where id = 'card-race';
  if not v_settings.enabled or v_game.id is null or not v_game.enabled then
    raise exception 'game_disabled';
  end if;
  if v_size < 4 or v_size > 16 or v_size % 4 <> 0 then
    raise exception 'invalid_choice';
  end if;
  v_count := v_size / 4;
  foreach v_stake in array p_stakes loop
    if v_stake is null or v_stake < 0 then
      raise exception 'invalid_bet';
    end if;
    if v_stake > 0 and (v_stake < v_settings.min_bet or v_stake > v_settings.max_bet or v_stake % v_settings.bet_step <> 0) then
      raise exception 'invalid_bet';
    end if;
    v_total := v_total + v_stake;
  end loop;
  if v_total = 0 then
    raise exception 'invalid_choice';
  end if;

  perform game.ensure_seed(p_wallet);
  select * into v_seed from game.seeds where wallet = p_wallet for update;
  if p_nonce is distinct from v_seed.nonce + 1 or p_server_seed_hash is distinct from v_seed.server_seed_hash then
    raise exception 'race_changed';
  end if;
  -- The whole stake must be there up front; winnings of one lane never fund another.
  if coalesce((select balance from game.accounts where wallet = p_wallet), 0) < v_total then
    raise exception 'insufficient_balance';
  end if;
  update game.seeds set nonce = v_seed.nonce + v_count where wallet = p_wallet;

  for v_board in 0..v_count - 1 loop
    if p_stakes[v_board * 4 + 1] + p_stakes[v_board * 4 + 2] + p_stakes[v_board * 4 + 3] + p_stakes[v_board * 4 + 4] = 0 then
      v_results := v_results || jsonb_build_array(null);
      continue;
    end if;
    v_nonce := v_seed.nonce + v_board + 1;
    v_deck := game.race_deck(v_seed.server_seed, v_seed.client_seed, v_nonce);
    v_odds := game.race_odds_for(v_deck);
    v_race := game.race_run(v_deck);
    v_winner := (v_race ->> 'winner')::integer;
    v_rounds := '[]'::jsonb;

    for v_suit in 0..3 loop
      v_stake := p_stakes[v_board * 4 + v_suit + 1];
      continue when v_stake = 0;
      if v_odds[v_suit + 1] = 0 then
        raise exception 'invalid_choice';
      end if;
      v_payout := case when v_winner = v_suit then v_stake * v_odds[v_suit + 1] / 10000 else 0 end;
      insert into game.rounds (wallet, game, bet, choice, outcome, payout, server_seed_hash, client_seed, nonce, odds_bps)
      values (p_wallet, 'card-race', v_stake, v_suit, v_winner, v_payout, v_seed.server_seed_hash, v_seed.client_seed, v_nonce, v_odds[v_suit + 1])
      returning id into v_round;
      perform game.apply_delta(p_wallet, -v_stake, 'round', v_round::text);
      if v_payout > 0 then
        perform game.apply_delta(p_wallet, v_payout, 'win', v_round::text);
      end if;
      v_rounds := v_rounds || jsonb_build_array(jsonb_build_object(
        'roundId', v_round, 'choice', v_suit, 'bet', v_stake, 'win', v_payout > 0, 'payout', v_payout));
    end loop;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'outcome', v_winner, 'nonce', v_nonce, 'rounds', v_rounds,
      'race', jsonb_build_object('track', to_jsonb(v_deck[1:7]), 'draws', to_jsonb(v_deck[8:7 + (v_race ->> 'draws')::integer]),
                                 'odds', to_jsonb(v_odds))));
  end loop;

  return jsonb_build_object('results', v_results,
    'balance', (select balance from game.accounts where wallet = p_wallet),
    'serverSeedHash', v_seed.server_seed_hash, 'clientSeed', v_seed.client_seed);
end;
$$;

revoke all on function game.play_race_stakes(text, bigint[], integer, text) from public, anon, authenticated;
grant execute on function game.play_race_stakes(text, bigint[], integer, text) to game_api;
