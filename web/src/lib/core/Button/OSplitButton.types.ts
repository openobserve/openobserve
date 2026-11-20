import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { ButtonSize } from "./OButton.types";

export interface SplitButtonProps {
  /** The default action. */
  label: I18nText;
  /** Leading glyph of the action half. */
  icon?: IconName;
  variant?: "primary" | "secondary";
  size?: Extract<ButtonSize, "sm" | "md">;
  /** aria-label of the menu half; defaults to "More options". */
  menuLabel?: I18nText;
  loading?: boolean;
  disabled?: boolean;
  /** The result is older than the inputs: the action half shows the stale dot. */
  stale?: boolean;
  /** Shortcut registry id shown in the action's tooltip. */
  shortcut?: string;
}

export interface SplitButtonEmits {
  (e: "click", event: MouseEvent): void;
}

export interface SplitButtonSlots {
  /** ODropdownItem children: the variants of the default action. */
  menu?: () => unknown;
}
