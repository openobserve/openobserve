/** Animation style — ring for general loading, dots for AI/typing contexts */
export type SpinnerVariant = "ring" | "dots";

/** Semantic size — maps to fixed pixel dimensions via tokens */
export type SpinnerSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface SpinnerProps {
  /** Animation style. Default: "ring" */
  variant?: SpinnerVariant;
  /** Component size. Default: "md" */
  size?: SpinnerSize;
  /** Shows at once instead of after the 300 ms loader wait, for a host that already waited. Default: false */
  instant?: boolean;
}
