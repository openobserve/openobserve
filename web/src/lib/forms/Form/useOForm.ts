// Copyright 2026 OpenObserve Inc.
//
// Headless form factory — the exact `useForm` configuration that <OForm> uses
// internally, extracted so a component that OWNS <OForm> can create the form in
// its own setup() and read it reactively (form.useStore) to drive parent-side
// conditional rendering (v-if / v-for / OStepper), then hand it to
// <OForm :form="form">.
//
// Use this ONLY when the OWNER of <OForm> needs reactive form state at setup
// (e.g. a discriminated form whose visible sections depend on a `kind` field).
// A component rendered INSIDE <OForm> (a descendant) does NOT need this — it can
// `inject(FORM_CONTEXT_KEY)` and call `form.useStore(...)` directly. And simple
// forms with no parent-side conditional rendering keep the plain
// <OForm :schema :default-values @submit> form (OForm creates the form itself
// via this same helper).
//
// The config here MUST stay identical to OForm.vue's fallback so an internal and
// an externally-supplied form behave the same: submit-then-change timing
// (revalidateLogic) + a single `onDynamic` schema source + an awaited onSubmit
// (which drives the auto Save spinner and guards double-submit).

import { useForm, revalidateLogic } from "@tanstack/vue-form";
import type { DeepKeys } from "@tanstack/form-core";

/**
 * The set of valid field-path strings for a form of shape `T` (what
 * setFieldValue/validateField/getFieldMeta accept as their first argument).
 * Components that access fields by a dynamically-built string cast the string
 * to this so it satisfies TanStack's DeepKeys union without widening the form.
 */
export type FormFieldPath<T> = DeepKeys<T>;

export interface UseOFormOptions<T extends Record<string, unknown>> {
  /** Initial values for all fields (same shape as OForm's :default-values). */
  defaultValues: T;
  /** Zod (Standard Schema) validating the whole form; mapped to fields by `name`. */
  schema?: unknown;
  /**
   * Awaited submit handler — runs once the schema passes. Awaiting it keeps
   * TanStack's `isSubmitting` true for the whole save (drives the Save spinner).
   */
  onSubmit?: (_values: T) => unknown | Promise<unknown>;
}

/**
 * Create a TanStack form pre-wired exactly like <OForm> does internally:
 * submit-then-change timing (revalidateLogic) + single onDynamic schema source +
 * awaited onSubmit. Pass the result to <OForm :form="form">; the owner can then
 * read it with `form.useStore(selector)` and write it with
 * `form.setFieldValue(...)` — a single source of truth, no mirror.
 */
export function useOForm<T extends Record<string, unknown>>(
  options: UseOFormOptions<T>,
) {
  return useForm({
    // Pass defaultValues unwidened so the form generic `T` flows into useForm and
    // the array-field helpers (pushFieldValue/removeFieldValue) resolve real
    // array paths instead of `never`. Components doing dynamic string field access
    // cast the path to `FormFieldPath<T>` (see useOForm exports below).
    defaultValues: options.defaultValues,
    // When a schema is supplied, validation TIMING is submit-then-change: nothing
    // runs until the first submit, then it re-validates on every change. The
    // schema lives in the single `onDynamic` source TanStack runs.
    ...(options.schema
      ? {
          validationLogic: revalidateLogic({
            mode: "submit",
            modeAfterSubmission: "change",
          }),
          validators: {
            onDynamic: options.schema as any,
            onDynamicAsync: options.schema as any,
          },
        }
      : {}),
    // AWAIT the consumer handler so `isSubmitting` spans the whole save.
    onSubmit: async ({ value }) => {
      await options.onSubmit?.(value as T);
    },
  });
}

/** The form instance returned by useOForm — accepted by <OForm :form>. */
export type OFormInstance = ReturnType<typeof useOForm<any>>;
