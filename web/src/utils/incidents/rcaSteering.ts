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

// Display rules of the steering rows. Times are µs.

import { gt, type I18nKey, type I18nText } from "@/types/i18n";
import type {
  RcaHypothesisStatus,
  RcaSteerAction,
  RcaSteerRecord,
  RcaSteerStatusReason,
} from "@/services/incidents";
import { userLocalPart } from "./rcaCell";

/** "Unblocked by a.rao at 14:13 · change history from a human lead". */
export interface RcaUnblockedLine {
  /** Local part of the answer's author. */
  author: string;
  /** Local "HH:mm" of the answer's `read_at`. */
  time: string;
  /** The need of the question it answered, when known. */
  need: string | null;
}

const REASON_KEY: Record<RcaSteerStatusReason, I18nKey> = {
  finalizing: "alerts.incidents.rcaSteer.reason.finalizing",
  no_active_turn: "alerts.incidents.rcaSteer.reason.noActiveTurn",
  agent_unreachable: "alerts.incidents.rcaSteer.reason.agentUnreachable",
  run_completed: "alerts.incidents.rcaSteer.reason.runCompleted",
  run_cancelled: "alerts.incidents.rcaSteer.reason.runCancelled",
  run_failed: "alerts.incidents.rcaSteer.reason.runFailed",
};

/** The status pill of a steering row. */
export function rcaSteerStatusLabel(item: RcaSteerRecord): I18nText {
  switch (item.status) {
    case "queued":
    case "delivered":
      return gt("alerts.incidents.rcaSteer.pill.queued");
    case "read":
      return gt("alerts.incidents.rcaSteer.pill.read");
    case "applied":
      return gt("alerts.incidents.rcaSteer.pill.applied");
    case "declined":
      return gt("alerts.incidents.rcaSteer.pill.declined");
    case "not_read":
      return gt("alerts.incidents.rcaSteer.pill.notRead");
    case "rejected":
      return item.status_reason
        ? gt("alerts.incidents.rcaSteer.pill.rejectedWithReason", {
            reason: gt(REASON_KEY[item.status_reason]),
          })
        : gt("alerts.incidents.rcaSteer.pill.rejected");
  }
}

/** A message the run never took offers "Re-analyze with this message". */
export const rcaSteerOffersReanalyze = (item: RcaSteerRecord): boolean =>
  (item.status === "rejected" && item.status_reason === "finalizing") || item.status === "not_read";

/** The run takes no more messages: the text can still start a new version as guidance. */
export const isClosedRunRefusal = (code: string | null): boolean =>
  code === "run_closing" || code === "run_not_steerable";

/** Rows counted in "steered N×": messages and hypothesis actions that reached the agent. */
export const rcaSteeredCount = (items: RcaSteerRecord[]): number =>
  items.filter(
    (item) =>
      (item.kind === "message" || item.kind === "hypothesis_action") &&
      (item.status === "delivered" ||
        item.status === "read" ||
        item.status === "applied" ||
        item.status === "declined"),
  ).length;

/** Hypothesis id → author of its oldest unread action, for "Pending · <author>". */
export function rcaPendingHypothesisActions(items: RcaSteerRecord[]): Map<string, string> {
  const pending = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== "hypothesis_action" || !item.hypothesis_id) continue;
    if (item.status !== "queued" && item.status !== "delivered") continue;
    if (!pending.has(item.hypothesis_id)) {
      pending.set(item.hypothesis_id, userLocalPart(item.author_email));
    }
  }
  return pending;
}

/** Disprove unless ruled out, Reopen when ruled out, Test first while untested, testing or likely. */
export function rcaHypothesisActions(status: RcaHypothesisStatus): RcaSteerAction[] {
  if (status === "ruled_out") return ["reopen"];
  const actions: RcaSteerAction[] = ["disprove"];
  if (status === "untested" || status === "testing" || status === "likely") {
    actions.push("test_first");
  }
  return actions;
}

/** The newest answer the agent read: the "Unblocked by" line. */
export function rcaUnblockingAnswer(items: RcaSteerRecord[]): RcaSteerRecord | null {
  let newest: RcaSteerRecord | null = null;
  for (const item of items) {
    if (item.kind !== "answer" || !item.read_at) continue;
    if (!newest || item.read_at > (newest.read_at ?? 0)) newest = item;
  }
  return newest;
}

/** The subject of a question's need without the leading "Needs" the agent writes; blank → null. */
export function rcaNeedSubject(need: string | null | undefined): string | null {
  const text = (need ?? "").trim();
  const subject = text.replace(/^needs(?:\s*:\s*|\s+)/i, "").trim();
  return subject && !/^needs:?$/i.test(subject) ? subject : null;
}
