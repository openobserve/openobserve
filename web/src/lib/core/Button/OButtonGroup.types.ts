/**
 * ButtonGroup.types.ts — single source of truth for all OButtonGroup public types.
 */

/** Layout axis for the group */
export type ButtonGroupOrientation = "horizontal" | "vertical";

/** Cross-axis alignment of items in the group */
export type ButtonGroupAlign = "stretch" | "center" | "start" | "end";

/**
 * Corner radius of the group clip — matches the inner button radius.
 * Use "sm" for chip/icon-chip sized button groups (4px).
 * Defaults to "md" (6px) to match md/sm sized buttons.
 */
export type ButtonGroupRadius = "sm" | "md" | "lg";

export interface ButtonGroupProps {
  /** Stack buttons horizontally (default) or vertically */
  orientation?: ButtonGroupOrientation;
  /** Cross-axis alignment of child buttons. Defaults to 'stretch' */
  align?: ButtonGroupAlign;
  /**
   * Corner radius applied to the group container clip.
   * Must match the radius of the inner buttons to avoid corner artifacts.
   * Use "sm" when children use size="chip" or size="icon-chip".
   * Defaults to "md".
   */
  radius?: ButtonGroupRadius;
  /**
   * Draw divider lines between sibling buttons. Defaults to true (segmented
   * look). Set false for a seamless single pill — e.g. a query-builder field
   * chip where the group itself carries the border and inner buttons are ghost.
   */
  divided?: boolean;
}

export interface ButtonGroupSlots {
  /** One or more OButton children */
  default?: () => unknown;
}
