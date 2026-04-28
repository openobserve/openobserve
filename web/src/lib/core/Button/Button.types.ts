/**
 * Button.types.ts — single source of truth for all OButton public types.
 * No types should be defined inline in Button.vue.
 */

/** Visual style variant — design is baked in, no style override props */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'

/** Size controls height, padding, and font-size only */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps {
  /** Visual style variant */
  variant?: ButtonVariant
  /** Component size */
  size?: ButtonSize
  /** Disables the button and all interaction */
  disabled?: boolean
  /** Shows loading state and disables interaction */
  loading?: boolean
  /** Native button type attribute */
  type?: 'button' | 'submit' | 'reset'
}

export interface ButtonEmits {
  (e: 'click', event: MouseEvent): void
}

export interface ButtonSlots {
  /** Main label / content */
  default?: () => unknown
  /** Icon placed before the label */
  'icon-left'?: () => unknown
  /** Icon placed after the label */
  'icon-right'?: () => unknown
}
