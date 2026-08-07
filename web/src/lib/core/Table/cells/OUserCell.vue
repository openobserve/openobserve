<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OUserCell — person column (owner / author / created-by / user). For now it
// renders the identity as PLAIN text (the real email or name, truncated, full
// on hover). The avatar/richer treatment was removed on request — this is the
// single place to enhance later, and every person column will upgrade at once.

import { computed } from "vue";

import { raw, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Raw identity — an email address or a display name. */
    value: unknown;
    /** Explicit display name. When set it's shown instead of the email. */
    name?: string;
    emptyLabel?: I18nText;
  }>(),
  { emptyLabel: raw("—") },
);

// Named `identity` (not `raw`) so it doesn't shadow the `raw()` i18n helper.
const identity = computed(() => String(props.value ?? "").trim());
const isEmpty = computed(() => identity.value === "");
const displayText = computed(() =>
  props.name && props.name.trim() ? props.name.trim() : identity.value,
);
</script>

<template>
  <span v-if="isEmpty" class="text-text-body">{{ emptyLabel }}</span>
  <span v-else class="text-text-body whitespace-nowrap" :title="identity">{{ displayText }}</span>
</template>
