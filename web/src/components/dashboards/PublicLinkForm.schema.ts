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

import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type {
  PublicLink,
  PublicLinkConfig,
  PublicLinkRange,
} from "@/services/public_dashboards_admin";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { parseDuration } from "@/utils/date";

export const REFRESH_SECONDS = [
  10, 15, 30, 60, 300, 900, 1800, 3600, 7200, 21600, 86400, 172800, 604800, 1209600, 2592000,
];

export const MAX_RANGES = 10;
const MIN_RANGE_SECS = 60;
const MAX_RANGE_SECS = 365 * 86_400;

/** What the dashboard date-time picker reports on a change. */
export interface PickedTime {
  valueType?: string;
  relativeTimePeriod?: string | null;
  startTime: number;
  endTime: number;
  /** False for the picker's own emit on mount, which repeats the value it was given. */
  userChangedValue?: boolean;
}

const rangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("relative"), secs: z.number() }),
  z.object({ type: z.literal("absolute"), start: z.number(), end: z.number() }),
]);

/** The id a range's snapshot is stored and requested under; matches the server's key. */
export function rangeKey(range: PublicLinkRange): string {
  return range.type === "relative" ? `r${range.secs}` : `a${range.start}-${range.end}`;
}

/** Relative ranges shortest first, then absolute ranges oldest first. */
export function sortRanges<T extends PublicLinkRange>(ranges: T[]): T[] {
  const order = (r: PublicLinkRange) => (r.type === "relative" ? [0, r.secs] : [1, r.start]);
  return ranges.slice().sort((a, b) => {
    const [ta, va] = order(a);
    const [tb, vb] = order(b);
    return ta - tb || va - vb;
  });
}

/** The range a picker change describes; a relative month counts as 30 days. */
export function rangeFromPicker(picked: PickedTime): PublicLinkRange {
  if (picked.valueType === "relative" && picked.relativeTimePeriod) {
    return { type: "relative", secs: parseDuration(picked.relativeTimePeriod) };
  }
  return { type: "absolute", start: picked.startTime, end: picked.endTime };
}

// Largest unit first, matching the picker's units; a month is 30 days.
const PICKER_UNITS: Array<[number, string]> = [
  [2_592_000, "M"],
  [604_800, "w"],
  [86_400, "d"],
  [3_600, "h"],
  [60, "m"],
];

/** A relative range as the picker's period string, e.g. `2w`. */
export function pickerPeriod(secs: number): string {
  const [unit, suffix] = PICKER_UNITS.find(([u]) => secs % u === 0) ?? [1, "s"];
  return `${secs / unit}${suffix}`;
}

// Offered in order by Add, so a new row starts on a range the list doesn't have yet.
const NEW_RANGE_SECS = [
  3600, 86_400, 604_800, 2_592_000, 900, 21_600, 43_200, 172_800, 1_209_600, 7_776_000,
];

/** The range Add starts a new row on: the first common range not listed yet. */
export function nextNewRange(ranges: PublicLinkRange[]): PublicLinkRange {
  const listed = new Set(ranges.map(rangeKey));
  const secs = NEW_RANGE_SECS.find((s) => !listed.has(`r${s}`)) ?? NEW_RANGE_SECS[0];
  return { type: "relative", secs };
}

/** Why a range is invalid, or null; `earlier` are the rows above it, `now` is UTC micros. */
export function rangeError(
  range: PublicLinkRange,
  earlier: PublicLinkRange[],
  now: number,
  t: TranslateFn,
): I18nText | null {
  if (earlier.some((r) => rangeKey(r) === rangeKey(range))) {
    return t("dashboard.publicLinks.rangeAlreadyAdded");
  }
  if (range.type === "relative") {
    if (range.secs < MIN_RANGE_SECS || range.secs % 60 !== 0) {
      return t("dashboard.publicLinks.rangeTooShort");
    }
    if (range.secs > MAX_RANGE_SECS) return t("dashboard.publicLinks.rangeTooLong");
    return null;
  }
  if (range.start >= range.end) return t("dashboard.publicLinks.rangeStartAfterEnd");
  if (range.end > now) return t("dashboard.publicLinks.rangeEndsInFuture");
  if ((range.end - range.start) / 1_000_000 > MAX_RANGE_SECS) {
    return t("dashboard.publicLinks.rangeTooLong");
  }
  return null;
}

export const makePublicLinkSchema = (t: TranslateFn, today: string) =>
  z
    .object({
      name: z
        .string()
        .trim()
        .min(1, t("dashboard.publicLinks.nameRequired"))
        .max(256, t("dashboard.publicLinks.nameTooLong")),
      ranges: z.array(rangeSchema),
      defaultKey: z.string(),
      rebuildSecs: z.number(),
      // YYYY-MM-DD strings compare correctly as text.
      expires: z
        .string()
        .refine((v) => v === "" || v >= today, t("dashboard.publicLinks.expiresInPast")),
    })
    .superRefine((v, ctx) => {
      const now = Date.now() * 1000;
      if (v.ranges.length > MAX_RANGES) {
        ctx.addIssue({
          code: "custom",
          path: ["ranges"],
          message: t("dashboard.publicLinks.rangesFull", { n: MAX_RANGES }),
        });
      } else if (v.ranges.some((r, i) => rangeError(r, v.ranges.slice(0, i), now, t))) {
        ctx.addIssue({
          code: "custom",
          path: ["ranges"],
          message: t("dashboard.publicLinks.fixRanges"),
        });
      }
      if (!v.ranges.length) {
        ctx.addIssue({
          code: "custom",
          path: ["ranges"],
          message: t("dashboard.publicLinks.presetsRequired"),
        });
      } else if (!v.ranges.some((r) => rangeKey(r) === v.defaultKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["defaultKey"],
          message: t("dashboard.publicLinks.defaultNotAvailable"),
        });
      }
    });

export type PublicLinkForm = z.infer<ReturnType<typeof makePublicLinkSchema>>;

export const publicLinkDefaults = (): PublicLinkForm => ({
  name: "",
  ranges: [
    { type: "relative", secs: 3600 },
    { type: "relative", secs: 86400 },
  ],
  defaultKey: "r3600",
  rebuildSecs: 60,
  expires: "",
});

/** Pre-fill the form from an existing link, showing its expiry as a date in the author's timezone. */
export const publicLinkFormFrom = (link: PublicLink, timezone: string): PublicLinkForm => {
  return {
    name: link.name,
    ranges: sortRanges(link.time_range.ranges),
    defaultKey: rangeKey(link.time_range.default),
    rebuildSecs: link.rebuild_secs,
    expires: link.expires_at
      ? formatInTimeZone(link.expires_at / 1000, timezone, "yyyy-MM-dd")
      : "",
  };
};

/** The link stops at the end of the chosen day in the author's timezone, sent as UTC microseconds. */
export const endOfDayMicros = (date: string, timezone: string): number =>
  fromZonedTime(`${date}T23:59:59.999`, timezone).getTime() * 1000;

/** Today as YYYY-MM-DD in the author's timezone, the earliest expiry date allowed. */
export const todayIn = (timezone: string, now: Date = new Date()): string =>
  formatInTimeZone(now, timezone, "yyyy-MM-dd");

export const toPublicLinkConfig = (
  value: PublicLinkForm,
  frozenVariables: Record<string, unknown>,
  timezone: string,
): PublicLinkConfig => {
  const ranges = sortRanges(value.ranges);
  return {
    name: value.name.trim(),
    visibility: "public",
    time_range: {
      ranges,
      default: ranges.find((r) => rangeKey(r) === value.defaultKey) ?? ranges[0],
    },
    frozen_variables: frozenVariables,
    rebuild_secs: value.rebuildSecs,
    expires_at: value.expires ? endOfDayMicros(value.expires, timezone) : null,
  };
};
