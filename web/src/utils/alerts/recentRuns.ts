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

export interface RecentRun {
  timestamp?: number;
  status?: string;
  error?: string | null;
  acked_by?: string | null;
  ack_action?: string | null;
}

/** What an empty "Recent checks" says: nothing scheduled to expect, a first check still to come, or a missed one. */
export type NoChecksNotice =
  { kind: "none" } | { kind: "firstDue"; byMs: number } | { kind: "missed"; savedMs?: number };

export const RECENT_RUNS_LIMIT = 5;

const DAY_MICROS = 24 * 60 * 60 * 1_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
// The scheduler picks a due alert up on its next sweep, so a check can land a little after its slot.
const FIRST_CHECK_GRACE_MS = 2 * 60 * 1000;

/** The last day of an alert's history; the header and the panel ask the same so they share one read. */
export const recentRunsParams = (
  alertId: string,
  endMicros: number,
  limit = RECENT_RUNS_LIMIT,
) => ({
  alert_id: alertId,
  start_time: endMicros - DAY_MICROS,
  end_time: endMicros,
  from: 0,
  size: limit,
});

// The endpoint pages but promises no order.
export const newestRuns = (data: unknown, limit = RECENT_RUNS_LIMIT): RecentRun[] =>
  [...((data as { hits?: RecentRun[] } | undefined)?.hits ?? [])]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, limit);

const KSUID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KSUID_EPOCH_SECONDS = 1_400_000_000;

/** When a KSUID was minted, in seconds; a new alert has no `updated_at`, but its id carries this. */
export function ksuidSeconds(id: string): number | undefined {
  if (!/^[0-9A-Za-z]{27}$/.test(id)) return undefined;
  let value = 0n;
  for (const ch of id) value = value * 62n + BigInt(KSUID_ALPHABET.indexOf(ch));
  return Number(value >> 128n) + KSUID_EPOCH_SECONDS;
}

/** An alert saved less than one interval ago has not missed anything yet; `savedAtSec` is the alert's `updated_at`. */
export function noChecksNotice(input: {
  everyMinutes?: number;
  savedAtSec?: number;
  nowMs: number;
}): NoChecksNotice {
  if (!input.everyMinutes) return { kind: "none" };
  if (!input.savedAtSec) return { kind: "missed" };
  const savedMs = input.savedAtSec * 1000;
  const byMs = savedMs + input.everyMinutes * 60 * 1000 + FIRST_CHECK_GRACE_MS;
  if (input.nowMs < byMs) return { kind: "firstDue", byMs };
  return savedMs > input.nowMs - DAY_MS ? { kind: "missed", savedMs } : { kind: "missed" };
}
