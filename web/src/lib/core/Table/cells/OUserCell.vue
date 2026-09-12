<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OUserCell — person column (owner / author / created-by / user). For now it
// renders the identity as PLAIN text (the real email or name, truncated, full
// on hover). The avatar/richer treatment was removed on request — this is the
// single place to enhance later, and every person column will upgrade at once.

import { computed, ref } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Raw identity — an email address or a display name. */
    value: unknown;
    /** Explicit display name. When set it's shown instead of the email. */
    name?: string;
    /** Show only the local part (before "@") of an email identity. Default false. */
    localPart?: boolean;
    /** Show a hover copy button that copies the raw identity. Default false. */
    copy?: boolean;
    /** Label for the copy button's tooltip. Defaults to the generic "Copy". */
    copyLabel?: string;
    emptyLabel?: I18nText;
  }>(),
  { emptyLabel: raw("—"), localPart: false, copy: false },
);

const { t } = useI18nTyped();

// Named `identity` (not `raw`) so it doesn't shadow the `raw()` i18n helper.
const identity = computed(() => String(props.value ?? "").trim());
const isEmpty = computed(() => identity.value === "");
const displayText = computed(() => {
  if (props.name && props.name.trim()) return props.name.trim();
  if (props.localPart) {
    const at = identity.value.indexOf("@");
    const local = at > 0 ? identity.value.slice(0, at) : null;
    if (local) {
      return local
        .split(/[._-]+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
    }
  }
  return identity.value;
});

const copied = ref(false);
async function handleCopy(e: MouseEvent) {
  e.stopPropagation();
  if (isEmpty.value) return;
  try {
    await navigator.clipboard.writeText(identity.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch {
    /* clipboard unavailable — no-op */
  }
}
</script>

<template>
  <span v-if="isEmpty" class="text-text-body">{{ emptyLabel }}</span>
  <span v-else class="group/user inline-flex items-center gap-1">
    <span class="text-text-body whitespace-nowrap" :title="identity">{{ displayText }}</span>
    <button
      v-if="copy"
      type="button"
      class="text-text-body shrink-0 cursor-pointer leading-none opacity-0 transition-opacity group-hover/user:opacity-60 hover:opacity-100!"
      :title="copied ? t('common.copiedExclaim') : copyLabel || t('common.copy')"
      @click="handleCopy"
    >
      <OIcon :name="copied ? 'check' : 'content-copy'" size="xs" />
    </button>
  </span>
</template>
