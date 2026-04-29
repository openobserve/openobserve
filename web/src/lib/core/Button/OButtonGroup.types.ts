/**
 * ButtonGroup.types.ts — single source of truth for all OButtonGroup public types.
 */

/** Layout axis for the group */
export type ButtonGroupOrientation = "horizontal" | "vertical";

/** Cross-axis alignment of items in the group */
export type ButtonGroupAlign = "stretch" | "center" | "start" | "end";

export interface ButtonGroupProps {
  /** Stack buttons horizontally (default) or vertically */
  orientation?: ButtonGroupOrientation;
  /** Cross-axis alignment of child buttons. Defaults to 'stretch' */
  align?: ButtonGroupAlign;
}

export interface ButtonGroupSlots {
  /** One or more OButton children */
  default?: () => unknown;
}
