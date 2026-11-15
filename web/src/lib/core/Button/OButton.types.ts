/**
 * OButton.types.ts — single source of truth for all OButton public types.
 * No types should be defined inline in OButton.vue.
 */

import type { InjectionKey, Ref } from "vue";
import type { RouteLocationRaw } from "vue-router";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nText } from "@/types/i18n";

/** Seven variants chosen by job; `danger` (solid) belongs inside a confirmation only. */
export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "accent-ghost" | "danger" | "danger-ghost" | "link";

/** Control heights: xs 24, sm 28, md 32 (default), lg 36 (sign-in and empty-state CTA). */
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export const BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "ghost",
  "accent-ghost",
  "danger",
  "danger-ghost",
  "link",
] as const satisfies readonly ButtonVariant[];

export const BUTTON_SIZES = ["xs", "sm", "md", "lg"] as const satisfies readonly ButtonSize[];

export interface ButtonProps {
  /** Visual job of the button. Defaults to `ghost` when icon-only, else `secondary`. */
  variant?: ButtonVariant;
  /** Height token; inherits the enclosing OButtonGroup's size, else `md`. */
  size?: ButtonSize;
  /** Leading glyph, only when it adds meaning the label lacks. */
  icon?: IconName;
  /** Trailing glyph: a menu chevron or an external-link arrow. */
  iconEnd?: IconName;
  /** Square button with no visible text; name it with `label` or `aria-label`. */
  iconOnly?: boolean;
  /** Visible text, or with `iconOnly` the aria-label and tooltip. */
  label?: I18nText;
  /** Count pill after the label. */
  count?: number;
  /** Toggle state; any boolean renders `aria-pressed` and the selected look. */
  pressed?: boolean;
  /** Keeps the width, shows a spinner and ignores clicks. */
  loading?: boolean;
  /** Disables the button and all interaction. */
  disabled?: boolean;
  /** With `disabled`, keeps the button focusable and says why in a tooltip. */
  disabledReason?: I18nText;
  /** Marks the result as older than the inputs (a Run or Apply waiting to be pressed). */
  stale?: boolean;
  /** Renders an anchor. */
  href?: string;
  /** Renders a router link. */
  to?: RouteLocationRaw;
  /** Shortcut registry id; its keys appear in the built-in tooltip. */
  shortcut?: string;
  /** Native button type. */
  type?: "button" | "submit" | "reset";
  /** Full-width block button. */
  block?: boolean;
  /** `div` hosts an embedded control (a switch) that cannot nest inside a native button. */
  as?: "button" | "div";
}

/** Class strings for one variant in each interaction state. */
export interface ButtonVariantLook {
  base: string;
  interactive: string;
  pressed: string;
  disabled: string;
}

export interface ButtonEmits {
  (e: "click", event: MouseEvent): void;
}

export interface ButtonSlots {
  /** Main label / content */
  default?: () => unknown;
  /** Replaces the `icon` glyph */
  icon?: () => unknown;
  /** Replaces the `iconEnd` glyph */
  "icon-end"?: () => unknown;
}

/** Provided by OButtonGroup so its children share one height. */
export const BUTTON_GROUP_SIZE: InjectionKey<Ref<ButtonSize | undefined>> =
  Symbol("OButtonGroupSize");
