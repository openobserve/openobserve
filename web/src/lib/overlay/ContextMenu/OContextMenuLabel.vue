<script setup lang="ts">
import type { ContextMenuLabelSlots } from "./OContextMenuLabel.types";
import { ContextMenuLabel } from "reka-ui";
import { MENU_LABEL_CLASS } from "../menuClasses";

defineSlots<ContextMenuLabelSlots>();
</script>

<template>
  <ContextMenuLabel :class="['truncate', MENU_LABEL_CLASS]">
    <slot />
  </ContextMenuLabel>
</template>
