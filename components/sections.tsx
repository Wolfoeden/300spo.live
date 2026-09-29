"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { LINKS, PARTNER_LINKS } from "@/lib/site";
import { useLiveData } from "./data/live-data";
import { ArrowRight, Plus } from "./icons";
import { WalletSoonButton } from "./coming-soon";
import { Reveal } from "./motion";
import { Brand } from "./site-header";
import { DelegateButton } from "./wallet/delegation";

export function Partners() {
  const { content } = useLiveData();
  return (
    <section id="partners" aria-labelledby="partners-title" className="py-24 sm:py-32">
      <div className="container-site">
        <Reveal className="relative overflow-hidden rounded-[2rem] border border-line bg-gradient-to-br from-raised via-panel to-ink p-8 sm:p-12 lg:p-16">
          <div aria-hidden="true" className="absolute -right-24 -top-24 size-80 rounded-full bg-gold/15 blur-[100px]" />
          <div className="relative grid grid-cols-1 gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            <div>
              <p className="kicker">{content.partnerKicker}</p>
              <h2 id="partners-title" className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
                {content.partnerHeading}
              </h2>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-5" aria-label="Midnight and RealFi">
              {[
                ["/partners/midnight-logo-white.svg", "Midnight", "Privacy & identity", PARTNER_LINKS.midnight],
                ["/partners/realfi-logo-white.svg", "RealFi", "Real-world finance", PARTNER_LINKS.realfi],
              ].map(([src, name, tag, href], index) => (
                <PartnerCard key={name} src={src} name={name} tag={tag} href={href} withPlus={index === 0} />
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PartnerCard({ src, name, tag, href, withPlus }: { src: string; name: string; tag: string; href: string; withPlus: boolean }) {
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="glass group flex aspect-[4/3] flex-col items-center justify-center gap-4 rounded-3xl p-5 transition hover:border-gold/30"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} className="h-8 w-auto max-w-full transition group-hover:scale-105 sm:h-10" />
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-faint">{tag}</span>
      </a>
      {withPlus && <span className="text-2xl text-gold">+</span>}
    </>
  );
}

const FAQ = [
  ["Is Cardano a Proof-of-Stake blockchain?", "Yes. Cardano uses Ouroboros, a proof-of-stake consensus protocol developed through peer-reviewed research."],
  [
    "Does my ADA leave my wallet when I delegate?",
    "No. Delegation assigns staking power through an on-chain certificate. Your ADA remains in your wallet and spendable.",
  ],
  [
    "Is there a lock-up period or slashing?",
    "No. Cardano delegation has no lock-up and delegated ADA is not slashed. A pool that underperforms may simply earn fewer rewards.",
  ],
  [
    "When can staking rewards begin?",
    "A new delegation passes through the Cardano snapshot and reward calculation cycle. Initial rewards normally take several epochs; subsequent rewards can arrive every epoch when the pool produces blocks.",
  ],
  [
    "Can I delegate to an SPO and a DRep at the same time?",
    "Yes. Stake-pool delegation and governance delegation are separate. You can support 300 SPO, choose 300 DRep, or select different operators for each role.",
  ],
  ["Are the displayed rewards guaranteed?", "No. Reward amounts vary with stake, pool performance, protocol parameters, fees and the probabilistic block schedule."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-line py-24 sm:py-32">
      <div className="container-site grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <p className="kicker">Cardano FAQ</p>
          <h2 id="faq-title" className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
            Answers before you delegate.
          </h2>
        </Reveal>
        <Reveal delay={0.08} className="divide-y divide-line border-y border-line">
          {FAQ.map(([question, answer], index) => {
            const expanded = open === index;
            return (
              <div key={question}>
                <button
                  className="flex w-full items-center justify-between gap-6 py-5 text-left text-lg font-medium transition hover:text-gold-bright"
                  aria-expanded={expanded}
                  aria-controls={`faq-${index}`}
                  onClick={() => setOpen(expanded ? null : index)}
                >
                  {question}
                  <motion.span animate={{ rotate: expanded ? 45 : 0 }} className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-gold">
                    <Plus size={15} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      id={`faq-${index}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="pb-6 pr-12 text-muted">{answer}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="pb-24 sm:pb-32">
      <div className="container-site">
        <Reveal className="relative overflow-hidden rounded-[2rem] border border-gold/30 bg-gradient-to-br from-gold/20 via-gold-deep/10 to-ink p-8 sm:p-14">
          <div aria-hidden="true" className="grid-backdrop absolute inset-0 opacity-70" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/300-logo.jpg" alt="" aria-hidden="true" className="absolute -bottom-20 -right-16 size-72 rounded-full opacity-25 blur-[1px] sm:size-96" />
          <div className="relative max-w-2xl">
            <p className="kicker">Built for the long term</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">Help shape Cardano&apos;s future with 300.</h2>
            <div className="mt-8 flex flex-wrap gap-3">
              <DelegateButton target="pool" className="btn btn-gold">
                Delegate to SPO <ArrowRight size={16} />
              </DelegateButton>
              <DelegateButton target="drep" className="btn btn-ghost">
                Delegate to DRep
              </DelegateButton>
              <WalletSoonButton />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line py-10">
      <div className="container-site flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Brand />
        <div className="flex items-center gap-4 text-sm text-faint">
          <a href={LINKS.admin} className="hover:text-text">
            Admin
          </a>
          <span>© {new Date().getFullYear()} 300</span>
        </div>
      </div>
    </footer>
  );
}
