"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LINKS } from "@/lib/site";
import { SoonBadge } from "./coming-soon";
import { Close, Menu } from "./icons";
import { ConnectButton } from "./wallet/connect-button";

/** Where a running game shows its name in the header (see GameFrame). */
export const HEADER_SLOT_ID = "site-header-game";

const NAV = [
  { href: "/#guide", label: "Start" },
  { href: LINKS.governance, label: "Governance" },
];

/** The 300 Wallet is not released yet: shown in the nav, but not a link. */
function WalletSoon({ className }: { className: string }) {
  return (
    <span aria-disabled="true" title="The 300 Wallet is coming soon" className={`cursor-not-allowed text-faint ${className}`}>
      300 Wallet
      <SoonBadge />
    </span>
  );
}

export function Brand() {
  return (
    <Link href="/#top" className="flex items-center gap-2.5" aria-label="300 home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/300-logo.jpg" alt="" className="size-9 rounded-full ring-1 ring-gold/40" />
      {/* In a game the name of the game takes this room on phones. */}
      <span className="leading-none max-sm:[html:has([data-game-shell])_&]:hidden">
        <strong className="block text-base font-bold tracking-tight">300</strong>
        <small className="hidden whitespace-nowrap font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted min-[400px]:block">SPO &amp; DRep</small>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled || open ? "border-b border-line bg-ink/75 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      {/* Slimmer while a game runs, so the game gets the room. */}
      <nav
        className="container-site flex h-[4.5rem] items-center gap-3 transition-[height] sm:gap-6 [html:has([data-game-shell])_&]:h-14"
        aria-label="Primary navigation"
      >
        <Brand />
        {/* A running game puts its name here (GameFrame). */}
        <div id={HEADER_SLOT_ID} className="flex min-w-0 flex-1 justify-center empty:hidden" />
        <div className="ml-2 hidden items-center gap-0.5 lg:flex xl:ml-6 xl:gap-1">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-full px-2.5 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-text xl:px-3.5"
            >
              {item.label}
            </a>
          ))}
          <WalletSoon className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2 text-sm xl:px-3.5" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ConnectButton />
          <button
            className="grid size-10 place-items-center rounded-full border border-line text-muted lg:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <Close size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            className="border-t border-line lg:hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="container-site grid gap-1 py-3">
              {NAV.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-muted hover:bg-white/5 hover:text-text">
                  {item.label}
                </a>
              ))}
              <WalletSoon className="flex items-center gap-2 px-3 py-3" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
