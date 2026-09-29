"use client";

import { DripCard } from "./drip-card";

/** The drip on the landing page: tiers and the claim for the connected wallet. */
export function DripSection() {
  return (
    <section id="drip" aria-label="Drip rewards" className="scroll-mt-24 pb-24 sm:pb-32">
      <div className="container-site">
        <DripCard className="bg-night/60" />
      </div>
    </section>
  );
}
