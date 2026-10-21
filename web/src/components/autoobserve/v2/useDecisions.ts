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

import { computed, reactive, watch } from "vue";
import {
  AUTONOMY,
  SCENARIOS,
  scenarioFacts,
  type Autonomy,
  type FixKind,
  type RequestFact,
} from "../data/facts";

export type Decision = "yes" | "no";
export type FixPhase = "fixing" | "fixed";
export type LogEvent = Decision | "fixed" | "undo" | "cancel";

export interface LogEntry {
  seq: number;
  ledgerId: string;
  event: LogEvent;
  undid?: Decision;
}

const FIX_SETTLE_MS = 3000;

const AUTONOMY_DEFAULTS = Object.fromEntries(AUTONOMY.map((a) => [a.kind, a.mode])) as Record<
  FixKind,
  Autonomy
>;

// One entry per ledger id, though the same request can appear in several scenarios.
const REQUESTS: RequestFact[] = [
  ...new Map(
    SCENARIOS.flatMap((s) => scenarioFacts(s).requests).map((r) => [r.ledgerId, r]),
  ).values(),
];
// A yes on a request tied to a problem starts a fix that settles a few seconds later.
const FIX_REQUESTS = new Set(REQUESTS.filter((r) => r.problem).map((r) => r.ledgerId));
const STANDING = REQUESTS.filter((r) => r.autonomyKind);

// Module-level so both views and every remount share one record of what the viewer decided.
const decisions = reactive<Record<string, Decision>>({});
const phases = reactive<Record<string, FixPhase>>({});
const log = reactive<LogEntry[]>([]);
const autonomy = reactive<Record<FixKind, Autonomy>>({ ...AUTONOMY_DEFAULTS });
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

const record = (ledgerId: string, event: LogEvent, undid?: Decision) => {
  seq += 1;
  log.push({ seq, ledgerId, event, undid });
};

const decide = (ledgerId: string, decision: Decision) => {
  if (decisions[ledgerId]) return;
  decisions[ledgerId] = decision;
  record(ledgerId, decision);
  if (decision !== "yes" || !FIX_REQUESTS.has(ledgerId)) return;
  phases[ledgerId] = "fixing";
  timers.set(
    ledgerId,
    setTimeout(() => {
      timers.delete(ledgerId);
      if (decisions[ledgerId] !== "yes") return;
      phases[ledgerId] = "fixed";
      record(ledgerId, "fixed");
    }, FIX_SETTLE_MS),
  );
};

const undo = (ledgerId: string) => {
  const previous = decisions[ledgerId];
  if (!previous) return;
  clearTimeout(timers.get(ledgerId));
  timers.delete(ledgerId);
  const cancelled = phases[ledgerId] === "fixing";
  delete phases[ledgerId];
  delete decisions[ledgerId];
  record(ledgerId, cancelled ? "cancel" : "undo", previous);
};

// A standing-permission request and its row in Settings are one setting.
STANDING.forEach((req) => {
  const kind = req.autonomyKind as FixKind;
  watch(
    () => decisions[req.ledgerId],
    (decision) => {
      const mode = decision === "yes" ? "fix" : AUTONOMY_DEFAULTS[kind];
      if (decision !== "no" && autonomy[kind] !== mode) autonomy[kind] = mode;
    },
  );
  watch(
    () => autonomy[kind],
    (mode) => {
      if (mode === "fix" && decisions[req.ledgerId] !== "yes") {
        if (decisions[req.ledgerId]) undo(req.ledgerId);
        decide(req.ledgerId, "yes");
      }
      if (mode !== "fix" && decisions[req.ledgerId] === "yes") undo(req.ledgerId);
    },
  );
});

// Fixes completed on the page add to their kind's track record; undoing one takes it back off.
const completedFixes = computed(() => {
  const counts: Partial<Record<FixKind, number>> = {};
  REQUESTS.forEach((req) => {
    if (!req.fixKind || phases[req.ledgerId] !== "fixed") return;
    counts[req.fixKind] = (counts[req.fixKind] ?? 0) + 1;
  });
  return counts;
});

export const useDecisions = () => ({ decisions, phases, log, decide, undo });

export const useCompletedFixes = () => completedFixes;

export const useAutonomy = () => autonomy;

export const resetDecisions = () => {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  Object.keys(decisions).forEach((id) => delete decisions[id]);
  Object.keys(phases).forEach((id) => delete phases[id]);
  log.splice(0);
  Object.assign(autonomy, AUTONOMY_DEFAULTS);
};

interface DecisionSnapshot {
  decisions: Record<string, Decision>;
  phases: Record<string, FixPhase>;
  log: LogEntry[];
  autonomy: Record<FixKind, Autonomy>;
}

// Session-only, never persisted: each user-and-org pair keeps its own sample decisions.
const stashedOrgs = new Map<string, DecisionSnapshot>();
let decisionsOrg: string | null = null;

/** Keeps the current org's decisions aside and restores the next org's, so another org starts with none. */
export const switchDecisionsOrg = (key: string) => {
  if (key === decisionsOrg) return;
  // A sample fix that was settling finishes before its org is put aside.
  Object.keys(phases).forEach((id) => {
    if (phases[id] !== "fixing") return;
    phases[id] = "fixed";
    record(id, "fixed");
  });
  if (decisionsOrg !== null)
    stashedOrgs.set(decisionsOrg, {
      decisions: { ...decisions },
      phases: { ...phases },
      log: [...log],
      autonomy: { ...autonomy },
    });
  resetDecisions();
  decisionsOrg = key;
  const saved = stashedOrgs.get(key);
  if (!saved) return;
  Object.assign(decisions, saved.decisions);
  Object.assign(phases, saved.phases);
  log.push(...saved.log);
  Object.assign(autonomy, saved.autonomy);
};
