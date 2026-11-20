<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
// A subgrid row, so the dt and dd of one pair always share a row of the list's columns.

import { computed, inject } from "vue";
import { raw } from "@/types/i18n";
import OCopyButton from "@/lib/core/CopyButton/OCopyButton.vue";
import {
  DESCRIPTION_CONTEXT,
  type DescriptionItemProps,
  type DescriptionItemSlots,
} from "./ODescriptionList.types";

const props = withDefaults(defineProps<DescriptionItemProps>(), {
  value: undefined,
  emptyLabel: undefined,
  mono: false,
  copy: false,
});

defineSlots<DescriptionItemSlots>();

const context = inject(DESCRIPTION_CONTEXT, null);

const monoList = computed(() => context?.value.labels === "mono");
// A slot that renders nothing falls back to the value, then to the empty label (C4).
const valueEmpty = computed(
  () => props.value === null || props.value === undefined || props.value === "",
);
const shownEmpty = computed(() => props.emptyLabel ?? context?.value.emptyLabel ?? raw("—"));
const copyText = computed(() =>
  props.value === null || props.value === undefined ? "" : String(props.value),
);

const labelClass = computed(() =>
  monoList.value ? "text-text-muted font-mono text-xs" : "text-text-secondary text-compact",
);
const valueClass = computed(() =>
  monoList.value || props.mono ? "font-mono text-xs" : "text-compact",
);
</script>

<template>
  <div
    class="col-span-full grid grid-cols-subgrid items-baseline gap-y-0.5"
    data-test="o2-description-item"
  >
    <dt :class="['min-w-0', labelClass]">
      <slot name="label">{{ label }}</slot>
    </dt>
    <dd
      :class="[
        'group text-text-heading m-0 flex min-w-0 items-center gap-1 wrap-anywhere',
        valueClass,
      ]"
    >
      <slot>
        <span v-if="valueEmpty" class="text-text-muted" data-test="o2-description-empty">{{
          shownEmpty
        }}</span>
        <template v-else>{{ raw(String(value)) }}</template>
      </slot>
      <OCopyButton
        v-if="copy && copyText"
        :value="copyText"
        size="xs"
        class="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"
        data-test="o2-description-copy"
      />
    </dd>
  </div>
</template>
