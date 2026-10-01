-- Rewards page, second pass (Roman, 30 September 2026): what a player lost is
-- now every stake that did not come back, round by round (a lane that loses
-- counts in full, a winning lane counts nothing), so everyone who ever lost a
-- round is listed, starting credit included. The jackpot is the same sum over
-- every player, live; the board itself still counts up to 00:00 UTC.

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
    where r.created_at < c.at
    group by r.wallet
    having sum(greatest(r.bet - r.payout, 0)) > 0
  )
  select jsonb_build_object(
    'asOf', c.at,
    'nextAt', c.at + interval '1 day',
    'revealAt', (select s.reveal_at from game.rewards_settings s),
    'jackpot', (select coalesce(sum(greatest(r.bet - r.payout, 0)), 0) from game.rounds r),
    'total', coalesce((select sum(p.lost) from players p), 0),
    'players', (select count(*) from players),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('wallet', top.wallet, 'lost', top.lost, 'rounds', top.rounds) order by top.lost desc, top.wallet)
      from (select * from players order by lost desc, wallet limit greatest(1, least(p_limit, 500))) top
    ), '[]'::jsonb)
  )
  from cutoff c;
$$;
