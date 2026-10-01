-- The countdown to the deal is 10 seconds after the second bet (Roman, 1 October 2026), was 15.

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
    select count(*) into v_ready from game.bj_seats where table_id = p_table and bet is not null;
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
