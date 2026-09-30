"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import { LINKS } from "@/lib/site";
import { WinBurst } from "./game/arena-effects";
import { ArrowRight, Close } from "./icons";
import { DELEGATED_EVENT } from "./wallet/delegation";
import { useWallet } from "./wallet/wallet-provider";

type Claim = { status: "granted"; amount: number; total: number } | { status: string };

/** After a delegation, the credit is asked for this often until it lands (the delegation needs a block first). */
const RECHECK_MS = 20_000;
const RECHECKS = 30;

/**
 * On the landing page: as soon as a wallet connects, its starting credit is
 * booked if it delegates to 300, and the credit is celebrated like a win. A
 * wallet that already has it is not asked again in this browser session; one
 * that does not delegate yet is asked again after it delegates here.
 */
export function WelcomeCredit() {
  const { status, wallet } = useWallet();
  const stake = status === "connected" ? (wallet?.stakeAddress ?? null) : null;
  const [credit, setCredit] = useState<{ amount: number; total: number; stage: "burst" | "card" } | null>(null);
  const asked = useRef<string | null>(null);

  // Asks once; true when there is nothing more to wait for (credited now or before).
  const claim = useCallback(async (address: string) => {
    const key = `300spo:welcome:${address}`;
    try {
      if (sessionStorage.getItem(key)) return true;
    } catch {
      // No session storage: ask anyway, the server books the credit once.
    }
    const result = await fetch("/api/welcome", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: address }) })
      .then((response) => (response.ok ? (response.json() as Promise<Claim>) : null))
      .catch(() => null);
    const settled = result?.status === "granted" || result?.status === "claimed";
    if (settled) {
      try {
        sessionStorage.setItem(key, result.status);
      } catch {
        // Only saves a second request.
      }
    }
    if (result?.status === "granted" && "amount" in result) setCredit({ amount: result.amount, total: result.total ?? result.amount, stage: "burst" });
    return settled;
  }, []);

  useEffect(() => {
    if (!stake || asked.current === stake) return;
    asked.current = stake;
    void claim(stake);
  }, [stake, claim]);

  // A delegation from this page: keep asking until the chain shows it and the credit is booked.
  useEffect(() => {
    if (!stake) return;
    let timer: number | undefined;
    const onDelegated = (event: Event) => {
      if ((event as CustomEvent<string | null>).detail !== stake) return;
      window.clearInterval(timer);
      let checks = 0;
      timer = window.setInterval(async () => {
        checks += 1;
        if ((await claim(stake)) || checks >= RECHECKS) window.clearInterval(timer);
      }, RECHECK_MS);
    };
    window.addEventListener(DELEGATED_EVENT, onDelegated);
    return () => {
      window.removeEventListener(DELEGATED_EVENT, onDelegated);
      window.clearInterval(timer);
    };
  }, [stake, claim]);

  useEffect(() => {
    if (credit?.stage !== "card") return;
    const timer = window.setTimeout(() => setCredit(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [credit?.stage]);

  return (
    <AnimatePresence>
      {credit?.stage === "burst" && (
        <motion.div
          key="burst"
          className="fixed inset-0 z-[70] grid place-items-center bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setCredit((current) => current && { ...current, stage: "card" })}
          role="status"
        >
          <div className="relative size-[min(88vw,28rem)]">
            <WinBurst
              title="Starting credit"
              amount={credit.amount}
              note="300 credited to your game balance"
              onDone={() => setCredit((current) => current && { ...current, stage: "card" })}
            />
          </div>
        </motion.div>
      )}
      {credit?.stage === "card" && (
        <motion.div
          key="card"
          className="fixed inset-x-4 bottom-4 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-gold/40 bg-ink/95 p-3 pl-4 shadow-2xl shadow-black/60"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          role="status"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/300-logo.jpg" alt="" className="size-9 shrink-0 rounded-full ring-1 ring-gold-bright/50" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="block font-semibold text-gold-bright">{formatTokenAmount(BigInt(credit.total))} 300 credited</span>
            <span className="block text-xs text-muted">Game credit for delegating to 300 · no withdrawals</span>
          </p>
          <a href={LINKS.play} className="btn btn-gold !px-3 !py-2 text-xs">
            Play <ArrowRight size={12} />
          </a>
          <button type="button" aria-label="Close" onClick={() => setCredit(null)} className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:text-text">
            <Close size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
