/** Semantic color state derived from the data value */
export type ProgressBarVariant = "default" | "warning" | "danger";

/** Height of the progress track */
export type ProgressBarSize = "xs" | "sm" | "md" | "lg";

export interface ProgressBarProps {
  /** Progress value between 0 and 1 (inclusive) */
  value: number;
  /** Semantic color state. Default: "default" */
  variant?: ProgressBarVariant;
  /** Track height. Default: "sm" */
  size?: ProgressBarSize;
}

export interface ProgressBarSlots {
  /** Content rendered inside the filled bar (e.g. a percentage label) */
  default?: () => unknown;
}
