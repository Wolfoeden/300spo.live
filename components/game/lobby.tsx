"use client";

import { aceArt } from "@/lib/game/card-art";
import { SUIT_COLORS } from "@/lib/game/card-race";
import { LOBBY_LIVE, LOBBY_SOON, type LobbyTile } from "@/lib/game/catalog";
import { RobotFace } from "./arena";

/** The /play lobby: live games as large tiles, announced ones below. */
export function Lobby({ onOpen }: { onOpen(slug: string): void }) {
  const [feature, ...others] = LOBBY_LIVE;
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="live-games">
        <h2 id="live-games" className="kicker">
          Play now
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Tile tile={feature} onOpen={onOpen} large tag="New · 4× mode" />
          <div className="grid gap-4">
            {others.map((tile) => (
              <Tile key={tile.slug} tile={tile} onOpen={onOpen} />
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="soon-games">
        <h2 id="soon-games" className="kicker">
          Coming soon
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {LOBBY_SOON.map((tile) => (
            <Tile key={tile.slug} tile={tile} small />
          ))}
        </div>
      </section>
    </div>
  );
}

function Tile({ tile, onOpen, large, small, tag }: { tile: LobbyTile; onOpen?(slug: string): void; large?: boolean; small?: boolean; tag?: string }) {
  const live = !!tile.game && !!onOpen;
  const body = (
    <>
      <div
        className={`relative overflow-hidden bg-[radial-gradient(circle_at_50%_35%,#2a2211,#0b0b0c_70%)] ${
          large ? "aspect-[16/10] sm:aspect-[16/9]" : small ? "aspect-[4/3]" : "aspect-[16/9]"
        }`}
      >
        <div aria-hidden="true" className="grid-backdrop absolute inset-0 opacity-40" />
        <div className={`absolute inset-0 transition duration-500 ${live ? "group-hover:scale-[1.04]" : "grayscale-[0.6] opacity-70"}`}>
          <Art slug={tile.slug} />
        </div>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-night to-transparent" />
        <span
          className={`absolute left-3 top-3 rounded-full px-2.5 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] ${
            live ? "bg-gold/90 text-[#1a1204]" : "border border-line-strong bg-ink/80 text-muted"
          }`}
        >
          {tile.badge}
        </span>
        {tag && (
          <span className="absolute bottom-3 right-3 z-10 rounded-full border border-gold/40 bg-ink/85 px-2.5 py-1 text-[0.65rem] font-semibold text-gold-bright">
            {tag}
          </span>
        )}
      </div>
      <div className={`flex items-end justify-between gap-3 ${small ? "p-3" : "p-4 sm:p-5"}`}>
        <div className="min-w-0">
          <h3 className={`font-semibold tracking-tight ${large ? "text-2xl" : small ? "text-sm" : "text-lg"}`}>{tile.title}</h3>
          <p className={`mt-1 text-muted ${small ? "line-clamp-2 text-xs" : "text-sm"}`}>{tile.tagline}</p>
        </div>
        {live && (
          <span className="btn btn-gold shrink-0 !px-4 !py-2 text-sm">
            Play
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          </span>
        )}
      </div>
    </>
  );
  const frame = `group relative block overflow-hidden rounded-3xl border bg-night text-left transition ${
    live ? "border-line hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-[0_24px_60px_-30px_rgba(233,180,76,0.5)]" : "border-line/70"
  }`;
  return live ? (
    <button type="button" className={frame} onClick={() => onOpen!(tile.slug)} aria-label={`Play ${tile.title}`}>
      {body}
    </button>
  ) : (
    <div className={frame} aria-disabled="true">
      {body}
    </div>
  );
}

function Art({ slug }: { slug: string }) {
  switch (slug) {
    case "horse-race":
      return <AcesArt />;
    case "coin-flip":
      return <CoinArt />;
    case "xerxes-vs-robot":
      return <DuelArt />;
    case "chicken":
      return <ChickenArt />;
    case "dice":
      return <DiceArt />;
    case "sparta-board":
      return <BoardArt />;
    case "wheel":
      return <WheelArt />;
    default:
      return null;
  }
}

/** Four legendary aces fanned like a hand of cards. */
function AcesArt() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="relative h-[62%] w-[70%]">
        {[0, 1, 2, 3].map((suit) => {
          const art = aceArt(suit);
          const offset = suit - 1.5;
          return (
            <span
              key={suit}
              className="absolute bottom-0 left-1/2 aspect-[5/7] h-full overflow-hidden rounded-xl border-2 border-gold-bright shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] transition duration-500 group-hover:translate-y-[-4%]"
              style={{
                transform: `translateX(calc(-50% + ${offset * 30}%)) rotate(${offset * 9}deg)`,
                transformOrigin: "50% 120%",
                outline: `2px solid ${SUIT_COLORS[suit]}`,
                outlineOffset: "2px",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art.src} alt={art.alt} className="size-full object-cover object-top" />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CoinArt() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="relative h-[58%] aspect-square">
        <span className="absolute inset-[-15%] rounded-full bg-gold/25 blur-3xl" />
        <span className="absolute right-[-22%] top-[8%] grid size-[78%] place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffe7a8,#e9b44c_45%,#a8691c)] shadow-xl ring-2 ring-gold-bright/60 [transform:rotateY(35deg)_rotate(12deg)]">
          <span className="text-[2.2rem] font-black tracking-tight text-[#2a1a03] sm:text-5xl">300</span>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/300-logo.jpg" alt="" className="relative size-full rounded-full shadow-[0_24px_60px_-20px_rgba(233,180,76,0.7)] ring-2 ring-gold-bright/60" />
      </div>
    </div>
  );
}

function DuelArt() {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/300-logo.jpg" alt="" className="h-[52%] rounded-full ring-2 ring-gold/60" />
      <span className="font-mono text-xs text-faint">VS</span>
      <span className="block h-[52%] aspect-square overflow-hidden rounded-full ring-2 ring-[#8fd3ff]/50">
        <RobotFace />
      </span>
    </div>
  );
}

/** A slice of the road: lanes with rising multipliers and the blue cock on his way. */
function ChickenArt() {
  const plates = ["1.04×", "1.08×", "1.13×", "1.19×"];
  return (
    <div className="absolute inset-0 flex items-center bg-[linear-gradient(180deg,#1b1c20,#141518)]">
      <div className="flex h-full w-full">
        {plates.map((plate, index) => (
          <div key={plate} className="relative flex-1 border-l-2 border-dashed border-gold/25">
            <span
              className={`absolute left-1/2 top-1/2 grid aspect-square w-[62%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-[0.6rem] font-bold sm:text-xs ${
                index === 0 ? "border-gold-bright bg-gold text-[#1a1204]" : "border-white/15 bg-[#1f2024] text-faint"
              }`}
            >
              {plate}
            </span>
          </div>
        ))}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/game/chicken-cock.jpg"
        alt="The blue cock"
        className="absolute left-[16%] top-1/2 h-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-gold-bright shadow-2xl"
      />
    </div>
  );
}

function DiceArt() {
  const pips = (values: number[][]) =>
    values.map(([cx, cy], index) => <circle key={index} cx={cx} cy={cy} r="5" fill="#1a1204" />);
  return (
    <svg viewBox="0 0 200 150" className="absolute inset-0 size-full" aria-hidden="true">
      <defs>
        <linearGradient id="die" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffe7a8" />
          <stop offset="1" stopColor="#c98a2b" />
        </linearGradient>
      </defs>
      <g transform="translate(52 42) rotate(-14 30 30)">
        <rect width="60" height="60" rx="12" fill="url(#die)" />
        {pips([[15, 15], [45, 15], [30, 30], [15, 45], [45, 45]])}
      </g>
      <g transform="translate(100 56) rotate(12 30 30)">
        <rect width="60" height="60" rx="12" fill="url(#die)" />
        {pips([[15, 15], [45, 15], [15, 30], [45, 30], [15, 45], [45, 45]])}
      </g>
    </svg>
  );
}

function BoardArt() {
  const squares = Array.from({ length: 16 }, (_, index) => {
    const side = Math.floor(index / 4);
    const step = index % 4;
    const [x, y] = [
      [30 + step * 30, 20],
      [150, 20 + step * 28],
      [150 - step * 30, 132],
      [30, 132 - step * 28],
    ][side];
    return <rect key={index} x={x - 12} y={y - 11} width="24" height="22" rx="4" fill={SUIT_COLORS[index % 4]} opacity="0.75" />;
  });
  return (
    <svg viewBox="0 0 180 152" className="absolute inset-0 size-full p-3" aria-hidden="true">
      {squares}
      <circle cx="90" cy="76" r="20" fill="#e9b44c" opacity="0.9" />
      <text x="90" y="82" textAnchor="middle" fontSize="16" fontWeight="800" fill="#1a1204">
        300
      </text>
    </svg>
  );
}

function WheelArt() {
  const segments = 12;
  return (
    <svg viewBox="0 0 160 160" className="absolute inset-0 size-full p-3" aria-hidden="true">
      <g transform="translate(80 84)">
        {Array.from({ length: segments }, (_, index) => {
          const a0 = (index / segments) * Math.PI * 2;
          const a1 = ((index + 1) / segments) * Math.PI * 2;
          const path = `M0 0 L${Math.cos(a0) * 58} ${Math.sin(a0) * 58} A58 58 0 0 1 ${Math.cos(a1) * 58} ${Math.sin(a1) * 58} Z`;
          return <path key={index} d={path} fill={index % 3 === 0 ? "#e9b44c" : SUIT_COLORS[index % 4]} opacity={index % 3 === 0 ? 0.95 : 0.7} />;
        })}
        <circle r="58" fill="none" stroke="#f3cf73" strokeWidth="3" />
        <circle r="12" fill="#0b0b0c" stroke="#f3cf73" strokeWidth="3" />
      </g>
      <path d="M80 16 l8 14 h-16 z" fill="#f3cf73" />
    </svg>
  );
}
