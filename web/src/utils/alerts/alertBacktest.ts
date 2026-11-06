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

const HOUR_MS = 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;

export interface BacktestOptions {
  startMs: number;
  hours: number;
  /** Window length in minutes. */
  period: number;
  operator: string;
  threshold: number;
}

export interface BacktestResult {
  fired: number;
  total: number;
  /** One flag per hour, oldest first: some window in that hour would have fired. */
  hours: boolean[];
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

/** The builder's count-per-bucket SQL with buckets as long as the look-back, or null for any other query shape. */
export function windowedCountSql(query: string, period: number): string | null {
  const minutes = Math.floor(Number(period));
  if (!query || !(minutes > 0)) return null;
  const histogram = /histogram\(\s*([A-Za-z_][\w]*)\s*\)/;
  if (!histogram.test(query) || !/COUNT\(\*\)\s+as\s+zo_sql_val/i.test(query)) return null;
  return query.replace(histogram, `histogram($1, '${minutes} minute')`);
}

// A histogram key is either microseconds or an ISO time the server writes in UTC without a zone.
const keyToMs = (key: unknown): number | null => {
  if (typeof key === "number") return key > 1e14 ? key / 1000 : key;
  if (typeof key !== "string" || !key) return null;
  const parsed = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(key) ? key : `${key}Z`);
  return Number.isNaN(parsed) ? null : parsed;
};

/** How many look-back windows of the past day the limit would have fired in, and in which hours. */
export function backtestWindows(
  rows: Record<string, unknown>[],
  options: BacktestOptions,
): BacktestResult {
  const compare = COMPARE[options.operator] ?? COMPARE[">="];
  const total = Math.max(1, Math.round(MINUTES_PER_DAY / Math.max(options.period, 1)));
  const hours = Array.from({ length: options.hours }, () => false);
  let fired = 0;
  for (const row of rows) {
    if (!compare(Number(row.zo_sql_val ?? 0), options.threshold)) continue;
    fired += 1;
    const at = keyToMs(row.zo_sql_key);
    if (at === null) continue;
    const hour = Math.floor((at - options.startMs) / HOUR_MS);
    hours[Math.min(options.hours - 1, Math.max(0, hour))] = true;
  }
  // Windows with no events never come back as rows, yet a "fewer than" limit fires on them.
  const silent = Math.max(0, total - rows.length);
  if (silent > 0 && compare(0, options.threshold)) {
    fired += silent;
    hours.fill(true);
  }
  return { fired: Math.min(fired, total), total, hours };
}
