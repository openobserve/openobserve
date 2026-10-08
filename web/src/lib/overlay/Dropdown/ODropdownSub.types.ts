import type { I18nText } from "@/types/i18n";

export interface DropdownSubProps {
  open?: boolean;
  textValue: I18nText;
  /** Secondary line under the trigger label, linked as its accessible description. */
  description?: I18nText | null;
  descriptionId?: string;
}

export interface DropdownSubEmits {
  "update:open": [open: boolean];
}

export interface DropdownSubSlots {
  trigger(): unknown;
  "icon-left"(): unknown;
  "icon-right"(): unknown;
  default(): unknown;
}
