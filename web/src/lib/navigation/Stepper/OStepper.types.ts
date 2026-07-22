/**
 * OStepper.types.ts ΓÇö single source of truth for OStepper public types.
 * OStepper is the root container that owns the active-step state (v-model).
 * It also provides context and a registration API to child OStep components.
 */

import type { Component } from 'vue'
import type { IconName } from '@/lib/core/Icon/OIcon.types'

/** Layout direction of the stepper */
export type StepperOrientation = 'horizontal' | 'vertical'

/** Step indicator icon: a registered icon name, a component, or none.
 * `IconName | string` collapses to `string` so `withDefaults` doesn't expand
 * the large IconName union (mirrors OIcon's `name?: IconName | string`). */
export type StepIcon = IconName | string | Component | null

export interface OStepperProps {
  /** Currently active step number ΓÇö required, drives v-model */
  modelValue: number
  /** Layout direction. Default: 'horizontal' */
  orientation?: StepperOrientation
  /** Animate step panel transitions. Default: true */
  animated?: boolean
  /** Allow clicking completed step headers to navigate back. Default: false */
  navigable?: boolean
  /**
   * Render ALL step panels at once (a progress checklist / timeline) instead of
   * only the active step's panel (the default wizard behavior). `modelValue`
   * still drives which step is highlighted as active. Works in both
   * orientations. Default: false.
   */
  expanded?: boolean
}

export interface OStepperEmits {
  (e: 'update:modelValue', value: number): void
  /** Fired after the active step changes (same value as update:modelValue) */
  (e: 'change', value: number): void
}

export interface OStepperSlots {
  /** OStep children */
  default: () => unknown
}

/** Data each OStep registers with its parent OStepper */
export interface StepRegistration {
  name: number
  title: string
  icon: StepIcon
  done: boolean
  error: boolean
  description: string | undefined
  navigable: boolean | undefined
}

/** API provided to OStep children for self-registration */
export interface StepperRegisterAPI {
  registerStep: (step: StepRegistration) => void
  unregisterStep: (name: number) => void
  updateStep: (step: StepRegistration) => void
}

/** Shape of the provide() payload shared with child OStep components */
export interface StepperContext {
  modelValue: number
  orientation: StepperOrientation
  navigable: boolean
  animated: boolean
  /** Render every step's panel (checklist mode) rather than only the active one. */
  expanded: boolean
  onStepClick: (name: number) => void
}

/** Symbol key used for provide / inject (context) */
export const STEPPER_CONTEXT_KEY = Symbol('OStepperContext')

/** Symbol key used for provide / inject (registration API) */
export const STEPPER_REGISTER_KEY = Symbol('OStepperRegister')
