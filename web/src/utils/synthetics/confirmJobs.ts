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
 * A confirm job re-tests a failure from a second location of the same run, or
 * from the same location when the check has one. Its result row carries no
 * marker, but a run tests each (location, browser, device, environment) slot
 * once, so a second execution in a slot is a confirm job. Each one pairs with a
 * failed execution of the run, on the same device when there is one.
 */
export function splitConfirms<T extends ExecutionSlot>(
  executions: readonly T[],
): { primary: T[]; confirms: ConfirmPair<T>[] } {
  const ordered = [...executions].sort((a, b) => a.timestamp - b.timestamp);
  const seen = new Set<string>();
  const primary: T[] = [];
  const extra: T[] = [];
  for (const e of ordered) {
    const slot = `${e.location}|${e.browser}|${e.device}|${e.environment}`;
    if (seen.has(slot)) extra.push(e);
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
  // A browser confirm job re-tests every device: pair same-device failures first, then the rest.
  const confirms: ConfirmPair<T>[] = extra.map((confirm) => ({
    of: take(
      (f) =>
        f.browser === confirm.browser &&
        f.device === confirm.device &&
        f.environment === confirm.environment,
    ),
    confirm,
  }));
  for (const pair of confirms) {
    if (!pair.of) pair.of = take((f) => f.environment === pair.confirm.environment);
  }
  return { primary, confirms };
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
