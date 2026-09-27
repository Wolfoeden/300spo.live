"use client";

import { formatCompact } from "@/lib/format";
import { Spinner, WalletIcon } from "../icons";
import { useWallet } from "./wallet-provider";

export function ConnectButton({ className = "" }: { className?: string }) {
  const { status, wallet, balance, openDialog } = useWallet();

  if (status === "connected" && wallet) {
    return (
      <button
        onClick={() => openDialog()}
        className={`group inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/[0.07] py-1.5 pl-1.5 pr-3.5 text-sm transition hover:border-gold/60 ${className}`}
        aria-label={`${wallet.name} connected. Open wallet details`}
      >
        <span className="grid size-7 place-items-center overflow-hidden rounded-full bg-raised">
          {wallet.icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI
            <img src={wallet.icon} alt="" className="size-5" />
          ) : (
            <WalletIcon size={14} className="text-gold" />
          )}
        </span>
        <span className="font-semibold tabular-nums">{balance ? formatCompact(Number(balance.token300), 1) : "–"}</span>
        <span className="text-gold-gradient font-semibold">300</span>
        {wallet.networkId !== 1 && <span className="size-1.5 rounded-full bg-warning" title="Testnet" />}
      </button>
    );
  }

  const busy = status === "connecting";
  return (
    <button onClick={() => openDialog()} className={`btn btn-gold !px-4 !py-2.5 sm:!px-5 ${className}`} disabled={busy}>
      {busy ? <Spinner size={16} /> : <WalletIcon size={16} />}
      {busy ? (
        <span>Connecting…</span>
      ) : (
        <span>
          Connect<span className="hidden sm:inline"> wallet</span>
        </span>
      )}
    </button>
  );
}
