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

// Display helpers for the summary view of an RCA run (03 §9, §12): verdict
// pill, band, hypothesis groups, timeline markers and evidence numbers.

import { gt, raw, type I18nKey, type I18nText } from "@/types/i18n";
import type {
  RcaBand,
  RcaEvidenceEntry,
  RcaHypothesisStatus,
  RcaOutcome,
  RcaRunSummary,
  RcaSignalClass,
  RcaSummaryHypothesis,
  RcaSummaryStatusChange,
  RcaSummaryTimelineEntry,
} from "@/services/incidents";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { formatRcaClock } from "@/utils/incidents/rcaThread";

/**
 * The one pill style of the Analysis tab (redesign): outcome, hypothesis status
 * and evidence weight share it. `dash` and `warn-dash` are the open statuses.
 */
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

/** Pill of a completed run's outcome (03 VE32). */
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

/** "High confidence" … "No confidence" (03 VE33). */
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

/** VE12 rank; `symptom` and `ruled_out` never rank. */
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
  // Ranked statuses first by VE12, then the never-ranked ones (symptom); then first seen.
  const ra = STATUS_RANK[a.status] ?? Number.MAX_SAFE_INTEGER;
  const rb = STATUS_RANK[b.status] ?? Number.MAX_SAFE_INTEGER;
  return ra !== rb ? ra - rb : a.first_seen_seq - b.first_seen_seq;
};

/**
 * Hypotheses in their groups (F8): "Explains the incident" first when the outcome
 * names a cause or a factor, else the open group first; "Ruled out" last. Empty
 * groups are dropped.
 */
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
export const rcaHypothesisStatusWord = (status: RcaHypothesisStatus): I18nText =>
  gt(STATUS_LABEL[status]);

/**
 * Status pill text of a hypothesis. A `root_cause` hypothesis of a run whose
 * outcome is not `root_cause_identified` reads "Root cause · not confirmed" (VE18).
 */
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

/** "14:07:04 UTC · Testing (agent · after a.rao)" for one status change (VE11). */
export function rcaStatusHistoryLine(change: RcaSummaryStatusChange): I18nText {
  const actor = change.steered_by
    ? gt("alerts.incidents.rcaSummary.historyActorSteered", { author: change.steered_by })
    : gt("alerts.incidents.rcaSummary.historyActorAgent");
  return gt("alerts.incidents.rcaSummary.historyLine", {
    time: formatRcaClock(change.at),
    status: rcaHypothesisStatusWord(change.status),
    actor,
  });
}

/** Timeline entries in time order (VE31). */
export const sortedRcaTimeline = (entries: RcaSummaryTimelineEntry[]): RcaSummaryTimelineEntry[] =>
  [...entries].sort((a, b) => a.at - b.at);

/** Evidence id → entry number, for chips (VE24); null when there is no summary. */
export function rcaEvidenceNumbers(summary: RcaRunSummary | null): Map<string, number> | null {
  if (!summary || summary.legacy) return null;
  const numbers = new Map<string, number>();
  for (const entry of summary.evidence) {
    // An id maps to the entry that cites it first (VE24); a later entry never overrides it.
    for (const id of entry.ids) if (!numbers.has(id)) numbers.set(id, entry.number);
  }
  return numbers;
}

/** Evidence filter of the index (VE28). */
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
export function rcaSignalLabel(signal: RcaSignalClass): I18nText {
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
