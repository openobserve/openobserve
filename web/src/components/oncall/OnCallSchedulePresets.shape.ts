// Copyright 2026 OpenObserve Inc.

/**
 * What a preset's live form values would COVER, as a week of hours.
 *
 * The preset screen's centrepiece is a picture of the week the current values
 * build, redrawn on every keystroke — so it cannot come from the server: the
 * catalogue can describe a shape, but only the browser knows that the user just
 * dragged EMEA's window to 15:00.
 *
 * `restrictionsOf` is therefore the ONE place that knows what each shape means.
 * Everything else in the drawer — which rows exist, which controls they carry,
 * how many regions are allowed — is still generated from the catalogue's own
 * `inputs`. An unknown preset id returns null here, and the screen renders every
 * row and applies correctly, only without the picture.
 */

import type { PresetDescriptor, PresetInput } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { gt, raw } from "@/types/i18n";
import { describeRestrictions, formatMinuteOfDay } from "@/utils/oncall";

/** Hours in one coverage cell. Three cells make a day column. */
export const BAND_HOURS = 8;
export const BANDS_PER_DAY = 24 / BAND_HOURS;
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MINUTES_PER_DAY = 1440;

/** The decorative ramp OScheduleBand paints with, so the two agree on hue. */
const BAND_TONES = [1, 2, 3, 4, 5, 6] as const;
export type LayerTone = (typeof BAND_TONES)[number] | "rest";

/**
 * When a layer holds an hour.
 *
 * `always` is the unrestricted catch-all every preset ends with — it is what
 * makes "every hour covered" true rather than hopeful.
 */
export type Restriction =
  | { kind: "always" }
  | { kind: "window"; days: number[]; from: number; to: number }
  | { kind: "until"; day: number; minute: number };

export interface PresetLayer {
  /** Stable across edits so a v-for does not remount on every keystroke. */
  key: string;
  label: I18nText;
  tone: LayerTone;
  members: string[];
  restriction: Restriction;
}

/** What one cell of the week grid is holding. */
export type CoverageMark = LayerTone | "gap" | "unstaffed";

export interface Coverage {
  /** `cells[day][band]`, Monday first. */
  cells: CoverageMark[][];
  /** Hours no layer claims. Zero for every catalogue shape — but not assumed. */
  gapHours: number;
  /** Hours a layer claims with nobody named in it. */
  unstaffedHours: number;
}

// ── Reading the model ─────────────────────────────────────────────────────────

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
function row(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function members(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function minute(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function days(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) && value.length
    ? value.filter((v): v is number => typeof v === "number")
    : fallback;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toneAt(index: number): LayerTone {
  return BAND_TONES[index % BAND_TONES.length];
}

/**
 * The catch-all's default, spelled out: nobody named means everybody named
 * above, in the order they were named. Rendering that as an empty layer would
 * report a staffing hole the server would never create.
 */
function inherited(above: PresetLayer[]): string[] {
  const seen = new Set<string>();
  for (const layer of above) for (const email of layer.members) seen.add(email);
  return [...seen];
}

function restLayer(
  key: string,
  label: I18nText,
  group: unknown,
  above: PresetLayer[],
): PresetLayer {
  const own = members(row(group).members);
  return {
    key,
    label,
    tone: "rest",
    members: own.length ? own : inherited(above),
    restriction: { kind: "always" },
  };
}

/** The catalogue's label for a field, so the picture and the rows say one thing. */
function labelOf(preset: PresetDescriptor, field: string): I18nText {
  return raw(preset.inputs.find((i: PresetInput) => i.field === field)?.label ?? field);
}

/**
 * The layers a shape builds, highest priority first, from the values as typed.
 *
 * Null for an id this build has never heard of — the screen then skips the
 * coverage picture rather than drawing a confident lie about it.
 */
export function layersOf(
  preset: PresetDescriptor,
  model: Record<string, unknown>,
): PresetLayer[] | null {
  switch (preset.id) {
    case "follow_the_sun": {
      const regions = rows(model.groups).map((group, index) => ({
        key: `groups-${index}`,
        label: raw(text(group.name)) || labelOf(preset, "groups"),
        tone: toneAt(index),
        members: members(group.members),
        restriction: {
          kind: "window" as const,
          days: WEEK_DAYS,
          from: minute(group.start_minute, 0),
          to: minute(group.end_minute, MINUTES_PER_DAY),
        },
      }));
      return [
        ...regions,
        restLayer("catch_all", labelOf(preset, "catch_all"), model.catch_all, regions),
      ];
    }

    case "weekday_weekend": {
      const weekdays: PresetLayer = {
        key: "weekdays",
        label: labelOf(preset, "weekdays"),
        tone: toneAt(0),
        members: members(row(model.weekdays).members),
        restriction: { kind: "window", days: [0, 1, 2, 3, 4], from: 0, to: MINUTES_PER_DAY },
      };
      return [
        weekdays,
        restLayer("weekend", labelOf(preset, "weekend"), model.weekend, [weekdays]),
      ];
    }

    case "split_the_week": {
      const first: PresetLayer = {
        key: "first",
        label: labelOf(preset, "first"),
        tone: toneAt(0),
        members: members(row(model.first).members),
        restriction: {
          kind: "until",
          day: minute(model.boundary_day, 3),
          minute: minute(model.boundary_minute, 0),
        },
      };
      return [first, restLayer("second", labelOf(preset, "second"), model.second, [first])];
    }

    case "business_hours_plus_nights": {
      const business: PresetLayer = {
        key: "business_hours",
        label: labelOf(preset, "business_hours"),
        tone: toneAt(0),
        members: members(row(model.business_hours).members),
        restriction: {
          kind: "window",
          days: days(model.days, [0, 1, 2, 3, 4]),
          from: minute(model.start_minute, 9 * 60),
          to: minute(model.end_minute, 17 * 60),
        },
      };
      return [
        business,
        restLayer("after_hours", labelOf(preset, "after_hours"), model.after_hours, [business]),
      ];
    }

    default:
      return null;
  }
}

// ── Resolving the week ────────────────────────────────────────────────────────

function holdsHour(restriction: Restriction, day: number, hour: number): boolean {
  // The hour's midpoint, so a window ending at 14:00 does not claim 14:00–15:00.
  const at = hour * 60 + 30;
  switch (restriction.kind) {
    case "always":
      return true;
    case "until":
      return day < restriction.day || (day === restriction.day && at < restriction.minute);
    case "window": {
      if (!restriction.days.includes(day)) return false;
      const { from, to } = restriction;
      if (from === to) return true;
      return from < to ? at >= from && at < to : at >= from || at < to;
    }
  }
}

/**
 * Which layer wins each hour, then each cell.
 *
 * A cell takes its band's EXCEPTION when it has one — one uncovered hour inside
 * an eight-hour cell is the whole reason to look at this picture, and averaging
 * it away would hide it behind seven good hours.
 */
export function coverageOf(layers: PresetLayer[]): Coverage {
  const cells: CoverageMark[][] = [];
  let gapHours = 0;
  let unstaffedHours = 0;

  for (const day of WEEK_DAYS) {
    const column: CoverageMark[] = [];
    for (let band = 0; band < BANDS_PER_DAY; band++) {
      const hours: CoverageMark[] = [];
      for (let hour = band * BAND_HOURS; hour < (band + 1) * BAND_HOURS; hour++) {
        const holder = layers.find((layer) => holdsHour(layer.restriction, day, hour));
        const mark: CoverageMark = !holder
          ? "gap"
          : holder.members.length
            ? holder.tone
            : "unstaffed";
        if (mark === "gap") gapHours++;
        if (mark === "unstaffed") unstaffedHours++;
        hours.push(mark);
      }
      column.push(
        hours.find((mark) => mark === "gap") ??
          hours.find((mark) => mark === "unstaffed") ??
          hours[0] ??
          "gap",
      );
    }
    cells.push(column);
  }

  return { cells, gapHours, unstaffedHours };
}

// ── Saying it in words ────────────────────────────────────────────────────────

const DAY_KEYS = [
  "oncall.day_mon",
  "oncall.day_tue",
  "oncall.day_wed",
  "oncall.day_thu",
  "oncall.day_fri",
  "oncall.day_sat",
  "oncall.day_sun",
] as const;

export function dayName(day: number): I18nText {
  return gt(DAY_KEYS[day] ?? "oncall.day_mon");
}

/**
 * When a layer holds, in the words the schedule's own "When" column uses.
 *
 * Routed through `describeRestrictions` rather than a parallel vocabulary: the
 * preset picture and the calendar it produces have to describe one window the
 * same way, or the preview reads as a different schedule from the one applied.
 */
export function describeWhen(restriction: Restriction): I18nText {
  switch (restriction.kind) {
    case "always":
      return describeRestrictions([], gt);
    case "until":
      return gt("oncall.presetWhenUntil", {
        day: String(dayName(restriction.day)),
        time: formatMinuteOfDay(restriction.minute),
      });
    case "window":
      return describeRestrictions(
        [
          {
            days: restriction.days,
            start_minute: restriction.from,
            end_minute: restriction.to,
          },
        ],
        gt,
      );
  }
}

/** The legend line for a layer — its name, then when it holds. */
export function describeLayer(layer: PresetLayer): I18nText {
  return gt("oncall.presetLegendEntry", {
    name: String(layer.label),
    when: String(describeWhen(layer.restriction)),
  });
}
