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
      class="tw:px-3 tw:py-1 tw:text-xs tw:font-semibold tw:text-select-group-label tw:select-none"
    >
      {{ label }}
    </SelectLabel>
    <slot />
  </SelectGroup>
</template>
