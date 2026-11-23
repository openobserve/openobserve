import type { I18nText } from "@/types/i18n";
import type { ButtonSize } from "../Button/OButton.types";

/** Auto-refresh choices offered by the menu segment; the page maps them to its timer. */
export type AutoRefreshInterval = "off" | "10s" | "30s" | "1m" | "5m" | "15m";

export const AUTO_REFRESH_INTERVALS = [
  "off",
  "10s",
  "30s",
  "1m",
  "5m",
  "15m",
] as const satisfies readonly AutoRefreshInterval[];

export interface RefreshButtonProps {
  /** Unix millisecond timestamp of the last completed query; drives the data age. */
  lastRunAt?: number | null;
  /** Swaps the glyph for a spinner and ignores clicks; the rows stay. */
  loading?: boolean;
  /** Disables the button independently of loading (e.g. while the query is invalid). */
  disabled?: boolean;
  /** Epoch ms of a failed refresh: a warn dot, "Failed", and the button reads Retry. */
  failedAt?: number | null;
  /** Shows the auto-refresh menu segment; omit to hide it. */
  autoRefresh?: AutoRefreshInterval;
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
  (e: "update:autoRefresh", value: AutoRefreshInterval): void;
}
