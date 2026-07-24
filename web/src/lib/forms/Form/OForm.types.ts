// Copyright 2026 OpenObserve Inc.

import type { InjectionKey, Ref } from "vue";

/**
 * The form instance returned by `useForm()` from @tanstack/vue-form.
 * Typed broadly to avoid re-exporting the full generic chain.
 */

export type FormContextValue = any;

/** Provide/inject key for the OForm context. */
export const FORM_CONTEXT_KEY: InjectionKey<FormContextValue> = Symbol("OFormContext");

/**
 * Provide/inject key for the form submit state. An overlay (ODialog/ODrawer)
 * provides a `ref<boolean>` here; the OForm nested in its slot mirrors its
 * TanStack `isSubmitting` into it, so the overlay's footer Save button — which
 * lives outside the <form> and is linked only by `form-id` — shows its spinner
 * automatically with no per-form loading wiring.
 */
export const FORM_SUBMIT_STATE_KEY: InjectionKey<Ref<boolean>> = Symbol("OFormSubmitState");

export interface OFormProps<T extends Record<string, unknown>> {
  /** Initial values for all fields in the form */
  defaultValues: T;
  /**
   * Validate every field before stopping on the first error.
   * Enables greedy validation (validate all fields, not just stop at the first). Without this, validation short-circuits
   * on the first failed field.
   */
  greedy?: boolean;
  /**
   * Optional Zod (Standard Schema) validating the whole form. Wired into
   * TanStack's single `onDynamic`/`onDynamicAsync` validator source; issues are
   * routed to fields by `name`. Validation TIMING is submit-then-change
   * (`revalidateLogic({ mode: "submit", modeAfterSubmission: "change" })`):
   * nothing validates until the first submit, then it re-validates on every
   * change. Field wrappers display whenever `field.state.meta.errors.length > 0`
   * (empty until the first submit, so nothing shows while typing or on blur).
   */
  schema?: unknown;
  /**
   * Submit handler, called with the validated values once all validators pass.
   * May be async — OForm AWAITS it, so TanStack's `isSubmitting` stays true for
   * the whole save (drives the auto Save spinner) and re-entry is guarded.
   * Written as `@submit="handler"` in templates (Vue maps it to this prop).
   */
  onSubmit?: (_values: T) => unknown | Promise<unknown>;
}

export interface OFormEmits {
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
  /** Reactive: true while the (awaited) submit handler is running. */
  isSubmitting: Ref<boolean>;
  /** Reactive: TanStack's `canSubmit` (false while invalid/validating). */
  canSubmit: Ref<boolean>;
  /** Direct access to the underlying TanStack form for advanced cases. */
  form: FormContextValue;
}
