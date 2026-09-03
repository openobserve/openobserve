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

/**
 * How solidly a band is painted. The tone says WHICH rotation the span belongs
 * to; the variant says what KIND of span it is.
 *
 * `solid` is the rotation running normally — the default reading of the chart,
 * and solid because a 50-tint span against a white card is hard to tell from
 * empty track. `outline` is a span somebody took FROM the rotation: it keeps the
 * lane's hue, so it still reads as that rotation's time, but the hollow fill
 * says the roster did not produce it. `soft` is the original pale ramp, kept for
 * the coverage bar and the escalation ladder, which are read for their
 * exceptions rather than for who is in them.
 */
export type ScheduleBandVariant = "soft" | "solid" | "outline";

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
  /** Default `soft`. Ignored by `gap`, which has one dashed treatment. */
  variant?: ScheduleBandVariant;
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
  /** Second line under `label` — a weekday under a date, say. */
  sublabel?: I18nText;
  /** Draw this tick as the one the reader is standing on (today, now). */
  emphasis?: boolean;
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
  /**
   * The now marker's label. Drawn as a pill on the axis in lane mode, and used
   * as the marker's accessible name in both modes.
   */
  nowLabel?: I18nText;
  /**
   * What the pointer is currently over, already worded by the caller.
   *
   * The component knows WHERE the pointer is (a share of the window); only the
   * caller knows what that share MEANS, because only it knows the window. So
   * the share goes out on `hover` and the sentence comes back here.
   */
  hoverLabel?: I18nText;
  /** Width of the left track-label gutter. Default `md`. */
  labelWidth?: "sm" | "md";
  /**
   * Drop the left gutter and let the caller draw a full-width header ABOVE each
   * track, via the `track-header` slot.
   *
   * A gutter wide enough for "Weekend cover · Sat–Sun · 12h shifts · 2 people"
   * is a gutter that leaves no chart. Once a row label carries a cadence, a
   * status and its own controls it is a header, not a label, and it needs the
   * width of the row rather than a column beside it.
   */
  laneHeaders?: boolean;
}

export interface ScheduleTimelineEmits {
  /**
   * Pointer position as a share of the visible window (0–1), or `null` when it
   * leaves. Lane mode only — gutter mode has a label column the share would be
   * measured across, which would make every reported instant wrong.
   */
  hover: [offset: number | null];
}

export interface ScheduleBandProps {
  band: ScheduleBand;
}

export interface ScheduleTimelineSlots {
  /**
   * Full-width header drawn above a track's strip. Only rendered under
   * `laneHeaders`, which also removes the left gutter this replaces.
   */
  "track-header"?: (props: { track: ScheduleTrack }) => unknown;
  /**
   * What to draw in place of an empty strip.
   *
   * An empty track is an ANSWER — "nobody, all window" — and usually the most
   * important one on the chart. This is the seam for saying what that costs and
   * offering the one action that fixes it, rather than leaving blank track the
   * reader has to interpret.
   */
  "track-empty"?: (props: { track: ScheduleTrack }) => unknown;
  /**
   * Replace how one band renders — the seam for wrapping it in an `OTooltip`
   * without the call site taking over positioning.
   */
  band?: (props: { band: ScheduleBand; track: ScheduleTrack }) => unknown;
  /** Rendered under the tracks, e.g. a colour legend. */
  legend?: () => unknown;
}
