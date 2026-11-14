import type { I18nText } from "@/types/i18n";

/** Inline code: a cron expression, an id, a path. A block of code is OCodeBlock. */
export interface CodeProps {
  /** Adds a copy button after the code; it copies the rendered text. */
  copyable?: boolean;
  truncate?: boolean;
  /** With `truncate`: hover text while cut (defaults to the value); `false` for secrets. */
  tooltip?: I18nText | false;
}

export interface CodeSlots {
  default(): unknown;
}
