/**
 * ButtonGroup.types.ts ΓÇö single source of truth for all OButtonGroup public types.
 */

/** Layout axis for the group */
export type ButtonGroupOrientation = "horizontal" | "vertical";

export interface ButtonGroupProps {
  /** Stack buttons horizontally (default) or vertically */
  orientation?: ButtonGroupOrientation;
}

export interface ButtonGroupSlots {
  /** One or more OButton children */
  default?: () => unknown;
}
