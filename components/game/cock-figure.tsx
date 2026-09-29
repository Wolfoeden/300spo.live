"use client";

import { motion, useReducedMotion } from "motion/react";

// The Chicken figure: the blue cock of 300 DEGEN #004 as a small Spartan —
// gold helmet with red crest, blue head, gold breastplate, round shield — drawn
// in the NFT's thick-outline style so each part can move on its own.

const LINE = "#11141c";
const BLUE = "#2458b8";
const BLUE_DARK = "#173e86";
const GOLD = "#e8b44a";
const GOLD_LIGHT = "#ffe3a3";
const GOLD_DARK = "#a8691c";
const RED = "#bb3128";
const RED_DARK = "#7d1d18";
const BEAK = "#f2a73a";
const FOOT = "#f2b441";

export type CockMood = "idle" | "hit" | "win";

/** The legs swing once per `step`; `mood` sets the face (knocked out, cheering). */
export function CockFigure({ step = 0, mood = "idle", className = "" }: { step?: number; mood?: CockMood; className?: string }) {
  const reduce = useReducedMotion();
  const still = reduce || mood === "hit";
  return (
    <svg viewBox="0 0 100 120" className={`overflow-visible ${className}`} aria-hidden="true">
      <ellipse cx="50" cy="114" rx="24" ry="4.5" fill="#000" opacity="0.35" />

      <motion.g
        key={`back-${step}`}
        style={{ transformBox: "fill-box", transformOrigin: "50% 0%" }}
        animate={still || step === 0 ? {} : { rotate: [0, -28, 16, 0] }}
        transition={{ duration: 0.38 }}
      >
        <Leg x={43} />
      </motion.g>
      <motion.g
        key={`front-${step}`}
        style={{ transformBox: "fill-box", transformOrigin: "50% 0%" }}
        animate={still || step === 0 ? {} : { rotate: [0, 28, -16, 0] }}
        transition={{ duration: 0.38 }}
      >
        <Leg x={57} />
      </motion.g>

      {/* Everything above the legs breathes a little. */}
      <motion.g
        animate={still ? {} : mood === "win" ? { y: [0, -6, 0, -4, 0] } : { y: [0, -1.6, 0] }}
        transition={mood === "win" ? { duration: 0.9 } : { duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* skirt */}
        <path d="M34 76 L66 76 L70 92 L30 92 Z" fill="#4a3521" stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
        {[38, 44, 50, 56, 62].map((x) => (
          <path key={x} d={`M${x} 78 L${x + (x - 50) * 0.18} 91`} stroke="#261a0f" strokeWidth="1.4" />
        ))}

        {/* back arm */}
        <ellipse cx="30" cy="64" rx="6.5" ry="11" transform="rotate(14 30 64)" fill={BLUE} stroke={LINE} strokeWidth="2.4" />
        <circle cx="27.5" cy="75" r="5" fill={BLUE} stroke={LINE} strokeWidth="2.2" />

        {/* breastplate */}
        <path d="M31 50 Q50 42 69 50 Q72 64 66 78 Q50 83 34 78 Q28 64 31 50 Z" fill={GOLD} stroke={LINE} strokeWidth="2.8" strokeLinejoin="round" />
        <path d="M36 58 Q43 63 50 58 M50 58 Q57 63 64 58 M50 54 L50 77 M41 68 L59 68 M42 73 L58 73" stroke={GOLD_DARK} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M37 53 Q44 49.5 49 51.5" stroke={GOLD_LIGHT} strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="33" cy="51" rx="8" ry="6" fill={GOLD} stroke={LINE} strokeWidth="2.4" />
        <ellipse cx="67" cy="51" rx="8" ry="6" fill={GOLD} stroke={LINE} strokeWidth="2.4" />

        {/* head */}
        <path d="M44 45 Q50 51 61 46" stroke={BLUE_DARK} strokeWidth="5" strokeLinecap="round" fill="none" />
        <circle cx="55" cy="32" r="15" fill={BLUE} stroke={LINE} strokeWidth="2.6" />
        <path d="M43 38 Q46 43 51 44 M42 33 Q44 37 48 39" stroke={BLUE_DARK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M66 28 Q80 29 83 36 Q74 37 66 39 Z" fill={BEAK} stroke={LINE} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M67 34 L80 35" stroke="#b86b14" strokeWidth="1.3" />
        <path d="M68 39 Q70 46 66 47.5 Q62.5 44.5 66 39 Z" fill={RED} stroke={LINE} strokeWidth="1.6" strokeLinejoin="round" />
        <Eye mood={mood} still={still} />

        {/* helmet and crest */}
        <motion.path
          d="M37 22 Q40 2 58 3 Q68 4 70 12 L64 14 Q56 8 48 12 Q42 16 42 24 Z"
          fill={RED}
          stroke={LINE}
          strokeWidth="2.4"
          strokeLinejoin="round"
          style={{ transformBox: "fill-box", transformOrigin: "40% 100%" }}
          animate={still ? {} : { rotate: [-5, 4, -5] }}
          transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
        />
        <path d="M44 14 Q48 8 55 7 M47 18 Q52 11 60 10" stroke={RED_DARK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M38 36 Q37 16 54 13 Q67 13 71 24 L64 25 Q60 20 54 21 Q47 22 46 30 L47 45 Q41 47 38 42 Z" fill={GOLD} stroke={LINE} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M47 22 Q55 17 66 21" stroke={GOLD_LIGHT} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M41 26 L42 40" stroke={GOLD_DARK} strokeWidth="1.4" strokeLinecap="round" />

        {/* shield in front */}
        <circle cx="61" cy="70" r="4.5" fill={BLUE} stroke={LINE} strokeWidth="2" />
        <circle cx="71" cy="69" r="13" fill="#7a3f1e" stroke={LINE} strokeWidth="2.6" />
        <circle cx="71" cy="69" r="10.3" fill="none" stroke={GOLD} strokeWidth="2" />
        <circle cx="71" cy="69" r="3.6" fill={GOLD} stroke={LINE} strokeWidth="1.5" />
      </motion.g>
    </svg>
  );
}

function Leg({ x }: { x: number }) {
  const shin = `M${x} 86 L${x} 106`;
  const toes = `M${x} 106 l-7 4 M${x} 106 l1 5 M${x} 106 l7 3`;
  return (
    <g strokeLinecap="round" fill="none">
      <path d={shin} stroke={LINE} strokeWidth="6" />
      <path d={shin} stroke={FOOT} strokeWidth="3" />
      <path d={toes} stroke={LINE} strokeWidth="5" />
      <path d={toes} stroke={FOOT} strokeWidth="2.4" />
    </g>
  );
}

function Eye({ mood, still }: { mood: CockMood; still: boolean }) {
  if (mood === "hit") {
    return <path d="M58 25 L64 31 M64 25 L58 31" stroke={LINE} strokeWidth="2.4" strokeLinecap="round" />;
  }
  if (mood === "win") {
    return <path d="M57.5 30 Q61 24.5 64.5 30" stroke={LINE} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
  }
  return (
    <motion.g
      style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
      animate={still ? {} : { scaleY: [1, 1, 0.12, 1] }}
      transition={{ duration: 3.4, times: [0, 0.9, 0.95, 1], repeat: Infinity }}
    >
      <ellipse cx="61" cy="28" rx="4.2" ry="4.4" fill="#fff" stroke={LINE} strokeWidth="1.6" />
      <circle cx="62.3" cy="28.6" r="2" fill={LINE} />
      <circle cx="61.5" cy="27.5" r="0.7" fill="#fff" />
    </motion.g>
  );
}
