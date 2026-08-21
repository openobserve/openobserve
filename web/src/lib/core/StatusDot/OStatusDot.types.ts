import type { I18nText } from "@/types/i18n";

/** Lifecycle state communicated by the dot's colour and motion. */
export type StatusDotState = "pending" | "active" | "success" | "warning" | "error";

/** Semantic dot size. */
export type StatusDotSize = "sm" | "md";

export interface StatusDotProps {
  /** Lifecycle state to communicate. */
  state: StatusDotState;
  /** Accessible description of the state. */
  label: I18nText;
  /** Dot size. Defaults to `sm`. */
  size?: StatusDotSize;
  /** Stable test selector forwarded to the rendered dot. */
  dataTest?: string;
}
