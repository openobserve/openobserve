// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

export interface SelectHeaderRowProps {
  /** Name of the group the header introduces. */
  label: I18nText;
  /** Secondary detail about the group, e.g. how many options it holds. */
  count?: I18nText;
  /** Label of the row's action; the row has no action without it. */
  action?: I18nText;
  /** Accessible name of the action when its label alone is ambiguous. */
  actionAriaLabel?: I18nText;
  /** Marks the row as the entry the arrow keys rest on in an open select. */
  highlighted?: boolean;
}

export interface SelectHeaderRowEmits {
  (_e: "action", _event: MouseEvent): void;
}
