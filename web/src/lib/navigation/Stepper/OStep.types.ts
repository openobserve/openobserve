/**
 * OStep.types.ts — single source of truth for OStep public types.
 * OStep represents a single step within an OStepper.
 */

import type { Component } from 'vue'

export interface OStepProps {
  /** Step identifier — unique within the stepper, matched against OStepper's v-model */
  name: number
  /** Step header label shown in the indicator row */
  title: string
  /** Lucide icon component shown in the step indicator (replaced by checkmark when done) */
  icon?: Component | null
  /** Marks this step as completed — shows a checkmark. Typically :done="step > N". Default: false */
  done?: boolean
  /**
   * Per-step override for header click navigation.
   * Undefined means inherit from the parent OStepper's `navigable` prop.
   */
  navigable?: boolean
  /** Optional subtitle shown below the title in the step header. */
  description?: string
  /** Shows an error state in the step indicator. Default: false */
  error?: boolean
}

export interface OStepSlots {
  /** Step content — shown only when this step is active */
  default: () => unknown
}
