-- The next hand opens with its countdown already running when two players are ready, so the pages have a
-- deadline to come back at (before, the countdown only started with the next request to the table).
create or replace function game.pk_open_hand(p_table integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into game.pk_hands (table_id, server_seed, server_seed_hash, starts_at)
  select p_table, s.seed, encode(extensions.digest(s.seed, 'sha256'), 'hex'),
         -- Time to look at the last showdown.
         case when (select count(*) from game.pk_seats t where t.table_id = p_table and not t.sitting_out and t.stack > 0) >= 2
              then now() + interval '8 seconds' end
  from (select extensions.gen_random_bytes(32) as seed) s
  on conflict do nothing;
$$;
