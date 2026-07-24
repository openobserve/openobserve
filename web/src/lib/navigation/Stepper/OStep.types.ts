/**
 * OStep.types.ts ΓÇö single source of truth for OStep public types.
 * OStep represents a single step within an OStepper.
 */

import type { StepIcon } from "./OStepper.types";

export interface OStepProps {
  /** Step identifier ΓÇö unique within the stepper, matched against OStepper's v-model */
  name: number;
  /** Step header label shown in the indicator row */
  title: string;
  /** OIcon name string or Lucide component shown in the step indicator (replaced by checkmark when done) */
  icon?: StepIcon;
  /** Marks this step as completed ΓÇö shows a checkmark. Typically :done="step > N". Default: false */
  done?: boolean;
  /**
   * Per-step override for header click navigation.
   * Undefined means inherit from the parent OStepper's `navigable` prop.
   */
  navigable?: boolean;
  /** Optional subtitle shown below the title in the step header. */
  description?: string;
  /** Shows an error state in the step indicator. Default: false */
  error?: boolean;
}

export interface OStepSlots {
  /** Step content ΓÇö shown only when this step is active */
  default: () => unknown;
  /**
   * Optional content rendered inline next to the title (e.g. a context badge).
   * Vertical orientation only (in horizontal mode the header is owned by OStepper).
   */
  "title-suffix"?: () => unknown;
}
