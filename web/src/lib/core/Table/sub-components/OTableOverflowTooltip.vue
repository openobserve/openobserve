<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { shallowRef, watch } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";
import type { OTableOverflowTooltipState } from "../OTable.types";

const props = defineProps<{
  state: OTableOverflowTooltipState;
}>();

// A null anchor during the exit animation parks the bubble at the viewport's top-left.
const lastAnchor = shallowRef<HTMLElement | null>(null);
watch(
  () => props.state.anchor.value,
  (el) => {
    if (el) lastAnchor.value = el;
  },
  { immediate: true, flush: "sync" },
);
</script>

<template>
  <OTooltip
    :anchor="lastAnchor"
    :side="state.side.value"
    :open="!!state.anchor.value"
    :content="raw(state.text.value)"
    @update:open="state.onOpenChange"
  />
</template>
