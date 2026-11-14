import type { I18nText } from "@/types/i18n";

/** OCard: the one panel frame (border, radius 10, no shadow). The header shows when `title` or `#header` is set. */
export interface OCardProps {
  title?: I18nText;
  /** Short context after the title, e.g. "last 1 hour". */
  meta?: I18nText;
  /** No body padding, for tables and charts. */
  flush?: boolean;
  /** Skeleton body; keeps the frame and header. */
  loading?: boolean;
}

export type OCardEmits = Record<never, never>;

export interface OCardSlots {
  default?(): unknown;
  /** Header end: sm (28 px) controls only. */
  actions?(): unknown;
  /** A custom header line in place of title and meta; still 40 px. */
  header?(): unknown;
  /** Right-aligned row under the body. */
  footer?(): unknown;
}
