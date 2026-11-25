<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SelectGroupProps, SelectGroupSlots } from "./OSelect.types";
import { SelectGroup, SelectLabel } from "reka-ui";

defineProps<SelectGroupProps>();

defineSlots<SelectGroupSlots>();
</script>

<template>
  <SelectGroup>
    <SelectLabel
      v-if="label"
      class="text-text-secondary px-2 pt-2 pb-1 text-xs font-medium select-none"
    >
      {{ label }}
    </SelectLabel>
    <slot />
  </SelectGroup>
</template>
