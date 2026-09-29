/** The Cardano FAQ on the landing page; its structured data (FAQPage) reads the same list. */
export const FAQ: [question: string, answer: string][] = [
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
