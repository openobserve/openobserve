// Copyright 2026 OpenObserve Inc.

import type { InjectionKey } from "vue";

/**
 * The form instance returned by `useForm()` from @tanstack/vue-form.
 * Typed broadly to avoid re-exporting the full generic chain.
 */
 
export type FormContextValue = any;

/** Provide/inject key for the OForm context. */
export const FORM_CONTEXT_KEY: InjectionKey<FormContextValue> =
  Symbol("OFormContext");

/** Validator function signature for OForm field components. */
export type FieldValidator<T = string> = (value: T) => string | undefined;

export interface OFormProps<T extends Record<string, unknown>> {
  /** Initial values for all fields in the form */
  defaultValues: T;
  /**
   * Validate every field before stopping on the first error.
   * Mirrors q-form's `greedy` prop. Without this, validation short-circuits
   * on the first failed field.
   */
  greedy?: boolean;
}

export interface OFormEmits<T extends Record<string, unknown>> {
  /** Fired when the form is submitted and all validators pass */
  (_e: "submit", _values: T): void;
  /** Fired when `reset()` is called on the OForm ref */
  (_e: "reset"): void;
}

export interface OFormSlots {
  default?: () => unknown;
}

/**
 * The shape exposed by OForm via `defineExpose`. Use this to type a
 * template ref:
 *
 * ```ts
 * const formRef = ref<OFormExposed | null>(null);
 * await formRef.value?.validate();
 * ```
 */
export interface OFormExposed {
  /**
   * Validate every field. With `greedy`, all validators run regardless of
   * earlier failures; otherwise short-circuits on the first invalid field.
   * Returns true when every field passes.
   */
  validate(): Promise<boolean>;
  /** Clear validation errors on every field without resetting their values. */
  resetValidation(): void;
  /** Programmatically trigger submission (runs validators → onSubmit). */
  submit(): void;
  /** Reset every field to its initial `defaultValues` and clear meta state. */
  reset(): void;
  /** Direct access to the underlying TanStack form for advanced cases. */
  form: FormContextValue;
}
