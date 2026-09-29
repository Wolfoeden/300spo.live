// The 300 DRep's voting record: Koios `drep_votes` and `proposal_list`, plus the
// rationale document each vote anchors (CIP-100 comment or CIP-136 fields).

export type VoteChoice = "Yes" | "No" | "Abstain";

export type KoiosVote = {
  proposal_id: string;
  proposal_tx_hash: string;
  proposal_index: number;
  vote_tx_hash: string;
  block_time: number;
  vote: VoteChoice;
  meta_url: string | null;
  meta_hash: string | null;
};

export type KoiosProposal = {
  proposal_id: string;
  proposal_type: string;
  proposed_epoch: number | null;
  ratified_epoch: number | null;
  enacted_epoch: number | null;
  dropped_epoch: number | null;
  expired_epoch: number | null;
  expiration: number | null;
  title: string | null;
};

export type ProposalStatus = "Enacted" | "Ratified" | "Expired" | "Dropped" | "Open";
export type Rationale = { summary: string | null; sections: { label: string; text: string }[]; url: string };

export type GovernanceVote = {
  proposalId: string;
  proposalTxHash: string;
  proposalIndex: number;
  type: string;
  title: string | null;
  status: ProposalStatus;
  vote: VoteChoice;
  /** Earlier votes on the same action, newest first, when the DRep changed its vote. */
  previous: VoteChoice[];
  votedAt: string;
  voteTxHash: string;
  rationale: Rationale | null;
  rationaleUrl: string | null;
};

export const PROPOSAL_TYPES: Record<string, string> = {
  ParameterChange: "Parameter change",
  HardForkInitiation: "Hard fork",
  TreasuryWithdrawals: "Treasury withdrawal",
  NoConfidence: "No confidence",
  NewCommittee: "Committee update",
  NewConstitution: "New constitution",
  InfoAction: "Info action",
};

/** One entry per governance action: the latest vote, with the ones it replaced. Newest first. */
export const latestVotes = (votes: KoiosVote[]) => {
  const byProposal = new Map<string, KoiosVote[]>();
  for (const vote of votes) byProposal.set(vote.proposal_id, [...(byProposal.get(vote.proposal_id) ?? []), vote]);
  return [...byProposal.values()]
    .map((entries) => {
      const [latest, ...older] = [...entries].sort((a, b) => b.block_time - a.block_time);
      return { latest, previous: older.map((vote) => vote.vote) };
    })
    .sort((a, b) => b.latest.block_time - a.latest.block_time);
};

export const proposalStatus = (proposal: KoiosProposal | undefined): ProposalStatus =>
  !proposal
    ? "Open"
    : proposal.enacted_epoch !== null
      ? "Enacted"
      : proposal.ratified_epoch !== null
        ? "Ratified"
        : proposal.expired_epoch !== null
          ? "Expired"
          : proposal.dropped_epoch !== null
            ? "Dropped"
            : "Open";

/**
 * Where to fetch an anchor: https as is, ipfs:// through Blockfrost's gateway
 * (ipfs.io and dweb.link answer server requests with 429), anything else not at all.
 */
export const anchorUrl = (url: string | null) => {
  if (!url) return null;
  if (url.startsWith("ipfs://")) return `https://ipfs.blockfrost.dev/ipfs/${url.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

const SECTIONS: [string, string][] = [
  ["rationaleStatement", "Rationale"],
  ["precedentDiscussion", "Precedent"],
  ["counterargumentDiscussion", "Counterarguments"],
  ["conclusion", "Conclusion"],
  ["comment", "Comment"],
];

// Authors sometimes publish the text as a JSON-LD value object ({"@value": "…"}).
const text = (value: unknown): string | null => {
  const raw = typeof value === "string" ? value : value && typeof value === "object" && "@value" in value ? (value as { "@value": unknown })["@value"] : null;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
};

/** The readable parts of a vote rationale document, or null if it has none. */
export const rationaleFrom = (document: unknown): Omit<Rationale, "url"> | null => {
  const body = document && typeof document === "object" ? (document as { body?: unknown }).body : null;
  if (!body || typeof body !== "object") return null;
  const fields = body as Record<string, unknown>;
  const summary = text(fields.summary);
  const sections = SECTIONS.flatMap(([key, label]) => {
    const value = text(fields[key]);
    return value ? [{ label, text: value }] : [];
  });
  return summary || sections.length ? { summary, sections } : null;
};
