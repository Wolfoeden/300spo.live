"use client";

import { formatTokenAmount } from "@/lib/format";
import { DEGEN_COLLECTION_URL } from "@/lib/game/card-art";
import { GAME_COPY, formatMultiplier, type GameId } from "@/lib/game/catalog";
import { InfoBubble } from "../info-bubble";
import { BalanceChip } from "./arena-effects";

/** The frame around a running game: back to the lobby, title with its rules, optional mode switch, balance. */
export function GameFrame({
  gameId,
  payoutBps,
  balance,
  onBack,
  toolbar,
  info,
  children,
}: {
  gameId: GameId;
  payoutBps: number;
  balance: number;
  onBack(): void;
  toolbar?: React.ReactNode;
  /** Rules for the info bubble when the default "pick and payout" text does not fit. */
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  const copy = GAME_COPY[gameId];
  const race = gameId === "card-race";
  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-night">
      <div aria-hidden="true" className="grid-backdrop absolute inset-0 opacity-50" />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-2 py-2 sm:px-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm text-muted transition hover:bg-white/5 hover:text-text"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">All games</span>
          </button>
          <h2 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
            {copy.title}
            <InfoBubble label={`How ${copy.title} works`}>
              {info ?? (
                <>
                  <span className="block">{copy.tagline}</span>
                  <span className="mt-2 block">
                    {race ? "A correct pick pays the odds shown under its ace." : `A correct pick pays ${formatMultiplier(payoutBps)} your bet.`}
                  </span>
                  {race && <span className="mt-2 block">In 4× mode four races run at once, each with its own track and odds and the same bet.</span>}
                  {race && (
                    <span className="mt-2 block text-xs text-faint">
                      Card art:{" "}
                      <a href={DEGEN_COLLECTION_URL} target="_blank" rel="noreferrer" className="text-gold-bright underline-offset-2 hover:underline">
                        300 DEGEN NFTs
                      </a>
                    </span>
                  )}
                </>
              )}
            </InfoBubble>
          </h2>
          {toolbar}
          <div className="ml-auto">
            <BalanceChip value={balance} />
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

/** Segmented switch between one race and four races at once. */
export function ModeSwitch({ quad, onChange, disabled }: { quad: boolean; onChange(quad: boolean): void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Races at once" className="flex rounded-full border border-line bg-ink/60 p-0.5 text-xs font-semibold">
      {[false, true].map((value) => (
        <button
          key={String(value)}
          type="button"
          role="radio"
          aria-checked={quad === value}
          disabled={disabled}
          onClick={() => onChange(value)}
          className={`rounded-full px-3 py-1 transition disabled:opacity-50 ${quad === value ? "bg-gold/20 text-gold-bright" : "text-muted hover:text-text"}`}
        >
          {value ? "4×" : "1×"}
        </button>
      ))}
    </div>
  );
}

/** Bet chips from the minimum to the maximum in the configured steps. */
export function BetChips({
  bets,
  bet,
  onChange,
  disabled,
  affordable,
}: {
  bets: { min: number; max: number; step: number };
  bet: number;
  onChange(bet: number): void;
  disabled: boolean;
  /** Whether a chip's amount can be paid (4× mode multiplies it by the races picked). */
  affordable(amount: number): boolean;
}) {
  const amounts: number[] = [];
  for (let amount = bets.min; amount <= bets.max; amount += bets.step) amounts.push(amount);
  return (
    <div className="flex flex-wrap gap-2">
      {amounts.map((amount) => (
        <button
          key={amount}
          type="button"
          onClick={() => onChange(amount)}
          disabled={disabled || !affordable(amount)}
          aria-pressed={bet === amount}
          className={`rounded-full border px-3 py-1.5 text-xs tabular-nums transition disabled:opacity-40 ${
            bet === amount ? "border-gold bg-gold/15 text-gold-bright" : "border-line text-muted hover:border-gold/40"
          }`}
        >
          {formatTokenAmount(BigInt(amount))}
        </button>
      ))}
    </div>
  );
}
