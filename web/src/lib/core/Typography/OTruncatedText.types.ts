import type { I18nText } from "@/types/i18n";

/** How many lines show before the text is cut with "…". */
export type TruncatedTextLines = 1 | 2 | 3 | 4 | 5 | 6;

export interface TruncatedTextProps {
  /** Element to render; keep the one the call site used so layout does not shift. It must be a block or a flex/grid item, as inline text cannot cut. */
  as?: string;
  /** Lines shown before cutting with "…" (default 1). */
  lines?: TruncatedTextLines;
  /** Tooltip text when cut (defaults to the element's own text); `false` when the full value is visible nearby. */
  tooltip?: I18nText | false;
}

export interface TruncatedTextSlots {
  /** The text to show. */
  default(): unknown;
}
