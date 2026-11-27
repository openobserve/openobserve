import type { I18nText } from "@/types/i18n";

/** How many lines show before the text is cut with "…". */
export type TruncatedTextLines = 1 | 2 | 3 | 4 | 5 | 6;

/** Where a too-long text is cut: at its end, or in its middle so the start and the tail both stay visible. */
export type TruncateAt = "end" | "middle";

export interface TruncatedTextProps {
  /** Element to render; keep the one the call site used so layout does not shift. It must be a block or a flex/grid item, as inline text cannot cut. */
  as?: string;
  /** Lines shown before cutting with "…" (default 1). */
  lines?: TruncatedTextLines;
  /** Tooltip text when cut (defaults to the element's own text); `false` when the full value is visible nearby. */
  tooltip?: I18nText | false;
  /** Classes for the tooltip bubble, e.g. `whitespace-pre-wrap` to keep the text's line breaks. */
  tooltipClass?: string;
  /** `middle` keeps the start and the tail of `text` on one line (a multi-line text shows its first line) and takes focus while cut; the element needs a width of its own, e.g. `flex-1`. */
  truncate?: TruncateAt;
  /** `false` keeps a cut `truncate="middle"` value out of the Tab order, for a value inside a control that already names it in full. */
  focusable?: boolean;
  /** Middle truncation only: fit to the parent's room after its other children, so the text can sit content-wide with a control right after it. */
  fitParent?: boolean;
  /** The full value for `truncate="middle"`, which cuts it to the measured width; the default slot is not rendered then. */
  text?: string;
}

export interface TruncatedTextSlots {
  /** The text to show. */
  default(): unknown;
}
