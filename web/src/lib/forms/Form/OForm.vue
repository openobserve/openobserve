<script setup lang="ts" generic="T extends Record<string, unknown>">
// Copyright 2026 OpenObserve Inc.

import { provide, inject, watch } from "vue";
import { useForm, revalidateLogic } from "@tanstack/vue-form";
import { FORM_CONTEXT_KEY, FORM_SUBMIT_STATE_KEY } from "./OForm.types";

const props = defineProps<{
  defaultValues: T;
  /**
   * Validate every field before stopping on the first error.
   * Mirrors q-form's `greedy` prop. Without this, validation short-circuits
   * on the first failed field.
   */
  greedy?: boolean;
  /**
   * Submit handler, called with the validated values once all validators pass.
   * May be async — OForm AWAITS it, so TanStack's `isSubmitting` stays true for
   * the whole save: the dialog/drawer Save button shows its spinner
   * automatically (no `useLoading` / `:primary-button-loading` needed) and
   * re-entry is guarded. Written as `@submit="handler"` in templates — Vue maps
   * the `@submit` listener onto this prop.
   */
  onSubmit?: (values: T) => unknown | Promise<unknown>;
  /**
   * Optional Zod (Standard Schema) validating the whole form. When provided,
   * it is wired into TanStack's `onDynamic` validators and TanStack routes each
   * issue to the field whose `name` matches the schema key — so individual
   * `OForm*` fields need no per-field `validators`.
   *
   * Validation TIMING is submit-then-change (revalidateLogic): nothing runs
   * until the first submit, so errors stay empty (and hidden) while typing/on
   * blur; first submit reveals all; then errors update live on each change.
   */
  schema?: unknown;
}>();

const emit = defineEmits<{
  reset: [];
}>();

const form = useForm({
  defaultValues: props.defaultValues as Record<string, unknown>,
  // When a Zod/Standard schema is supplied, drive validation TIMING with
  // TanStack's revalidateLogic: NOTHING validates until the first submit, then
  // it re-validates on every change (mode: "submit" → modeAfterSubmission:
  // "change"). The schema lives in the single `onDynamic` source it runs.
  // Field wrappers display whenever `errors.length > 0` (empty until submit). Net UX:
  //  • before the first submit → no errors while typing OR on blur;
  //  • first submit → every field's error is revealed;
  //  • after that → errors clear / re-show live on each change.
  // TanStack maps each schema issue onto the matching field by `name`.
  ...(props.schema
    ? {
        validationLogic: revalidateLogic({
          mode: "submit",
          modeAfterSubmission: "change",
        }),
        validators: {
          onDynamic: props.schema as any,
          onDynamicAsync: props.schema as any,
        },
      }
    : {}),
  // AWAIT the consumer's handler so TanStack's `isSubmitting` spans the entire
  // save (that's what drives the auto Save spinner). Errors are the consumer's
  // to surface (toast) — see handleSubmit's catch.
  onSubmit: async ({ value }) => {
    await props.onSubmit?.(value as T);
  },
});

provide(FORM_CONTEXT_KEY, form);

// TanStack owns the submission lifecycle. Because `onSubmit` above AWAITS the
// consumer handler, these stay accurate for the whole save.
const isSubmitting = form.useStore((s: any) => s.isSubmitting);
const canSubmit = form.useStore((s: any) => s.canSubmit);

// When OForm is nested in an ODialog/ODrawer, the overlay provides a ref we
// mirror `isSubmitting` into, so its footer Save button (outside the <form>,
// linked only by `form-id`) shows a spinner automatically. Optional — OForm
// works standalone, and the slot also exposes `isSubmitting` for inline buttons.
const overlaySubmitting = inject(FORM_SUBMIT_STATE_KEY, null);
if (overlaySubmitting) {
  watch(
    isSubmitting,
    (v) => {
      overlaySubmitting.value = !!v;
    },
    { immediate: true },
  );
}

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (isSubmitting.value) return; // guard double-submit (e.g. Enter while saving)
  try {
    await form.handleSubmit();
  } catch {
    // The consumer's submit handler owns error reporting (e.g. a toast).
  }
}

// ── q-form compatibility surface ──────────────────────────────────────────
// q-form exposes these methods on its ref. The 50 existing q-form refs in
// the codebase rely on them — keep names identical to avoid touching every
// call site during migration.

/**
 * All registered fields by dot-notation path.
 *
 * TanStack form keys `fieldMeta` by `DeepKeys<TFormData>` (a flat record
 * with dot-notation paths for nested values, e.g. `"user.email"`). Walking
 * `Object.keys(form.state.values)` would only enumerate top-level keys,
 * so nested fields like `user.email` would never run their validators.
 * Using `fieldMeta` reaches every registered field component.
 */
function registeredFieldPaths(): string[] {
  return Object.keys(form.state.fieldMeta ?? {});
}

/**
 * Validate every field. With `greedy`, all validators run regardless of
 * earlier failures; otherwise short-circuits on the first invalid field.
 * Returns true when every field passes.
 */
async function validate(): Promise<boolean> {
  // TanStack form's validateAllFields runs every field's validators
  // concurrently. Without `greedy`, run them sequentially and stop at the
  // first failure to match q-form semantics.
  if (props.greedy) {
    await form.validateAllFields("submit");
  } else {
    for (const name of registeredFieldPaths()) {
      await form.validateField(name, "submit");
      const err = form.getFieldMeta(name)?.errors ?? [];
      if (err.length > 0) return false;
    }
  }
  // After all validations, check the canonical isValid flag.
  return form.state.isValid;
}

/**
 * Clear validation errors on every field without resetting their values.
 * Mirrors q-form's `resetValidation()`.
 */
function resetValidation() {
  // Clear each field's errorMap so no stale message lingers (errors[] is a
  // derived view) — once cleared, the wrappers hide (errors.length === 0).
  for (const name of registeredFieldPaths()) {
    const meta = form.getFieldMeta(name);
    if (!meta) continue;
    form.setFieldMeta(name, { ...meta, errorMap: {} });
  }
}

/**
 * Programmatically trigger submission (runs validators → onSubmit).
 * Mirrors q-form's `submit()`.
 */
function submit() {
  if (isSubmitting.value) return; // guard double-submit
  form.handleSubmit();
}

/** Reset every field to its initial defaultValues and clear meta state. */
function reset() {
  form.reset();
  emit("reset");
}

defineExpose({
  validate,
  resetValidation,
  submit,
  reset,
  /** Reactive: true while the (awaited) submit handler runs. */
  isSubmitting,
  /** Reactive: TanStack's canSubmit (false while invalid/validating). */
  canSubmit,
  /** Direct access to the underlying TanStack form for advanced cases. */
  form,
});
</script>

<template>
  <form @submit="handleSubmit">
    <!-- Slot scope exposes submit state for inline (non-overlay) Save buttons:
         <OForm v-slot="{ isSubmitting }"> … <OButton :loading="isSubmitting" /> -->
    <slot :is-submitting="isSubmitting" :can-submit="canSubmit" />
  </form>
</template>
