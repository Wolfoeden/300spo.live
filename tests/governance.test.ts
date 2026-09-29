import { describe, expect, it } from "vitest";
import { anchorUrl, latestVotes, proposalStatus, rationaleFrom, type KoiosProposal, type KoiosVote } from "../lib/governance";

const vote = (proposal: string, time: number, choice: KoiosVote["vote"]): KoiosVote => ({
  proposal_id: proposal,
  proposal_tx_hash: "00".repeat(32),
  proposal_index: 0,
  vote_tx_hash: `${time}`.padStart(64, "0"),
  block_time: time,
  vote: choice,
  meta_url: null,
  meta_hash: null,
});

describe("latestVotes", () => {
  it("keeps the newest vote per action and lists the ones it replaced", () => {
    const grouped = latestVotes([vote("a", 10, "Yes"), vote("b", 30, "Yes"), vote("a", 20, "No")]);
    expect(grouped.map((entry) => [entry.latest.proposal_id, entry.latest.vote, entry.previous])).toEqual([
      ["b", "Yes", []],
      ["a", "No", ["Yes"]],
    ]);
  });
});

describe("proposalStatus", () => {
  const base: KoiosProposal = {
    proposal_id: "a",
    proposal_type: "InfoAction",
    proposed_epoch: 600,
    ratified_epoch: null,
    enacted_epoch: null,
    dropped_epoch: null,
    expired_epoch: null,
    expiration: 606,
    title: null,
  };
  it("prefers the furthest step an action reached", () => {
    expect(proposalStatus(base)).toBe("Open");
    expect(proposalStatus({ ...base, expired_epoch: 653, dropped_epoch: 654 })).toBe("Expired");
    expect(proposalStatus({ ...base, ratified_epoch: 610 })).toBe("Ratified");
    expect(proposalStatus({ ...base, ratified_epoch: 610, enacted_epoch: 611 })).toBe("Enacted");
  });
});

describe("rationaleFrom", () => {
  it("reads a CIP-100 comment", () => {
    expect(rationaleFrom({ body: { comment: " I support both changes. " } })).toEqual({ summary: null, sections: [{ label: "Comment", text: "I support both changes." }] });
  });

  it("reads CIP-136 fields in order, including JSON-LD values", () => {
    const parsed = rationaleFrom({ body: { summary: "Short", conclusion: "Done", rationaleStatement: { "@value": "Because" } } });
    expect(parsed).toEqual({
      summary: "Short",
      sections: [
        { label: "Rationale", text: "Because" },
        { label: "Conclusion", text: "Done" },
      ],
    });
  });

  it("returns null for documents without text", () => {
    expect(rationaleFrom({ body: {} })).toBeNull();
    expect(rationaleFrom("not json")).toBeNull();
  });
});

describe("anchorUrl", () => {
  it("fetches https directly and ipfs through a gateway, nothing else", () => {
    expect(anchorUrl("https://example.com/a.json")).toBe("https://example.com/a.json");
    expect(anchorUrl("ipfs://bafkreie2")).toBe("https://ipfs.blockfrost.dev/ipfs/bafkreie2");
    expect(anchorUrl("http://example.com/a.json")).toBeNull();
    expect(anchorUrl("file:///etc/passwd")).toBeNull();
    expect(anchorUrl(null)).toBeNull();
  });
});
