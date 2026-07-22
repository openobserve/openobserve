<script setup lang="ts">
import type { ContextMenuLabelSlots } from "./OContextMenuLabel.types";
import { ContextMenuLabel } from "reka-ui";

defineSlots<ContextMenuLabelSlots>();
</script>

<template>
  <ContextMenuLabel
    class="px-3 py-1.5 text-xs font-medium text-dropdown-label select-none truncate"
  >
    <slot />
  </ContextMenuLabel>
</template>
