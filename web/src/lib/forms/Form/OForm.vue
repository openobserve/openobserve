<script setup lang="ts" generic="T extends Record<string, unknown>">
// Copyright 2026 OpenObserve Inc.

import { provide } from "vue";
import { useForm } from "@tanstack/vue-form";
import { FORM_CONTEXT_KEY } from "./OForm.types";

const props = defineProps<{
  defaultValues: T;
}>();

const emit = defineEmits<{
  submit: [values: T];
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
</script>

<template>
  <form @submit="handleSubmit">
    <slot />
  </form>
</template>
