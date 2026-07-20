/**
 * OTooltip.types.ts ΓÇö public types for OTooltip.
 */

import type { TooltipContentProps } from "reka-ui";

export type TooltipSide = "top" | "right" | "bottom" | "left";
export type TooltipAlign = "start" | "center" | "end";

export interface TooltipProps {
  /** Tooltip text ΓÇö shorthand for `#content` slot when content is plain text */
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
  /**
   * When true, the tooltip stays open while the pointer moves onto the bubble,
   * so its content can be hovered/selected/copied (useful for long error text
   * or paths). Default false keeps the standard non-interactive tooltip that
   * closes as soon as the pointer leaves the trigger.
   */
  hoverable?: boolean;
  /** Controlled open state ΓÇö omit for uncontrolled */
  open?: boolean;
  /** Extra CSS class applied to the tooltip bubble element */
  contentClass?: string;
  /**
   * Renders a keyboard-shortcut hint (OShortcut keycaps) after the content.
   * Accepts a pre-symbolised string (`"⌘⇧A"`) or an array of keycaps
   * (`["⌘", "⇧", "A"]`). Omit to show no hint.
   */
  shortcut?: string | string[];
  /**
   * Registry shortcut id — resolves the hint keys from `shortcutRegistry.ts`
   * (the single source of truth) so a key change there updates this tooltip too.
   * Prefer this over `shortcut`; `shortcut` wins if both are set.
   */
  shortcutId?: string;
}

export interface TooltipSlots {
  /** The trigger element ΓÇö must be a single focusable element */
  default?: () => unknown;
  /** Rich tooltip content ΓÇö use instead of `content` prop when markup is needed */
  content?: () => unknown;
}
