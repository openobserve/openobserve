import type { I18nText } from "@/types/i18n";

export interface DropdownSubProps {
  open?: boolean;
  textValue: I18nText;
  /** Secondary line under the trigger label, linked as its accessible description. */
  description?: I18nText | null;
  descriptionId?: string;
  /** Edge of the trigger the submenu lines up with; `end` grows it upward from a bottom bar. */
  align?: "start" | "center" | "end";
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
