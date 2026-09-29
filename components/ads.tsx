import { ArrowUpRight } from "./icons";

export const PARTNER_LINKS = {
  midnight: "https://midnight.network",
  realfi: "https://realfi.co",
} as const;

// Windows of the skyline: [x, y, lit] in the 400×160 viewBox, fixed so the render is stable.
const TOWERS = [
  [0, 70, 34],
  [38, 40, 30],
  [72, 88, 26],
  [102, 22, 40],
  [146, 58, 30],
  [180, 34, 36],
  [220, 80, 28],
  [252, 12, 44],
  [300, 52, 32],
  [336, 30, 38],
  [378, 76, 22],
] as const;

function Skyline() {
  return (
    <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice" className="absolute inset-x-0 bottom-0 h-full w-full opacity-60" aria-hidden="true">
      <defs>
        <linearGradient id="tower" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2b3a8f" />
          <stop offset="1" stopColor="#0a0f33" />
        </linearGradient>
      </defs>
      {TOWERS.map(([x, top, width], index) => (
        <g key={x}>
          <rect x={x} y={top} width={width} height={160 - top} fill="url(#tower)" />
          {Array.from({ length: Math.floor((160 - top - 10) / 12) }, (_, row) =>
            Array.from({ length: Math.floor((width - 6) / 8) }, (_, column) => {
              const lit = (index * 7 + row * 3 + column * 5) % 4 === 0;
              return lit ? (
                <rect
                  key={`${row}-${column}`}
                  x={x + 4 + column * 8}
                  y={top + 8 + row * 12}
                  width="3"
                  height="4"
                  fill="#c9d4ff"
                  className={(row + column + index) % 5 === 0 ? "animate-pulse" : undefined}
                  opacity="0.85"
                />
              ) : null;
            }),
          )}
        </g>
      ))}
    </svg>
  );
}

/** Paid placement for Midnight City, labelled as such. */
export function MidnightCityAd() {
  return (
    <aside aria-label="Sponsored" className="container-site py-12 sm:py-16">
      <a
        href="https://midnight.city"
        target="_blank"
        rel="sponsored noopener noreferrer"
        className="group relative block overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(115deg,#04051a_0%,#0a1142_55%,#1a2170_100%)] p-6 transition hover:border-white/25 sm:p-10"
      >
        <div className="absolute inset-y-0 right-0 w-full sm:w-3/5">
          <Skyline />
          <div className="absolute inset-0 bg-gradient-to-r from-[#04051a] via-[#04051a]/40 to-transparent" />
        </div>
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-white/25 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-white/70">
                Sponsored
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/partners/midnight-logo-white.svg" alt="Midnight" className="h-4 w-auto opacity-90" />
            </div>
            <p className="mt-5 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-5xl">Midnight City</p>
            <p className="mt-2 max-w-sm text-white/70">A living city of AI agents, running on Midnight.</p>
          </div>
          <span className="btn w-full shrink-0 bg-white text-sm text-[#04051a] transition group-hover:bg-[#dfe5ff] sm:w-auto sm:text-[0.925rem]">
            Enter Midnight City <ArrowUpRight size={16} />
          </span>
        </div>
      </a>
    </aside>
  );
}

/** Slim link to RealFi below the partner showcase. */
export function RealFiBanner() {
  return (
    <a
      href={PARTNER_LINKS.realfi}
      target="_blank"
      rel="noopener noreferrer"
      className="group mt-5 flex flex-col gap-4 rounded-3xl border border-line bg-panel px-6 py-5 transition hover:border-gold/40 sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/partners/realfi-logo-white.svg" alt="RealFi" className="h-6 w-auto" />
        <span className="text-muted">USDr — a stablecoin backed by real-world assets.</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gold group-hover:text-gold-bright">
        Visit RealFi <ArrowUpRight size={14} />
      </span>
    </a>
  );
}
