"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { addressBytesFromWallet, bytesToHex, drepCredential, poolKeyHash, stakeKeyHash } from "@/lib/cardano/address";
import { assembleSignedTx, buildTransaction, delegationCertificates, ttlFromNow, parseUtxo, type ProtocolParams, type Utxo } from "@/lib/cardano/tx";
import { fetchChain, loadProtocolParams, transactionErrorMessage, type TxStage } from "@/lib/chain-client";
import { formatAdaExact, formatTokenAmount } from "@/lib/format";
import { DREP_ID, POOL_ID } from "@/lib/site";
import { ArrowUpRight, Check, Spinner } from "../icons";
import { Modal } from "../modal";
import { useWallet } from "./wallet-provider";

/** Sent on window when a delegation transaction was submitted (detail: the stake address). */
export const DELEGATED_EVENT = "300spo:delegated";

/** "both" preselects the stake pool and the DRep; the wallet can untick either. */
export type DelegationTarget = "pool" | "drep" | "both";
/** Starting credit: `poolAmount` for delegating to the stake pool, `amount` for the DRep alone. */
type WelcomeOffer = { enabled: boolean; amount: number; poolAmount?: number };

type AccountState = { registered: boolean; delegatedTo300: { pool: boolean; drep: boolean } };

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


export function DelegationProvider({ children }: { children: React.ReactNode }) {
  const { status, openDialog } = useWallet();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>({ pool: true, drep: false });
  const [offer, setOffer] = useState<WelcomeOffer | null>(null);

  const show = useCallback((target: DelegationTarget) => {
    setSelection({ pool: target !== "drep", drep: target !== "pool" });
    setOpen(true);
  }, []);

  // The starting-credit offer shown in the dialog; read once, the first time it opens.
  useEffect(() => {
    if (!open || offer) return;
    let active = true;
    fetch("/api/offers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { welcome?: WelcomeOffer } | null) => active && data?.welcome && setOffer(data.welcome))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, offer]);

  // Without a wallet, connect first and continue straight into the delegation.
  const start = useCallback(
    (target: DelegationTarget) => (status === "connected" ? show(target) : openDialog(() => show(target))),
    [status, show, openDialog],
  );

  return (
    <DelegationContext.Provider value={{ start }}>
      {children}
      <Modal open={open} onClose={() => setOpen(false)} title="Delegate to 300">
        {open && <DelegationBody selection={selection} setSelection={setSelection} offer={offer?.enabled ? offer : null} />}
      </Modal>
    </DelegationContext.Provider>
  );
}

type Selection = { pool: boolean; drep: boolean };

function DelegationBody({
  selection,
  setSelection,
  offer,
}: {
  selection: Selection;
  setSelection: React.Dispatch<React.SetStateAction<Selection>>;
  offer: WelcomeOffer | null;
}) {
  const onPlay = usePathname()?.startsWith("/play") ?? false;
  const credit = offer ? (selection.pool || !selection.drep ? (offer.poolAmount ?? offer.amount) : offer.amount) : 0;
  const { wallet, getApi, refreshBalance } = useWallet();
  const [account, setAccount] = useState<AccountState | null>(null);
  const [chainParams, setChainParams] = useState<ProtocolParams | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const mainnet = wallet?.networkId === 1;
  const stakeAddress = wallet?.stakeAddress ?? null;

  useEffect(() => {
    if (!stakeAddress) return;
    let active = true;
    Promise.all([
      fetchChain<AccountState>(`/api/chain/account?stake=${encodeURIComponent(stakeAddress)}`),
      loadProtocolParams(),
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
    let stage: TxStage = "build";
    try {
      const keyHash = stakeKeyHash(addressBytesFromWallet(wallet.stakeAddressHex));
      if (!keyHash) throw new Error("This wallet uses a script stake key, which this page cannot delegate.");
      const params = chainParams;
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
        ttl: ttlFromNow(),
      });
      stage = "sign";
      const witnesses = await api.signTx(bytesToHex(built.unsignedTx), true);
      stage = "submit";
      const txHash = await api.submitTx(bytesToHex(assembleSignedTx(built.body, witnesses)));
      setPhase({ name: "submitted", txHash });
      window.dispatchEvent(new CustomEvent(DELEGATED_EVENT, { detail: stakeAddress }));
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
        {offer && (
          <StartingCredit amount={credit}>
            {onPlay ? (
              "It is added to your game balance here as soon as the delegation is on chain."
            ) : (
              <>
                Collect it in{" "}
                <a href="/play/" className="font-medium text-gold-bright underline underline-offset-2">
                  300 Games
                </a>{" "}
                once the delegation is on chain.
              </>
            )}
          </StartingCredit>
        )}
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
      {offer && (
        <StartingCredit amount={credit}>
          {(offer.poolAmount ?? offer.amount) === offer.amount
            ? "For delegating to the 300 stake pool, the 300 DRep or both — once per wallet, to play 300 Games."
            : selection.pool || !selection.drep
              ? "For delegating to the 300 stake pool — once per wallet, to play 300 Games."
              : `For delegating to the 300 DRep — once per wallet, to play 300 Games. With the stake pool it is ${formatTokenAmount(BigInt(offer.poolAmount ?? offer.amount))}.`}
        </StartingCredit>
      )}
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
          First delegation from this wallet: Cardano takes a {formatAdaExact(chainParams.keyDeposit)} ADA deposit to register your
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

function StartingCredit({ amount, children }: { amount: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gold/[0.08] p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/300-logo.jpg" alt="" className="size-9 shrink-0 rounded-full ring-1 ring-gold-bright/50" />
      <div>
        <p className="font-semibold text-gold-bright">{formatTokenAmount(BigInt(amount))} 300 starting credit</p>
        <p className="mt-0.5 text-muted">{children}</p>
      </div>
    </div>
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
