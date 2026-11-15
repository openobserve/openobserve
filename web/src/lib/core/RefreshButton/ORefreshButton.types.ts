import type { I18nText } from "@/types/i18n";
import type { ButtonSize } from "../Button/OButton.types";

export interface RefreshButtonProps {
  /** Unix millisecond timestamp of the last completed query; drives the data age. */
  lastRunAt?: number | null;
  /** Swaps the glyph for a spinner and ignores clicks; the rows stay. */
  loading?: boolean;
  /** Disables the button independently of loading (e.g. while the query is invalid). */
  disabled?: boolean;
  /** With `disabled`, says why in the tooltip and keeps the button focusable (B9). */
  disabledReason?: I18nText | null;
  /** Epoch ms of a failed refresh: a warn dot, "Failed", and the button reads Retry. */
  failedAt?: number | null;
  /** Auto-refresh interval in seconds, 0 for Off; omit to hide the menu segment. The page runs the timer. */
  autoRefresh?: number;
  /** The menu's intervals in seconds; the app's shared list when absent. */
  intervals?: readonly number[];
  /** Intervals shorter than this many seconds are disabled; the server's minimum when absent. */
  minInterval?: number;
  /** One line under the intervals, such as which time ranges auto-refresh applies to. */
  autoRefreshNote?: I18nText;
  /** `md` in a toolbar, `sm` in a panel header. */
  size?: Extract<ButtonSize, "sm" | "md">;
  /** Shortcut registry id shown in the tooltip. */
  shortcut?: string;
  /** Overrides the button's `data-test` so a page keeps its own selector. */
  dataTest?: string;
  /** Replaces the last-refreshed time in the tooltip, for data that carries its own as-of time. */
  tooltip?: I18nText;
  /** IANA zone for the failed-refresh times; the app's selected zone when absent. */
  timeZone?: string;
}

export interface RefreshButtonEmits {
  (e: "click", event: MouseEvent): void;
  (e: "update:autoRefresh", value: number): void;
}
