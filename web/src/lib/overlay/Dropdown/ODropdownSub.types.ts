import type { I18nText } from "@/types/i18n";
import type { IconName } from "../../core/Icon/OIcon.icons";

export interface DropdownSubProps {
  open?: boolean;
  /** The trigger row's label; also its typeahead text. */
  label: I18nText;
  icon?: IconName;
  /** Secondary line under the trigger label, linked as its accessible description. */
  description?: I18nText | null;
}

export interface DropdownSubEmits {
  "update:open": [open: boolean];
}

export interface DropdownSubSlots {
  /** Trailing content before the chevron. */
  end?(): unknown;
  /** The submenu's items; a submenu never holds another submenu (guideline O1). */
  default(): unknown;
}
