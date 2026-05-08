// Copyright 2026 OpenObserve Inc.

import type { InjectionKey } from "vue";

/**
 * The form instance returned by `useForm()` from @tanstack/vue-form.
 * Typed broadly to avoid re-exporting the full generic chain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormContextValue = any;

/** Provide/inject key for the OForm context. */
export const FORM_CONTEXT_KEY: InjectionKey<FormContextValue> =
  Symbol("OFormContext");

/** Validator function signature for OForm field components. */
export type FieldValidator<T = string> = (value: T) => string | undefined;

export interface OFormProps<T extends Record<string, unknown>> {
  /** Initial values for all fields in the form */
  defaultValues: T;
}

export interface OFormEmits<T extends Record<string, unknown>> {
  (_e: "submit", _values: T): void;
}

export interface OFormSlots {
  default?: () => unknown;
}
