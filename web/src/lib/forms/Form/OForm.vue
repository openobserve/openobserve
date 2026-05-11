<script setup lang="ts" generic="T extends Record<string, unknown>">
// Copyright 2026 OpenObserve Inc.

import { provide } from "vue";
import { useForm } from "@tanstack/vue-form";
import { FORM_CONTEXT_KEY } from "./OForm.types";

const props = defineProps<{
  defaultValues: T;
  /**
   * Validate every field before stopping on the first error.
   * Mirrors q-form's `greedy` prop. Without this, validation short-circuits
   * on the first failed field.
   */
  greedy?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: T];
  reset: [];
}>();

const form = useForm({
  defaultValues: props.defaultValues as Record<string, unknown>,
  onSubmit: async ({ value }) => {
    emit("submit", value as T);
  },
});

provide(FORM_CONTEXT_KEY, form);

function handleSubmit(e: Event) {
  e.preventDefault();
  form.handleSubmit();
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
    await form.validateAllFields("change");
  } else {
    for (const name of registeredFieldPaths()) {
      await form.validateField(name, "change");
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
  // FieldMetaBase has errorMap (errors[] is a derived view) — clearing the
  // map clears the displayed errors. Also reset isTouched so child OForm*
  // components stop rendering their error <div> (they gate on isTouched).
  for (const name of registeredFieldPaths()) {
    const meta = form.getFieldMeta(name);
    if (!meta) continue;
    form.setFieldMeta(name, {
      ...meta,
      errorMap: {},
      isTouched: false,
    });
  }
}

/**
 * Programmatically trigger submission (runs validators → onSubmit).
 * Mirrors q-form's `submit()`.
 */
function submit() {
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
  /** Direct access to the underlying TanStack form for advanced cases. */
  form,
});
</script>

<template>
  <form @submit="handleSubmit">
    <slot />
  </form>
</template>
