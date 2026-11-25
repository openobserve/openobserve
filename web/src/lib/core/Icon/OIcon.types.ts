import type { I18nText } from "@/types/i18n";

import type { IconName } from "./OIcon.icons";

export type { IconName };

export interface IconProps {
  /**
   * Either an approved icon name from the registry, or an `img:<path>` reference
   * to render an external image. To add a registry icon, update OIcon.icons.ts.
   * Optional: when omitted the icon is supplied via the default slot.
   */
  name?: IconName | string;
  /**
   * Semantic size, paired with the text beside it. Defaults to "md" (20px).
   * xs=14px  sm=16px  md=20px  lg=32px  xl=40px
   */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Accessible label. When provided the icon has role="img". When omitted it is aria-hidden. */
  label?: I18nText;
}

export interface IconSlots {
  /** Optional slot — e.g. to co-locate an OTooltip next to the icon. */
  default?(): unknown;
}
