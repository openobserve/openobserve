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

import { METERS, unitRate, type MeterKey, type MeteringDetails } from "./meteringModel";

const MICROS_PER_SECOND = 1_000_000;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;

/** Days of run rate the forecast averages, so one spike does not swing the projection. */
const TRAILING_DAYS = 7;

/** Price of one unit of `size` for each `usage` event, inside one billing cycle. */
export interface CyclePrice {
  /** Unix seconds. */
  start: number;
  end: number;
  rates: Record<string, number>;
}

/** One row of the chart's own query: already priced by cycle in SQL. */
export interface CostRow {
  /** Unix seconds of the bucket start. */
  ts: number;
  event: string;
  cost: number;
}

export interface MeterTotal {
  key: MeterKey;
  cost: number;
}

export interface TrendSummary {
  total: number;
  /** Cost per day bucket, oldest first. */
  days: { ts: number; cost: number }[];
  /** Every meter with a `usage` event, highest cost first. */
  meters: MeterTotal[];
}

export interface Forecast {
  /** Average daily cost across the trailing window. */
  pace: number;
  /** Days that window actually covered. */
  paceDays: number;
  projected: number;
  low: number;
  high: number;
}

/** Every event a meter bills, so a query and its pricing name the same set. */
export const PRICED_EVENTS = METERS.flatMap((def) => def.events);

/** The backend sends seconds for a cycle but microseconds for `oldest_ts` when past invoices exist. */
export function toEpochSeconds(value: number | null | undefined): number {
  const n = Number(value) || 0;
  if (n > 1e14) return Math.floor(n / MICROS_PER_SECOND);
  if (n > 1e11) return Math.floor(n / 1000);
  return n;
}

/** Priced from `base_cost`, not the money fields: Stripe rounds each meter up to a whole unit. */
/** `gross` prices each cycle at list rate, before its discount. */
export function cyclePrices(cycles: MeteringDetails[], gross = false): CyclePrice[] {
  return [...cycles]
    .sort((a, b) => a.cycle_start - b.cycle_start)
    .map((cycle) => {
      const rates: Record<string, number> = {};
      for (const def of METERS) {
        const meter = cycle[def.key];
        const discount = gross
          ? 0
          : Math.min(Math.max(Number(meter?.percent_discount) || 0, 0), 100);
        const rate = unitRate(meter) * (1 - discount / 100);
        for (const event of def.events) rates[event] = rate;
      }
      return { start: cycle.cycle_start, end: cycle.cycle_end, rates };
    });
}

/** A moment takes the price of the latest cycle that started before it; a gap keeps the earlier price. */
export function priceAt(prices: CyclePrice[], event: string, tsSeconds: number): number {
  if (!prices.length) return 0;
  let chosen = prices[0];
  for (const price of prices) {
    if (price.start <= tsSeconds) chosen = price;
  }
  return chosen.rates[event] ?? 0;
}

/** The same rule as `priceAt`, written as SQL so the chart query prices each row by its own cycle. */
export function priceCaseSql(prices: CyclePrice[], events: string[] = PRICED_EVENTS): string {
  if (!prices.length) return "0";
  const branches = events.flatMap((event) =>
    prices.map((price, index) => {
      const next = prices[index + 1];
      const rate = price.rates[event] ?? 0;
      const literal = event.replace(/'/g, "''");
      return next
        ? `when event = '${literal}' and _timestamp < ${next.start * MICROS_PER_SECOND} then ${rate}`
        : `when event = '${literal}' then ${rate}`;
    }),
  );
  return `case ${branches.join(" ")} else 0 end`;
}

/** A bucket the window can show more than a handful of, so a short range is not one bar. */
export function trendBucket(startSeconds: number, endSeconds: number): string {
  const hours = (endSeconds - startSeconds) / SECONDS_PER_HOUR;
  if (hours <= 2) return "1 minute";
  if (hours <= 48) return "1 hour";
  return "1 day";
}

/** Search returns a bucket as a UTC timestamp without a zone, or as microseconds. */
export function bucketSeconds(value: unknown): number {
  if (typeof value === "number") return toEpochSeconds(value);
  const text = String(value ?? "");
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** Totals the chart query's rows by day and by meter; the days narrow to an isolated meter. */
export function summarizeTrend(rows: CostRow[], only: MeterKey | null = null): TrendSummary {
  const eventMeter = new Map<string, MeterKey>();
  for (const def of METERS) for (const event of def.events) eventMeter.set(event, def.key);

  const byDay = new Map<number, number>();
  const byMeter = new Map<MeterKey, MeterTotal>();
  for (const def of METERS) {
    if (def.events.length) byMeter.set(def.key, { key: def.key, cost: 0 });
  }

  for (const row of rows) {
    const key = eventMeter.get(row.event);
    if (!key) continue;
    byMeter.get(key)!.cost += row.cost;
    if (only && key !== only) continue;
    byDay.set(row.ts, (byDay.get(row.ts) ?? 0) + row.cost);
  }

  const days = [...byDay.entries()].map(([ts, cost]) => ({ ts, cost })).sort((a, b) => a.ts - b.ts);
  const meters = [...byMeter.values()].sort((a, b) => b.cost - a.cost);
  const total = only
    ? (byMeter.get(only)?.cost ?? 0)
    : meters.reduce((sum, meter) => sum + meter.cost, 0);
  return { total, days, meters };
}

/** Trailing-week run rate; a day with no usage has no row, so the window is zero-filled first. */
export function forecastCycle(
  summary: TrendSummary,
  cycleStart: number,
  cycleEnd: number,
  now: number = Date.now() / 1000,
): Forecast | null {
  const daysLeft = Math.max((cycleEnd - now) / SECONDS_PER_DAY, 0);
  if (daysLeft <= 0 || now <= cycleStart) return null;
  const costOn = new Map(summary.days.map((day) => [day.ts, day.cost]));
  const window: number[] = [];
  const today = Math.floor(now / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  const first = Math.floor(cycleStart / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  for (let day = today; day >= first && window.length < TRAILING_DAYS; day -= SECONDS_PER_DAY) {
    window.push(costOn.get(day) ?? 0);
  }
  const pace = window.reduce((sum, cost) => sum + cost, 0) / window.length;
  return {
    pace,
    paceDays: window.length,
    projected: summary.total + pace * daysLeft,
    low: summary.total + Math.min(...window) * daysLeft,
    high: summary.total + Math.max(...window) * daysLeft,
  };
}
