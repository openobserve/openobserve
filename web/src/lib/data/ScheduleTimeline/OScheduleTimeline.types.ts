// Copyright 2026 OpenObserve Inc.
//
// Types for OScheduleTimeline / OScheduleBand — the horizontal "who covers what
// span of time" track used by the on-call calendar, the coverage bar and the
// escalation ladder.
//
// The primitive owns ALL offset/width geometry. A call site supplies each band
// as a pair of 0–1 shares of the visible window and never writes a style.

import type { I18nText } from "@/types/i18n";

/**
 * A band's colour identity.
 *
 * `1`–`6` are the DECORATIVE `--color-schedule-band-*` ramp: they mean "this is
 * a different person from the one next to it", not "this is good/bad". Six, so a
 * five-person rotation never puts two neighbouring bands on one hue.
 * `gap` is the one alarming value — nobody is covering this span — and gets the
 * error-tinted `--color-schedule-gap-*` treatment instead of a band tone.
 *
 * `covered` / `partial` answer a DIFFERENT question from the ramp: not "who is
 * on this span" but "how much cover does it have". The ramp is deliberately
 * pale because its job is only to separate neighbours; a coverage bar needs
 * solid status colour, so these two are status-toned rather than decorative.
 */
export type ScheduleBandTone = 1 | 2 | 3 | 4 | 5 | 6 | "gap" | "covered" | "partial";

/** Number of distinct decorative band tones, for callers hashing into the ramp. */
export const SCHEDULE_BAND_TONE_COUNT = 6;

export interface ScheduleBand {
  /** Stable key for the v-for. */
  key: string;
  /** Where the band starts, as a share of the visible window (0–1). */
  offset: number;
  /** How much of the visible window it covers (0–1). */
  width: number;
  /** Text drawn inside the band. Clipped when the band is too narrow. */
  label: I18nText;
  /**
   * The band's accessible name. Required, not optional: a band is `role="img"`,
   * and a schedule a screen reader cannot read is not a schedule.
   */
  ariaLabel: I18nText;
  tone: ScheduleBandTone;
}

export interface ScheduleTrack {
  /** Stable key for the v-for. */
  key: string;
  /** Row label in the left gutter (a rotation name, a weekday, a ladder step). */
  label: I18nText;
  bands: ScheduleBand[];
  /**
   * Why this track is empty, when empty does not mean "nothing happens here".
   *
   * An empty strip is read as an answer — "nobody, all week". Set this when the
   * row has no bands because the data was never fetched for it, so the reader
   * is told the difference between an absence and a gap.
   */
  note?: I18nText;
}

/** One labelled mark on the shared time axis above the tracks. */
export interface ScheduleAxisTick {
  /** Position as a share of the visible window (0–1). */
  offset: number;
  label: I18nText;
}

export interface ScheduleTimelineProps {
  /** One row per rotation / day / ladder step. */
  tracks: ScheduleTrack[];
  /**
   * Vertical guides, as shares of the visible window (0–1) — day or hour
   * boundaries. Purely decorative; they carry no accessible name.
   */
  dayColumns?: number[];
  /** Labelled marks on the axis above the tracks. Omit for no axis. */
  axisTicks?: ScheduleAxisTick[];
  /**
   * Position of the "now" marker as a share of the window, or `null` when the
   * window does not contain the present — which is the common case when someone
   * pages forward through a calendar.
   */
  nowOffset?: number | null;
  /** Accessible name for the now marker. */
  nowLabel?: I18nText;
  /** Width of the left track-label gutter. Default `md`. */
  labelWidth?: "sm" | "md";
}

export interface ScheduleBandProps {
  band: ScheduleBand;
}

export interface ScheduleTimelineSlots {
  /**
   * Replace how one band renders — the seam for wrapping it in an `OTooltip`
   * without the call site taking over positioning.
   */
  band?: (props: { band: ScheduleBand; track: ScheduleTrack }) => unknown;
  /** Rendered under the tracks, e.g. a colour legend. */
  legend?: () => unknown;
}
