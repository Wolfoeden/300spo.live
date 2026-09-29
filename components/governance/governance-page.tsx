"use client";

import { useEffect, useState } from "react";
import { formatAdaCompact, formatInteger } from "@/lib/format";
import { PROPOSAL_TYPES, type GovernanceVote, type VoteChoice } from "@/lib/governance";
import { CopyButton } from "../copy-button";
import { ArrowRight, ArrowUpRight, Spinner } from "../icons";
import { InfoBubble } from "../info-bubble";
import { DelegateButton } from "../wallet/delegation";

type Drep = {
  id: string;
  active: boolean;
  votingPowerLovelace: string | null;
  delegators: number | null;
  expiresEpoch: number | null;
  objectives: string | null;
};
type VotingRecord = { drep: Drep; votes: GovernanceVote[]; updatedAt: string };

const VOTE_STYLE: { [vote in VoteChoice]: string } = {
  Yes: "border-positive/40 bg-positive/10 text-positive",
  No: "border-danger/40 bg-danger/10 text-danger",
  Abstain: "border-line-strong bg-white/5 text-muted",
};
const STATUS_STYLE: { [status in GovernanceVote["status"]]: string } = {
  Enacted: "text-positive",
  Ratified: "text-positive",
  Open: "text-gold",
  Expired: "text-faint",
  Dropped: "text-faint",
};
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The 300 DRep's profile and every vote it cast, with the published rationale. */
export function GovernancePage() {
  const [record, setRecord] = useState<VotingRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/governance")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: VotingRecord) => active && setRecord(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  const votes = record?.votes ?? [];
  const count = (vote: VoteChoice) => votes.filter((entry) => entry.vote === vote).length;
  const withRationale = votes.filter((entry) => entry.rationaleUrl).length;

  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden">
        <div className="grid-backdrop absolute inset-0" />
        <div className="absolute -top-40 right-[-10%] h-[30rem] w-[30rem] rounded-full bg-gold/[0.12] blur-[120px]" />
      </div>

      <div className="container-site relative pb-24 pt-28 sm:pt-32">
        <header className="max-w-3xl">
          <p className="kicker">Governance</p>
          <h1 className="mt-3 flex flex-wrap items-center gap-3 text-4xl font-semibold leading-[1.02] tracking-[-0.03em] sm:text-5xl">
            <span>
              How <span className="text-gold-gradient">300</span> votes.
            </span>
            <InfoBubble label="Where this record comes from">
              <span className="block">
                Every vote the 300 DRep cast on a Cardano governance action, read from the chain. A rationale is the document a vote links to
                on chain; it is shown here as published.
              </span>
            </InfoBubble>
          </h1>
        </header>

        <section aria-label="300 DRep" className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="glass rounded-3xl p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/300-logo.jpg" alt="" className="size-12 rounded-full ring-1 ring-gold/50" />
                <div>
                  <p className="text-xl font-semibold">300 DRep</p>
                  <p className={`text-xs ${record?.drep.active ? "text-positive" : "text-faint"}`}>
                    {record ? (record.drep.active ? "Active" : "Inactive") : "…"}
                    {record?.drep.expiresEpoch ? ` · active until epoch ${record.drep.expiresEpoch}` : ""}
                  </p>
                </div>
              </div>
              <DelegateButton target="drep" className="btn btn-gold !px-4 !py-2 text-sm">
                Delegate to 300 DRep <ArrowRight size={14} />
              </DelegateButton>
            </div>
            {record?.drep.objectives && <p className="mt-5 text-muted">“{record.drep.objectives}”</p>}
            <div className="mt-5 rounded-2xl border border-line p-4">
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">DRep ID</p>
              <code className="mt-1 block break-all font-mono text-xs text-text">{record?.drep.id ?? "…"}</code>
              {record && <CopyButton value={record.drep.id} label="Copy DRep ID" className="mt-3" />}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            {[
              ["Voting power", record ? formatAdaCompact(record.drep.votingPowerLovelace) : "…"],
              ["Delegators", record ? formatInteger(record.drep.delegators) : "…"],
              ["Actions voted", record ? formatInteger(votes.length) : "…"],
              ["With rationale", record ? `${withRationale} of ${votes.length}` : "…"],
              ["Yes / No", record ? `${count("Yes")} / ${count("No")}` : "…"],
              ["Abstain", record ? formatInteger(count("Abstain")) : "…"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-line bg-night/60 p-4">
                <dt className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="votes-title" className="mt-14">
          <h2 id="votes-title" className="kicker">
            Votes and rationales
          </h2>
          {!record ? (
            <p className="mt-6 flex items-center gap-2 text-sm text-muted">
              {failed ? "The voting record could not be loaded from the Cardano chain. Try again in a moment." : <><Spinner size={16} /> Loading the voting record…</>}
            </p>
          ) : !votes.length ? (
            <p className="mt-6 text-sm text-muted">No votes yet.</p>
          ) : (
            <ol className="mt-6 grid grid-cols-1 gap-4">
              {votes.map((vote) => (
                <VoteCard key={vote.proposalId} vote={vote} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function VoteCard({ vote }: { vote: GovernanceVote }) {
  const [open, setOpen] = useState(false);
  const rationale = vote.rationale;
  const [lead, ...rest] = rationale?.sections ?? [];
  const long = !!rationale && (rest.length > 0 || !!rationale.summary || (lead?.text.length ?? 0) > 420);

  return (
    <li className="rounded-3xl border border-line bg-night/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className={`rounded-full border px-2.5 py-1 font-semibold ${VOTE_STYLE[vote.vote]}`}>{vote.vote}</span>
        <span className="text-muted">{PROPOSAL_TYPES[vote.type] ?? "Governance action"}</span>
        <span className={STATUS_STYLE[vote.status]}>{vote.status}</span>
        <span className="text-faint">voted {date(vote.votedAt)}</span>
        {vote.previous.length > 0 && <span className="text-faint">· changed from {vote.previous.join(", then ")}</span>}
      </div>
      <h3 className="mt-3 text-lg font-semibold leading-snug">{vote.title ?? "Untitled governance action"}</h3>

      {rationale ? (
        <div className="mt-3 text-sm leading-relaxed text-muted">
          {rationale.summary && <p className="whitespace-pre-line text-text">{rationale.summary}</p>}
          {(open || !rationale.summary) && lead && (
            <div className={rationale.summary ? "mt-3" : ""}>
              {rationale.summary && <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">{lead.label}</p>}
              <p className={`whitespace-pre-line ${!open && !rationale.summary ? "line-clamp-5" : ""}`}>{lead.text}</p>
            </div>
          )}
          {open &&
            rest.map((section) => (
              <div key={section.label} className="mt-3">
                <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">{section.label}</p>
                <p className="whitespace-pre-line">{section.text}</p>
              </div>
            ))}
          {long && (
            <button className="mt-2 text-sm font-medium text-gold hover:text-gold-bright" onClick={() => setOpen((value) => !value)}>
              {open ? "Show less" : "Read full rationale"}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-faint">
          {vote.rationaleUrl ? "The rationale is not available at the address it was published under." : "No rationale was published with this vote."}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <a
          className="inline-flex items-center gap-1 text-muted hover:text-text"
          href={`https://gov.tools/governance_actions/${vote.proposalTxHash}#${vote.proposalIndex}`}
          target="_blank"
          rel="noreferrer"
        >
          Governance action <ArrowUpRight size={12} />
        </a>
        <a
          className="inline-flex items-center gap-1 text-muted hover:text-text"
          href={`https://cardanoscan.io/transaction/${vote.voteTxHash}`}
          target="_blank"
          rel="noreferrer"
        >
          Vote transaction <ArrowUpRight size={12} />
        </a>
        {vote.rationaleUrl && (
          <a
            className="inline-flex items-center gap-1 text-muted hover:text-text"
            href={vote.rationaleUrl.startsWith("ipfs://") ? `https://ipfs.blockfrost.dev/ipfs/${vote.rationaleUrl.slice(7)}` : vote.rationaleUrl}
            target="_blank"
            rel="noreferrer"
          >
            Rationale document <ArrowUpRight size={12} />
          </a>
        )}
      </div>
    </li>
  );
}
