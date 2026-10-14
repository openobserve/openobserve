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

import type { I18nKey } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import {
  AUTONOMY,
  DAY_DATE,
  DEMO_NOW,
  LEDGER,
  daysBefore,
  type DayKey,
  type LedgerFact,
} from "../data/facts";
import type { LedgerEntry } from "../fixtures";
import type { FixPhase } from "./useDecisions";

export type ChangeFilter = "all" | "fixes" | "watching" | "tuning";
export type ChangeKind = "fix" | "permission" | "watching" | "tuning";
export type ChangeState = "applying" | "worked" | "done" | "review" | "didntHelp" | "undone";

export interface Change {
  entry: LedgerEntry;
  fact: LedgerFact;
  kind: ChangeKind;
  state: ChangeState;
  reviewDays?: number;
  day: DayKey;
  time?: string;
}

export const TRUST_WINDOW_DAYS = 7;

export const CHANGE_FILTERS: ChangeFilter[] = ["all", "fixes", "watching", "tuning"];

export const FILTER_LABEL: Record<ChangeFilter, I18nKey> = {
  all: "autoobserve2.activityPage.filters.all",
  fixes: "autoobserve2.activityPage.filters.fixes",
  watching: "autoobserve2.activityPage.filters.watching",
  tuning: "autoobserve2.activityPage.filters.tuning",
};

export const KIND_LOOK: Record<ChangeKind, { icon: IconName; badge: string; accent: string }> = {
  fix: {
    icon: "build",
    badge:
      "from-badge-purple-soft-bg to-ingest-accent-purple/25 text-badge-purple-soft-text ring-ingest-accent-purple/30",
    accent: "bg-ingest-accent-purple",
  },
  permission: {
    icon: "verified-user",
    badge:
      "from-badge-blue-soft-bg to-ingest-accent-blue/25 text-badge-blue-soft-text ring-ingest-accent-blue/30",
    accent: "bg-ingest-accent-blue",
  },
  watching: {
    icon: "visibility",
    badge:
      "from-badge-teal-soft-bg to-ingest-accent-teal/25 text-badge-teal-soft-text ring-ingest-accent-teal/30",
    accent: "bg-ingest-accent-teal",
  },
  tuning: {
    icon: "tune",
    badge:
      "from-badge-amber-soft-bg to-ingest-accent-amber/25 text-badge-amber-soft-text ring-ingest-accent-amber/30",
    accent: "bg-ingest-accent-amber",
  },
};

export const FILTER_DOT: Record<ChangeFilter, string | undefined> = {
  all: undefined,
  fixes: KIND_LOOK.fix.accent,
  watching: KIND_LOOK.watching.accent,
  tuning: KIND_LOOK.tuning.accent,
};

export const STATE_LOOK: Record<
  ChangeState,
  { variant: BadgeVariant; key: I18nKey; icon?: IconName }
> = {
  applying: {
    variant: "primary-soft",
    key: "autoobserve2.activityPage.status.applying",
    icon: "schedule",
  },
  worked: {
    variant: "success-soft",
    key: "autoobserve2.activityPage.status.worked",
    icon: "check",
  },
  done: { variant: "blue-soft", key: "autoobserve2.activityPage.status.done", icon: "check" },
  review: {
    variant: "indigo-soft",
    key: "autoobserve2.activityPage.status.review",
    icon: "schedule",
  },
  didntHelp: {
    variant: "orange-soft",
    key: "autoobserve2.activityPage.status.didntHelp",
    icon: "warning",
  },
  undone: { variant: "purple-soft", key: "autoobserve2.activityPage.status.undone", icon: "undo" },
};

const FACTS: Record<string, LedgerFact> = Object.fromEntries(LEDGER.map((f) => [f.id, f]));

// The investigation loop's only change is an alert-query fix, so it reads as alert tuning.
const kindOf = (fact: LedgerFact): ChangeKind => {
  if (fact.loop === "coverage") return "watching";
  if (fact.loop !== "action") return "tuning";
  return fact.actionClass === "RaiseAutonomy" ? "permission" : "fix";
};

export const filterOf = (kind: ChangeKind): ChangeFilter =>
  kind === "watching" ? "watching" : kind === "tuning" ? "tuning" : "fixes";

const fixOutcome = (fact: LedgerFact) => fact.history.find((h) => h.kind === "fixes")?.worked;

const stateOf = (entry: LedgerEntry, fact: LedgerFact, phase?: FixPhase): ChangeState => {
  if (entry.status === "rolled_back") return "undone";
  if (phase) return phase === "fixing" ? "applying" : "worked";
  if (entry.status === "kept") return "worked";
  const outcome = fixOutcome(fact);
  if (outcome !== undefined) return outcome ? "worked" : "didntHelp";
  return entry.status === "auto_applied" && fact.reviewWindow ? "review" : "done";
};

const reviewDaysOf = (fact: LedgerFact) => {
  const days = Number.parseInt(fact.reviewWindow ?? "", 10);
  return Number.isNaN(days) ? undefined : days;
};

// A proposal still awaiting an answer, or turned down, never changed anything.
export const isChange = (entry: LedgerEntry) =>
  entry.status !== "awaiting" && entry.status !== "rejected";

// An answered request happened now, so it moves to today however old the proposal is.
export const toChanges = (ledger: LedgerEntry[], phases: Record<string, FixPhase>): Change[] =>
  ledger.filter(isChange).map((entry) => {
    const fact = FACTS[entry.id];
    return {
      entry,
      fact,
      kind: kindOf(fact),
      state: stateOf(entry, fact, entry.decided ? phases[entry.id] : undefined),
      reviewDays: reviewDaysOf(fact),
      day: entry.decided ? "today" : fact.day,
      time: entry.decided ? DEMO_NOW : fact.time,
    };
  });

export const byNewest = (a: Change, b: Change) =>
  `${DAY_DATE[b.day]} ${b.time ?? "00:00"}`.localeCompare(
    `${DAY_DATE[a.day]} ${a.time ?? "00:00"}`,
  );

// Undo applies where the ledger can restore a prior state; a fix that already reversed itself has none.
export const canUndo = (change: Change) =>
  !!change.entry.decided ||
  (change.entry.status === "auto_applied" && change.state !== "didntHelp");

export const recurringBug = (actionClass: string) =>
  AUTONOMY.find((a) => a.actionClass === actionClass)?.recurringBug;

// A change worked when it is in place and nothing says otherwise; review and applying are not judged yet.
export const trustCounts = (changes: Change[]) => {
  const recent = changes.filter((c) => daysBefore(c.day) < TRUST_WINDOW_DAYS);
  const count = (states: ChangeState[]) => recent.filter((c) => states.includes(c.state)).length;
  return {
    made: recent.length,
    worked: count(["worked", "done"]),
    review: count(["review"]),
    applying: count(["applying"]),
    undone: count(["undone", "didntHelp"]),
  };
};
