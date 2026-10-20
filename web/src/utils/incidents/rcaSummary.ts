// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Display structured RCA verdicts, timeline, hypotheses and evidence metadata.

import { z } from "zod";
import { gt, raw, type I18nKey, type I18nText } from "@/types/i18n";
import type {
  RcaActionKind,
  RcaBand,
  RcaEvidenceEntry,
  RcaHypothesisStatus,
  RcaOutcome,
  RcaRunSummary,
  RcaSignalClass,
  RcaSummaryHypothesis,
  RcaSummaryStatusChange,
  RcaSummaryTimelineEntry,
  RcaVerdictDetails,
} from "@/services/incidents";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { formatRcaClock } from "@/utils/incidents/rcaThread";

export type RcaPillTone = "ok" | "warn" | "err" | "neutral" | "strong" | "dash" | "warn-dash";

export const RCA_PILL_TONE_CLASS: Record<RcaPillTone, string> = {
  ok: "bg-status-success-bg text-status-success-text border-transparent",
  warn: "bg-status-warning-bg text-status-warning-text border-transparent",
  err: "bg-status-error-bg text-status-error-text border-transparent",
  neutral: "bg-surface-tint-neutral text-text-secondary border-border-default",
  strong: "bg-accent text-text-inverse border-transparent",
  dash: "bg-surface-base text-text-secondary border-border-strong border-dashed",
  "warn-dash": "bg-surface-base text-status-warning-text border-status-warning-text border-dashed",
};

/** Pill of a completed run's outcome. */
export const RCA_OUTCOME_PILL: Record<
  RcaOutcome,
  { key: I18nKey; tone: RcaPillTone; icon: IconName }
> = {
  root_cause_identified: {
    key: "alerts.incidents.rcaRun.outcome.rootCauseIdentified",
    tone: "ok",
    icon: "verified",
  },
  contributing_factor: {
    key: "alerts.incidents.rcaRun.outcome.contributingFactor",
    tone: "warn",
    icon: "help",
  },
  inconclusive: { key: "alerts.incidents.rcaRun.outcome.inconclusive", tone: "warn", icon: "help" },
  blocked: { key: "alerts.incidents.rcaRun.outcome.blocked", tone: "warn", icon: "block" },
};

/** Filled bars of the band glyph: Low 1, Medium 2, High 3, none 0 (redesign). */
export const rcaBandLevel = (band?: RcaBand): 0 | 1 | 2 | 3 =>
  band === "high" ? 3 : band === "medium" ? 2 : band === "low" ? 1 : 0;

/** "High confidence" … "No confidence". */
export function rcaBandLabel(band?: RcaBand): I18nText {
  switch (band) {
    case "high":
      return gt("alerts.incidents.rcaRun.band.high");
    case "medium":
      return gt("alerts.incidents.rcaRun.band.medium");
    case "low":
      return gt("alerts.incidents.rcaRun.band.low");
    default:
      return gt("alerts.incidents.rcaRun.band.none");
  }
}

/** Hypothesis rank; `symptom` and `ruled_out` never rank. */
const STATUS_RANK: Record<RcaHypothesisStatus, number | null> = {
  root_cause: 1,
  likely: 2,
  testing: 3,
  blocked: 4,
  contributing: 5,
  inconclusive: 6,
  untested: 7,
  symptom: null,
  ruled_out: null,
};

/** Group of a hypothesis (contract F8, redesign). */
export type RcaHypothesisGroupId = "explains" | "open" | "out";

const STATUS_GROUP: Record<RcaHypothesisStatus, RcaHypothesisGroupId> = {
  root_cause: "explains",
  contributing: "explains",
  symptom: "explains",
  blocked: "open",
  inconclusive: "open",
  likely: "open",
  testing: "open",
  untested: "open",
  ruled_out: "out",
};

export interface RcaHypothesisGroup {
  id: RcaHypothesisGroupId;
  items: RcaSummaryHypothesis[];
}

const compareHypotheses = (a: RcaSummaryHypothesis, b: RcaSummaryHypothesis): number => {
  // Ranked statuses first, then the never-ranked ones (symptom); then first seen.
  const ra = STATUS_RANK[a.status] ?? Number.MAX_SAFE_INTEGER;
  const rb = STATUS_RANK[b.status] ?? Number.MAX_SAFE_INTEGER;
  return ra !== rb ? ra - rb : a.first_seen_seq - b.first_seen_seq;
};

export function groupRcaHypotheses(
  hypotheses: RcaSummaryHypothesis[],
  outcome: RcaOutcome | undefined,
): RcaHypothesisGroup[] {
  const order: RcaHypothesisGroupId[] =
    outcome === "root_cause_identified" || outcome === "contributing_factor"
      ? ["explains", "open", "out"]
      : ["open", "explains", "out"];
  return order
    .map((id) => ({
      id,
      items: hypotheses.filter((h) => STATUS_GROUP[h.status] === id).sort(compareHypotheses),
    }))
    .filter((group) => group.items.length > 0);
}

/** Title of a group; the open group reads "Being tested" while the run is live (redesign). */
export function rcaHypothesisGroupTitle(id: RcaHypothesisGroupId, live: boolean): I18nText {
  switch (id) {
    case "explains":
      return gt("alerts.incidents.rcaSummary.group.explains");
    case "open":
      return live
        ? gt("alerts.incidents.rcaSummary.group.beingTested")
        : gt("alerts.incidents.rcaSummary.group.notConfirmed");
    case "out":
      return gt("alerts.incidents.rcaSummary.group.ruledOut");
  }
}

const STATUS_LABEL: Record<RcaHypothesisStatus, I18nKey> = {
  root_cause: "alerts.incidents.rcaSummary.status.rootCause",
  contributing: "alerts.incidents.rcaSummary.status.contributing",
  symptom: "alerts.incidents.rcaSummary.status.symptom",
  ruled_out: "alerts.incidents.rcaSummary.status.ruledOut",
  inconclusive: "alerts.incidents.rcaSummary.status.inconclusive",
  blocked: "alerts.incidents.rcaSummary.status.blocked",
  testing: "alerts.incidents.rcaSummary.status.testing",
  untested: "alerts.incidents.rcaSummary.status.untested",
  likely: "alerts.incidents.rcaSummary.status.likely",
};

/** Status word of a hypothesis or of a history entry. */
const rcaHypothesisStatusWord = (status: RcaHypothesisStatus): I18nText => gt(STATUS_LABEL[status]);

/** Status pill text of a hypothesis. */
export function rcaHypothesisStatusLabel(
  status: RcaHypothesisStatus,
  outcome: RcaOutcome | undefined,
): I18nText {
  if (status === "root_cause" && outcome !== "root_cause_identified") {
    return gt("alerts.incidents.rcaSummary.status.rootCauseNotConfirmed");
  }
  return rcaHypothesisStatusWord(status);
}

/** Pill tone of a hypothesis status (redesign `HT`). */
export const RCA_HYPOTHESIS_TONE: Record<RcaHypothesisStatus, RcaPillTone> = {
  root_cause: "strong",
  contributing: "warn",
  likely: "warn",
  symptom: "neutral",
  ruled_out: "neutral",
  inconclusive: "dash",
  testing: "dash",
  untested: "dash",
  blocked: "warn-dash",
};

/** "14:07:04 UTC · Testing (agent · after a.rao)" for one status change. */
export function rcaStatusHistoryLine(change: RcaSummaryStatusChange): I18nText {
  const actor = change.run_ended
    ? gt("alerts.incidents.rcaSummary.historyActorRunEnded")
    : change.steered_by
      ? gt("alerts.incidents.rcaSummary.historyActorSteered", { author: change.steered_by })
      : gt("alerts.incidents.rcaSummary.historyActorAgent");
  return gt("alerts.incidents.rcaSummary.historyLine", {
    time: formatRcaClock(change.at),
    status: rcaHypothesisStatusWord(change.status),
    actor,
  });
}

/** Timeline entries in time order. */
export const sortedRcaTimeline = (entries: RcaSummaryTimelineEntry[]): RcaSummaryTimelineEntry[] =>
  [...entries].sort((a, b) => a.at - b.at);

/** Evidence id → entry number, for chips; null when there is no summary. */
export function rcaEvidenceNumbers(summary: RcaRunSummary | null): Map<string, number> | null {
  if (!summary || summary.legacy) return null;
  const numbers = new Map<string, number>();
  for (const entry of summary.evidence) {
    // An id maps to the entry that cites it first; a later entry never overrides it.
    for (const id of entry.ids) if (!numbers.has(id)) numbers.set(id, entry.number);
  }
  return numbers;
}

/** Evidence filter of the index. */
export type RcaEvidenceFilter = "all" | "decisive" | "supporting";

export function filterRcaEvidence(
  entries: RcaEvidenceEntry[],
  filter: RcaEvidenceFilter,
): RcaEvidenceEntry[] {
  if (filter === "all") return entries;
  return entries.filter((entry) => entry.decisive === (filter === "decisive"));
}

/** Icon of an evidence kind (redesign `KIND_IC`). */
export function rcaEvidenceKindIcon(kind: string): IconName {
  switch (kind) {
    case "SQL":
      return "description";
    case "PromQL":
      return "bar-chart";
    case "Traces":
      return "account-tree";
    default:
      return "code";
  }
}

/** Label of a signal class. */
function rcaSignalLabel(signal: RcaSignalClass): I18nText {
  switch (signal) {
    case "logs":
      return gt("alerts.incidents.rcaSummary.signal.logs");
    case "metrics":
      return gt("alerts.incidents.rcaSummary.signal.metrics");
    case "traces":
      return gt("alerts.incidents.rcaSummary.signal.traces");
    case "change":
      return gt("alerts.incidents.rcaSummary.signal.change");
    case "infra":
      return gt("alerts.incidents.rcaSummary.signal.infra");
    case "context":
      return gt("alerts.incidents.rcaSummary.signal.context");
    case "unclassified":
      return gt("alerts.incidents.rcaSummary.signal.unclassified");
  }
}

/** "14:02–14:35 UTC" from µs, or empty when the entry has no range. */
export function rcaUtcRange(startUs?: number, endUs?: number): I18nText {
  if (typeof startUs !== "number" || typeof endUs !== "number") return raw("");
  return gt("alerts.incidents.rcaSummary.utcRange", {
    start: formatRcaClock(startUs),
    end: formatRcaClock(endUs),
  });
}

/** "Logs · checkout_api": the one-line title of an evidence entry. */
export function rcaEvidenceTitle(entry: RcaEvidenceEntry): I18nText {
  const target = rcaSignalLabel(entry.target);
  return entry.link.streams.length > 0
    ? raw(`${target} · ${entry.link.streams.join(", ")}`)
    : target;
}

/** The part of `rca_runs.result` the card reads; the server writes both lists. */
const StoredVerdict = z.object({
  verdict: z.object({
    impacted_services: z.array(z.string()).default([]),
    proposed_actions: z
      .array(
        z.object({
          title: z.string(),
          kind: z.enum(["rollback", "scale", "restart", "runbook", "other"]),
          detail: z.string(),
        }),
      )
      .default([]),
  }),
});

/** A stored record's impacted services and proposed actions; null when it has no verdict. */
export function rcaVerdictDetails(result: unknown): RcaVerdictDetails | null {
  const parsed = StoredVerdict.safeParse(result);
  if (!parsed.success) return null;
  const { impacted_services, proposed_actions } = parsed.data.verdict;
  return { impactedServices: impacted_services, proposedActions: proposed_actions };
}

/** "Rollback", "Scale", … for a proposed action's kind. */
export function rcaActionKindLabel(kind: RcaActionKind): I18nText {
  switch (kind) {
    case "rollback":
      return gt("alerts.incidents.rcaSummary.actionKind.rollback");
    case "scale":
      return gt("alerts.incidents.rcaSummary.actionKind.scale");
    case "restart":
      return gt("alerts.incidents.rcaSummary.actionKind.restart");
    case "runbook":
      return gt("alerts.incidents.rcaSummary.actionKind.runbook");
    case "other":
      return gt("alerts.incidents.rcaSummary.actionKind.other");
  }
}
