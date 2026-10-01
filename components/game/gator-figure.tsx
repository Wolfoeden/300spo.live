"use client";

import { motion, useReducedMotion } from "motion/react";

// The blackjack dealer: the Gator of 300 DEGEN #007 as a Spartan behind the
// table — bronze helmet with red crest, green crocodile head with a row of
// teeth, spear and round shield — drawn in the NFT's thick-outline style like
// the Chicken cock, so jaw, eye, crest and body can move on their own.

const LINE = "#11141c";
const GREEN = "#3c8a3a";
const GREEN_DARK = "#24602a";
const GREEN_LIGHT = "#6bb35a";
const BRONZE = "#b8803a";
const BRONZE_LIGHT = "#e3b46a";
const BRONZE_DARK = "#7a4f1f";
const RED = "#a32a1f";
const RED_DARK = "#6d1b14";
const TOOTH = "#f4ead2";
const EYE = "#f6c234";
const WOOD = "#6b4423";
const STEEL = "#c9ccd3";

/**
 * idle: breathes, blinks, snaps now and then. think: the dealer's turn, jaw
 * chattering. win: the dealer took the table, a wide grin and a hop. bust: the
 * dealer went over 21, dizzy.
 */
export type GatorMood = "idle" | "think" | "win" | "bust";

export function GatorFigure({ mood = "idle", className = "" }: { mood?: GatorMood; className?: string }) {
  const reduce = useReducedMotion();
  const still = !!reduce;

  const jaw = still
    ? {}
    : mood === "think"
      ? { rotate: [0, 13, 2, 11, 0] }
      : mood === "win"
        ? { rotate: [0, 24, 18, 24, 20] }
        : mood === "bust"
          ? { rotate: 17 }
          : { rotate: [0, 0, 0, 12, 0] };
  const jawTransition =
    mood === "think"
      ? { duration: 0.9, repeat: Infinity }
      : mood === "win"
        ? { duration: 1.2 }
        : mood === "bust"
          ? { duration: 0.3 }
          : { duration: 5.2, times: [0, 0.82, 0.88, 0.92, 1], repeat: Infinity };

  const body = still
    ? {}
    : mood === "win"
      ? { y: [0, -5, 0, -3, 0] }
      : mood === "bust"
        ? { rotate: [-4, 4, -4] }
        : mood === "think"
          ? { rotate: [0, 3, 0], y: [0, -1, 0] }
          : { y: [0, -1.4, 0] };
  const bodyTransition =
    mood === "win" ? { duration: 1 } : mood === "bust" ? { duration: 1.1, repeat: Infinity } : mood === "think" ? { duration: 1.4, repeat: Infinity } : { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const };

  return (
    <svg viewBox="0 0 120 104" className={`overflow-visible ${className}`} aria-hidden="true">
      <motion.g style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }} animate={body} transition={bodyTransition}>
        {/* the spear, behind */}
        <path d="M17 104 L25 10" stroke={LINE} strokeWidth="5.4" strokeLinecap="round" />
        <path d="M17 104 L25 10" stroke={WOOD} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M21.4 16 L25.6 -2 L29.4 16.6 Q25.4 19.5 21.4 16 Z" fill={STEEL} stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
        <path d="M25.6 1 L25.3 14" stroke="#8e939c" strokeWidth="1" />

        {/* torso */}
        <path d="M28 72 Q60 56 94 72 L100 104 L20 104 Z" fill={GREEN} stroke={LINE} strokeWidth="2.8" strokeLinejoin="round" />
        <path d="M37 79 Q48 86 59 79 M62 79 Q73 86 84 79 M60 82 L60 104 M50 93 L70 93 M51 100 L69 100" stroke={GREEN_DARK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M38 75 Q46 71 53 73" stroke={GREEN_LIGHT} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        {[
          [34, 70],
          [40, 67],
          [80, 67],
          [86, 70],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" fill={GREEN_DARK} />
        ))}

        {/* the spear arm */}
        <ellipse cx="31" cy="74" rx="9" ry="7" fill={GREEN} stroke={LINE} strokeWidth="2.4" />
        <ellipse cx="25" cy="86" rx="6.5" ry="11" transform="rotate(18 25 86)" fill={GREEN} stroke={LINE} strokeWidth="2.4" />
        <circle cx="21.5" cy="96" r="5.2" fill={GREEN} stroke={LINE} strokeWidth="2.2" />
        <path d="M18 94 L25 96" stroke={GREEN_DARK} strokeWidth="1.3" strokeLinecap="round" />

        {/* neck */}
        <path d="M49 54 Q60 63 72 54 L75 68 L47 68 Z" fill={GREEN} stroke={LINE} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M53 61 Q60 65 68 60" stroke={GREEN_DARK} strokeWidth="1.4" fill="none" strokeLinecap="round" />

        {/* the mouth behind the jaws, seen when they part */}
        <path d="M63 48 L98 46 L95 55 L65 57 Z" fill={RED_DARK} stroke={LINE} strokeWidth="1.6" strokeLinejoin="round" />

        {/* lower jaw, hinged under the eye */}
        <motion.g style={{ transformBox: "fill-box", transformOrigin: "2% 18%" }} animate={jaw} transition={jawTransition}>
          <path d="M61 49 L97 48 Q101 53 95 57.5 L64 60 Q58 56 61 49 Z" fill={GREEN} stroke={LINE} strokeWidth="2.4" strokeLinejoin="round" />
          {[70, 76, 82, 88].map((x) => (
            <path key={x} d={`M${x} 49.2 l2.1 -4.6 l2.1 4.6 Z`} fill={TOOTH} stroke={LINE} strokeWidth="1" strokeLinejoin="round" />
          ))}
          <path d="M66 56 Q80 55 93 53" stroke={GREEN_DARK} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </motion.g>

        {/* head and snout */}
        <ellipse cx="57" cy="40" rx="17.5" ry="15.5" fill={GREEN} stroke={LINE} strokeWidth="2.6" />
        <path d="M61 33 Q84 28 104 37 Q107 43 101 47.5 L63 50.5 Z" fill={GREEN} stroke={LINE} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M70 36 Q85 33 99 38" stroke={GREEN_LIGHT} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <circle cx="101.5" cy="38.5" r="1.4" fill={LINE} />
        {[68, 74, 80, 86, 92].map((x) => (
          <path key={x} d={`M${x} 47.8 l2.3 5 l2.3 -5.2 Z`} fill={TOOTH} stroke={LINE} strokeWidth="1" strokeLinejoin="round" />
        ))}
        {[
          [50, 46],
          [46, 40],
          [53, 51],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.4" fill={GREEN_DARK} />
        ))}

        {/* eye: a reptile's slit under an angry brow */}
        <ellipse cx="67" cy="31.5" rx="7" ry="5.6" fill={GREEN} stroke={LINE} strokeWidth="2.2" />
        <Eye mood={mood} still={still} />
        <path d="M59.5 26.5 L74 24.5" stroke={LINE} strokeWidth="2.8" strokeLinecap="round" />

        {/* helmet and crest */}
        <motion.path
          d="M43 19 Q45 -1 64 1 Q76 3 78 14 L71 16 Q63 7 55 11 Q49 14 48.5 21 Z"
          fill={RED}
          stroke={LINE}
          strokeWidth="2.4"
          strokeLinejoin="round"
          style={{ transformBox: "fill-box", transformOrigin: "35% 100%" }}
          animate={still ? {} : mood === "bust" ? { rotate: [-9, 9, -9] } : { rotate: [-5, 4, -5] }}
          transition={{ duration: mood === "bust" ? 0.8 : 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
        <path d="M50 12 Q55 6 62 5 M52 17 Q58 10 67 9" stroke={RED_DARK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M39.5 42 Q37 16 58 14.5 Q75 14 78 27 L71 28.5 Q65 21.5 56 23.5 Q47.5 26 47 38 L48 52 Q42 52.5 39.5 42 Z" fill={BRONZE} stroke={LINE} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M47 20.5 Q57 15.5 70 19" stroke={BRONZE_LIGHT} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M42.5 30 L43.5 47" stroke={BRONZE_DARK} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M44 26 Q58 19.5 76 25" stroke={BRONZE_DARK} strokeWidth="1.3" fill="none" />

        {/* shield in front */}
        <ellipse cx="86" cy="76" rx="8" ry="6.5" fill={GREEN} stroke={LINE} strokeWidth="2.3" />
        <circle cx="95" cy="88" r="17" fill={BRONZE_DARK} stroke={LINE} strokeWidth="2.8" />
        <circle cx="95" cy="88" r="13.4" fill={BRONZE} stroke={BRONZE_DARK} strokeWidth="1.5" />
        <path d="M86 79 Q93 75 101 78" stroke={BRONZE_LIGHT} strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="95" cy="88" r="4.6" fill={BRONZE_DARK} stroke={LINE} strokeWidth="1.6" />
        <circle cx="94" cy="87" r="1.3" fill={BRONZE_LIGHT} />
      </motion.g>
    </svg>
  );
}

function Eye({ mood, still }: { mood: GatorMood; still: boolean }) {
  if (mood === "bust") {
    return <path d="M64 28.5 L70 34.5 M70 28.5 L64 34.5" stroke={LINE} strokeWidth="2.4" strokeLinecap="round" />;
  }
  if (mood === "win") {
    return <path d="M63.5 33 Q67 27.5 70.5 33" stroke={LINE} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
  }
  return (
    <motion.g
      style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
      animate={still ? {} : { scaleY: [1, 1, 0.1, 1] }}
      transition={{ duration: 3.8, times: [0, 0.9, 0.95, 1], repeat: Infinity }}
    >
      <ellipse cx="67.5" cy="31.6" rx="3.9" ry="3.3" fill={EYE} stroke={LINE} strokeWidth="1.5" />
      <ellipse cx="68.4" cy="31.6" rx="0.95" ry="2.7" fill={LINE} />
      <circle cx="66.6" cy="30.4" r="0.6" fill="#fff" />
    </motion.g>
  );
}
