/**
 * OTag.types.ts — public types of OTag, the app-facing chip.
 * No types should be defined inline in OTag.vue.
 */

import type { I18nText } from "@/types/i18n";
import type { BadgeProps } from "./OBadge.types";
import type { BadgeGroupName } from "./badgeGroups";

export interface TagProps extends BadgeProps {
  /** Registry group (e.g. "alertType"); maps `value` through badgeGroups. */
  type?: BadgeGroupName | string;
  /** Raw value (string | boolean | number) resolved through `type`. */
  value?: unknown;
  /** Overrides the resolved label with runtime text. */
  label?: I18nText;
  /** Text shown when a typed value is empty. Default "—". */
  emptyLabel?: I18nText;
}

export interface TagEmits {
  /** A `toggle` chip was activated. */
  click: [e: MouseEvent];
  /** The `removable` ✕ was activated. */
  remove: [e: MouseEvent];
}
