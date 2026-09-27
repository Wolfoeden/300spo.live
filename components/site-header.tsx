"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { LINKS } from "@/lib/site";
import { Close, Menu } from "./icons";
import { ConnectButton } from "./wallet/connect-button";

const NAV = [
  { href: "#guide", label: "Cardano guide" },
  { href: "#pool", label: "Live pool" },
  { href: "#governance", label: "Governance" },
  { href: "#partners", label: "Partners" },
  { href: LINKS.wallet, label: "300 Wallet" },
];

export function Brand() {
  return (
    <a href="#top" className="flex items-center gap-2.5" aria-label="300 home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/300-logo.jpg" alt="" className="size-9 rounded-full ring-1 ring-gold/40" />
      <span className="leading-none">
        <strong className="block text-base font-bold tracking-tight">300</strong>
        <small className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted">SPO &amp; DRep</small>
      </span>
    </a>
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
      <nav className="container-site flex h-[4.5rem] items-center gap-6" aria-label="Primary navigation">
        <Brand />
        <div className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="rounded-full px-3.5 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-text">
              {item.label}
            </a>
          ))}
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
