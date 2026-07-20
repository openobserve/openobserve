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
      class="px-3 py-1 text-xs font-semibold text-select-group-label select-none"
    >
      {{ label }}
    </SelectLabel>
    <slot />
  </SelectGroup>
</template>
