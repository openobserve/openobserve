/** Semantic color state derived from the data value */
export type ProgressBarVariant = "default" | "warning" | "danger";

/** Height of the progress track */
export type ProgressBarSize = "xs" | "sm" | "md" | "lg";

export interface ProgressBarProps {
  /** Progress value between 0 and 1 (inclusive) */
  value: number;
  /**
   * Left edge of the fill, between 0 and 1. Default 0 — the fill starts at the
   * track's start, which is ordinary progress.
   *
   * Set it to turn the bar into a *segment* of the track: the fill spans
   * `[start, value]` rather than `[0, value]`, so a series of bars sharing one
   * scale reads as a timeline. `start >= value` renders an empty fill rather
   * than a negative width.
   */
  start?: number;
  /** Semantic color state. Default: "default" */
  variant?: ProgressBarVariant;
  /** Track height. Default: "sm" */
  size?: ProgressBarSize;
}

export interface ProgressBarSlots {
  /** Content rendered inside the filled bar (e.g. a percentage label) */
  default?: () => unknown;
}
