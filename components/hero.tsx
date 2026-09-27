"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { LINKS } from "@/lib/site";
import { capitalize, formatAdaCompact, formatCompact, formatInteger } from "@/lib/format";
import { useLiveData } from "./data/live-data";
import { ArrowRight } from "./icons";
import { CountUp } from "./motion";

const ease = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  const { metrics, content } = useLiveData();
  const pool = metrics?.pool;

  return (
    <section id="top" className="relative overflow-hidden pt-28 sm:pt-32">
      <HeroBackdrop />
      <div className="container-site relative grid grid-cols-1 items-center gap-12 pb-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8 lg:pb-24">
        <div>
          <motion.span
            className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-muted"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
          >
            <span className="size-1.5 animate-pulse-dot rounded-full bg-positive" />
            Cardano infrastructure &amp; governance
          </motion.span>
          <motion.h1
            className="mt-6 text-5xl font-semibold leading-[0.98] tracking-[-0.035em] sm:text-6xl lg:text-7xl xl:text-[5.4rem]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.05, ease }}
          >
            Stake Cardano
            <br />
            with <span className="text-gold-gradient">300.</span>
          </motion.h1>
          <motion.p
            className="mt-6 max-w-xl text-lg leading-relaxed text-muted"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.12, ease }}
          >
            Independent stake pool infrastructure, non-custodial ADA delegation and responsible DRep representation in one transparent
            Cardano home.
          </motion.p>
          <motion.div
            className="mt-8 flex flex-wrap gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease }}
          >
            <a href={LINKS.delegateSpo} className="btn btn-gold">
              Delegate to 300 SPO <ArrowRight size={16} />
            </a>
            <a href="#governance" className="btn btn-ghost">
              Explore 300 DRep
            </a>
          </motion.div>
          <motion.a
            href="#partners"
            className="mt-8 inline-flex flex-wrap items-center gap-3 text-sm text-muted transition hover:text-text"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.35 }}
          >
            <span className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/partners/midnight-logo-white.svg" alt="Midnight" className="h-3.5 w-auto opacity-90" />
              <span className="text-faint">+</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/partners/realfi-logo-white.svg" alt="RealFi" className="h-3.5 w-auto opacity-90" />
            </span>
            <span>{content.heroAnnouncement}</span>
          </motion.a>
        </div>
        <CoinStage status={pool?.status} stake={pool?.liveStakeLovelace} delegators={pool?.liveDelegators} />
      </div>
      <ProofBar />
    </section>
  );
}

function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/300-hero.jpg"
        alt=""
        className="absolute inset-x-0 top-0 h-[34rem] w-full object-cover opacity-[0.13] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      <div className="grid-backdrop absolute inset-0" />
      <div className="absolute -top-40 right-[-10%] h-[36rem] w-[36rem] rounded-full bg-gold/[0.14] blur-[120px]" />
      <div className="absolute left-[-15%] top-1/3 h-[28rem] w-[28rem] rounded-full bg-gold-deep/[0.12] blur-[120px]" />
    </div>
  );
}

function CoinStage({ status, stake, delegators }: { status?: string | null; stake?: string | null; delegators?: number | null }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [10, -10]), { stiffness: 150, damping: 18 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-12, 12]), { stiffness: 150, damping: 18 });

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - rect.left) / rect.width - 0.5);
    y.set((event.clientY - rect.top) / rect.height - 0.5);
  };

  return (
    <motion.div
      className="relative mx-auto aspect-square w-full max-w-[26rem] [perspective:1000px] lg:max-w-[30rem]"
      onPointerMove={onMove}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, delay: 0.1, ease }}
    >
      <OrbitRings />
      <motion.div className="absolute inset-[18%] animate-float" style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}>
        <div className="absolute inset-[-12%] rounded-full bg-gold/30 blur-3xl" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/300-logo.jpg"
          alt="300 Cardano coin"
          className="relative size-full rounded-full shadow-[0_30px_80px_-20px_rgba(233,180,76,0.55)] ring-1 ring-gold-bright/40"
        />
        <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.28),transparent_45%)]" />
      </motion.div>
      <FloatingChip className="left-0 top-[14%]" delay={0.5} label="Pool status" value={capitalize(status)} positive />
      <FloatingChip className="right-0 top-[58%]" delay={0.65} label="Live stake" value={formatAdaCompact(stake)} />
      <FloatingChip className="bottom-[4%] left-[8%]" delay={0.8} label="Delegators" value={formatInteger(delegators)} />
    </motion.div>
  );
}

function OrbitRings() {
  return (
    <svg viewBox="0 0 400 400" className="absolute inset-0 size-full" aria-hidden="true">
      <defs>
        <linearGradient id="orbit" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffd779" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd779" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <g className="origin-center animate-spin-slow" style={{ transformBox: "fill-box" }}>
        <circle cx="200" cy="200" r="196" fill="none" stroke="url(#orbit)" strokeWidth="1" strokeDasharray="2 10" />
        {Array.from({ length: 12 }, (_, index) => {
          const angle = (index / 12) * Math.PI * 2;
          return <circle key={index} cx={200 + Math.cos(angle) * 196} cy={200 + Math.sin(angle) * 196} r={index % 3 === 0 ? 3 : 1.6} fill="#e9b44c" opacity={index % 3 === 0 ? 0.9 : 0.45} />;
        })}
      </g>
      <circle cx="200" cy="200" r="160" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
    </svg>
  );
}

function FloatingChip({ className, delay, label, value, positive }: { className: string; delay: number; label: string; value: string; positive?: boolean }) {
  return (
    <motion.div
      className={`glass absolute z-10 rounded-2xl !bg-ink/70 px-4 py-2.5 shadow-xl shadow-black/40 ${className}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease }}
    >
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-faint">{label}</p>
      <p className={`mt-0.5 flex items-center gap-1.5 text-sm font-semibold ${positive && value !== "–" ? "text-positive" : ""}`}>
        {positive && value !== "–" && <span className="size-1.5 rounded-full bg-positive" />}
        {value}
      </p>
    </motion.div>
  );
}

function ProofBar() {
  const { metrics, metricsFailed } = useLiveData();
  const pool = metrics?.pool;
  const updated = metrics?.updatedAt
    ? `Updated ${new Date(metrics.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : metricsFailed
      ? "Live data unavailable"
      : "Loading live data…";
  const stakeAda = pool?.liveStakeLovelace ? Number(pool.liveStakeLovelace) / 1_000_000 : null;

  const items = [
    { label: "Blocks produced", value: <CountUp value={pool?.blockCount ?? null} format={(v) => formatInteger(Math.round(v))} />, note: "On-chain lifetime total" },
    { label: "Live stake", value: <CountUp value={stakeAda} format={(v) => `${formatCompact(v)} ADA`} />, note: "Delegated to 300" },
    { label: "Delegators", value: <CountUp value={pool?.liveDelegators ?? null} format={(v) => formatInteger(Math.round(v))} />, note: "Choosing 300" },
    { label: "Pool status", value: <span className="text-positive">{capitalize(pool?.status)}</span>, note: updated },
  ];

  return (
    <div className="relative border-y border-line bg-night/60 backdrop-blur">
      <div className="container-site grid grid-cols-2 lg:grid-cols-4" aria-label="Live 300 stake pool data">
        {items.map((item, index) => (
          <div key={item.label} className={`px-1 py-6 sm:px-6 ${index % 2 === 1 ? "border-l border-line" : ""} ${index >= 2 ? "border-t border-line lg:border-t-0" : ""} ${index === 2 ? "lg:border-l" : ""}`}>
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">{item.value}</p>
            <p className="mt-1 text-xs text-muted">{item.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
