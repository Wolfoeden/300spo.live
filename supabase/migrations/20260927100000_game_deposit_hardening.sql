-- The on-chain reference decides which deposit a transaction belongs to.
-- A tx hash that a player attached to the wrong deposit no longer blocks the
-- real owner, and a second transfer reusing a confirmed reference is reported
-- instead of being dropped.

create or replace function game.mark_deposit_submitted(p_wallet text, p_reference uuid, p_tx_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from game.deposits where tx_hash = p_tx_hash and reference <> p_reference) then
    raise exception 'tx_already_used';
  end if;
  update game.deposits set tx_hash = p_tx_hash, status = 'submitted'
  where reference = p_reference and wallet = p_wallet and status in ('open', 'submitted');
  if not found then
    raise exception 'deposit_not_found';
  end if;
end;
$$;

create or replace function game.confirm_deposit(p_reference uuid, p_tx_hash text, p_received bigint, p_block_height bigint)
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
    return jsonb_build_object('status', case when v_deposit.tx_hash = p_tx_hash then 'already_confirmed' else 'reference_already_used' end);
  end if;
  -- Release the hash from deposits that only claimed it without proof.
  update game.deposits set tx_hash = null, status = 'open'
  where tx_hash = p_tx_hash and id <> v_deposit.id and status <> 'confirmed';
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
