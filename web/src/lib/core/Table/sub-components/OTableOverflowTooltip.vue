<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";
import type { OTableOverflowTooltipState } from "../OTable.types";

defineProps<{
  state: OTableOverflowTooltipState;
}>();
</script>

<template>
  <OTooltip
    :anchor="state.anchor.value"
    :side="state.side.value"
    :open="!!state.anchor.value"
    :content="raw(state.text.value)"
    @update:open="state.onOpenChange"
  />
</template>
