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

import { formatInTimeZone } from "date-fns-tz";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { historyStatusOf } from "@/utils/alerts/ackState";

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
// A row and a history record of one check land within moments of each other.
const SAME_CHECK_US = 5_000_000;

/** The outcome to chip: the newest check's record, unless the row's outcome is from a later check. */
export function headerOutcome(
  row: { last_outcome?: string | null; last_outcome_at?: number | null } | null | undefined,
  newest: RecentRun | undefined,
): string {
  const check = newest ? String(historyStatusOf(newest) ?? "") : "";
  if (!row?.last_outcome) return check;
  if (!check || !newest?.timestamp || !row.last_outcome_at) return row.last_outcome;
  return row.last_outcome_at - newest.timestamp > SAME_CHECK_US ? row.last_outcome : check;
}

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

/** "HH:mm" today, "MMM d, HH:mm" on an earlier day, in the viewer's zone. */
export function runClock(ms: number, zone: string, nowMs: number): string {
  const day = (at: number) => formatInTimeZone(new Date(at), zone, "yyyyMMdd");
  return formatInTimeZone(new Date(ms), zone, day(ms) === day(nowMs) ? "HH:mm" : "MMM d, HH:mm");
}

/** A real-time alert records only the matches that fired it, never a quiet check, so it has no outcome to chip. */
export function realtimeRunChip(
  t: TranslateFn,
  firedUs: number | null | undefined,
  clock: (ms: number) => string,
): { label: I18nText; tooltip: I18nText } {
  if (!firedUs) {
    return { label: t("alerts.runState.noMatchYet"), tooltip: t("alerts.runState.noMatchTooltip") };
  }
  const time = raw(clock(firedUs / 1000));
  return {
    label: t("alerts.runState.fired", { time }),
    tooltip: t("alerts.runState.firedTooltip", { time }),
  };
}

const SENT_STATES = new Set(["firing", "completed"]);

/** A real-time row that notified is a sent message, not a failure; other outcomes (a failed send) keep their state chip. */
export function realtimeRowChip(t: TranslateFn, run: RecentRun): I18nText | null {
  const state = String(historyStatusOf(run) ?? "").toLowerCase();
  return SENT_STATES.has(state) ? t("alerts.runState.notified") : null;
}
