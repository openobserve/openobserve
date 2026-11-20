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
import { getIntlLocale } from "@/locales";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { compactDuration, durationText, durationWords, everyWords } from "./alertCopy";

export type ScheduleOverlapKind = "overlap" | "equal" | "gaps";
export type CheckRelation = ScheduleOverlapKind | "promql";

export interface CheckTimelineInput {
  /** Minutes between checks; ignored when `cron` is set. */
  frequency: number;
  /** Minutes of data each check reads. */
  period: number;
  /** PromQL one alert per series reads each series' newest value, so overlap does not apply. */
  promqlLatest?: boolean;
  cron?: string | null;
  timezone?: string | null;
  nowMs?: number;
}

export interface CheckTimeline {
  relation: CheckRelation;
  /** Minutes both checks read (overlap) or neither reads (gaps). */
  minutes: number;
  bracket: I18nText;
  /** When the previous and the latest check ran, in minutes from now (zero or negative). */
  checks: [number, number];
  period: number;
  /** Cron only: the sentence, and clock labels for minutes from now. */
  cron: {
    sentence: I18nText;
    clockAt: (minutesFromNow: number) => I18nText;
    nowClock: number;
  } | null;
}

interface CronRuns {
  previous: number;
  latest: number;
  shortest: number;
  longest: number;
}

/** The sentence for each way consecutive checks' windows meet. */
export const CAPTION_KEYS = {
  overlap: "alerts.form.schedule.overlapWords",
  equal: "alerts.form.schedule.equalWords",
  gaps: "alerts.form.schedule.gapsWords",
} as const satisfies Record<ScheduleOverlapKind, I18nKey>;

const MINUTE_MS = 60_000;
// Enough runs to see a monthly schedule's spread without walking a per-second cron for long.
const CRON_SAMPLE_RUNS = 64;
const CRON_SAMPLE_SPAN_MS = 35 * 1440 * MINUTE_MS;
const RANGE_UNITS: ReadonlyArray<readonly [number, I18nKey]> = [
  [1440, "alerts.sections.timeline.rangeDays"],
  [60, "alerts.sections.timeline.rangeHours"],
  [1, "alerts.sections.timeline.rangeMinutes"],
];

/** How consecutive checks' look-back windows relate: shared minutes, or unread minutes between them. */
export function scheduleOverlap(
  periodMin: number,
  frequencyMin: number,
): { kind: ScheduleOverlapKind; minutes: number } {
  const diff = periodMin - frequencyMin;
  if (diff > 0) return { kind: "overlap", minutes: diff };
  if (diff < 0) return { kind: "gaps", minutes: -diff };
  return { kind: "equal", minutes: 0 };
}

/** Checks further apart than the look back leave minutes no check reads; the fix checks as often as
 * the look back, unless the org's minimum interval is longer. */
export function checkGapNote(
  periodMin: number,
  frequencyMin: number,
  floorMin: number,
  t: TranslateFn,
): { text: I18nText; fix: I18nText | null; fixMinutes: number | null } | null {
  if (!(periodMin > 0) || !(frequencyMin > 0)) return null;
  const { kind, minutes } = scheduleOverlap(periodMin, frequencyMin);
  if (kind !== "gaps") return null;
  const fixable = periodMin >= floorMin;
  return {
    text: t("alerts.form.schedule.gapNote", { minutes: durationWords(minutes, t) }, minutes),
    fix: fixable ? t("alerts.guard.checkEvery", { every: everyWords(periodMin, t) }) : null,
    fixMinutes: fixable ? periodMin : null,
  };
}

/** A span for tight labels, exact to the minute: "20 min", "23 h", "1 h 30 min". */
export function shortSpan(minutes: number, t: TranslateFn): I18nText {
  const whole = Math.max(0, Math.round(minutes));
  if (whole >= 1440 && whole % 1440 === 0) return compactDuration(whole * 60, t);
  if (whole >= 60 && whole % 60 !== 0) {
    return t("alerts.sections.timeline.hoursMinutes", {
      hours: Math.floor(whole / 60),
      minutes: whole % 60,
    });
  }
  return compactDuration(whole * 60, t);
}

/** How a cron schedule's checks read the data, over the spread of time between its runs. */
export function cronTimelineWords(
  shortest: number,
  longest: number,
  periodMin: number,
  t: TranslateFn,
): I18nText {
  const period = durationWords(periodMin, t);
  let reads: I18nText;
  if (shortest === longest) {
    const { kind, minutes } = scheduleOverlap(periodMin, shortest);
    reads = t(CAPTION_KEYS[kind], { period, minutes: durationWords(minutes, t) });
  } else if (longest <= periodMin) {
    reads = t("alerts.sections.timeline.cronOverlap", {
      period,
      minutes: durationText((periodMin - shortest) * 60, t),
    });
  } else {
    const unread = longest - periodMin;
    reads = t(
      shortest < periodMin
        ? "alerts.sections.timeline.cronOverlapAndGaps"
        : "alerts.sections.timeline.cronGaps",
      { period, minutes: durationText(unread * 60, t) },
      shownCount(unread),
    );
  }
  return t("alerts.sections.timeline.cronRuns", { apart: apartWords(shortest, longest, t), reads });
}

/** The latest two checks and how their windows relate, for the "What this looks like" drawing. */
export function checkTimeline(input: CheckTimelineInput, t: TranslateFn): CheckTimeline | null {
  const period = Number(input.period);
  if (!(period > 0)) return null;
  const nowMs = input.nowMs ?? Date.now();
  let checks: [number, number];
  let cron: CheckTimeline["cron"] = null;
  if (input.cron != null) {
    const timezone = input.timezone || "UTC";
    const runs = input.cron.trim() ? cronRuns(input.cron.trim(), timezone, nowMs) : null;
    if (!runs) return null;
    checks = [runs.previous, runs.latest];
    const format = clockFormat(timezone);
    if (!format) return null;
    const clockAt = (minutes: number) => raw(format.format(new Date(nowMs + minutes * MINUTE_MS)));
    const part = (type: string) =>
      Number(format.formatToParts(new Date(nowMs)).find((p) => p.type === type)?.value ?? 0);
    cron = {
      sentence: cronTimelineWords(runs.shortest, runs.longest, period, t),
      clockAt,
      nowClock: (part("hour") % 24) * 60 + part("minute"),
    };
  } else {
    const frequency = Number(input.frequency);
    if (!(frequency > 0)) return null;
    checks = [-frequency, 0];
  }
  if (input.promqlLatest) {
    return {
      relation: "promql",
      minutes: 0,
      bracket: t("alerts.sections.timeline.newestOnly"),
      checks,
      period,
      cron,
    };
  }
  const { kind, minutes } = scheduleOverlap(period, Math.round(checks[1] - checks[0]));
  const bracket =
    kind === "overlap"
      ? t("alerts.sections.timeline.readByBoth", { span: shortSpan(minutes, t) })
      : kind === "gaps"
        ? t("alerts.sections.timeline.readByNeither", { span: shortSpan(minutes, t) })
        : t("alerts.sections.timeline.backToBack");
  return { relation: kind, minutes, bracket, checks, period, cron };
}

function cronRuns(cron: string, timezone: string, nowMs: number): CronRuns | null {
  try {
    const back = CronExpressionParser.parse(cron, { currentDate: new Date(nowMs), tz: timezone });
    const latest = back.prev().getTime();
    const previous = back.prev().getTime();
    const ahead = CronExpressionParser.parse(cron, { currentDate: new Date(latest), tz: timezone });
    const gaps = [latest - previous];
    let at = latest;
    while (gaps.length < CRON_SAMPLE_RUNS && at - latest < CRON_SAMPLE_SPAN_MS && ahead.hasNext()) {
      const next = ahead.next().getTime();
      gaps.push(next - at);
      at = next;
    }
    const toMinutes = (ms: number) => Math.max(1, Math.round(ms / MINUTE_MS));
    return {
      previous: (previous - nowMs) / MINUTE_MS,
      latest: (latest - nowMs) / MINUTE_MS,
      shortest: toMinutes(Math.min(...gaps)),
      longest: toMinutes(Math.max(...gaps)),
    };
  } catch {
    return null;
  }
}

function apartWords(shortest: number, longest: number, t: TranslateFn): I18nText {
  if (shortest === longest) return durationText(shortest * 60, t);
  const unit = RANGE_UNITS.find(([size]) => shortest % size === 0 && longest % size === 0);
  if (!unit) {
    return t("alerts.sections.timeline.range", {
      from: durationText(shortest * 60, t),
      to: durationText(longest * 60, t),
    });
  }
  const [size, key] = unit;
  return t(key, { from: shortest / size, count: longest / size }, longest / size);
}

/** The number durationText shows for these minutes, so the verb agrees with it. */
function shownCount(minutes: number): number {
  const size = RANGE_UNITS.find(([unit]) => minutes % unit === 0)?.[0] ?? 1;
  return minutes / size;
}

function clockFormat(timezone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(getIntlLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      // The app writes times as HH:mm everywhere.
      hourCycle: "h23",
      timeZone: timezone,
    });
  } catch {
    return null;
  }
}
