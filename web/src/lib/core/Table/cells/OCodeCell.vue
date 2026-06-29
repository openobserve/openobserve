<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OCodeCell — monospace rendering for identifiers / SQL / tokens with an
// optional copy-on-hover affordance (audit §3). Truncates with ellipsis and
// exposes the full value via a native title tooltip.
//
//   <OCodeCell :value="row.trace_id" />
//   <OCodeCell :value="row.query" :copy="false" />

import { computed, ref } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = withDefaults(
  defineProps<{
    value: unknown;
    /** Show the hover copy button. Default true. */
    copy?: boolean;
    emptyLabel?: string;
  }>(),
  { copy: true, emptyLabel: "—" },
);

const text = computed(() => {
  const v = props.value;
  if (v === null || v === undefined || v === "") return null;
  return String(v);
});

const copied = ref(false);
async function handleCopy(e: MouseEvent) {
  e.stopPropagation();
  if (text.value === null) return;
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch {
    /* clipboard unavailable — no-op */
  }
}
</script>

<template>
  <span
    v-if="text === null"
    class="tw:text-text-primary tw:text-xs"
  >{{ emptyLabel }}</span>
  <span
    v-else
    class="tw:group/code tw:inline-flex tw:items-center tw:gap-1 tw:min-w-0 tw:max-w-full"
  >
    <span
      class="tw:font-mono tw:text-xs tw:truncate tw:min-w-0"
      :title="text"
    >{{ text }}</span>
    <button
      v-if="copy"
      type="button"
      class="tw:shrink-0 tw:opacity-0 tw:group-hover/code:opacity-60 tw:hover:opacity-100! tw:cursor-pointer tw:text-text-primary tw:transition-opacity tw:leading-none"
      :title="copied ? 'Copied!' : 'Copy'"
      @click="handleCopy"
    >
      <OIcon :name="copied ? 'check' : 'content-copy'" size="xs" />
    </button>
  </span>
</template>
