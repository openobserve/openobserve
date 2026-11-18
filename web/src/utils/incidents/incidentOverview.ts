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

import { getTimezoneOffset } from "date-fns-tz";
import { DateTime } from "luxon";
import type { TranslateFn } from "@/types/i18n";
import type { IncidentAlert, IncidentTopology } from "@/services/incidents";
import type { SparklinePoint } from "@/lib/data/Sparkline/OSparkline.types";
import { relativeTimeText } from "@/lib/core/Table/cells/relativeTime";
import { formatTimestampInTimezone } from "@/utils/date";
import { histogramBucketFor, incidentAge, incidentTime, isNamedService } from "./incidentUnfold";

const MINUTE_US = 60_000_000;
const DAY_US = 24 * 60 * MINUTE_US;
const LANE_BUCKETS = 24;
const AXIS_TICKS = 8;
const PEAK_WINDOW_US = 5 * MINUTE_US;

type Firing = Pick<IncidentAlert, "alert_id" | "alert_name" | "alert_fired_at"> &
  Partial<Pick<IncidentAlert, "alert_kind">>;

export interface OverviewLane {
  alertId: string;
  name: string;
  alertKind?: IncidentAlert["alert_kind"];
  /** Distinct firings: one evaluation can write several trigger rows. */
  count: number;
  last: number;
  counts: number[];
  points: SparklinePoint[];
}

export interface OverviewAxisTick {
  index: number;
  label: string;
  peak?: boolean;
  soFar?: boolean;
}

export interface OverviewLanes {
  /** Most firings first. */
  lanes: OverviewLane[];
  total: number;
  bucketUs: number;
  start: number;
  end: number;
  buckets: number;
  /** The bucket holding the Timeline's peak window; null when no window holds two firings. */
  peak: number | null;
  max: number;
  ticks: OverviewAxisTick[];
}

export interface AffectedService {
  key: string;
  display?: string;
}

export const incidentMoment = (t: TranslateFn, zone: string, us: number, nowUs: number) =>
  t("alerts.incidents.overview.moment", {
    time: incidentTime(zone, us),
    age: incidentAge(us, nowUs),
  });

/** A planned end such as a downtime's, which may lie ahead: "2026-11-17 18:00 · in 3 hours". */
export const incidentUntil = (t: TranslateFn, zone: string, us: number, nowUs: number) =>
  t("alerts.incidents.overview.moment", {
    time: incidentTime(zone, us),
    age: relativeTimeText(us / 1000, nowUs / 1000),
  });

const distinctFirings = (triggers: readonly Firing[]) => {
  const byAlert = new Map<string, { firing: Firing; times: Set<number> }>();
  for (const trigger of triggers) {
    const entry = byAlert.get(trigger.alert_id) ?? { firing: trigger, times: new Set<number>() };
    entry.times.add(trigger.alert_fired_at);
    byAlert.set(trigger.alert_id, entry);
  }
  return [...byAlert.values()];
};

// Buckets start on the bucket's boundary in the user's zone, so a 15-minute bar reads 06:15, not 06:11.
const alignedStart = (zone: string, first: number, size: number) => {
  const offset = getTimezoneOffset(zone, new Date(first / 1000)) * 1000;
  return Math.floor((first + offset) / size) * size - offset;
};

// Day buckets step by calendar days from local midnight, so a 23- or 25-hour DST day keeps its own firings.
const bucketStarts = (zone: string, first: number, end: number, size: number) => {
  if (size < DAY_US) {
    const start = alignedStart(zone, first, size);
    return Array.from({ length: Math.floor((end - start) / size) + 1 }, (_, i) => start + i * size);
  }
  const days = Math.round(size / DAY_US);
  const starts: number[] = [];
  let day = DateTime.fromMillis(first / 1000, { zone }).startOf("day");
  while (day.toMillis() * 1000 <= end) {
    starts.push(day.toMillis() * 1000);
    day = day.plus({ days });
  }
  return starts;
};

const bucketOf = (starts: readonly number[], at: number) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const tickFormat = (zone: string, start: number, end: number, size: number) => {
  if (size >= DAY_US) return "MMM D";
  const sameDay =
    formatTimestampInTimezone(start, "YYYY-MM-DD", zone) ===
    formatTimestampInTimezone(end, "YYYY-MM-DD", zone);
  return sameDay ? "HH:mm" : "MMM D, HH:mm";
};

// Every few buckets get a time; the peak and the filling bucket name themselves, and the wider "so far" keeps a gap.
const axisTicks = (n: number, peak: number | null, open: boolean, label: (i: number) => string) => {
  const step = Math.max(1, Math.ceil(n / AXIS_TICKS));
  const soFar = open && n > 1 ? n - 1 : -1;
  const ticks: OverviewAxisTick[] = [];
  for (let i = 0; i < n; i += step) {
    if (i !== peak && (soFar < 0 || soFar - i > 1)) ticks.push({ index: i, label: label(i) });
  }
  if (peak !== null) ticks.push({ index: peak, label: label(peak), peak: true });
  if (open && n > 1 && peak !== n - 1)
    ticks.push({ index: n - 1, label: label(n - 1), soFar: true });
  return ticks.sort((a, b) => a.index - b.index);
};

export function overviewLanes(
  triggers: readonly Firing[],
  zone: string,
  nowUs: number,
  open: boolean,
): OverviewLanes | null {
  const runs = distinctFirings(triggers);
  if (!runs.length) return null;
  const times = runs.flatMap((run) => [...run.times]);
  const first = times.reduce((min, at) => (at < min ? at : min), Infinity);
  const lastFiring = times.reduce((max, at) => (at > max ? at : max), -Infinity);
  const end = open ? Math.max(nowUs, lastFiring) : lastFiring;
  // Past the largest Alert Graph size, whole days stretch so the axis keeps at most LANE_BUCKETS bars.
  const span = end - first;
  const size =
    span > LANE_BUCKETS * DAY_US
      ? Math.ceil(span / LANE_BUCKETS / DAY_US) * DAY_US
      : histogramBucketFor(span, LANE_BUCKETS).minutes * MINUTE_US;
  const starts = bucketStarts(zone, first, end, size);
  const [start] = starts;
  const buckets = starts.length;
  const lanes = runs
    .map(({ firing, times: own }): OverviewLane => {
      const counts = Array.from({ length: buckets }, () => 0);
      for (const at of own) counts[bucketOf(starts, at)] += 1;
      return {
        alertId: firing.alert_id,
        name: firing.alert_name,
        alertKind: firing.alert_kind,
        count: own.size,
        last: [...own].reduce((max, at) => (at > max ? at : max), -Infinity),
        counts,
        // The newest bucket of an open incident is still filling, so it is drawn as provisional.
        points: counts.map((value, i) => ({ value, provisional: open && i === buckets - 1 })),
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const peakAt = peakWindow(triggers)?.at;
  const peak = peakAt === undefined ? null : bucketOf(starts, peakAt);
  const format = tickFormat(zone, start, end, size);
  return {
    lanes,
    total: times.length,
    bucketUs: size,
    start,
    end,
    buckets,
    peak,
    max: Math.max(...lanes.flatMap((lane) => lane.counts)),
    ticks: axisTicks(buckets, peak, open, (i) =>
      formatTimestampInTimezone(starts[i], format, zone),
    ),
  };
}

/** The 5-minute window with the most firings, from its first firing; null when no window holds two. */
export function peakWindow(triggers: readonly Firing[]) {
  const times = [...new Set(triggers.map((tr) => `${tr.alert_id}@${tr.alert_fired_at}`))]
    .map((key) => Number(key.slice(key.lastIndexOf("@") + 1)))
    .sort((a, b) => a - b);
  let best = { at: 0, count: 0 };
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while (j < times.length && times[j] < times[i] + PEAK_WINDOW_US) j++;
    if (j - i > best.count) best = { at: times[i], count: j - i };
  }
  return best.count > 1 ? { ...best, windowUs: PEAK_WINDOW_US } : null;
}

/** Firings a minute, or an hour when under one a minute; null over a span under a minute. */
export function firingRate(t: TranslateFn, firings: number, spanUs: number, locale: string) {
  const minutes = spanUs / MINUTE_US;
  if (minutes < 1 || !firings) return null;
  const perMinute = firings / minutes;
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  return perMinute >= 1
    ? t("alerts.incidents.overview.perMinute", { rate: number(perMinute) })
    : t("alerts.incidents.overview.perHour", { rate: number(perMinute * 60) });
}

/** Distinct services: the incident's own service dimension first, then each alert's service. */
export function servicesAffected(
  groupValues: Record<string, string> | undefined,
  groupDisplay: Record<string, string> | undefined,
  topology: IncidentTopology | undefined,
): AffectedService[] {
  const services = new Map<string, AffectedService>();
  const own = groupValues?.service;
  if (own && isNamedService(own)) services.set(own, { key: own, display: groupDisplay?.service });
  for (const node of topology?.nodes ?? []) {
    if (isNamedService(node.service_name) && !services.has(node.service_name)) {
      services.set(node.service_name, { key: node.service_name, display: node.display_name });
    }
  }
  return [...services.values()];
}
