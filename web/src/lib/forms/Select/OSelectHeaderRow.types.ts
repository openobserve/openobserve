// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

export interface SelectHeaderRowProps {
  /** Group name, shown bold. */
  label: I18nText;
  /** Quieter text after the label, e.g. a count. */
  count?: I18nText;
  /** Label of the action button on the row's end edge; no button without it. */
  action?: I18nText;
  /** Accessible name of the action when its label alone is ambiguous. */
  actionAriaLabel?: I18nText;
}

export interface SelectHeaderRowEmits {
  (_e: "action", _event: MouseEvent): void;
}
