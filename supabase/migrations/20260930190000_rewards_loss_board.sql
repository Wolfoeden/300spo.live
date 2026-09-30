-- The rewards page (Roman, 30 September 2026): a public board of what every
-- player has lost in 300 Games, and a curtain that opens when a countdown
-- reaches `reveal_at`.
--
-- A player's loss is what went in minus what came back over all finished
-- rounds (open Chicken rounds count once they end); players who are ahead are
-- not listed. Only rounds before the start of the current UTC day count, so
-- the board moves once every 24 hours.

create table game.rewards_settings (
  id boolean primary key default true check (id),
  reveal_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into game.rewards_settings default values;
alter table game.rewards_settings enable row level security;

create function game.loss_board(p_limit integer)
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
    select r.wallet, sum(r.bet) - sum(r.payout) as lost, count(*) as rounds
    from game.rounds r, cutoff c
    where r.created_at < c.at
    group by r.wallet
    having sum(r.bet) - sum(r.payout) > 0
  )
  select jsonb_build_object(
    'asOf', c.at,
    'nextAt', c.at + interval '1 day',
    'revealAt', (select s.reveal_at from game.rewards_settings s),
    'total', coalesce((select sum(p.lost) from players p), 0),
    'players', (select count(*) from players),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('wallet', top.wallet, 'lost', top.lost, 'rounds', top.rounds) order by top.lost desc, top.wallet)
      from (select * from players order by lost desc, wallet limit greatest(1, least(p_limit, 500))) top
    ), '[]'::jsonb)
  )
  from cutoff c;
$$;

revoke all on function game.loss_board(integer) from public, anon, authenticated;
grant execute on function game.loss_board(integer) to game_api;
