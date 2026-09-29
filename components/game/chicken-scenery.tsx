"use client";

import { cosmetic } from "@/lib/game/catalog";

// The scenery around the Chicken road: a panorama along the top edge (sky,
// river, Sparta's buildings and trees, the curb with its lamps), the vehicles
// that come out of it, and a few artifacts on the sidewalks. Everything is
// drawn from a fixed seed, so the same road always looks the same.

/** Height the panorama is drawn at; it is scaled to the band it gets. */
const BAND = 140;
const STONE = "#c9b98f";
const STONE_DARK = "#8d7f5c";
const WALL = "#23262f";
const WALL_EDGE = "#323744";
const LEAF = "#1f3b27";
const LEAF_LIGHT = "#2c5536";
const WINDOW = "#e9b44c";

type Piece = { x: number; kind: "house" | "tower" | "temple" | "shop" | "tree" | "cypress" | "olive" | "amphora" | "column" | "statue"; seed: number };

const WIDTH: Record<Piece["kind"], number> = {
  house: 54,
  tower: 30,
  temple: 96,
  shop: 58,
  tree: 34,
  cypress: 16,
  olive: 40,
  amphora: 14,
  column: 18,
  statue: 22,
};
const KINDS: Piece["kind"][] = ["house", "tree", "shop", "cypress", "tower", "olive", "house", "column", "tree", "amphora", "statue", "cypress"];

/** The panorama over the top of the road: \`width\` and \`height\` in pixels, \`marks\` = lane edges in pixels. */
export function Skyline({ width, height, marks }: { width: number; height: number; marks: number[] }) {
  const scale = height / BAND;
  const span = width / scale;
  // Buildings, trees and artifacts side by side; a temple every so often.
  const pieces: Piece[] = [];
  for (let x = 6, index = 0; x < span; index += 1) {
    const kind = index % 9 === 4 ? "temple" : KINDS[Math.floor(cosmetic(index, 1) * KINDS.length)];
    pieces.push({ x, kind, seed: index });
    x += WIDTH[kind] + 4 + cosmetic(index, 2) * 14;
  }
  const stars = Array.from({ length: Math.round(span / 38) }, (_, index) => ({
    x: cosmetic(index, 3) * span,
    y: 4 + cosmetic(index, 4) * 50,
    r: 0.5 + cosmetic(index, 5) * 1.1,
    delay: cosmetic(index, 6) * 3,
  }));
  const bushes = Array.from({ length: Math.round(span / 46) }, (_, index) => ({ x: index * 46 + cosmetic(index, 7) * 30, r: 5 + cosmetic(index, 8) * 5 }));
  const hills = Array.from({ length: Math.ceil(span / 40) + 1 }, (_, index) => `L${index * 40} ${74 - Math.sin(index * 0.9) * 6 - cosmetic(index, 9) * 8}`).join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${span} ${BAND}`} preserveAspectRatio="none" className="block" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#070a12" />
          <stop offset="1" stopColor="#141a27" />
        </linearGradient>
        <radialGradient id="lamp-glow">
          <stop offset="0" stopColor="#ffd779" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd779" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width={span} height={BAND} fill="url(#sky)" />
      {stars.map((star, index) => (
        <circle key={index} cx={star.x} cy={star.y} r={star.r} fill="#fff4d6" className="animate-twinkle" style={{ animationDelay: `-${star.delay}s` }} />
      ))}
      <circle cx={span * 0.72} cy={24} r={10} fill="#f3e3b0" opacity="0.9" />
      <circle cx={span * 0.72 + 4} cy={21} r={9} fill="#141a27" opacity="0.55" />

      {/* far hills and the river in front of them */}
      <path d={`M0 90 ${hills} L${span} 90 Z`} fill="#111726" />
      <rect y={84} width={span} height={18} fill="#16304d" />
      {[88, 93, 98].map((y, index) => (
        <line
          key={y}
          x1={0}
          x2={span}
          y1={y}
          y2={y}
          stroke="#6d9ad0"
          strokeOpacity={0.45 - index * 0.1}
          strokeWidth={1.2}
          strokeDasharray={`${6 + index * 3} ${14 + index * 5}`}
          className="animate-river"
          style={{ animationDuration: `${4 + index * 1.5}s` }}
        />
      ))}

      {/* the near bank */}
      <rect y={100} width={span} height={26} fill="#151c18" />
      {pieces.map((piece) => (
        <g key={piece.seed} transform={`translate(${piece.x} 0)`}>
          <Building piece={piece} />
        </g>
      ))}
      {bushes.map((bush, index) => (
        <g key={index} transform={`translate(${bush.x} 124)`} fill={index % 3 ? LEAF : LEAF_LIGHT}>
          <circle cx={0} cy={-bush.r * 0.6} r={bush.r} />
          <circle cx={bush.r * 0.9} cy={-bush.r * 0.4} r={bush.r * 0.8} />
          <circle cx={-bush.r * 0.8} cy={-bush.r * 0.35} r={bush.r * 0.7} />
        </g>
      ))}

      {/* the curb, with a lamp at every lane edge */}
      <rect y={124} width={span} height={16} fill="#2a2b31" />
      <rect y={124} width={span} height={1.5} fill="#44464f" />
      <rect y={138} width={span} height={2} fill="#e9b44c" opacity="0.55" />
      {marks.map((mark, index) => (
        <g key={index} transform={`translate(${mark / scale} 0)`}>
          <circle cx={6} cy={98} r={16} fill="url(#lamp-glow)" />
          <rect x={-1.2} y={96} width={2.4} height={40} fill="#4a4d57" />
          <path d="M0 97 Q0 92 6 92" stroke="#4a4d57" strokeWidth="2" fill="none" />
          <rect x={3} y={92} width={7} height={4} rx={1.5} fill="#2f323b" />
          <rect x={4} y={95.5} width={5} height={2} rx={1} fill="#ffe7a8" />
        </g>
      ))}
    </svg>
  );
}

function Building({ piece }: { piece: Piece }) {
  const { kind, seed } = piece;
  const lit = (index: number) => cosmetic(seed * 7 + index, 11) > 0.45;
  switch (kind) {
    case "house": {
      const height = 30 + cosmetic(seed, 12) * 22;
      const top = 118 - height;
      return (
        <g>
          <rect x={2} y={top} width={50} height={height} fill={WALL} stroke={WALL_EDGE} />
          <path d={`M0 ${top} L27 ${top - 14} L54 ${top} Z`} fill="#3a2a22" stroke="#4a372c" />
          {[0, 1, 2].map((column) =>
            Array.from({ length: Math.floor(height / 14) }, (_, row) => (
              <rect key={`${column}-${row}`} x={8 + column * 15} y={top + 6 + row * 14} width={8} height={7} fill={lit(column * 5 + row) ? WINDOW : "#0f1116"} opacity={0.85} />
            )),
          )}
        </g>
      );
    }
    case "tower": {
      const height = 58 + cosmetic(seed, 13) * 20;
      const top = 118 - height;
      return (
        <g>
          <rect x={2} y={top} width={26} height={height} fill={WALL} stroke={WALL_EDGE} />
          <rect x={0} y={top - 4} width={30} height={5} fill={WALL_EDGE} />
          {Array.from({ length: Math.floor(height / 11) }, (_, row) => (
            <rect key={row} x={9} y={top + 5 + row * 11} width={12} height={5} fill={lit(row) ? WINDOW : "#0f1116"} opacity={0.8} />
          ))}
        </g>
      );
    }
    case "temple":
      return (
        <g>
          <rect x={4} y={110} width={88} height={8} fill={STONE_DARK} />
          <rect x={0} y={116} width={96} height={4} fill={STONE} />
          {[0, 1, 2, 3, 4, 5].map((column) => (
            <g key={column}>
              <rect x={10 + column * 15} y={74} width={6} height={36} fill={STONE} />
              <rect x={9 + column * 15} y={72} width={8} height={3} fill={STONE_DARK} />
            </g>
          ))}
          <rect x={4} y={66} width={88} height={7} fill={STONE} />
          <path d="M2 66 L48 48 L94 66 Z" fill={STONE_DARK} stroke={STONE} />
          <circle cx={48} cy={59} r={4} fill="#e9b44c" />
        </g>
      );
    case "shop":
      return (
        <g>
          <rect x={2} y={82} width={54} height={36} fill={WALL} stroke={WALL_EDGE} />
          {[0, 1, 2, 3, 4, 5].map((stripe) => (
            <rect key={stripe} x={2 + stripe * 9} y={82} width={9} height={8} fill={stripe % 2 ? "#e9b44c" : "#7d1d18"} />
          ))}
          <rect x={8} y={96} width={18} height={14} fill={WINDOW} opacity="0.7" />
          <rect x={32} y={96} width={16} height={22} fill="#0f1116" />
        </g>
      );
    case "tree":
      return (
        <g>
          <rect x={15} y={98} width={4} height={20} fill="#3b2a1d" />
          <circle cx={17} cy={90} r={15} fill={LEAF} />
          <circle cx={11} cy={86} r={8} fill={LEAF_LIGHT} />
        </g>
      );
    case "cypress":
      return (
        <g>
          <rect x={7} y={108} width={2.5} height={10} fill="#3b2a1d" />
          <ellipse cx={8} cy={84} rx={7} ry={26} fill="#18301f" />
          <ellipse cx={6} cy={80} rx={3} ry={16} fill={LEAF_LIGHT} opacity="0.6" />
        </g>
      );
    case "olive":
      return (
        <g>
          <path d="M20 118 Q18 104 22 96" stroke="#4a3a2a" strokeWidth="4" fill="none" />
          <ellipse cx={20} cy={90} rx={19} ry={11} fill="#4d5a3f" />
          <ellipse cx={14} cy={86} rx={9} ry={6} fill="#65744f" />
        </g>
      );
    case "amphora":
      return (
        <g>
          <path d="M4 104 Q1 98 5 94 L5 90 L9 90 L9 94 Q13 98 10 104 Q12 112 7 118 Q2 112 4 104 Z" fill="#b5652c" stroke="#e39a55" strokeWidth="0.8" />
          <path d="M3 104 L11 104" stroke="#1a1204" strokeWidth="1.2" />
        </g>
      );
    case "column":
      return (
        <g>
          <rect x={3} y={88 + cosmetic(seed, 14) * 12} width={12} height={30} fill={STONE} />
          <rect x={1} y={114} width={16} height={4} fill={STONE_DARK} />
          <path d="M6 90 L6 118 M10 90 L10 118" stroke={STONE_DARK} strokeWidth="0.8" />
        </g>
      );
    case "statue":
      return (
        <g>
          <rect x={2} y={104} width={18} height={14} fill={STONE_DARK} />
          {/* a Spartan helmet on its pedestal */}
          <path d="M5 104 Q4 90 11 88 Q18 90 17 104 L14 104 L14 98 L8 98 L8 104 Z" fill="#d6a64a" stroke="#8a6420" strokeWidth="0.8" />
          <path d="M6 90 Q11 78 18 86" stroke="#bb3128" strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
  }
}

export type VehicleKind = "sedan" | "taxi" | "truck" | "bus" | "bike" | "chariot";
const VEHICLES: VehicleKind[] = ["sedan", "taxi", "truck", "sedan", "bus", "bike", "chariot", "sedan", "truck", "bike"];

/** The vehicle of a lane, the same every time the road is drawn. */
export const laneVehicle = (lane: number): VehicleKind => VEHICLES[Math.floor(cosmetic(lane, 11) * VEHICLES.length)];

/** Vehicles seen from above, driving down the screen (front at the bottom). */
export function Vehicle({ kind, color }: { kind: VehicleKind; color: string }) {
  switch (kind) {
    case "taxi":
      return (
        <svg viewBox="0 0 36 64" width="36" height="64" aria-hidden="true">
          <rect x="2" y="2" width="32" height="60" rx="9" fill="#e9b44c" stroke="#1a1204" strokeWidth="2" />
          <rect x="7" y="12" width="22" height="10" rx="3" fill="#1a1204" opacity="0.65" />
          <rect x="7" y="42" width="22" height="8" rx="3" fill="#1a1204" opacity="0.55" />
          <rect x="11" y="27" width="14" height="7" rx="2" fill="#fff4d6" stroke="#1a1204" />
          <rect x="5" y="56" width="7" height="4" rx="1.5" fill="#ffe7a8" />
          <rect x="24" y="56" width="7" height="4" rx="1.5" fill="#ffe7a8" />
        </svg>
      );
    case "truck":
      return (
        <svg viewBox="0 0 40 96" width="40" height="96" aria-hidden="true">
          <rect x="2" y="2" width="36" height="64" rx="3" fill="#3a3d46" stroke={color} strokeWidth="2" />
          <path d="M8 10 H32 M8 22 H32 M8 34 H32 M8 46 H32 M8 58 H32" stroke="#555a66" strokeWidth="1.5" />
          <rect x="4" y="68" width="32" height="26" rx="6" fill="#0f1013" stroke={color} strokeWidth="2" />
          <rect x="8" y="80" width="24" height="7" rx="2" fill="#8fb1ff" opacity="0.35" />
          <rect x="6" y="89" width="7" height="4" rx="1.5" fill="#ffe7a8" />
          <rect x="27" y="89" width="7" height="4" rx="1.5" fill="#ffe7a8" />
        </svg>
      );
    case "bus":
      return (
        <svg viewBox="0 0 42 112" width="42" height="112" aria-hidden="true">
          <rect x="2" y="2" width="38" height="108" rx="8" fill="#7d1d18" stroke="#e9b44c" strokeWidth="2" />
          <rect x="7" y="6" width="28" height="96" rx="4" fill="#5c1512" />
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <rect key={row} x="9" y={10 + row * 15} width="24" height="9" rx="2" fill="#ffd779" opacity="0.35" />
          ))}
          <rect x="8" y="96" width="26" height="8" rx="2" fill="#8fb1ff" opacity="0.4" />
          <rect x="6" y="104" width="8" height="4" rx="1.5" fill="#ffe7a8" />
          <rect x="28" y="104" width="8" height="4" rx="1.5" fill="#ffe7a8" />
        </svg>
      );
    case "bike":
      return (
        <svg viewBox="0 0 20 46" width="20" height="46" aria-hidden="true">
          <rect x="8" y="2" width="4" height="12" rx="2" fill="#15161a" />
          <rect x="8" y="32" width="4" height="12" rx="2" fill="#15161a" />
          <rect x="6" y="12" width="8" height="22" rx="3" fill={color} />
          <path d="M2 34 H18" stroke="#9ea3b0" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="22" r="5.5" fill="#101114" stroke={color} strokeWidth="1.5" />
          <rect x="8.5" y="42" width="3" height="3" rx="1" fill="#ffe7a8" />
        </svg>
      );
    case "chariot":
      return (
        <svg viewBox="0 0 44 86" width="44" height="86" aria-hidden="true">
          {/* the chariot with its Spartan, pulled by two horses */}
          <rect x="6" y="2" width="32" height="22" rx="4" fill="#8a6420" stroke="#e9b44c" strokeWidth="1.5" />
          <circle cx="4" cy="14" r="4" fill="#3b2a1d" stroke="#e9b44c" />
          <circle cx="40" cy="14" r="4" fill="#3b2a1d" stroke="#e9b44c" />
          <circle cx="22" cy="12" r="6" fill="#d6a64a" />
          <path d="M16 12 Q22 2 28 12" stroke="#bb3128" strokeWidth="2.5" fill="none" />
          <path d="M22 24 V40 M14 40 H30" stroke="#6b5332" strokeWidth="2" />
          {[14, 30].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={58} rx={6} ry={16} fill="#5a3a22" />
              <ellipse cx={x} cy={76} rx={3.5} ry={7} fill="#4a2f1b" />
              <path d={`M${x - 2} 48 V70`} stroke="#241710" strokeWidth="1.5" />
            </g>
          ))}
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 36 64" width="36" height="64" aria-hidden="true">
          <rect x="2" y="2" width="32" height="60" rx="9" fill="#0f1013" stroke={color} strokeWidth="2.5" />
          <rect x="7" y="12" width="22" height="11" rx="3" fill="#8fb1ff" opacity="0.35" />
          <rect x="7" y="40" width="22" height="8" rx="3" fill="#8fb1ff" opacity="0.25" />
          <rect x="15" y="2" width="6" height="60" fill={color} opacity="0.85" />
          <rect x="5" y="56" width="7" height="4" rx="1.5" fill="#ffe7a8" />
          <rect x="24" y="56" width="7" height="4" rx="1.5" fill="#ffe7a8" />
        </svg>
      );
  }
}

/** How long a vehicle takes down its lane: buses are slow, bikes quick. */
export const VEHICLE_SECONDS: Record<VehicleKind, number> = { sedan: 3, taxi: 2.8, truck: 3.8, bus: 4.4, bike: 2.2, chariot: 3.2 };

/** Things on the start sidewalk: a hoplite's shield and spear, and an amphora. */
export function StartProps({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 60 70" width={size} height={size * (70 / 60)} aria-hidden="true">
      <path d="M44 2 L48 68" stroke="#8a6420" strokeWidth="3" strokeLinecap="round" />
      <path d="M42 2 L46 -6 L49 2 Z" fill="#c9b98f" transform="translate(0 6)" />
      <circle cx="26" cy="44" r="20" fill="#7d1d18" stroke="#e9b44c" strokeWidth="3" />
      <circle cx="26" cy="44" r="13" fill="none" stroke="#e9b44c" strokeWidth="1.5" opacity="0.7" />
      <text x="26" y="49" textAnchor="middle" fontSize="13" fontWeight="800" fill="#e9b44c">Λ</text>
      <path d="M8 58 Q5 52 9 48 L9 45 L13 45 L13 48 Q17 52 14 58 Q16 64 11 68 Q6 64 8 58 Z" fill="#b5652c" stroke="#e39a55" strokeWidth="0.8" />
    </svg>
  );
}

/** Things on the finish sidewalk: a laurel wreath on a column stump. */
export function FinishProps({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 60 70" width={size} height={size * (70 / 60)} aria-hidden="true">
      <rect x="18" y="38" width="24" height="30" fill={STONE} />
      <rect x="14" y="34" width="32" height="6" fill={STONE_DARK} />
      <path d="M24 40 V68 M30 40 V68 M36 40 V68" stroke={STONE_DARK} strokeWidth="1" />
      {Array.from({ length: 7 }, (_, index) => {
        const angle = (Math.PI * (index + 1)) / 8;
        return (
          <g key={index}>
            <ellipse cx={30 - Math.cos(angle) * 14} cy={22 - Math.sin(angle) * 10} rx="4" ry="2" fill="#5ee39b" opacity="0.8" transform={`rotate(${-index * 20} ${30 - Math.cos(angle) * 14} ${22 - Math.sin(angle) * 10})`} />
            <ellipse cx={30 + Math.cos(angle) * 14} cy={22 - Math.sin(angle) * 10} rx="4" ry="2" fill="#5ee39b" opacity="0.8" transform={`rotate(${index * 20} ${30 + Math.cos(angle) * 14} ${22 - Math.sin(angle) * 10})`} />
          </g>
        );
      })}
      <circle cx="30" cy="30" r="4" fill="#e9b44c" />
    </svg>
  );
}
