"use client";

import { SUIT_COLORS } from "@/lib/game/card-race";
import { STRATEGIES, STRATEGY_SUIT, type RaceStrategy } from "@/lib/game/race-strategy";
import { Kbd } from "./game-frame";

/** The strategy switch in the race terminal; tapping the active one turns it off again. */
export function StrategyPicker({ value, onChange, disabled }: { value: RaceStrategy | null; onChange(next: RaceStrategy | null): void; disabled?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 hidden items-center gap-1.5 text-[0.7rem] text-faint lg:flex">
        Pick for me
        <Kbd>B</Kbd>
        <Kbd>R</Kbd>
        <Kbd>L</Kbd>
        <Kbd>M</Kbd>
        <Kbd>H</Kbd>
      </p>
      <div className="grid grid-cols-5 gap-1 rounded-xl border border-line bg-ink/60 p-0.5" role="group" aria-label="Pick for me">
        {STRATEGIES.map((entry) => {
          const suit = STRATEGY_SUIT[entry.id];
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onChange(value === entry.id ? null : entry.id)}
              disabled={disabled}
              aria-pressed={value === entry.id}
              aria-keyshortcuts={entry.key.toUpperCase()}
              title={entry.name}
              className={`flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 lg:py-2 ${
                value === entry.id ? "bg-gold/20 text-gold-bright" : "text-muted enabled:hover:text-text"
              }`}
            >
              {suit !== undefined && <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: SUIT_COLORS[suit] }} />}
              {entry.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
