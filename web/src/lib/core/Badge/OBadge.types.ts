/**
 * OBadge.types.ts — single source of truth for all OBadge public types.
 * No types should be defined inline in OBadge.vue.
 */

/**
 * Semantic colour variant — design is baked in, no style override props.
 *
 * Solid variants (filled background, contrasting foreground):
 *   default | primary | success | warning | error
 *
 * Outline variants (transparent background, coloured ring + text):
 *   default-outline | primary-outline | success-outline | warning-outline | error-outline |
 *   info-outline | purple-outline
 *
 * Soft variants (light tinted background, dark text — no ring):
 *   default-soft | primary-soft | success-soft | warning-soft | error-soft
 */
export type BadgeVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "default-outline"
  | "primary-outline"
  | "success-outline"
  | "warning-outline"
  | "error-outline"
  | "info-outline"
  | "purple-outline"
  | "default-soft"
  | "primary-soft"
  | "success-soft"
  | "warning-soft"
  | "error-soft"
  // NEW: Extended color families for correlation dimensions (8 colors × 3 variants = 24 new variants)
  | "teal" | "teal-outline" | "teal-soft"
  | "orange" | "orange-outline" | "orange-soft"
  | "lime" | "lime-outline" | "lime-soft"
  | "amber" | "amber-outline" | "amber-soft"
  | "cyan" | "cyan-outline" | "cyan-soft"
  | "blue" | "blue-outline" | "blue-soft"
  | "purple" | "purple-outline" | "purple-soft"
  | "indigo" | "indigo-outline" | "indigo-soft";

/** Size controls padding and font-size only — shape is always pill (rounded-full). */
export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  /** Semantic colour variant. Default: `"default"` */
  variant?: BadgeVariant;
  /** Size. Default: `"md"` */
  size?: BadgeSize;
  /**
   * Material icon name rendered on the left side of the label.
   * Overridden by the `#icon` slot when provided.
   */
  icon?: string;
  /**
   * Numeric count rendered in a trailing segment on the right.
   * Overridden by the `#trailing` slot when provided.
   * NOTE: `count: 0` still renders the `0` chip (different from q-badge which
   * hid empty counts). To hide an empty count, pass `count: undefined` or use
   * `hideZeroCount`.
   */
  count?: number;
  /**
   * When true and `count` is 0, the trailing segment is suppressed
   * (q-badge-compatible behavior).
   */
  hideZeroCount?: boolean;
  /**
   * Renders a 7px solid status dot before the label (HANDOFF §11). The dot
   * inherits the badge's foreground colour (`currentColor`), so a `success`
   * badge gets a green dot, an `error` badge a red dot, etc. Use for live
   * status pills like "active" / "suspended".
   */
  dot?: boolean;
  /**
   * Makes the badge interactive — adds keyboard handling, hover feedback,
   * and a visible focus ring. Emits `click` on activation.
   */
  clickable?: boolean;
  /** Mutes the badge visually and suppresses interaction. */
  disabled?: boolean;
}

export interface BadgeEmits {
  /**
   * Fired when `clickable` is `true` and the badge is clicked or activated
   * via the keyboard (Enter or Space).
   */
  click: [e: MouseEvent | KeyboardEvent];
}

export interface BadgeSlots {
  /** Badge label content (text, icons, tooltip, etc.). */
  default(): unknown;
  /**
   * Custom left-side content — image, SVG, avatar, or any element.
   * When provided, overrides the `icon` prop.
   */
  icon?(): unknown;
  /**
   * Custom right-side trailing content — text sublabel, icon, or anything.
   * Rendered after a thin visual divider. When provided, overrides the `count` prop.
   */
  trailing?(): unknown;
}
