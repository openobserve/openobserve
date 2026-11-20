<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OSecretCell — a credential that stays masked until revealed. The real value is
// never rendered while masked, so it is not in the DOM; Copy uses the prop value.
//
//   <OSecretCell :value="row.token" mask="Basic ••••••••" />

import { computed, ref } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    value: unknown;
    /** What shows while masked; it must not contain any part of the secret. */
    mask?: string;
    emptyLabel?: I18nText;
  }>(),
  { mask: "••••••••", emptyLabel: raw("—") },
);

const text = computed(() => {
  const v = props.value;
  if (v === null || v === undefined || v === "") return null;
  return String(v);
});

const { t } = useI18nTyped();
const revealed = ref(false);
const copied = ref(false);

async function handleCopy(e: MouseEvent) {
  e.stopPropagation();
  if (text.value === null) return;
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch {
    /* clipboard unavailable: no-op */
  }
}

function toggleReveal(e: MouseEvent) {
  e.stopPropagation();
  revealed.value = !revealed.value;
}

const actionClass =
  "text-text-body focus-visible:ring-accent shrink-0 cursor-pointer rounded-chip leading-none opacity-0 transition-opacity outline-none focus-visible:opacity-100 focus-visible:ring-2 group-hover/secret:opacity-60 group-focus-within/secret:opacity-60 hover:opacity-100! max-md:opacity-60";
</script>

<template>
  <span v-if="text === null" class="text-text-muted text-xs">{{ emptyLabel }}</span>
  <span
    v-else
    class="group/secret inline-flex max-w-full min-w-0 items-center gap-1"
    data-test="o-secret-cell"
  >
    <OTruncatedText class="font-mono text-xs" :tooltip="false">{{
      revealed ? text : mask
    }}</OTruncatedText>
    <button
      type="button"
      :class="actionClass"
      :title="revealed ? t('common.hide') : t('common.reveal')"
      :aria-label="revealed ? t('common.hide') : t('common.reveal')"
      :aria-pressed="revealed"
      data-test="o-secret-cell-reveal"
      @click="toggleReveal"
    >
      <OIcon :name="revealed ? 'visibility-off' : 'visibility'" size="xs" />
    </button>
    <button
      type="button"
      :class="actionClass"
      :title="copied ? t('common.copiedExclaim') : t('common.copy')"
      :aria-label="t('common.copy')"
      data-test="o-secret-cell-copy"
      @click="handleCopy"
    >
      <OIcon :name="copied ? 'check' : 'content-copy'" size="xs" />
    </button>
  </span>
</template>
