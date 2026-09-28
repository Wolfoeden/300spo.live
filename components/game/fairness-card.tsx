"use client";

import { useEffect, useState } from "react";
import { choiceLabel } from "@/lib/game/catalog";
import { raceDeck, runRace } from "@/lib/game/card-race";
import { sha256Hex, verifyOutcome } from "@/lib/game/fair";
import { Check, Spinner } from "../icons";

export type Fairness = {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  revealed: { serverSeed: string; serverSeedHash: string; clientSeed: string; lastNonce: number; revealedAt: string }[];
};

type Round = { id: number; game: string; outcome: number; nonce: number; serverSeedHash: string; clientSeed: string };
type SeedCheck = { seedOk: boolean; checked: number; mismatches: number[] };

const CLIENT_SEED = /^[A-Za-z0-9_-]{1,64}$/;

const checkSeeds = async (revealed: Fairness["revealed"], rounds: Round[], outcomes: Record<string, number>) => {
  const results: Record<string, SeedCheck> = {};
  for (const seed of revealed) {
    const seedOk = (await sha256Hex(seed.serverSeed)) === seed.serverSeedHash;
    const played = rounds.filter((round) => round.serverSeedHash === seed.serverSeedHash);
    const mismatches: number[] = [];
    for (const round of played) {
      const outcome =
        round.game === "card-race"
          ? runRace(await raceDeck(seed.serverSeed, round.clientSeed, round.nonce)).winner
          : await verifyOutcome({ serverSeed: seed.serverSeed, clientSeed: round.clientSeed, nonce: round.nonce, outcomes: outcomes[round.game] ?? 2 });
      if (outcome !== round.outcome) mismatches.push(round.id);
    }
    results[seed.serverSeedHash] = { seedOk, checked: played.length, mismatches };
  }
  return results;
};

/**
 * Shows the committed server seed hash and lets the player reveal it. A revealed
 * seed is checked right here: its SHA-256 must match the commitment, and every
 * round played with it must recompute to the stored outcome.
 */
export function FairnessCard({
  rounds,
  outcomes,
  load,
  rotate,
}: {
  rounds: Round[];
  outcomes: Record<string, number>;
  load(): Promise<Fairness>;
  rotate(clientSeed: string | null): Promise<Fairness>;
}) {
  const [fairness, setFairness] = useState<Fairness | null>(null);
  const [clientSeed, setClientSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, SeedCheck>>({});
  const roundKey = rounds.map((round) => round.id).join(",");

  useEffect(() => {
    let active = true;
    load().then(
      (loaded) => active && setFairness(loaded),
      () => active && setError("Could not load the fairness data."),
    );
    return () => {
      active = false;
    };
    // Reload after every round so the nonce stays current.
  }, [load, roundKey]);

  useEffect(() => {
    if (!fairness?.revealed.length) return;
    let active = true;
    checkSeeds(fairness.revealed, rounds, outcomes).then((results) => active && setChecks(results));
    return () => {
      active = false;
    };
  }, [fairness, rounds, outcomes]);

  const reveal = async () => {
    const seed = clientSeed.trim();
    if (seed && !CLIENT_SEED.test(seed)) {
      setError("Client seed: 1–64 letters, digits, - or _.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setFairness(await rotate(seed || null));
      setClientSeed("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rotate the seed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-line p-6 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Provably fair</h3>
        <p className="text-xs text-faint">
          outcome = HMAC-SHA256(server seed, &quot;client seed:nonce&quot;), first 4 bytes × outcomes ÷ 2³² · horse race: the deck is shuffled with
          HMAC(server seed, &quot;client seed:nonce:race:n&quot;)
        </p>
      </div>
      {!fairness ? (
        <p className="mt-3 text-sm text-muted">{error ?? "Loading…"}</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt className="text-faint">Server seed hash</dt>
            <dd className="break-all font-mono text-xs">{fairness.serverSeedHash}</dd>
            <dt className="text-faint">Client seed</dt>
            <dd className="break-all font-mono text-xs">{fairness.clientSeed}</dd>
            <dt className="text-faint">Rounds on this seed</dt>
            <dd className="font-mono text-xs">{fairness.nonce}</dd>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              value={clientSeed}
              onChange={(event) => setClientSeed(event.target.value)}
              placeholder="New client seed (optional)"
              maxLength={64}
              className="min-w-0 flex-1 rounded-xl border border-line-strong bg-ink px-3 py-2 font-mono text-xs outline-none focus:border-gold"
              disabled={busy}
            />
            <button className="btn btn-ghost !py-2 text-sm" onClick={reveal} disabled={busy}>
              {busy && <Spinner size={14} />}
              Reveal seed &amp; start new
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}

          {fairness.revealed.length > 0 && (
            <ul className="mt-5 divide-y divide-line border-t border-line text-xs">
              {fairness.revealed.map((seed) => {
                const check = checks[seed.serverSeedHash];
                const ok = check && check.seedOk && check.mismatches.length === 0;
                return (
                  <li key={seed.serverSeedHash} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-muted">server seed {seed.serverSeed}</p>
                      <p className="font-mono text-faint">
                        client seed {seed.clientSeed} · nonces 1–{seed.lastNonce}
                      </p>
                    </div>
                    <span className={check ? (ok ? "text-positive" : "text-danger") : "text-faint"}>
                      {!check ? (
                        "Checking…"
                      ) : !check.seedOk ? (
                        "Hash does not match"
                      ) : check.mismatches.length ? (
                        `Rounds ${check.mismatches.map((id) => `#${id}`).join(", ")} do not match`
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Check size={12} /> {check.checked ? `${check.checked} round${check.checked === 1 ? "" : "s"} verified` : "Hash verified"}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** "Xerxes → 300" style label for a round's pick and result. */
export const roundSummary = (round: { game: string; choice: number; outcome: number }) =>
  `${choiceLabel(round.game, round.choice)} → ${choiceLabel(round.game, round.outcome)}`;
