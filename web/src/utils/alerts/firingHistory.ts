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

import { conditionSummary, outcomeBucket } from "./runOutcome";
import { isAckEventRow, type AckHistoryFields } from "./ackState";

export interface AlertRun extends AckHistoryFields {
  timestamp: number;
  status: string;
  actual_value?: number | null;
  threshold_value?: number | null;
  threshold_operator?: string | null;
  rule_value?: string;
  value_is_lower_bound?: boolean | null;
  success_response?: string | null;
  error?: string | null;
}

type RunState = "firing" | "ok";

export type BarState = RunState | "unknown";

export interface BarSegment {
  state: BarState;
  startUs: number;
  endUs: number;
  pct: number;
}

export interface StatusBar {
  segments: BarSegment[];
  firingMs: number;
  okMs: number;
  unknownMs: number;
}

export type HistoryEventKind = "started" | "recovered" | "notified" | "failed" | "ack";

export interface HistoryEvent {
  kind: HistoryEventKind;
  at: number;
  key: string;
  run?: AlertRun;
  condition?: string;
  names?: string[];
  durationMs?: number;
  /** A state still in force, so its duration runs up to now. */
  open?: boolean;
}

interface Change {
  state: RunState;
  at: number;
  run: AlertRun;
}

// Well over the default 90 s run lease (ZO_ALERT_SCHEDULE_TIMEOUT), the widest gap between a run's row and the firing's start.
export const OPENING_RUN_MARGIN_US = 5 * 60_000_000;

const FAILED_DESTINATION = /destination (.+?) err: /g;
const NO_CONDITION = "—";
const EVENTS_SHOWN = 5;

const byTime = (a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp;
const ascending = (hits: AlertRun[]) => [...hits].sort(byTime);
const descending = (hits: AlertRun[]) => ascending(hits).reverse();

// Suppressed, skipped and errored runs observed no new state, so the last one stands.
const stateOf = (run: AlertRun): RunState | null => {
  if (isAckEventRow(run)) return null;
  const bucket = outcomeBucket(run.status);
  return bucket === "firing" || bucket === "ok" ? bucket : null;
};

const changesOf = (hits: AlertRun[]): Change[] => {
  const changes: Change[] = [];
  for (const run of ascending(hits)) {
    const state = stateOf(run);
    if (state && state !== changes.at(-1)?.state) {
      changes.push({ state, at: run.timestamp, run });
    }
  }
  return changes;
};

/** State changes since `sinceUs`; the first row only sets the baseline. */
export const flapCount = (hits: AlertRun[], sinceUs: number): number =>
  changesOf(hits)
    .slice(1)
    .filter((change) => change.at >= sinceUs).length;

/** Rows carry no value, so Now is the newest run that recorded one. */
export const latestReading = (
  hits: AlertRun[],
): { value: string; threshold: string | null } | null => {
  const measured = descending(hits).filter(
    (run) => !isAckEventRow(run) && (run.actual_value != null || run.rule_value != null),
  );
  const [latest] = measured;
  if (!latest) return null;
  const threshold = measured.find((run) => run.threshold_value != null)?.threshold_value;
  return {
    value: conditionSummary({
      actual_value: latest.actual_value,
      rule_value: latest.rule_value,
      value_is_lower_bound: latest.value_is_lower_bound,
    }),
    threshold: threshold == null ? null : String(threshold),
  };
};

/** The newest outcome, for an alert the open chip does not list. */
export const latestState = (hits: AlertRun[]): string | undefined =>
  descending(hits).find((run) => stateOf(run) !== null)?.status;

export const failedNames = (run: AlertRun): string[] =>
  [...(run.error ?? "").matchAll(FAILED_DESTINATION)].map((match) => match[1]);

const sentNames = (run: AlertRun, destinations: string[]): string[] =>
  destinations.filter((name) => (run.success_response ?? "").includes(`destination ${name} `));

const closesFiring = (run: AlertRun) =>
  stateOf(run) !== null || outcomeBucket(run.status) === "pending";

// A run's row is stamped before its send and the firing's start after it, so the opening run sits just behind the start.
const runsOfFiring = (hits: AlertRun[], sinceUs: number): AlertRun[] => {
  const runs = descending(hits);
  const behind = runs.find((run) => run.timestamp < sinceUs && closesFiring(run));
  const adjacent = behind && sinceUs - behind.timestamp <= OPENING_RUN_MARGIN_US;
  const opening = adjacent && stateOf(behind) === "firing" ? behind : undefined;
  return runs.filter((run) => run.timestamp >= sinceUs || run === opening);
};

/** Destinations whose newest delivery in the firing that began at `sinceUs` is a recorded success. */
export const deliveredNames = (hits: AlertRun[], destinations: string[], sinceUs = 0): string[] => {
  const newest = new Map<string, boolean>();
  for (const run of runsOfFiring(hits, sinceUs)) {
    for (const name of failedNames(run)) if (!newest.has(name)) newest.set(name, false);
    for (const name of sentNames(run, destinations)) if (!newest.has(name)) newest.set(name, true);
  }
  return destinations.filter((name) => newest.get(name));
};

/** Who the newest failed run could not reach; `names` is empty when it failed before naming one. */
export const failedDelivery = (hits: AlertRun[]): { names: string[]; error: string } | null => {
  const run = descending(hits).find((row) => row.status === "notify_failed");
  return run ? { names: failedNames(run), error: run.error ?? "" } : null;
};

/** The window as firing and ok spans; an open firing is red from its start whatever its runs say, and a `partial` read leaves the time before its runs unknown. */
export const statusBar = (
  hits: AlertRun[],
  window: { startUs: number; nowUs: number; firingStartedAt?: number; partial?: boolean },
): StatusBar => {
  const { startUs, nowUs, firingStartedAt, partial } = window;
  const points: { state: BarState; at: number }[] = [
    { state: partial ? "unknown" : "ok", at: startUs },
    ...changesOf(hits).filter(
      (change) => firingStartedAt === undefined || change.at < firingStartedAt,
    ),
  ];
  if (firingStartedAt !== undefined) points.push({ state: "firing", at: firingStartedAt });

  const segments: BarSegment[] = [];
  const total = nowUs - startUs;
  points.forEach((point, index) => {
    const begin = Math.max(point.at, startUs);
    const end = Math.min(points[index + 1]?.at ?? nowUs, nowUs);
    if (end <= begin) return;
    const last = segments.at(-1);
    if (last?.state === point.state) {
      last.endUs = end;
      last.pct = ((end - last.startUs) / total) * 100;
    } else {
      segments.push({
        state: point.state,
        startUs: begin,
        endUs: end,
        pct: ((end - begin) / total) * 100,
      });
    }
  });
  const spent = (state: BarState) =>
    segments
      .filter((segment) => segment.state === state)
      .reduce((sum, segment) => sum + (segment.endUs - segment.startUs) / 1000, 0);
  return {
    segments,
    firingMs: spent("firing"),
    okMs: spent("ok"),
    unknownMs: spent("unknown"),
  };
};

const conditionOf = (run: AlertRun): string | undefined => {
  const text = conditionSummary(run);
  return text === NO_CONDITION ? undefined : text;
};

const stateEvent = (change: Change): HistoryEvent => ({
  kind: change.state === "firing" ? "started" : "recovered",
  at: change.at,
  key: change.state,
  run: change.run,
  condition: conditionOf(change.run),
});

const runEvent = (run: AlertRun, destinations: string[]): HistoryEvent | null => {
  if (isAckEventRow(run)) {
    return {
      kind: "ack",
      at: run.timestamp,
      key: `ack:${run.ack_action}:${run.acked_by}:${run.taken_over_from}`,
      run,
    };
  }
  if (run.status === "notify_failed") {
    const names = failedNames(run);
    return { kind: "failed", at: run.timestamp, key: `failed:${names}`, run, names };
  }
  const body = run.success_response ?? "";
  if (!body.includes("destination ")) return null;
  const names = sentNames(run, destinations);
  return { kind: "notified", at: run.timestamp, key: `notified:${names}`, run, names };
};

// A firing the read does not reach starts at the row's own stamp, so it is never lost.
const anchorOpenFiring = (events: HistoryEvent[], firingStartedAt?: number) => {
  if (firingStartedAt === undefined) return;
  const states = events.filter((event) => event.kind === "started" || event.kind === "recovered");
  const last = states.at(-1);
  if (last?.kind === "started") last.at = firingStartedAt;
  else events.push({ kind: "started", at: firingStartedAt, key: "firing" });
};

const withoutRepeats = (events: HistoryEvent[]): HistoryEvent[] =>
  events.filter((event, index) => event.key !== events[index - 1]?.key);

const withDurations = (events: HistoryEvent[], nowUs: number) => {
  const states = events.filter((event) => event.kind === "started" || event.kind === "recovered");
  states.forEach((event, index) => {
    const next = states[index + 1];
    event.durationMs = ((next?.at ?? nowUs) - event.at) / 1000;
    event.open = !next;
  });
};

// The read reaches behind the bar, so a firing first seen inside the bar really started there.
const eventChanges = (hits: AlertRun[], windowStartUs?: number): Change[] => {
  const [first, ...rest] = changesOf(hits);
  const painted = first?.state === "firing" && windowStartUs !== undefined;
  return painted && first.at >= windowStartUs ? [first, ...rest] : rest;
};

/** The drawer's lines, newest first: state changes, sends and acks, with repeats dropped. */
export const historyEvents = (
  hits: AlertRun[],
  options: {
    destinations: string[];
    nowUs: number;
    firingStartedAt?: number;
    windowStartUs?: number;
  },
): HistoryEvent[] => {
  const { firingStartedAt } = options;
  // The open firing outranks its runs, as on the bar, so an ok run after its start ended nothing.
  const changes = eventChanges(hits, options.windowStartUs).filter(
    (change) => firingStartedAt === undefined || change.at <= firingStartedAt,
  );
  const events: HistoryEvent[] = [
    ...changes.map(stateEvent),
    ...ascending(hits).flatMap((run) => runEvent(run, options.destinations) ?? []),
  ];
  anchorOpenFiring(events, firingStartedAt);
  events.sort((a, b) => a.at - b.at);
  withDurations(events, options.nowUs);
  return withoutRepeats(events).slice(-EVENTS_SHOWN).reverse();
};
