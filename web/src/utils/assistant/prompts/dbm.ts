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

import { gt, raw, type TranslateFn } from "@/types/i18n";
import type {
  BlockingFixPromptInput,
  DeadlockFixPromptInput,
  QueryFixPromptInput,
} from "@/utils/dbm/aiPrompts";
import { formatCount, formatMultiplier, formatNs } from "@/utils/dbm/format";

import { doorChip, finish, ident, inline, type PromptBuild } from "./format";

export {
  buildBlockingFixPrompt,
  buildDeadlockFixPrompt,
  buildQueryFixPrompt,
  type BlockingFixPromptInput,
  type DeadlockFixPromptInput,
  type QueryFixPromptInput,
} from "@/utils/dbm/aiPrompts";

/** A DBM finding with the rule-based facts that describe it. */
export type DbmFinding =
  | { kind: "query"; input: QueryFixPromptInput }
  | { kind: "deadlock"; input: DeadlockFixPromptInput }
  | { kind: "blocking"; input: BlockingFixPromptInput };

export interface DbmFindingInput {
  org: string;
  /** What the thread and chip are named after: the instance, or the engine when the instance is unknown. */
  name: string;
  finding: DbmFinding;
}

const NORMALIZED_NOTE =
  "The statements are normalized: every literal has been replaced with ?, so treat parameter values as unknown and do not assume selectivity from them.";

/** Ask AI how to fix this: numbers in a fixed template; statements, instance, objects, applications and callers only in the Report block. */
export function buildDbmFindingPrompt(input: DbmFindingInput, t: TranslateFn = gt): PromptBuild {
  const label = t("assistant.entry.chip.database", { name: raw(inline(input.name, 60)) });
  const chip = doorChip({
    kind: "report",
    key: `${input.org}|dbm|${input.finding.kind}|${input.name}|${JSON.stringify(input.finding.input)}`,
    label,
    short: raw(inline(input.name, 60)),
    ref: { type: "dbm_finding", org: input.org },
    data: { finding: input.finding.kind, ...input.finding.input },
    sent: "serialized",
  });
  return { text: finish(textOf(input.finding)), chips: [chip], title: label };
}

function engine(dbSystem: string | null | undefined): string {
  return ident(dbSystem ?? "") ?? "SQL";
}

function fact(label: string, value: string | null): string | null {
  return value ? `${label}: ${value}.` : null;
}

function nsFact(label: string, ns: number | null | undefined): string | null {
  return ns == null ? null : fact(label, formatNs(ns));
}

function textOf(finding: DbmFinding): (string | null | false)[] {
  if (finding.kind === "query") return queryText(finding.input);
  if (finding.kind === "deadlock") return deadlockText(finding.input);
  return blockingText(finding.input);
}

function queryText(input: QueryFixPromptInput): (string | null | false)[] {
  return [
    `This ${engine(input.dbSystem)} query is one of the most expensive on its instance and I need to make it faster.`,
    "The normalized statement, the instance and its callers are in the attached Report block.",
    nsFact("p50", input.p50Ns),
    nsFact("p95", input.p95Ns),
    nsFact("p99", input.p99Ns),
    nsFact("Slowest execution", input.maxNs),
    input.calls != null && fact("Executions in the window", formatCount(input.calls)),
    nsFact("Total database time in the window", input.totalTimeNs),
    input.errors != null &&
      input.errors > 0 &&
      fact("Failed executions", formatCount(input.errors)),
    input.callsPerTrace != null &&
      fact("Executions per request", `${formatMultiplier(input.callsPerTrace)} on average`),
    NORMALIZED_NOTE,
    "Given these numbers, what is most likely making it slow, and what specific changes should I make? Cover indexing, the shape of the statement itself, and whether the calling code should run it fewer times.",
  ];
}

function deadlockText(input: DeadlockFixPromptInput): (string | null | false)[] {
  return [
    `Two sessions on this ${engine(input.dbSystem)} instance deadlocked against each other and the database cancelled one of them.`,
    "Both normalized statements, the instance, the contested objects and the applications are in the attached Report block.",
    input.count != null && fact("Deadlocks in the window", formatCount(input.count)),
    input.cadenceSeconds != null &&
      fact("Recurring roughly every", `${Math.round(input.cadenceSeconds)} s`),
    fact(
      "Opposite row order detected",
      input.oppositeRowOrder
        ? "yes, the two statements touch the same object's rows in opposite order"
        : "no, the row ordering evidence is inconclusive",
    ),
    NORMALIZED_NOTE,
    "How do I stop this deadlock from recurring? Tell me whether a consistent lock ordering fixes it here, what that ordering should be, and what else to change if ordering alone is not enough.",
  ];
}

function blockingText(input: BlockingFixPromptInput): (string | null | false)[] {
  return [
    `One session on this ${engine(input.dbSystem)} instance is at the root of a lock-wait chain: nothing is blocking it, and everything else is waiting behind it.`,
    input.query
      ? "Its last normalized statement, its session id, the instance and the application are in the attached Report block."
      : "Its session id, the instance and the application are in the attached Report block.",
    input.blockingCount != null &&
      fact("Sessions stuck behind it", formatCount(input.blockingCount)),
    input.longestWaitSeconds != null &&
      fact("Longest wait behind it", `${Math.round(input.longestWaitSeconds)} s`),
    input.idleSeconds != null &&
      fact(
        "Idle in transaction for",
        `${Math.round(input.idleSeconds)} s, holding locks but running nothing`,
      ),
    !!input.query && NORMALIZED_NOTE,
    "Why would this session be holding locks and blocking the others, and what should I do about it right now versus permanently?",
  ];
}
