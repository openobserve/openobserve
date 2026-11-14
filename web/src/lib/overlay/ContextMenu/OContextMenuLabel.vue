<script setup lang="ts">
import type { ContextMenuLabelSlots } from "./OContextMenuLabel.types";
import { ContextMenuLabel } from "reka-ui";

defineSlots<ContextMenuLabelSlots>();
</script>

<template>
  <ContextMenuLabel
    class="text-text-muted text-2xs truncate px-2 pt-1.5 pb-0.5 font-medium select-none"
  >
    <slot />
  </ContextMenuLabel>
</template>
