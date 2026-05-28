/** Horizontal alignment of action buttons */
export type OCardActionsAlign = "left" | "center" | "right" | "between";

export interface OCardActionsProps {
  /**
   * Horizontal alignment of action buttons.
   * Defaults to `"right"` ΓÇö the most common case (write zero props).
   */
  align?: OCardActionsAlign;
}

export type OCardActionsEmits = Record<never, never>;

export interface OCardActionsSlots {
  /** Action buttons ΓÇö typically OButton components */
  default(): unknown;
}
