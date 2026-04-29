/**
 * Button.types.ts — single source of truth for all OButton public types.
 * No types should be defined inline in Button.vue.
 */

import type { PrimitiveProps } from "reka-ui";

/** Visual style variant — design is baked in, no style override props */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "ghost-primary"
  | "ghost-muted"
  | "ghost-subtle"
  | "ghost-destructive"
  | "ghost-warning"
  | "ghost-neutral"
  | "outline-destructive"
  | "sidebar-toggle"
  | "destructive";

/** Size controls height, padding, font-size, and border-radius */
export type ButtonSize =
  | "xs"
  | "chip"
  | "sm"
  | "sm-action"
  | "xs"
  | "md"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-xs-circle"
  | "icon-xs-sq"
  | "icon-chip"
  | "icon-sm"
  | "icon-md"
  | "icon-lg"
  | "icon-circle"
  | "icon-circle-sm";

export interface ButtonProps extends PrimitiveProps {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Component size */
  size?: ButtonSize;
  /** Disables the button and all interaction */
  disabled?: boolean;
  /** Shows loading state and disables interaction */
  loading?: boolean;
  /** Applies active/selected state styling (overrides variant to primary appearance) */
  active?: boolean;
  /** Native button type attribute — only meaningful when as="button" */
  type?: "button" | "submit" | "reset";
  /** Makes the button a block-level element ( full width, flex instead of inline-flex ) */
  block?: boolean;
}

export interface ButtonEmits {
  (e: "click", event: MouseEvent): void;
}

export interface ButtonSlots {
  /** Main label / content */
  default?: () => unknown;
  /** Icon placed before the label */
  "icon-left"?: () => unknown;
  /** Icon placed after the label */
  "icon-right"?: () => unknown;
}
