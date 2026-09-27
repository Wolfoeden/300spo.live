"use client";

import { useEffect, useState } from "react";
import { shortenAddress } from "@/lib/cardano/address";
import { Shield, Spinner, WalletIcon } from "../icons";
import { useWallet } from "../wallet/wallet-provider";

type AdminSession = { authenticated: boolean; wallet: string | null };

const readSession = async (): Promise<AdminSession> => {
  const response = await fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" });
  return (await response.json()) as AdminSession;
};

/** Wallet sign-in for /admin/: connect, sign the challenge, then continue if the wallet is an admin. */
export function AdminLogin() {
  const { status, wallet, auth, openDialog, signIn, signOut } = useWallet();
  const [session, setSession] = useState<AdminSession | null>(null);
  const next = typeof window === "undefined" ? "/admin/" : new URLSearchParams(window.location.search).get("next") ?? "/admin/";
  const target = next.startsWith("/admin/") ? next : "/admin/";

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let active = true;
    readSession()
      .then((current) => {
        if (!active) return;
        setSession(current);
        if (current.authenticated) window.location.assign(target);
      })
      .catch(() => active && setSession({ authenticated: false, wallet: null }));
    return () => {
      active = false;
    };
  }, [auth.status, target]);

  const denied = auth.status === "signed-in" && session !== null && !session.authenticated;

  return (
    <div className="glass mx-auto flex max-w-lg flex-col items-start gap-5 rounded-3xl p-6 sm:p-8">
      <span className="grid size-11 place-items-center rounded-2xl bg-gold/10">
        <Shield className="text-gold" />
      </span>
      <div>
        <h1 className="text-2xl font-semibold">Admin sign-in</h1>
        <p className="mt-1 text-muted">Connect the admin wallet and sign a free message. No transaction, no fees.</p>
      </div>

      {status !== "connected" || !wallet ? (
        <button className="btn btn-gold" onClick={() => openDialog(() => undefined)} disabled={status === "connecting" || status === "detecting"}>
          <WalletIcon size={16} /> Connect wallet
        </button>
      ) : auth.status !== "signed-in" ? (
        <>
          <p className="text-sm text-muted">
            Connected: {wallet.name} · <span className="font-mono">{shortenAddress(wallet.stakeAddress ?? wallet.changeAddress, 14, 8)}</span>
          </p>
          <button className="btn btn-gold" onClick={signIn} disabled={auth.status === "signing"}>
            {auth.status === "signing" && <Spinner size={16} />}
            {auth.status === "signing" ? "Check your wallet…" : "Sign in"}
          </button>
          {auth.error && <p className="text-sm text-danger">{auth.error}</p>}
        </>
      ) : denied ? (
        <>
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            This wallet ({shortenAddress(auth.identity ?? "", 14, 8)}) has no admin access.
          </p>
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out and use another wallet
          </button>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner size={16} /> Opening the admin area…
        </p>
      )}
    </div>
  );
}
