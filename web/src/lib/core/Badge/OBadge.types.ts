/**
 * OBadge.types.ts — single source of truth for the chip types shared by OBadge and OTag.
 * No types should be defined inline in OBadge.vue.
 */

import type { I18nText } from "@/types/i18n";

/** Chip tone. Status tones (ok · warn · err · crit · info) render the soft triplet. */
export type ChipTone = "neutral" | "outline" | "accent" | "ok" | "warn" | "err" | "crit" | "info";

/** Chip height: sm 20, md 24 (a chip sitting in a 24 px row). */
export type ChipSize = "sm" | "md";

export const CHIP_TONES = [
  "neutral",
  "outline",
  "accent",
  "ok",
  "warn",
  "err",
  "crit",
  "info",
] as const satisfies readonly ChipTone[];

export const CHIP_SIZES = ["sm", "md"] as const satisfies readonly ChipSize[];

/** Tones that state a status; they get a leading dot unless an icon already carries it. */
export const CHIP_STATUS_TONES = [
  "ok",
  "warn",
  "err",
  "crit",
  "info",
] as const satisfies readonly ChipTone[];

export interface BadgeProps {
  /** Colour role. Default `"neutral"`. */
  tone?: ChipTone;
  /** Height. Default `"sm"`; a toggle chip is always 24. */
  size?: ChipSize;
  /** Leading 12 px icon (OIcon name). Overridden by the `#icon` slot. */
  icon?: string;
  /**
   * Leading 6 px dot. Unset means automatic: status tones without an icon get one,
   * so status never reads by colour alone.
   */
  dot?: boolean;
  /** Monospace text, for identifiers and values. */
  mono?: boolean;
  /** Renders a selectable chip: a 24 px `<button>` with `aria-pressed`. */
  toggle?: boolean;
  /** Pressed state of a `toggle` chip. */
  pressed?: boolean;
  /** Mutes the chip and blocks its toggle and remove controls. */
  disabled?: boolean;
  /** Renders a trailing ✕ that emits `remove`. */
  removable?: boolean;
  /** Accessible name for the remove button. Defaults to `common.remove`. */
  removeLabel?: I18nText;
}

export interface BadgeEmits {
  /** A `toggle` chip was activated. */
  click: [e: MouseEvent];
  /** The `removable` ✕ was activated. */
  remove: [e: MouseEvent];
}

export interface BadgeSlots {
  /** Chip text. */
  default(): unknown;
  /** Custom leading content; replaces the `icon` prop. */
  icon?(): unknown;
  /** Trailing segment after a thin divider, e.g. a count. */
  trailing?(): unknown;
}
