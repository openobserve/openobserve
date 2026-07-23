<script setup lang="ts">
import type { ContextMenuLabelSlots } from "./OContextMenuLabel.types";
import { ContextMenuLabel } from "reka-ui";

defineSlots<ContextMenuLabelSlots>();
</script>

<template>
  <ContextMenuLabel
    class="text-dropdown-label truncate px-3 py-1.5 text-xs font-medium select-none"
  >
    <slot />
  </ContextMenuLabel>
</template>
