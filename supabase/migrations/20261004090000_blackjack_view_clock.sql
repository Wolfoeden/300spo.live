-- A table's state carries the time it was read (clock_timestamp, not the transaction's start), so a
-- page can tell which of two states is newer and never replaces a newer one with an older one.

create or replace function game.bj_view(p_table integer)
returns jsonb
language sql
volatile -- clock_timestamp()
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
    -- The moment this state was read: pages keep the newest one when answers and pushes cross.
    'now', clock_timestamp(),
    'bets', (select jsonb_build_object('min', s.min_bet, 'max', s.max_bet, 'step', s.bet_step) from game.settings s),
    'seats', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'name', s.name, 'bet', s.bet,
                         -- Only whether the player is a high roller leaves the server, never the balance.
                         'highRoller', coalesce((select a.balance > 1000000 from game.accounts a where a.wallet = s.wallet), false)) order by s.seat)
                       from game.bj_seats s where s.table_id = p_table), '[]'::jsonb),
    'tables', (select jsonb_agg(jsonb_build_object('id', t.id, 'seated', (select count(*) from game.bj_seats s where s.table_id = t.id)) order by t.id)
               from game.bj_tables t),
    'round', (select j.body from round_json j where j.id = (select id from current_round)),
    'last', (select j.body from round_json j where j.id = (select id from last_round) and j.id <> (select id from current_round))
  );
$$;
