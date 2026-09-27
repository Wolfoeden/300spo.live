"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { addressBytesFromWallet, addressToBech32 } from "@/lib/cardano/address";
import {
  type Cip30Api,
  type InstalledWallet,
  listInstalledWallets,
  utf8ToHex,
  waitForWallets,
  walletErrorCode,
  walletErrorMessage,
} from "@/lib/cardano/cip30";
import { assetQuantity, decodeWalletValue } from "@/lib/cardano/value";
import { TOKEN_300 } from "@/lib/site";

const STORAGE_KEY = "300spo:wallet";
const BALANCE_REFRESH_MS = 60_000;

export type WalletBalance = { lovelace: bigint; token300: bigint; updatedAt: number };

export type ConnectedWallet = {
  key: string;
  name: string;
  icon: string | null;
  networkId: number;
  stakeAddress: string | null;
  stakeAddressHex: string | null;
  changeAddress: string;
  changeAddressHex: string;
};

export type WalletStatus = "detecting" | "disconnected" | "connecting" | "connected";
export type AuthStatus = "signed-out" | "signing" | "signed-in";

type WalletContextValue = {
  status: WalletStatus;
  installed: InstalledWallet[];
  connectingKey: string | null;
  wallet: ConnectedWallet | null;
  balance: WalletBalance | null;
  balanceError: string | null;
  error: string | null;
  auth: { status: AuthStatus; identity: string | null; error: string | null };
  dialogOpen: boolean;
  openDialog(): void;
  closeDialog(): void;
  connect(key: string): Promise<void>;
  disconnect(): void;
  refreshBalance(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const storage = {
  get: () => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set: (value: string | null) => {
    try {
      if (value) window.localStorage.setItem(STORAGE_KEY, value);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode or blocked storage: auto-reconnect is a convenience only.
    }
  },
};

const postJson = async (path: string, body: unknown) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
};

const AUTH_ERRORS: Record<string, string> = {
  not_configured: "Wallet sign-in is not configured on the server yet.",
  challenge_expired: "The sign-in request expired. Please try again.",
  message_mismatch: "The wallet signed a different message.",
  address_mismatch: "The wallet signed with a different address.",
  invalid_signature: "The signature could not be verified.",
  unsupported_address: "This address type cannot be used for sign-in.",
};

type SignInResult = { identity: string; error: null } | { identity: null; error: string };

/** Challenge → signData → verify, trying each candidate address in turn. */
const signInWithWallet = async (api: Cip30Api, candidates: string[]): Promise<SignInResult> => {
  let lastError = "The wallet could not sign the request.";
  for (const addressHex of candidates) {
    const challenge = await postJson("/api/wallet-auth/challenge", { address: addressHex });
    if (!challenge.ok) {
      lastError = AUTH_ERRORS[String(challenge.data.error)] ?? `Sign-in is unavailable (HTTP ${challenge.status}).`;
      if (challenge.data.error === "unsupported_address") continue;
      break;
    }
    let signed: { signature: string; key: string };
    try {
      signed = await api.signData(addressHex, utf8ToHex(String(challenge.data.message)));
    } catch (cause) {
      lastError = walletErrorMessage(cause);
      const code = walletErrorCode(cause);
      if (code === 3 || code === -3) break; // declined by the user: do not ask again
      continue;
    }
    const verified = await postJson("/api/wallet-auth/verify", { challenge: challenge.data.challenge, ...signed });
    if (verified.ok) return { identity: String(verified.data.identity), error: null };
    lastError = AUTH_ERRORS[String(verified.data.error)] ?? `Sign-in failed (HTTP ${verified.status}).`;
    break;
  }
  return { identity: null, error: lastError };
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("detecting");
  const [installed, setInstalled] = useState<InstalledWallet[]>([]);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState<WalletContextValue["auth"]>({ status: "signed-out", identity: null, error: null });
  const [dialogOpen, setDialogOpen] = useState(false);
  const apiRef = useRef<Cip30Api | null>(null);

  const loadBalance = useCallback(async (api: Cip30Api) => {
    try {
      const value = decodeWalletValue(await api.getBalance());
      setBalance({
        lovelace: value.lovelace,
        token300: assetQuantity(value, TOKEN_300.policyId, TOKEN_300.assetNameHex),
        updatedAt: Date.now(),
      });
      setBalanceError(null);
    } catch (cause) {
      setBalanceError(walletErrorMessage(cause));
    }
  }, []);

  const loadSession = useCallback(async (connected: ConnectedWallet) => {
    try {
      const response = await fetch("/api/wallet-auth/session", { credentials: "same-origin", cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { identity?: string | null };
      const identity = response.ok ? (data.identity ?? null) : null;
      const matches = identity !== null && (identity === connected.stakeAddress || identity === connected.changeAddress);
      setAuth({ status: matches ? "signed-in" : "signed-out", identity: matches ? identity : null, error: null });
    } catch {
      setAuth({ status: "signed-out", identity: null, error: null });
    }
  }, []);

  const connect = useCallback(
    async (key: string) => {
      const target = listInstalledWallets().find((entry) => entry.key === key);
      if (!target) {
        setError("This wallet is no longer available. Reload the page and try again.");
        return;
      }
      setError(null);
      setConnectingKey(key);
      setStatus("connecting");
      try {
        const api = await target.provider.enable();
        const [networkId, rewardAddresses, changeAddressHex] = await Promise.all([
          api.getNetworkId(),
          api.getRewardAddresses().catch(() => [] as string[]),
          api.getChangeAddress(),
        ]);
        const stakeAddressHex = rewardAddresses[0] ?? null;
        const connected: ConnectedWallet = {
          key,
          name: target.name,
          icon: target.icon,
          networkId,
          stakeAddressHex,
          stakeAddress: stakeAddressHex ? addressToBech32(addressBytesFromWallet(stakeAddressHex)) : null,
          changeAddressHex,
          changeAddress: addressToBech32(addressBytesFromWallet(changeAddressHex)),
        };
        apiRef.current = api;
        setWallet(connected);
        setStatus("connected");
        storage.set(key);
        await Promise.all([loadBalance(api), loadSession(connected)]);
      } catch (cause) {
        apiRef.current = null;
        setWallet(null);
        setStatus("disconnected");
        setError(walletErrorMessage(cause));
      } finally {
        setConnectingKey(null);
      }
    },
    [loadBalance, loadSession],
  );

  const disconnect = useCallback(() => {
    apiRef.current = null;
    storage.set(null);
    setWallet(null);
    setBalance(null);
    setBalanceError(null);
    setAuth({ status: "signed-out", identity: null, error: null });
    setStatus("disconnected");
  }, []);

  const refreshBalance = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      await api.getNetworkId();
    } catch (cause) {
      // AccountChange (-4) or a revoked connection: reconnect to pick up the new account.
      if (wallet && walletErrorCode(cause) === -4) await connect(wallet.key);
      else disconnect();
      return;
    }
    await loadBalance(api);
  }, [connect, disconnect, loadBalance, wallet]);

  const signIn = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !wallet) return;
    setAuth({ status: "signing", identity: null, error: null });

    // Prefer the stake address (one identity per wallet); fall back to the
    // change address for wallets that refuse to sign with reward addresses.
    const candidates = [wallet.stakeAddressHex, wallet.changeAddressHex].filter((value): value is string => Boolean(value));
    const result = await signInWithWallet(api, candidates).catch(() => ({
      identity: null,
      error: "Sign-in failed because the server could not be reached.",
    }));
    setAuth(result.identity ? { status: "signed-in", identity: result.identity, error: null } : { status: "signed-out", identity: null, error: result.error });
  }, [wallet]);

  const signOut = useCallback(async () => {
    await postJson("/api/wallet-auth/logout", {}).catch(() => null);
    setAuth({ status: "signed-out", identity: null, error: null });
  }, []);

  // Detect injected wallets and silently restore a previously approved connection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wallets = await waitForWallets();
      if (cancelled) return;
      setInstalled(wallets);
      const saved = storage.get();
      const previous = saved ? wallets.find((entry) => entry.key === saved) : undefined;
      const stillEnabled = previous ? await previous.provider.isEnabled?.().catch(() => false) : false;
      if (cancelled) return;
      if (previous && stillEnabled) await connect(previous.key);
      else setStatus("disconnected");
    })();
    return () => {
      cancelled = true;
    };
  }, [connect]);

  useEffect(() => {
    if (status !== "connected") return;
    const onFocus = () => void refreshBalance();
    const timer = window.setInterval(onFocus, BALANCE_REFRESH_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [status, refreshBalance]);

  const openDialog = useCallback(() => {
    setInstalled(listInstalledWallets());
    setError(null);
    setDialogOpen(true);
  }, []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      installed,
      connectingKey,
      wallet,
      balance,
      balanceError,
      error,
      auth,
      dialogOpen,
      openDialog,
      closeDialog,
      connect,
      disconnect,
      refreshBalance,
      signIn,
      signOut,
    }),
    [status, installed, connectingKey, wallet, balance, balanceError, error, auth, dialogOpen, openDialog, closeDialog, connect, disconnect, refreshBalance, signIn, signOut],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside <WalletProvider>");
  return context;
};
