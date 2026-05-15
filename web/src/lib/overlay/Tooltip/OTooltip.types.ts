/**
 * OTooltip.types.ts — public types for OTooltip.
 */

import type { TooltipContentProps } from "reka-ui";

export type TooltipSide = "top" | "right" | "bottom" | "left";
export type TooltipAlign = "start" | "center" | "end";

export interface TooltipProps {
  /** Tooltip text — shorthand for `#content` slot when content is plain text */
  content?: string;
  /** Which side of the trigger to render the tooltip on */
  side?: TooltipSide;
  /** Alignment along the chosen side */
  align?: TooltipAlign;
  /** Gap in pixels between trigger edge and tooltip bubble */
  sideOffset?: TooltipContentProps["sideOffset"];
  /** Shift along the alignment axis */
  alignOffset?: TooltipContentProps["alignOffset"];
  /** Milliseconds before tooltip shows on hover (maps to delayDuration) */
  delay?: number;
  /** CSS max-width of the tooltip content bubble */
  maxWidth?: string;
  /** When true, the tooltip never opens */
  disabled?: boolean;
  /** Controlled open state — omit for uncontrolled */
  open?: boolean;
  /** Extra CSS class applied to the tooltip bubble element */
  contentClass?: string;
}

export interface TooltipSlots {
  /** The trigger element — must be a single focusable element */
  default?: () => unknown;
  /** Rich tooltip content — use instead of `content` prop when markup is needed */
  content?: () => unknown;
}
