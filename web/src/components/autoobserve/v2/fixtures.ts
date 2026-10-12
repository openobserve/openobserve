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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import {
  AUTONOMY,
  DAY_DATE,
  DEMO_NOW,
  DESTINATIONS,
  EVENTS,
  LAST_CHECKED_MINUTES,
  NEW_SERVICES,
  FOUND_TODAY_CANT_SEE,
  PROBLEMS as FACTS,
  RETUNE,
  SCENARIOS,
  STALLED,
  EVENT_PROBLEM,
  eventScenarios,
  heldBeforeFriday,
  ledgerIn,
  problemsIn,
  scenarioFacts,
  serviceStats,
  type Autonomy,
  type DayKey,
  type FixKind,
  type HistoryKind,
  type Outcome,
  type ProblemFact,
  type RequestFact,
  type RequestKind,
  type Scenario,
  type Severity,
} from "../data/facts";
import type { LogEntry } from "./useDecisions";

export type { Autonomy, HistoryKind, Outcome, RequestKind, Scenario, Severity };
export type ProblemOutcome = Outcome | "fixing" | "contained";
export type HistoryTone = Outcome | "neutral" | "fix";
export type PriorityFilter = "all" | Severity;

// Problems whose state has changed on the page because the viewer approved a fix; answered holds ledger ids.
export interface FixOverrides {
  fixing: string[];
  fixed: string[];
  answered: string[];
}

const NO_OVERRIDES: FixOverrides = { fixing: [], fixed: [], answered: [] };

export interface Msg {
  key: I18nKey;
  params?: Record<string, unknown>;
  plural?: number;
}

export interface Problem {
  id: string;
  incidentId: string;
  service: string;
  day: I18nKey;
  time: string;
  absolute: string;
  severity: Severity;
  outcome: ProblemOutcome;
  resolvedIn?: number;
  title: I18nKey;
  summary: I18nKey;
}

export interface RecentData {
  problems: string[];
  quiet: Msg | null;
}

export interface Request {
  id: string;
  problem?: string;
  kind: RequestKind;
  doneSettled?: Msg;
  body: Msg;
  yes: I18nKey;
  no: I18nKey;
  doneYes: Msg;
  doneNo: Msg;
}

export interface HistoryEntry {
  id: string;
  tone: HistoryTone;
  day: I18nKey;
  time?: string;
  kind: HistoryKind;
  text: Msg;
  worked?: boolean;
  ledgerId?: string;
}

export interface ScenarioData {
  serviceCount: number;
  recent: RecentData;
  requests: Request[];
  allVisible: boolean;
}

export interface SettingsKind {
  id: FixKind;
  name: I18nKey;
  record: Msg;
  hasRecord: boolean;
  locked: boolean;
  mode: Autonomy;
}

export interface DestinationOption {
  id: string;
  label: Msg;
}

export const PRIORITY_FILTERS: PriorityFilter[] = ["all", "p1", "p2", "p3", "p4"];

// Highest priority first, then newest first; absolute is a sortable timestamp.
export const byPriority = (a: Problem, b: Problem) =>
  a.severity.localeCompare(b.severity) || b.absolute.localeCompare(a.absolute);

export const SCENARIO_LABEL: Record<Scenario, I18nKey> = {
  demo: "autoobserve2.scenarios.demo",
  allClear: "autoobserve2.scenarios.allClear",
  incident: "autoobserve2.scenarios.incident",
  cantSee: "autoobserve2.scenarios.cantSee",
  noBaseline: "autoobserve2.scenarios.noBaseline",
};

export const DAY_LABEL: Record<DayKey, I18nKey> = {
  today: "autoobserve2.days.today",
  monday: "autoobserve2.days.monday",
  tuesday: "autoobserve2.days.tuesday",
  wednesday: "autoobserve2.days.wednesday",
  thursday: "autoobserve2.days.thursday",
  friday: "autoobserve2.days.friday",
  sep12: "autoobserve2.days.sep12",
  sep23: "autoobserve2.days.sep23",
  sep24: "autoobserve2.days.sep24",
  sep30: "autoobserve2.days.sep30",
  oct1: "autoobserve2.days.oct1",
  oct2: "autoobserve2.days.oct2",
};

const k = (key: string) => key as I18nKey;

const msg = (key: string, params?: Record<string, unknown>, plural?: number): Msg => ({
  key: k(key),
  params,
  plural,
});

const toProblem = (fact: ProblemFact, overrides: FixOverrides): Problem => {
  const state = overrides.fixed.includes(fact.id)
    ? "fixed"
    : overrides.fixing.includes(fact.id)
      ? "fixing"
      : null;
  const base = `autoobserve2.problems.${fact.id}`;
  return {
    id: fact.id,
    incidentId: fact.incidentId,
    service: fact.service,
    day: DAY_LABEL[fact.day],
    time: fact.time,
    absolute: `${DAY_DATE[fact.day]} ${fact.time}:${fact.seconds}`,
    severity: fact.severity,
    outcome: state === "fixed" && fact.containOnly ? "contained" : (state ?? fact.outcome),
    resolvedIn: fact.resolvedIn,
    title: k(state === "fixed" ? `${base}.titleFixed` : `${base}.title`),
    summary: k(
      state === "fixed"
        ? `${base}.summaryFixed`
        : state === "fixing"
          ? `${base}.summaryFixing`
          : `${base}.summary`,
    ),
  };
};

export const problemsFor = (overrides: FixOverrides = NO_OVERRIDES): Record<string, Problem> =>
  Object.fromEntries(Object.values(FACTS).map((fact) => [fact.id, toProblem(fact, overrides)]));

export const problemLabel = (t: TranslateFn, problem: Problem): I18nText =>
  t("autoobserve2.entryLabel", {
    when: t("autoobserve2.when", { day: t(problem.day), time: raw(problem.time) }),
    service: raw(problem.service),
  });

const isMsg = (value: unknown): value is Msg =>
  typeof value === "object" && value !== null && "key" in value;

export const say = (t: TranslateFn, m: Msg): I18nText => {
  const params = Object.fromEntries(
    Object.entries(m.params ?? {}).map(([name, value]) => [
      name,
      isMsg(value) ? say(t, value) : value,
    ]),
  );
  return m.plural === undefined ? t(m.key, params) : t(m.key, params, m.plural);
};

// The facts week list is exactly the last 7 days before the demos now.
const recentFor = (scenario: Scenario): RecentData => {
  const problems = problemsIn(scenario, "week").map((p) => p.id);
  const total = serviceStats(scenario).total;
  return {
    problems,
    quiet: problems.length ? null : msg("autoobserve2.noProblems.week", { count: total }, total),
  };
};

const record = (kind: FixKind) => AUTONOMY.find((a) => a.kind === kind) ?? AUTONOMY[0];

// Fix-now copy is per problem, because each one asks for a different fix.
const copyId = (fact: RequestFact) =>
  fact.kind === "fixNow" ? `fixNow.${fact.problem}` : fact.kind;

const requestFor = (fact: RequestFact): Request => {
  const kind = fact.kind;
  const base = `autoobserve2.needs.${copyId(fact)}`;
  const parts = {
    id: fact.ledgerId,
    problem: fact.problem,
    kind,
    yes: k(`${base}.yes`),
    no: k(`${base}.no`),
  };
  if (kind === "retune") {
    return {
      ...parts,
      body: msg(`${base}.body`, RETUNE),
      doneYes: msg(`${base}.doneYes`, RETUNE),
      doneNo: msg(`${base}.doneNo`, RETUNE),
    };
  }
  if (kind === "fixNow") {
    return {
      ...parts,
      doneSettled: msg(`${base}.doneSettled`),
      body: msg(`${base}.body`),
      doneYes: msg(`${base}.doneYes`),
      doneNo: msg(`${base}.doneNo`),
    };
  }
  return {
    ...parts,
    body: msg(`${base}.body`, { done: record(fact.autonomyKind ?? "abortRollout").done }),
    doneYes: msg(`${base}.doneYes`),
    doneNo: msg(`${base}.doneNo`),
  };
};

export const overridesFor = (
  scenario: Scenario,
  decisions: Record<string, "yes" | "no">,
  phases: Record<string, "fixing" | "fixed">,
): FixOverrides => {
  const requests = scenarioFacts(scenario).requests;
  const fixesIn = (phase: "fixing" | "fixed") =>
    requests
      .filter((r) => r.problem && decisions[r.ledgerId] === "yes" && phases[r.ledgerId] === phase)
      .map((r) => r.problem as string);
  return {
    fixing: fixesIn("fixing"),
    fixed: fixesIn("fixed"),
    answered: requests.filter((r) => decisions[r.ledgerId]).map((r) => r.ledgerId),
  };
};

export const scenarioData = (scenario: Scenario): ScenarioData => {
  const facts = scenarioFacts(scenario);
  return {
    serviceCount: facts.services.length,
    recent: recentFor(scenario),
    requests: facts.requests.map(requestFor),
    allVisible: !facts.gaps.length,
  };
};

const HISTORY_PARAMS: Record<string, Record<string, unknown>> = {
  diskApproved: { to: RETUNE.to },
  euStopped: { cluster: STALLED.cluster },
  found18: { count: serviceStats("noBaseline").total },
  newWatch: { count: NEW_SERVICES.names.length },
  foundWatch: { count: FOUND_TODAY_CANT_SEE.length },
};

const LOG_KEY: Record<LogEntry["event"], (copy: string, entry: LogEntry) => string> = {
  yes: (copy) => `decision.${copy}.yes`,
  no: (copy) => `decision.${copy}.no`,
  fixed: () => "",
  undo: (copy, entry) => `decision.${copy}.${entry.undid === "no" ? "undoNo" : "undoYes"}`,
  cancel: (copy) => `decision.${copy}.cancel`,
};

// Every decision, completed fix and undo stays in History, newest first; undoing never erases earlier entries.
export const logEntries = (scenario: Scenario, log: LogEntry[]): HistoryEntry[] => {
  const requests = scenarioFacts(scenario).requests;
  const inLedger = new Set(ledgerIn(scenario).map((e) => e.id));
  return [...log].reverse().flatMap((entry) => {
    const fact = requests.find((r) => r.ledgerId === entry.ledgerId);
    if (!fact) return [];
    const fixed = entry.event === "fixed";
    return [
      {
        id: `log-${entry.seq}`,
        tone: (fixed ? "fix" : "neutral") as HistoryTone,
        day: DAY_LABEL.today,
        time: fixed ? undefined : DEMO_NOW,
        kind: (fixed ? "fixes" : "decisions") as HistoryKind,
        text: msg(
          `autoobserve2.historyDrawer.entries.${
            fixed ? `fixedNow.${fact.problem}` : LOG_KEY[entry.event](copyId(fact), entry)
          }`,
        ),
        worked: fixed || undefined,
        ledgerId: inLedger.has(entry.ledgerId) ? entry.ledgerId : undefined,
      },
    ];
  });
};

export const historyFor = (scenario: Scenario): HistoryEntry[] => {
  const fromLedger = ledgerIn(scenario).flatMap((entry) =>
    entry.history.map((h) => ({
      id: `${entry.id}-${h.key}`,
      dayKey: entry.day,
      time: entry.time,
      kind: h.kind,
      tone: (h.kind === "fixes" ? "fix" : "neutral") as HistoryTone,
      text: msg(`autoobserve2.historyDrawer.entries.${h.key}`, HISTORY_PARAMS[h.key]),
      worked: h.worked,
      ledgerId: entry.id,
    })),
  );
  const fromEvents = EVENTS.filter((e) => eventScenarios(e).includes(scenario)).map((e) => {
    const count = e.id === "fridaySummary" ? heldBeforeFriday(scenario) : undefined;
    const problem = EVENT_PROBLEM[e.id];
    return {
      id: e.id,
      tone: (problem ? FACTS[problem].outcome : "neutral") as HistoryTone,
      dayKey: e.day,
      time: e.time,
      kind: e.kind,
      text: msg(
        `autoobserve2.historyDrawer.entries.${e.key}`,
        { ...HISTORY_PARAMS[e.key], count },
        count,
      ),
      worked: undefined,
    };
  });
  return [...fromLedger, ...fromEvents]
    .sort((a, b) =>
      `${DAY_DATE[b.dayKey]} ${b.time ?? "00:00"}`.localeCompare(
        `${DAY_DATE[a.dayKey]} ${a.time ?? "00:00"}`,
      ),
    )
    .map(({ dayKey, ...rest }) => ({ ...rest, day: DAY_LABEL[dayKey] }));
};

// extra counts fixes completed on the page, so a track record grows as the viewer approves them.
export const recordFor = (a: (typeof AUTONOMY)[number], extra = 0): Msg => {
  if (a.recurringBug) {
    return msg("autoobserve2.settingsDrawer.kinds.recurringRecord", {
      done: a.done,
      bug: a.recurringBug,
    });
  }
  if (!a.done && !extra) return msg("autoobserve2.settingsDrawer.kinds.noRecord");
  return msg(`autoobserve2.settingsDrawer.kinds.${a.kind === "retune" ? "keptRecord" : "record"}`, {
    done: a.done + extra,
    worked: a.worked + extra,
  });
};

// A fix that keeps being needed for one open bug never runs on its own; it waits for the bug to be fixed.
export const settingsKinds = (extra: Partial<Record<FixKind, number>> = {}): SettingsKind[] =>
  AUTONOMY.map((a) => ({
    id: a.kind,
    name: k(`autoobserve2.settingsDrawer.kinds.${a.kind}`),
    record: recordFor(a, extra[a.kind]),
    hasRecord: a.done + (extra[a.kind] ?? 0) > 0,
    locked: !!a.recurringBug,
    mode: a.mode,
  }));

export const DESTINATION_OPTIONS: DestinationOption[] = DESTINATIONS.map((d) => ({
  id: d.id,
  label:
    d.kind === "slack"
      ? msg("autoobserve2.settingsDrawer.destSlack", { channel: d.name })
      : msg("autoobserve2.settingsDrawer.destEmail", { address: d.name }),
}));

export const LAST_CHECKED = LAST_CHECKED_MINUTES;

export const ALL_SERVICES = scenarioFacts("demo").services.map((s) => s.name);

export { SCENARIOS };

export const coverageSummary = (scenario: Scenario) => {
  const s = serviceStats(scenario);
  const watched = s.watching + s.learning;
  const allLearning = s.learning === s.total;
  const head = allLearning
    ? msg("autoobserve2.coverageDrawer.summaryAllLearning", { total: s.total })
    : watched === s.total
      ? msg("autoobserve2.coverageDrawer.summaryAll", { total: s.total })
      : msg("autoobserve2.coverageDrawer.summaryWatching", { watched, total: s.total });
  const clauses = [
    ...(s.learning && !allLearning
      ? [msg("autoobserve2.coverageDrawer.clauseLearning", { count: s.learning }, s.learning)]
      : []),
    ...(s.unseen
      ? [msg("autoobserve2.coverageDrawer.clauseUnseen", { count: s.unseen }, s.unseen)]
      : []),
  ];
  return {
    head,
    clauses,
    segments: { watching: s.watching, learning: s.learning, unseen: s.unseen },
    total: s.total,
  };
};
