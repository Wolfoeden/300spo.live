"use client";

import { DREP_ID, LINKS, POOL_ID } from "@/lib/site";
import { capitalize, formatAdaCompact, formatInteger, formatMargin, formatPercent } from "@/lib/format";
import { CopyButton } from "./copy-button";
import { useLiveData } from "./data/live-data";
import { ArrowRight, ArrowUpRight, Check } from "./icons";
import { Reveal } from "./motion";
import { DelegateButton } from "./wallet/delegation";

const BENEFITS = [
  ["Self-custody", "ADA never leaves your wallet"],
  ["No lock-up", "Spend or move ADA at any time"],
  ["No slashing", "Your delegated principal is not at risk"],
  ["No minimum", "Any ADA balance can participate"],
];

const STEPS = [
  ["Use a Cardano wallet", "Open 300 Wallet or a compatible wallet such as VESPR, Lace or Eternl."],
  ["Choose 300 SPO", "Use the delegation button or search with the verified 300 pool ID."],
  ["Review and sign", "Your wallet shows the on-chain delegation certificate before you approve it."],
  ["Remain in control", "Your ADA stays liquid and your delegation can be changed at any time."],
];

const EPOCHS = [
  ["N", "Delegate"],
  ["N+1", "Snapshot"],
  ["N+2", "Blocks"],
  ["N+3", "Calculate"],
  ["N+4", "Distribute"],
];

const TRUST = [
  "Registered, publicly verifiable stake pool",
  "Independent contribution to Cardano decentralization",
  "Transparent pool parameters and live metrics",
  "Non-custodial delegation",
  "Integrated SPO and DRep education",
  "Supported by Midnight and RealFi",
];

const PRINCIPLES = [
  ["Decentralization first", "Protect distributed decision-making and resist unnecessary concentration."],
  ["Utility with accountability", "Support durable value with clear use of treasury resources."],
  ["Security over shortcuts", "Favor evidence-led progress that protects the protocol."],
  ["Long-term relevance", "Grow Cardano's resilience and real-world usefulness."],
];

function GuideSection({ number, id, title, children }: { number: string; id: string; title: string; children: React.ReactNode }) {
  return (
    <Reveal as="section" className="relative border-t border-line py-12 first:border-t-0 first:pt-0">
      <div aria-labelledby={id}>
        <span className="font-mono text-sm text-gold">{number}</span>
        <h3 id={id} className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h3>
        <div className="mt-4 space-y-5 text-[1.02rem] leading-relaxed text-muted">{children}</div>
      </div>
    </Reveal>
  );
}

export function Guide() {
  return (
    <section id="guide" aria-labelledby="guide-title" className="relative py-24 sm:py-32">
      <div className="container-site">
        <Reveal className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <p className="kicker">Cardano protocol guide</p>
            <h2 id="guide-title" className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
              Understand the network.
              <br />
              <span className="text-muted">Then choose your role.</span>
            </h2>
          </div>
          <p className="max-w-md text-muted lg:justify-self-end">
            Clear, Cardano-specific information for ADA holders who want to stake, participate in governance and keep control of their assets.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
          <article>
            <GuideSection number="01" id="what-cardano" title="What is Cardano?">
              <p>
                Cardano is an open-source proof-of-stake blockchain designed through peer-reviewed research and evidence-based engineering. Its native
                asset is ADA, which is used for transactions, staking and participation in on-chain governance.
              </p>
              <a className="inline-flex items-center gap-1.5 text-sm font-medium text-gold hover:text-gold-bright" href={LINKS.cardanoOrg} target="_blank" rel="noreferrer">
                Official Cardano website <ArrowUpRight size={14} />
              </a>
            </GuideSection>

            <GuideSection number="02" id="ouroboros" title="How does Cardano Proof of Stake work?">
              <p>
                Cardano uses the Ouroboros proof-of-stake protocol. ADA holders can delegate the staking power attached to their ADA to a stake pool.
                Pools that are selected as slot leaders produce blocks and help maintain the ledger.
              </p>
              <div className="rounded-2xl border-l-2 border-gold bg-gold/[0.06] p-5">
                <p className="font-semibold text-text">Important distinction</p>
                <p className="mt-1">Cardano delegation does not lock ADA in a smart contract. Your ADA stays in your wallet and remains spendable.</p>
              </div>
            </GuideSection>

            <GuideSection number="03" id="delegation" title="What does delegation mean?">
              <p>
                Delegation assigns your stake weight to a pool without transferring ownership. It is Cardano&apos;s way of allowing every ADA holder to
                support network security without operating a server around the clock.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {BENEFITS.map(([title, text]) => (
                  <div key={title} className="glass flex gap-3 rounded-2xl p-4">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-positive/10 text-positive">
                      <Check size={14} />
                    </span>
                    <span>
                      <strong className="block text-text">{title}</strong>
                      <span className="text-sm">{text}</span>
                    </span>
                  </div>
                ))}
              </div>
            </GuideSection>

            <GuideSection number="04" id="stake-steps" title="How to delegate to 300">
              <ol className="space-y-3">
                {STEPS.map(([title, text], index) => (
                  <li key={title} className="flex gap-4 rounded-2xl border border-line p-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gold font-mono text-sm font-bold text-ink">{index + 1}</span>
                    <span>
                      <strong className="block text-text">{title}</strong>
                      <span className="text-sm">{text}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-3 pt-2">
                <DelegateButton target="pool" className="btn btn-gold">
                  Delegate to 300 SPO <ArrowRight size={16} />
                </DelegateButton>
                <a className="btn btn-ghost" href={LINKS.wallet}>
                  Open 300 Wallet
                </a>
              </div>
            </GuideSection>

            <GuideSection number="05" id="rewards" title="How do Cardano rewards work?">
              <p>
                Rewards come from transaction fees and monetary expansion. They are calculated by the protocol and distributed after pool costs and
                margin. Results vary with stake, pool performance, protocol parameters and the random slot-leader schedule.
              </p>
              <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1" aria-label="Illustrated staking reward timeline">
                {EPOCHS.map(([epoch, label], index) => (
                  <div key={epoch} className="flex min-w-[5.5rem] flex-1 flex-col items-center rounded-2xl border border-line bg-white/[0.02] px-2 py-4 text-center">
                    <span className={`font-mono text-lg font-semibold ${index === EPOCHS.length - 1 ? "text-gold" : "text-text"}`}>{epoch}</span>
                    <span className="mt-1 text-xs">{label}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-faint">
                The first rewards normally require multiple epochs. Afterwards, rewards can arrive every epoch (approximately five days) when the pool
                produces blocks. Rewards are estimates, not guarantees.
              </p>
            </GuideSection>

            <GuideSection number="06" id="why-300" title="Why delegate to 300?">
              <p>
                300 is built around proof rather than promises. Pool status, stake, delegators, block production and governance delegation are shown
                from public Cardano data.
              </p>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {TRUST.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <Check size={16} className="mt-0.5 shrink-0 text-gold" />
                    {item}
                  </li>
                ))}
              </ul>
              <a className="inline-flex items-center gap-1.5 text-sm font-medium text-gold hover:text-gold-bright" href={LINKS.poolPm} target="_blank" rel="noreferrer">
                Verify 300 on pool.pm <ArrowUpRight size={14} />
              </a>
            </GuideSection>

            <div id="governance" className="scroll-mt-24">
              <GuideSection number="07" id="drep-title" title="What is a Cardano DRep?">
                <p>
                  A Delegated Representative votes on governance actions using voting power delegated by ADA holders. Stake-pool delegation and DRep
                  delegation are independent: you can support one SPO and choose a different DRep without moving your ADA.
                </p>
                <DrepSummary />
                <h4 className="pt-2 text-lg font-semibold text-text">How 300 approaches governance</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PRINCIPLES.map(([title, text], index) => (
                    <div key={title} className="rounded-2xl border border-line p-4">
                      <span className="font-mono text-xs text-gold">0{index + 1}</span>
                      <strong className="mt-1 block text-text">{title}</strong>
                      <span className="text-sm">{text}</span>
                    </div>
                  ))}
                </div>
                <DelegateButton target="drep" className="btn btn-gold">
                  Delegate to 300 DRep <ArrowRight size={16} />
                </DelegateButton>
              </GuideSection>
            </div>
          </article>

          <aside aria-label="Live Cardano protocol card">
            <div className="space-y-4 lg:sticky lg:top-24">
              <ProtocolCard />
              <div className="glass rounded-3xl p-5">
                <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">Verified pool ID</p>
                <code className="mt-2 block break-all font-mono text-xs leading-relaxed text-text">{POOL_ID}</code>
                <CopyButton value={POOL_ID} label="Copy pool ID" className="mt-3" />
              </div>
              <p className="px-1 text-xs leading-relaxed text-faint">
                Cardano explanations on this page follow official Cardano documentation. Live 300 metrics are loaded from public on-chain data.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function DrepSummary() {
  const { metrics } = useLiveData();
  const drep = metrics?.drep;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="glass rounded-2xl p-4">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">300 DRep status</p>
        <p className="mt-1 text-xl font-semibold text-positive">{capitalize(drep?.status)}</p>
      </div>
      <div className="glass rounded-2xl p-4">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">Delegated voting power</p>
        <p className="mt-1 text-xl font-semibold text-text">{formatAdaCompact(drep?.amountLovelace)}</p>
      </div>
      <p className="break-all font-mono text-[0.68rem] text-faint sm:col-span-2">{DREP_ID}</p>
    </div>
  );
}

function ProtocolCard() {
  const { metrics } = useLiveData();
  const pool = metrics?.pool;
  const rows: [string, string, string?][] = [
    ["Token", "ADA"],
    ["Consensus", "Ouroboros PoS"],
    ["Pool status", capitalize(pool?.status), "text-positive"],
    ["Blocks", formatInteger(pool?.blockCount)],
    ["Live stake", formatAdaCompact(pool?.liveStakeLovelace)],
    ["Delegators", formatInteger(pool?.liveDelegators)],
    ["Saturation", formatPercent(pool?.liveSaturation)],
    ["Margin", formatMargin(pool?.margin)],
    ["Fixed cost", formatAdaCompact(pool?.fixedCostLovelace)],
    ["Pledge", formatAdaCompact(pool?.pledgeLovelace)],
  ];
  return (
    <article className="relative overflow-hidden rounded-3xl border border-gold/25 bg-gradient-to-b from-gold/[0.09] to-panel p-5">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/300-logo.jpg" alt="" className="size-10 rounded-full ring-1 ring-gold/40" />
        <div>
          <p className="font-semibold">Protocol card</p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-positive" /> Live 300 data
          </p>
        </div>
      </div>
      <dl className="mt-5 divide-y divide-line text-sm">
        {rows.map(([label, value, tone]) => (
          <div key={label} className="flex justify-between gap-4 py-2.5">
            <dt className="text-muted">{label}</dt>
            <dd className={`font-medium tabular-nums ${tone ?? "text-text"}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <DelegateButton target="pool" className="btn btn-gold mt-5 w-full">
        Stake with 300 <ArrowRight size={16} />
      </DelegateButton>
    </article>
  );
}
