"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

const WIDTH = 288;
const MARGIN = 12;

/**
 * A small ⓘ next to a title that opens its explanation in a bubble. Tap or
 * click toggles it; Esc, an outside click or scrolling closes it. The bubble
 * is placed under the button and kept inside the viewport.
 */
export function InfoBubble({ label, children }: { label: string; children: React.ReactNode }) {
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const open = place !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setPlace(null);
    const rect = button.current!.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.min(Math.max(MARGIN, rect.left - 16), window.innerWidth - width - MARGIN);
    setPlace({ top: rect.bottom + 8, left, width });
  };

  return (
    <span ref={root} className="inline-flex align-middle">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className={`grid size-5 place-items-center rounded-full border font-serif text-[0.7rem] font-bold italic leading-none transition ${
          open ? "border-gold bg-gold/15 text-gold-bright" : "border-line-strong text-faint hover:border-gold/50 hover:text-text"
        }`}
      >
        i
      </button>
      <AnimatePresence>
        {place && (
          <motion.span
            id={id}
            role="tooltip"
            style={{ top: place.top, left: place.left, width: place.width }}
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="fixed z-50 block rounded-2xl border border-line-strong bg-ink/95 p-4 text-left text-sm font-normal not-italic leading-relaxed tracking-normal text-muted shadow-2xl shadow-black/60 backdrop-blur"
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
