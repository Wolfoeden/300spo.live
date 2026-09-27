"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { addressBytesFromWallet, bytesToHex, drepCredential, poolKeyHash, stakeKeyHash } from "@/lib/cardano/address";
import { walletErrorCode, walletErrorMessage } from "@/lib/cardano/cip30";
import { InsufficientFundsError, assembleSignedTx, buildTransaction, delegationCertificates, mainnetSlotAt, parseUtxo, type Utxo } from "@/lib/cardano/tx";
import { formatAdaExact } from "@/lib/format";
import { DREP_ID, POOL_ID } from "@/lib/site";
import { ArrowUpRight, Check, Spinner } from "../icons";
import { Modal } from "../modal";
import { useWallet } from "./wallet-provider";

export type DelegationTarget = "pool" | "drep";

type AccountState = { registered: boolean; delegatedTo300: { pool: boolean; drep: boolean } };
type ChainParams = { minFeeA: string; minFeeB: string; keyDeposit: string; coinsPerUtxoByte: string; maxTxSize: number };

/** The chain proxy depends on a slow public API; one retry absorbs most hiccups. */
const fetchChain = async <T,>(path: string, attempts = 2): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) return (await response.json()) as T;
      if (response.status < 500 || attempt >= attempts) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
  }
};

type Phase =
  | { name: "loading" }
  | { name: "ready" }
  | { name: "signing" }
  | { name: "submitted"; txHash: string }
  | { name: "error"; message: string };

const DelegationContext = createContext<{ start(target: DelegationTarget): void } | null>(null);

export const useDelegation = () => {
  const context = useContext(DelegationContext);
  if (!context) throw new Error("useDelegation must be used inside <DelegationProvider>");
  return context;
};

const TTL_SLOTS = 3600;

/** CIP-30 codes differ per call: signTx 2 = user declined, submitTx 2 = rejected by the network. */
const transactionErrorMessage = (error: unknown, stage: "build" | "sign" | "submit") => {
  if (error instanceof InsufficientFundsError || error instanceof Error) return error.message;
  const code = walletErrorCode(error);
  if (code === -3 || (stage === "sign" && code === 2)) return "The transaction was declined in your wallet.";
  if (stage === "submit") return `The network rejected the transaction: ${walletErrorMessage(error)}`;
  return walletErrorMessage(error);
};

export function DelegationProvider({ children }: { children: React.ReactNode }) {
  const { status, openDialog } = useWallet();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Record<DelegationTarget, boolean>>({ pool: true, drep: false });

  const show = useCallback((target: DelegationTarget) => {
    setSelection({ pool: target === "pool", drep: target === "drep" });
    setOpen(true);
  }, []);

  // Without a wallet, connect first and continue straight into the delegation.
  const start = useCallback(
    (target: DelegationTarget) => (status === "connected" ? show(target) : openDialog(() => show(target))),
    [status, show, openDialog],
  );

  return (
    <DelegationContext.Provider value={{ start }}>
      {children}
      <Modal open={open} onClose={() => setOpen(false)} title="Delegate to 300">
        {open && <DelegationBody selection={selection} setSelection={setSelection} />}
      </Modal>
    </DelegationContext.Provider>
  );
}

function DelegationBody({
  selection,
  setSelection,
}: {
  selection: Record<DelegationTarget, boolean>;
  setSelection: React.Dispatch<React.SetStateAction<Record<DelegationTarget, boolean>>>;
}) {
  const { wallet, getApi, refreshBalance } = useWallet();
  const [account, setAccount] = useState<AccountState | null>(null);
  const [chainParams, setChainParams] = useState<ChainParams | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const mainnet = wallet?.networkId === 1;
  const stakeAddress = wallet?.stakeAddress ?? null;

  useEffect(() => {
    if (!stakeAddress) return;
    let active = true;
    Promise.all([
      fetchChain<AccountState>(`/api/chain/account?stake=${encodeURIComponent(stakeAddress)}`),
      fetchChain<ChainParams>("/api/chain/params"),
    ])
      .then(([data, params]) => {
        if (!active) return;
        setAccount(data);
        setChainParams(params);
        // Nothing to do for a role that already points at 300.
        setSelection((current) => ({ pool: current.pool && !data.delegatedTo300.pool, drep: current.drep && !data.delegatedTo300.drep }));
        setPhase({ name: "ready" });
      })
      .catch(() => {
        if (active) setPhase({ name: "error", message: "Could not read the current delegation from the Cardano network. Try again in a moment." });
      });
    return () => {
      active = false;
    };
  }, [stakeAddress, setSelection]);

  if (!wallet) return null;
  if (!mainnet) return <Notice>Switch your wallet to Cardano mainnet. The 300 pool and DRep only exist there.</Notice>;
  if (!wallet.stakeAddress || !wallet.stakeAddressHex) return <Notice>This wallet does not expose a stake address, so it cannot delegate.</Notice>;

  const submit = async () => {
    const api = getApi();
    if (!api || !account || !chainParams || !wallet.stakeAddressHex) return;
    setPhase({ name: "signing" });
    let stage: "build" | "sign" | "submit" = "build";
    try {
      const keyHash = stakeKeyHash(addressBytesFromWallet(wallet.stakeAddressHex));
      if (!keyHash) throw new Error("This wallet uses a script stake key, which this page cannot delegate.");
      const params = {
        minFeeA: BigInt(chainParams.minFeeA),
        minFeeB: BigInt(chainParams.minFeeB),
        keyDeposit: BigInt(chainParams.keyDeposit),
        coinsPerUtxoByte: BigInt(chainParams.coinsPerUtxoByte),
        maxTxSize: chainParams.maxTxSize,
      };
      const { certificates, deposit } = delegationCertificates({
        stakeKeyHash: keyHash,
        registered: account.registered,
        keyDeposit: params.keyDeposit,
        poolKeyHash: selection.pool ? poolKeyHash(POOL_ID) : undefined,
        drep: selection.drep ? drepCredential(DREP_ID) : undefined,
      });
      const utxos = ((await api.getUtxos()) ?? []).map(parseUtxo).filter((utxo): utxo is Utxo => utxo !== null);
      const built = buildTransaction({
        utxos,
        changeAddress: addressBytesFromWallet(wallet.changeAddressHex),
        certificates,
        deposit,
        extraSigners: 1,
        params,
        ttl: mainnetSlotAt(Date.now()) + TTL_SLOTS,
      });
      stage = "sign";
      const witnesses = await api.signTx(bytesToHex(built.unsignedTx), true);
      stage = "submit";
      const txHash = await api.submitTx(bytesToHex(assembleSignedTx(built.body, witnesses)));
      setPhase({ name: "submitted", txHash });
      void refreshBalance();
    } catch (error) {
      setPhase({ name: "error", message: transactionErrorMessage(error, stage) });
    }
  };

  if (phase.name === "submitted") {
    return (
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-3 rounded-2xl border border-positive/30 bg-positive/10 p-4">
          <Check className="text-positive" />
          <p className="font-medium text-text">Delegation submitted.</p>
        </div>
        <p className="text-muted">
          It is recorded on-chain within a minute. Staking rewards follow the normal epoch cycle; your ADA stays in your wallet.
        </p>
        <a
          href={`https://cardanoscan.io/transaction/${phase.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-gold hover:text-gold-bright"
        >
          View transaction <ArrowUpRight size={14} />
        </a>
      </div>
    );
  }

  const alreadyAll = account?.delegatedTo300.pool && account?.delegatedTo300.drep;
  const nothingSelected = !selection.pool && !selection.drep;
  const busy = phase.name === "loading" || phase.name === "signing";

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">Your ADA never leaves your wallet. You sign one transaction; the network fee is about 0.2 ADA.</p>
      <div className="space-y-2">
        <Choice
          label="Stake pool"
          value="300 SPO"
          done={account?.delegatedTo300.pool}
          checked={selection.pool}
          onChange={(value) => setSelection((current) => ({ ...current, pool: value }))}
          disabled={busy}
        />
        <Choice
          label="Governance (DRep)"
          value="300 DRep"
          done={account?.delegatedTo300.drep}
          checked={selection.drep}
          onChange={(value) => setSelection((current) => ({ ...current, drep: value }))}
          disabled={busy}
        />
      </div>
      {account && chainParams && !account.registered && (
        <p className="rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-muted">
          First delegation from this wallet: Cardano takes a {formatAdaExact(BigInt(chainParams.keyDeposit))} ADA deposit to register your
          stake key. You get it back if you ever deregister.
        </p>
      )}
      {phase.name === "error" && <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-danger">{phase.message}</p>}
      {alreadyAll ? (
        <p className="flex items-center gap-2 text-positive">
          <Check size={16} /> You are delegated to 300 for staking and governance. Thank you!
        </p>
      ) : (
        <button className="btn btn-gold w-full" onClick={submit} disabled={busy || nothingSelected || !account || !chainParams}>
          {busy && <Spinner size={16} />}
          {phase.name === "loading" ? "Checking your delegation…" : phase.name === "signing" ? "Confirm in your wallet…" : "Sign delegation"}
        </button>
      )}
    </div>
  );
}

function Choice(props: { label: string; value: string; done?: boolean; checked: boolean; disabled: boolean; onChange(value: boolean): void }) {
  return (
    <label className={`flex items-center gap-3 rounded-2xl border p-4 ${props.done ? "border-positive/30" : "border-line"} ${props.done ? "" : "cursor-pointer"}`}>
      {props.done ? (
        <span className="grid size-5 place-items-center rounded-full bg-positive/15 text-positive">
          <Check size={12} />
        </span>
      ) : (
        <input
          type="checkbox"
          className="size-5 accent-[var(--color-gold)]"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.checked)}
        />
      )}
      <span className="flex-1">
        <span className="block text-xs text-faint">{props.label}</span>
        <span className="block font-medium text-text">{props.value}</span>
      </span>
      {props.done && <span className="text-xs text-positive">Already delegated</span>}
    </label>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{children}</p>;
}

/** Drop-in replacement for the old web+cardano:// links. */
export function DelegateButton({ target, className, children }: { target: DelegationTarget; className?: string; children: React.ReactNode }) {
  const { start } = useDelegation();
  return (
    <button type="button" className={className} onClick={() => start(target)}>
      {children}
    </button>
  );
}
