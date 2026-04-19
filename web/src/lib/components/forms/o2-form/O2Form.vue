// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Form — validation context provider replacing q-form.
 *
 * Provides an 'o2-form' inject key so child O2Input / O2Select / O2Field
 * components can register their validate() functions. Calling form.validate()
 * triggers all registered validators and returns a boolean.
 *
 * Props mirror Quasar q-form for drop-in replacement.
 */

import { provide, ref } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2FormProps {
  /** Validate all fields even after first failure (collect all errors) */
  greedy?: boolean;
  /** Do not focus the first invalid field after failed validation */
  noErrorFocus?: boolean;
}

const props = withDefaults(defineProps<O2FormProps>(), {
  greedy: false,
  noErrorFocus: false,
});

const emit = defineEmits<{
  submit: [event: SubmitEvent];
  "validation-error": [failedValidators: Array<() => boolean>];
}>();

// ─── Validator registry ───────────────────────────────────────────────────────

type ValidatorFn = () => boolean;

const validators = ref<ValidatorFn[]>([]);

const register = (fn: ValidatorFn) => {
  if (!validators.value.includes(fn)) {
    validators.value.push(fn);
  }
};

const unregister = (fn: ValidatorFn) => {
  const idx = validators.value.indexOf(fn);
  if (idx !== -1) validators.value.splice(idx, 1);
};

// ─── Provide context to child fields ─────────────────────────────────────────

provide("o2-form", { register, unregister });

// ─── Validation ───────────────────────────────────────────────────────────────

const validate = (): boolean => {
  const failed: ValidatorFn[] = [];

  if (props.greedy) {
    // Run all validators; collect failures
    for (const fn of validators.value) {
      const ok = fn();
      if (!ok) failed.push(fn);
    }
  } else {
    // Stop at first failure
    for (const fn of validators.value) {
      const ok = fn();
      if (!ok) {
        failed.push(fn);
        break;
      }
    }
  }

  if (failed.length) {
    emit("validation-error", failed);
    return false;
  }
  return true;
};

const resetValidation = (): void => {
  // No-op at form level — each field manages its own reset.
  // Consumers can call resetValidation() on individual field refs if needed.
};

defineExpose({ validate, resetValidation });

// ─── Submit handler ───────────────────────────────────────────────────────────

const handleSubmit = (event: SubmitEvent) => {
  const ok = validate();
  if (ok) {
    emit("submit", event);
  }
};
</script>

<template>
  <form v-bind="$attrs" @submit.prevent="handleSubmit">
    <slot />
  </form>
</template>
