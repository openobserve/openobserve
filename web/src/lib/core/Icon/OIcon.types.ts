import type { IconName } from "./OIcon.icons";

export type { IconName };

export interface IconProps {
  /** Approved icon name from the registry. To add a new icon, update OIcon.icons.ts. */
  name: IconName;
  /**
   * Semantic size. Defaults to "md" (24px).
   * xs=12px  sm=16px  md=24px  lg=32px  xl=40px
   */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Accessible label. When provided the icon has role="img". When omitted it is aria-hidden. */
  label?: string;
}

export interface IconSlots {
  /** Optional slot — e.g. to co-locate an OTooltip next to the icon. */
  default?(): unknown;
}
