"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { shortenAddress } from "@/lib/cardano/address";
import { formatAdaExact, formatTokenAmount } from "@/lib/format";
import { CopyButton } from "../copy-button";
import { ArrowUpRight, Close, Power, Refresh, Shield, Spinner, WalletIcon } from "../icons";
import { useWallet } from "./wallet-provider";

const INSTALL_LINKS = [
  { name: "VESPR", href: "https://vespr.xyz/" },
  { name: "Lace", href: "https://www.lace.io/" },
  { name: "Eternl", href: "https://eternl.io/" },
];

const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const subscribeNever = () => () => {};

export function WalletDialog() {
  const { dialogOpen, closeDialog, status } = useWallet();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button, a")?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [dialogOpen, closeDialog]);

  return (
    <AnimatePresence>
      {dialogOpen && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button aria-label="Close wallet dialog" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeDialog} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-dialog-title"
            className="relative w-full max-w-md overflow-hidden rounded-t-3xl border border-line-strong bg-panel shadow-2xl shadow-black/60 sm:rounded-3xl"
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-gold/20 blur-3xl" />
            <div className="relative max-h-[85vh] overflow-y-auto p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 id="wallet-dialog-title" className="text-lg font-semibold">
                  {status === "connected" ? "Your wallet" : "Connect a Cardano wallet"}
                </h2>
                <button
                  onClick={closeDialog}
                  className="grid size-9 place-items-center rounded-full border border-line text-muted transition hover:text-text"
                  aria-label="Close"
                >
                  <Close size={16} />
                </button>
              </div>
              {status === "connected" ? <AccountView /> : <PickerView />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PickerView() {
  const { installed, connect, connectingKey, error, status } = useWallet();
  const mobile = useSyncExternalStore(subscribeNever, isMobileDevice, () => false);

  if (status === "detecting") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner size={16} /> Looking for installed wallets…
      </p>
    );
  }

  if (installed.length === 0) return mobile ? <MobileInstructions /> : <DesktopInstall />;

  return (
    <div>
      <p className="mb-4 text-sm text-muted">Choose a wallet. You approve the connection inside your wallet; nothing is signed or sent.</p>
      <ul className="space-y-2">
        {installed.map((entry) => {
          const busy = connectingKey === entry.key;
          return (
            <li key={entry.key}>
              <button
                onClick={() => connect(entry.key)}
                disabled={Boolean(connectingKey)}
                className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-white/[0.02] px-4 py-3 text-left transition hover:border-gold/40 hover:bg-white/[0.05] disabled:opacity-60"
              >
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-raised">
                  {entry.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI
                    <img src={entry.icon} alt="" className="size-7" />
                  ) : (
                    <WalletIcon size={18} className="text-gold" />
                  )}
                </span>
                <span className="flex-1">
                  <span className="block font-medium">{entry.name}</span>
                  <span className="block text-xs text-faint">{busy ? "Waiting for approval in your wallet…" : "Detected"}</span>
                </span>
                {busy ? <Spinner size={18} className="text-gold" /> : <span className="text-faint transition group-hover:text-gold">→</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function DesktopInstall() {
  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        No Cardano wallet was detected in this browser. Install one of these wallets, then reload the page.
      </p>
      <div className="grid gap-2">
        {INSTALL_LINKS.map((link) => (
          <a
            key={link.name}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-2xl border border-line px-4 py-3 transition hover:border-gold/40"
          >
            <span className="font-medium">Get {link.name}</span>
            <ArrowUpRight size={16} className="text-gold" />
          </a>
        ))}
      </div>
    </div>
  );
}

function MobileInstructions() {
  const url = typeof window === "undefined" ? "https://300spo.live" : window.location.origin;
  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Mobile browsers cannot reach wallet apps directly. Open 300spo.live inside your wallet&apos;s built-in browser instead:
      </p>
      <ol className="mb-5 space-y-3 text-sm">
        {["Open the VESPR app (or another Cardano wallet with a dApp browser).", "Go to the dApp browser inside the app.", "Enter 300spo.live and tap Connect wallet."].map(
          (step, index) => (
            <li key={step} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gold/15 font-mono text-xs text-gold">{index + 1}</span>
              <span className="pt-0.5">{step}</span>
            </li>
          ),
        )}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={url} label="Copy site link" />
        <a href="https://vespr.xyz/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium text-muted hover:text-text">
          Get VESPR <ArrowUpRight size={13} />
        </a>
      </div>
    </div>
  );
}

function AccountView() {
  const { wallet, balance, balanceError, auth, refreshBalance, disconnect, signIn, signOut } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  if (!wallet) return null;
  const mainnet = wallet.networkId === 1;
  const address = wallet.stakeAddress ?? wallet.changeAddress;

  const refresh = async () => {
    setRefreshing(true);
    await refreshBalance();
    setRefreshing(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center overflow-hidden rounded-xl bg-raised">
          {wallet.icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI
            <img src={wallet.icon} alt="" className="size-7" />
          ) : (
            <WalletIcon className="text-gold" />
          )}
        </span>
        <div className="flex-1">
          <p className="font-medium">{wallet.name}</p>
          <p className="font-mono text-xs text-faint">{shortenAddress(address, 14, 8)}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-wider ${
            mainnet ? "bg-positive/10 text-positive" : "bg-warning/10 text-warning"
          }`}
        >
          {mainnet ? "Mainnet" : "Testnet"}
        </span>
      </div>

      <div className="rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.12] via-transparent to-transparent p-4">
        <p className="kicker mb-2">300 token balance</p>
        <div className="flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold tracking-tight">
            {balance ? formatTokenAmount(balance.token300) : "–"} <span className="text-gold-gradient">300</span>
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/300-logo.jpg" alt="" className="size-10 rounded-full ring-1 ring-gold/40" />
        </div>
        <p className="mt-2 text-sm text-muted">{balance ? `${formatAdaExact(balance.lovelace)} ADA` : "Reading balance…"}</p>
        {!mainnet && <p className="mt-2 text-xs text-warning">The 300 token lives on mainnet. Testnet wallets always show 0.</p>}
        {balanceError && <p className="mt-2 text-xs text-danger">{balanceError}</p>}
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-3">
          <Shield size={18} className={auth.status === "signed-in" ? "text-positive" : "text-faint"} />
          <div className="flex-1 text-sm">
            <p className="font-medium">{auth.status === "signed-in" ? "Ownership verified" : "Verify ownership"}</p>
            <p className="text-xs text-faint">
              {auth.status === "signed-in" ? "Signed in for 7 days on this device." : "Sign a free message. No transaction, no fees."}
            </p>
          </div>
          {auth.status === "signed-in" ? (
            <button onClick={signOut} className="text-xs text-muted underline-offset-4 hover:text-text hover:underline">
              Sign out
            </button>
          ) : (
            <button onClick={signIn} disabled={auth.status === "signing"} className="btn btn-ghost !px-3.5 !py-2 text-xs">
              {auth.status === "signing" ? <Spinner size={14} /> : null}
              {auth.status === "signing" ? "Check wallet…" : "Verify"}
            </button>
          )}
        </div>
        {auth.error && <p className="mt-3 text-xs text-danger">{auth.error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={address} label="Copy address" />
        {wallet.stakeAddress && mainnet && (
          <a
            href={`https://cardanoscan.io/stakekey/${wallet.stakeAddress}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium text-muted hover:text-text"
          >
            Cardanoscan <ArrowUpRight size={13} />
          </a>
        )}
        <span className="flex-1" />
        <button onClick={refresh} className="grid size-8 place-items-center rounded-full border border-line text-muted hover:text-text" aria-label="Refresh balance">
          {refreshing ? <Spinner size={14} /> : <Refresh size={15} />}
        </button>
        <button
          onClick={disconnect}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-danger/40 hover:text-danger"
        >
          <Power size={14} /> Disconnect
        </button>
      </div>
    </div>
  );
}
