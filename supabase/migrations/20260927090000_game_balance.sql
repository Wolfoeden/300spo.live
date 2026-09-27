-- Game balance for 300spo.live: players deposit 300 tokens to a treasury
-- address and spend them on game rounds. There are no winnings and no
-- withdrawals. Only the SECURITY DEFINER functions below touch the tables;
-- the Netlify functions connect as `game_api`, which may execute nothing else.

create schema game;
revoke all on schema game from public;

create table game.settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  round_cost bigint not null default 300 check (round_cost > 0),
  min_deposit bigint not null default 300 check (min_deposit > 0),
  treasury_address text check (treasury_address ~ '^addr1[02-9ac-hj-np-z]{50,120}$'),
  scanned_block_height bigint not null default 0 check (scanned_block_height >= 0),
  updated_at timestamptz not null default now()
);
insert into game.settings default values;

-- `wallet` is the identity proven by the wallet sign-in: a stake address, or a
-- payment address for wallets that refuse to sign with their stake key.
create table game.accounts (
  wallet text primary key check (wallet ~ '^(stake1|addr1)[02-9ac-hj-np-z]{50,120}$'),
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table game.deposits (
  id bigint generated always as identity primary key,
  reference uuid not null default gen_random_uuid() unique,
  wallet text not null references game.accounts (wallet),
  requested bigint not null check (requested > 0),
  tx_hash text unique check (tx_hash ~ '^[0-9a-f]{64}$'),
  received bigint check (received >= 0),
  status text not null default 'open' check (status in ('open', 'submitted', 'confirmed')),
  block_height bigint,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index deposits_wallet_created_idx on game.deposits (wallet, created_at desc);
create index deposits_pending_idx on game.deposits (status) where status <> 'confirmed';

-- Treasury receipts without a known deposit reference, for manual assignment.
create table game.unmatched_transfers (
  tx_hash text primary key check (tx_hash ~ '^[0-9a-f]{64}$'),
  quantity bigint not null check (quantity > 0),
  block_height bigint not null,
  assigned_wallet text references game.accounts (wallet),
  assigned_at timestamptz,
  created_at timestamptz not null default now()
);
create index unmatched_transfers_assigned_wallet_idx on game.unmatched_transfers (assigned_wallet);

create table game.rounds (
  id bigint generated always as identity primary key,
  wallet text not null references game.accounts (wallet),
  game text not null check (game ~ '^[a-z0-9-]{1,32}$'),
  cost bigint not null check (cost > 0),
  created_at timestamptz not null default now()
);
create index rounds_wallet_created_idx on game.rounds (wallet, created_at desc);

-- Every balance change, with the balance it produced. (kind, reference) makes
-- each deposit, round and adjustment count exactly once.
create table game.ledger (
  id bigint generated always as identity primary key,
  wallet text not null references game.accounts (wallet),
  delta bigint not null check (delta <> 0),
  kind text not null check (kind in ('deposit', 'round', 'adjustment')),
  reference text not null,
  balance_after bigint not null check (balance_after >= 0),
  note text,
  created_at timestamptz not null default now(),
  unique (kind, reference)
);
create index ledger_wallet_created_idx on game.ledger (wallet, created_at desc);

alter table game.settings enable row level security;
alter table game.accounts enable row level security;
alter table game.deposits enable row level security;
alter table game.unmatched_transfers enable row level security;
alter table game.rounds enable row level security;
alter table game.ledger enable row level security;

-- Internal: change a balance under a row lock and record it in the ledger.
create function game.apply_delta(p_wallet text, p_delta bigint, p_kind text, p_reference text, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  insert into game.accounts (wallet) values (p_wallet) on conflict do nothing;
  select balance into v_balance from game.accounts where wallet = p_wallet for update;
  if v_balance + p_delta < 0 then
    raise exception 'insufficient_balance';
  end if;
  update game.accounts set balance = v_balance + p_delta, updated_at = now() where wallet = p_wallet;
  insert into game.ledger (wallet, delta, kind, reference, balance_after, note)
  values (p_wallet, p_delta, p_kind, p_reference, v_balance + p_delta, p_note);
  return v_balance + p_delta;
end;
$$;

create function game.state(p_wallet text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.enabled and s.treasury_address is not null,
    'roundCost', s.round_cost,
    'minDeposit', s.min_deposit,
    'treasuryAddress', s.treasury_address,
    'balance', coalesce((select a.balance from game.accounts a where a.wallet = p_wallet), 0),
    'deposits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', d.reference, 'requested', d.requested, 'received', d.received,
        'status', d.status, 'txHash', d.tx_hash, 'createdAt', d.created_at) order by d.created_at desc)
      from (select * from game.deposits where wallet = p_wallet and (status <> 'open' or created_at > now() - interval '1 hour')
            order by created_at desc limit 10) d), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'game', r.game, 'cost', r.cost, 'createdAt', r.created_at) order by r.created_at desc)
      from (select * from game.rounds where wallet = p_wallet order by created_at desc limit 10) r), '[]'::jsonb)
  )
  from game.settings s;
$$;

create function game.open_deposit(p_wallet text, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_reference uuid;
begin
  select * into v_settings from game.settings;
  if not v_settings.enabled or v_settings.treasury_address is null then
    raise exception 'game_disabled';
  end if;
  if p_amount < v_settings.min_deposit then
    raise exception 'amount_too_small';
  end if;
  insert into game.accounts (wallet) values (p_wallet) on conflict do nothing;
  if (select count(*) from game.deposits
      where wallet = p_wallet and status = 'open' and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_open_deposits';
  end if;
  insert into game.deposits (wallet, requested) values (p_wallet, p_amount) returning reference into v_reference;
  return jsonb_build_object('reference', v_reference, 'treasuryAddress', v_settings.treasury_address, 'amount', p_amount);
end;
$$;

create function game.mark_deposit_submitted(p_wallet text, p_reference uuid, p_tx_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update game.deposits set tx_hash = p_tx_hash, status = 'submitted'
  where reference = p_reference and wallet = p_wallet and status = 'open';
  if not found then
    raise exception 'deposit_not_found';
  end if;
end;
$$;

-- Called by the treasury watcher once a transfer carrying the reference has
-- enough confirmations. Idempotent per deposit and per transaction.
create function game.confirm_deposit(p_reference uuid, p_tx_hash text, p_received bigint, p_block_height bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deposit game.deposits;
  v_balance bigint;
begin
  select * into v_deposit from game.deposits where reference = p_reference for update;
  if not found then
    return jsonb_build_object('status', 'unknown_reference');
  end if;
  if v_deposit.status = 'confirmed' then
    return jsonb_build_object('status', 'already_confirmed');
  end if;
  if exists (select 1 from game.deposits where tx_hash = p_tx_hash and id <> v_deposit.id) then
    return jsonb_build_object('status', 'tx_already_used');
  end if;
  update game.deposits
  set tx_hash = p_tx_hash, received = p_received, status = 'confirmed',
      block_height = p_block_height, confirmed_at = now()
  where id = v_deposit.id;
  if p_received > 0 then
    v_balance := game.apply_delta(v_deposit.wallet, p_received, 'deposit', p_tx_hash);
  end if;
  return jsonb_build_object('status', 'confirmed', 'wallet', v_deposit.wallet, 'balance', v_balance);
end;
$$;

create function game.record_unmatched(p_tx_hash text, p_quantity bigint, p_block_height bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into game.unmatched_transfers (tx_hash, quantity, block_height)
  values (p_tx_hash, p_quantity, p_block_height)
  on conflict (tx_hash) do nothing;
$$;

create function game.watcher_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('treasuryAddress', treasury_address, 'scannedBlockHeight', scanned_block_height)
  from game.settings;
$$;

create function game.set_scanned_block_height(p_treasury text, p_height bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  -- Ignore the update if the treasury changed while the scan was running.
  update game.settings set scanned_block_height = greatest(scanned_block_height, p_height)
  where treasury_address = p_treasury;
$$;

create function game.start_round(p_wallet text, p_game text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings game.settings;
  v_round_id bigint;
  v_balance bigint;
begin
  select * into v_settings from game.settings;
  if not v_settings.enabled then
    raise exception 'game_disabled';
  end if;
  insert into game.rounds (wallet, game, cost) values (p_wallet, p_game, v_settings.round_cost)
  returning id into v_round_id;
  v_balance := game.apply_delta(p_wallet, -v_settings.round_cost, 'round', v_round_id::text);
  return jsonb_build_object('roundId', v_round_id, 'cost', v_settings.round_cost, 'balance', v_balance);
end;
$$;

create function game.admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('enabled', enabled, 'roundCost', round_cost, 'minDeposit', min_deposit,
                  'treasuryAddress', treasury_address, 'scannedBlockHeight', scanned_block_height) from game.settings),
    'totals', jsonb_build_object(
      'accounts', (select count(*) from game.accounts),
      'balances', (select coalesce(sum(balance), 0) from game.accounts),
      'deposited', (select coalesce(sum(received), 0) from game.deposits where status = 'confirmed'),
      'rounds', (select count(*) from game.rounds),
      'spent', (select coalesce(sum(cost), 0) from game.rounds)),
    'deposits', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc)
      from (select reference, wallet, requested, received, status, tx_hash, created_at, confirmed_at
            from game.deposits where status <> 'open' order by created_at desc limit 50) d), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at desc)
      from (select tx_hash, quantity, block_height, created_at from game.unmatched_transfers
            where assigned_wallet is null order by created_at desc limit 50) u), '[]'::jsonb)
  );
$$;

create function game.admin_update_settings(p_enabled boolean, p_round_cost bigint, p_min_deposit bigint, p_treasury_address text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update game.settings
  set enabled = p_enabled,
      round_cost = p_round_cost,
      min_deposit = p_min_deposit,
      scanned_block_height = case when treasury_address is distinct from p_treasury_address then 0 else scanned_block_height end,
      treasury_address = p_treasury_address,
      updated_at = now();
end;
$$;

create function game.admin_adjust(p_wallet text, p_delta bigint, p_note text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select game.apply_delta(p_wallet, p_delta, 'adjustment', 'admin-' || gen_random_uuid()::text, p_note);
$$;

create function game.admin_assign_unmatched(p_tx_hash text, p_wallet text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity bigint;
begin
  select quantity into v_quantity from game.unmatched_transfers
  where tx_hash = p_tx_hash and assigned_wallet is null for update;
  if not found then
    raise exception 'transfer_not_found';
  end if;
  insert into game.accounts (wallet) values (p_wallet) on conflict do nothing;
  update game.unmatched_transfers set assigned_wallet = p_wallet, assigned_at = now() where tx_hash = p_tx_hash;
  return game.apply_delta(p_wallet, v_quantity, 'deposit', p_tx_hash, 'assigned by admin');
end;
$$;

-- Functions are executable by PUBLIC by default; allow only the API role.
revoke all on all functions in schema game from public, anon, authenticated;
revoke all on all tables in schema game from public, anon, authenticated;
alter default privileges in schema game revoke execute on functions from public;

-- The password is set separately (as a SCRAM verifier) so it never appears in
-- migration history.
create role game_api login noinherit;
alter role game_api set statement_timeout = '5s';
grant usage on schema game to game_api;
grant execute on function
  game.state(text),
  game.open_deposit(text, bigint),
  game.mark_deposit_submitted(text, uuid, text),
  game.confirm_deposit(uuid, text, bigint, bigint),
  game.record_unmatched(text, bigint, bigint),
  game.watcher_state(),
  game.set_scanned_block_height(text, bigint),
  game.start_round(text, text),
  game.admin_overview(),
  game.admin_update_settings(boolean, bigint, bigint, text),
  game.admin_adjust(text, bigint, text),
  game.admin_assign_unmatched(text, text)
to game_api;
