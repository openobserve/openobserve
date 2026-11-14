/**
 * OTooltip.types.ts ΓÇö public types for OTooltip.
 */

import type { I18nText } from "@/types/i18n";

/** Set on every element that owns an OTooltip, so shared tooltips (e.g. OTable's) can avoid doubling it. */
export const TOOLTIP_TRIGGER_ATTR = "data-o-tooltip-trigger";

/** Set by OButton when clicking it does nothing, so its tooltip may open on click. */
export const INERT_TRIGGER_ATTR = "data-o2-inert";

/** `TOOLTIP_TRIGGER_ATTR` value of an overflow-only tooltip, which shows only while its element is cut. */
export const TOOLTIP_TRIGGER_OVERFLOW = "overflow";

/** Marks an element whose text must never reach a tooltip (a secret); shared tooltips honour it. */
export const TOOLTIP_OFF_ATTR = "data-o-tooltip-off";

export type TooltipSide = "top" | "right" | "bottom" | "left";

export interface TooltipProps {
  /** One line: the action or the fact, sentence case. Use the `#content` slot for a second line. */
  content?: I18nText;
  /** Flips once when there is no room. @default "top" */
  side?: TooltipSide;
  /** When true, the tooltip never opens */
  disabled?: boolean;
  /** Keeps the bubble open while the pointer is on it, so its text can be selected. */
  hoverable?: boolean;
  /** Controlled open state — omit for uncontrolled */
  open?: boolean;
  /** Extra classes on the bubble; never a width, which is capped at 280 (guideline O1). */
  contentClass?: string;
  /** Fill class for the arrow, so it matches a `contentClass` background */
  arrowClass?: string;
  /** Shortcut registry id; its keys show after the content (B6, KB3), as on OButton. */
  shortcut?: string;
  /** Keys to show when there is no registry binding. */
  keys?: string | string[];
  /** Open only when the trigger's text is actually cut off; without `content` it shows that text. */
  overflowOnly?: boolean;
  /** Closes when another exclusive tooltip opens, so a row's tooltips never show side by side. */
  exclusive?: boolean;
  /** Element to position against, for one tooltip shared by many targets; visibility then follows `open` alone. */
  anchor?: HTMLElement | null;
}

export interface TooltipEmits {
  /** Requested open state, e.g. `false` when Escape is pressed. */
  (e: "update:open", value: boolean): void;
}

export interface TooltipSlots {
  /** The trigger element ΓÇö must be a single focusable element */
  default?: () => unknown;
  /** Rich tooltip content ΓÇö use instead of `content` prop when markup is needed */
  content?: () => unknown;
}
