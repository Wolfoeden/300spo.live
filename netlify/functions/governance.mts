import type { Config } from "@netlify/functions";
import {
  anchorUrl,
  latestVotes,
  proposalStatus,
  rationaleFrom,
  type GovernanceVote,
  type KoiosProposal,
  type KoiosVote,
  type Rationale,
} from "../../lib/governance";
import { koios } from "../../lib/server/koios";
import { DREP_ID } from "../../lib/site";
import { json } from "./_shared/wallet-auth";

// Public: the 300 DRep's votes with their rationales. Two rounds of requests
// (votes and profile, then proposals and rationale documents) have to fit into
// Netlify's 10 s, so each gets a short timeout; the CDN keeps the answer.
const KOIOS_TIMEOUT_MS = 4_500;
const ANCHOR_TIMEOUT_MS = 3_500;
const MAX_ANCHOR_BYTES = 300_000;

type DrepInfo = { active: boolean; drep_status: string; amount: string; expires_epoch_no: number | null; live_delegator_count: number | null };
type DrepMetadata = { meta_json: { body?: { objectives?: unknown } } | null };

/** A vote's rationale document; null when it is missing, too large, slow or not readable. */
const fetchRationale = async (metaUrl: string | null): Promise<Rationale | null> => {
  const url = anchorUrl(metaUrl);
  if (!url || !metaUrl) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ANCHOR_TIMEOUT_MS), headers: { accept: "application/json" } });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_ANCHOR_BYTES) return null;
    const body = await response.text();
    if (body.length > MAX_ANCHOR_BYTES) return null;
    const parsed = rationaleFrom(JSON.parse(body));
    return parsed && { ...parsed, url: metaUrl };
  } catch {
    return null;
  }
};

const proposalsById = async (ids: string[]) => {
  if (!ids.length) return new Map<string, KoiosProposal>();
  const select =
    "proposal_id,proposal_type,proposed_epoch,ratified_epoch,enacted_epoch,dropped_epoch,expired_epoch,expiration,title:meta_json->body->>title";
  const rows = await koios<KoiosProposal[]>(`proposal_list?proposal_id=in.(${ids.join(",")})&select=${select}`, undefined, KOIOS_TIMEOUT_MS);
  return new Map(rows.map((row) => [row.proposal_id, row]));
};

export default async () => {
  try {
    const [votes, [info], [metadata]] = await Promise.all([
      koios<KoiosVote[]>(`drep_votes?_drep_id=${DREP_ID}`, undefined, KOIOS_TIMEOUT_MS),
      koios<DrepInfo[]>("drep_info", { _drep_ids: [DREP_ID] }, KOIOS_TIMEOUT_MS),
      koios<DrepMetadata[]>("drep_metadata", { _drep_ids: [DREP_ID] }, KOIOS_TIMEOUT_MS).catch(() => [] as DrepMetadata[]),
    ]);
    const grouped = latestVotes(votes);
    const [proposals, rationales] = await Promise.all([
      proposalsById(grouped.map((entry) => entry.latest.proposal_id)).catch(() => new Map<string, KoiosProposal>()),
      Promise.all(grouped.map((entry) => fetchRationale(entry.latest.meta_url))),
    ]);
    const record: GovernanceVote[] = grouped.map(({ latest, previous }, index) => {
      const proposal = proposals.get(latest.proposal_id);
      return {
        proposalId: latest.proposal_id,
        proposalTxHash: latest.proposal_tx_hash,
        proposalIndex: latest.proposal_index,
        type: proposal?.proposal_type ?? "",
        title: proposal?.title ?? null,
        status: proposalStatus(proposal),
        vote: latest.vote,
        previous,
        votedAt: new Date(latest.block_time * 1000).toISOString(),
        voteTxHash: latest.vote_tx_hash,
        rationale: rationales[index],
        rationaleUrl: latest.meta_url,
      };
    });
    const objectives = metadata?.meta_json?.body?.objectives;
    return json(
      {
        drep: {
          id: DREP_ID,
          active: info?.active ?? false,
          status: info?.drep_status ?? null,
          votingPowerLovelace: info?.amount ?? null,
          delegators: info?.live_delegator_count ?? null,
          expiresEpoch: info?.expires_epoch_no ?? null,
          objectives: typeof objectives === "string" ? objectives : null,
        },
        votes: record,
        updatedAt: new Date().toISOString(),
      },
      200,
      { "cache-control": "public, max-age=300", "netlify-cdn-cache-control": "public, durable, max-age=900, stale-while-revalidate=86400" },
    );
  } catch (error) {
    console.error("[governance]", error);
    return json({ error: "chain_unavailable" }, 502);
  }
};

export const config: Config = { path: "/api/governance" };
