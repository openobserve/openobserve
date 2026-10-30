/**
 * ODropdownGroup.types.ts — public types for ODropdownGroup.
 */

import type { I18nText } from "@/types/i18n";

export interface DropdownGroupProps {
  /** Optional visible group label */
  label?: I18nText;
}

export interface DropdownGroupSlots {
  default?: () => unknown;
  /** Optional right-aligned action rendered next to the group label */
  "label-action"?: () => unknown;
}
