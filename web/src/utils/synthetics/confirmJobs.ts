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

import type { ExecutionStatus } from "./rollUpStatus";

/** The fields of one execution that identify where and how it ran. */
export interface ExecutionSlot {
  location: string;
  browser: string;
  device: string;
  environment: string;
  /** The job's scheduled time. A confirm job is enqueued later than the run's own jobs. */
  scheduledTs: number;
  timestamp: number;
  status: ExecutionStatus;
}

export interface ConfirmPair<T> {
  /** The failed execution the confirm job re-tested; null when none is left to pair with. */
  of: T | null;
  confirm: T;
}

/**
 * Split a run's executions into the scheduled ones and its confirm jobs.
 *
 * A confirm job re-tests a failure from the location that failed (older runs
 * used a second location). Its result row carries no
 * marker, but the job API enqueues it with its own, later `scheduled_ts`, while
 * the run's own jobs share the run's. Rows without a scheduled time fall back to
 * the slot rule: a run tests each (location, browser, device, environment) slot
 * once, so a second execution in a slot is a confirm job. Each confirm job pairs
 * with a failed execution of the run: in its own location first, then on the
 * same device, then in the same environment.
 */
export function splitConfirms<T extends ExecutionSlot>(
  executions: readonly T[],
): { primary: T[]; confirms: ConfirmPair<T>[] } {
  const ordered = [...executions].sort(
    (a, b) => a.scheduledTs - b.scheduledTs || a.timestamp - b.timestamp,
  );
  const runTs = ordered[0]?.scheduledTs ?? 0;
  const seen = new Set<string>();
  const primary: T[] = [];
  const extra: T[] = [];
  for (const e of ordered) {
    const slot = `${e.location}|${e.browser}|${e.device}|${e.environment}`;
    if ((runTs > 0 && e.scheduledTs > runTs) || seen.has(slot)) extra.push(e);
    else {
      seen.add(slot);
      primary.push(e);
    }
  }
  const failed = primary.filter((e) => e.status === "fail");
  const take = (match: (f: T) => boolean): T | null => {
    const i = failed.findIndex(match);
    return i < 0 ? null : failed.splice(i, 1)[0];
  };
  const sameDevice = (f: T, c: T) =>
    f.browser === c.browser && f.device === c.device && f.environment === c.environment;
  // A browser confirm job re-tests every device: pair same-location, same-device failures first.
  const confirms: ConfirmPair<T>[] = extra.map((confirm) => ({
    of: take((f) => f.location === confirm.location && sameDevice(f, confirm)),
    confirm,
  }));
  for (const pair of confirms) {
    if (!pair.of) pair.of = take((f) => sameDevice(f, pair.confirm));
  }
  for (const pair of confirms) {
    if (!pair.of) pair.of = take((f) => f.environment === pair.confirm.environment);
  }
  return { primary, confirms };
}

/**
 * Each scheduled execution's status after its confirm job. A browser confirm job re-tests every
 * device of a location and the server votes per job, so one failed device in the confirm job
 * keeps the failure in that location, even when the failed device's own re-test passed.
 */
export function confirmedStatuses<T extends ExecutionSlot>(
  primary: readonly T[],
  confirms: readonly ConfirmPair<T>[],
): ExecutionStatus[] {
  const failedAt = new Set(
    confirms.filter((c) => c.confirm.status === "fail").map((c) => c.confirm.location),
  );
  const confirmOf = new Map(confirms.filter((c) => c.of).map((c) => [c.of!, c.confirm] as const));
  return primary.map((e) =>
    failedAt.has(e.location) ? e.status : confirmedStatus(e.status, confirmOf.get(e)?.status),
  );
}

/**
 * A failure counts only when its confirm job fails too. A passing confirm job
 * turns it into a warning (flaky); a confirm job that did not test the site
 * leaves the failure standing.
 */
export function confirmedStatus(
  status: ExecutionStatus,
  confirm?: ExecutionStatus,
): ExecutionStatus {
  if (status === "fail" && (confirm === "pass" || confirm === "warning")) return "warning";
  return status;
}
