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

import CronExpressionParser from "cron-parser";
import type { I18nKey } from "@/types/i18n";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60_000;
// A sub-minute cron would replay tens of thousands of checks; the check declines it.
const MAX_CHECKS = 24 * 60;
/** Alerting on more than this share of a day's checks reads as noise. */
const NOISY_SHARE = 0.25;

// Which way the threshold should move depends on the comparison; exactly / not exactly have no direction.
const HINT_KEYS: Record<"up" | "down" | "none", { never: I18nKey; noisy: I18nKey }> = {
  up: { never: "alerts.sections.backtest.never", noisy: "alerts.sections.backtest.noisy" },
  down: {
    never: "alerts.sections.backtest.neverRaise",
    noisy: "alerts.sections.backtest.noisyLower",
  },
  none: {
    never: "alerts.sections.backtest.neverCheck",
    noisy: "alerts.sections.backtest.noisyCheck",
  },
};

export interface BacktestOptions {
  startMs: number;
  hours: number;
  /** Window length in minutes. */
  period: number;
  /** Minutes between checks; ignored when `checkTimesMs` is given. */
  frequency: number;
  /** Minutes after a notification in which further fires stay quiet. */
  silence: number;
  /** Cron check times, oldest first. */
  checkTimesMs?: number[];
  operator: string;
  threshold: number;
}

export interface BacktestResult {
  fired: number;
  total: number;
  /** One flag per hour, oldest first: some check in that hour would have fired. */
  hours: boolean[];
}

export interface BacktestReplay extends BacktestResult {
  alerts: number;
  singleCheckSpikes: number;
  refires: number;
}

const COMPARE: Record<string, (value: number, limit: number) => boolean> = {
  ">=": (value, limit) => value >= limit,
  ">": (value, limit) => value > limit,
  "<=": (value, limit) => value <= limit,
  "<": (value, limit) => value < limit,
  "=": (value, limit) => value === limit,
  "==": (value, limit) => value === limit,
  "!=": (value, limit) => value !== limit,
};

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const wholeMinutes = (value: number) => Math.max(1, Math.floor(Number(value)) || 1);

/** The largest bucket that every check window starts and ends on; cron times only line up per minute. */
export function backtestBucketMinutes(
  options: Pick<BacktestOptions, "period" | "frequency" | "checkTimesMs">,
): number {
  if (options.checkTimesMs) return 1;
  return gcd(wholeMinutes(options.period), wholeMinutes(options.frequency));
}

/** The builder's count-per-bucket SQL re-bucketed to `bucketMinutes`, or null for any other query shape. */
export function windowedCountSql(query: string, bucketMinutes: number): string | null {
  const minutes = Math.floor(Number(bucketMinutes));
  if (!query || !(minutes > 0)) return null;
  const histogram = /histogram\(\s*([A-Za-z_][\w]*)\s*\)/;
  if (!histogram.test(query) || !/COUNT\(\*\)\s+as\s+zo_sql_val/i.test(query)) return null;
  return query.replace(histogram, `histogram($1, '${minutes} minute')`);
}

/** When a cron schedule would have run between the two times in its timezone, or null if it cannot be replayed. */
export function cronCheckTimes(
  cron: string,
  timezone: string | undefined,
  startMs: number,
  endMs: number,
): number[] | null {
  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: new Date(startMs),
      endDate: new Date(endMs),
      tz: timezone || "UTC",
    });
    const times: number[] = [];
    while (interval.hasNext()) {
      times.push(interval.next().getTime());
      if (times.length > MAX_CHECKS) return null;
    }
    return times;
  } catch {
    return null;
  }
}

// A histogram key is either microseconds or an ISO time the server writes in UTC without a zone.
export const keyToMs = (key: unknown): number | null => {
  if (typeof key === "number") return key > 1e14 ? key / 1000 : key;
  if (typeof key !== "string" || !key) return null;
  const parsed = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(key) ? key : `${key}Z`);
  return Number.isNaN(parsed) ? null : parsed;
};

// Checks sit on multiples of the frequency, as an aligned schedule would run them.
const frequencyCheckTimes = (startMs: number, endMs: number, frequency: number) => {
  const stepMs = wholeMinutes(frequency) * MINUTE_MS;
  const times: number[] = [];
  for (let at = Math.floor(endMs / stepMs) * stepMs; at > startMs; at -= stepMs) times.push(at);
  return times.reverse();
};

/** Replays each check of the past day over its own look-back window, with silence after each alert. */
export function backtestWindows(
  rows: Record<string, unknown>[],
  options: BacktestOptions,
): BacktestReplay {
  const compare = COMPARE[options.operator] ?? COMPARE[">="];
  const endMs = options.startMs + options.hours * HOUR_MS;
  const checks =
    options.checkTimesMs ?? frequencyCheckTimes(options.startMs, endMs, options.frequency);
  const bucketMs = backtestBucketMinutes(options) * MINUTE_MS;
  const counts = new Map<number, number>();
  for (const row of rows) {
    const at = keyToMs(row.zo_sql_key);
    if (at === null) continue;
    const bucket = Math.floor(at / bucketMs);
    counts.set(bucket, (counts.get(bucket) ?? 0) + Number(row.zo_sql_val ?? 0));
  }
  const periodBuckets = Math.round((wholeMinutes(options.period) * MINUTE_MS) / bucketMs);
  // Windows with no events never come back as rows, yet a "fewer than" limit fires on them.
  const firing = checks.map((at) => {
    const last = Math.floor(at / bucketMs) - 1;
    let sum = 0;
    for (let b = last - periodBuckets + 1; b <= last; b++) sum += counts.get(b) ?? 0;
    return compare(sum, options.threshold);
  });
  return replayChecks(checks, firing, options);
}

function replayChecks(
  checks: number[],
  firing: boolean[],
  options: BacktestOptions,
): BacktestReplay {
  const hours = Array.from({ length: options.hours }, () => false);
  const hourOf = (ms: number) =>
    Math.min(options.hours - 1, Math.max(0, Math.floor((ms - options.startMs) / HOUR_MS)));
  const silenceMs = Math.max(0, Number(options.silence) || 0) * MINUTE_MS;
  let lastAlertMs: number | null = null;
  let fired = 0;
  let alerts = 0;
  let singleCheckSpikes = 0;
  let refires = 0;
  firing.forEach((fires, i) => {
    if (!fires) return;
    fired += 1;
    hours[hourOf(checks[i])] = true;
    if (i + 2 < firing.length && !firing[i + 1] && firing[i + 2]) refires += 1;
    if (lastAlertMs !== null && checks[i] - lastAlertMs < silenceMs) return;
    alerts += 1;
    lastAlertMs = checks[i];
    if (!firing[i - 1] && i + 1 < firing.length && !firing[i + 1]) singleCheckSpikes += 1;
  });
  return { fired, total: checks.length, hours, alerts, singleCheckSpikes, refires };
}

/** The advice under a day's replay: never alerted, or alerted often enough to be ignored. */
export function backtestHintKey(alerts: number, total: number, operator: string): I18nKey | null {
  if (total === 0) return null;
  const direction = [">=", ">"].includes(operator)
    ? "up"
    : ["<=", "<"].includes(operator)
      ? "down"
      : "none";
  if (alerts === 0) return HINT_KEYS[direction].never;
  return alerts / total > NOISY_SHARE ? HINT_KEYS[direction].noisy : null;
}
