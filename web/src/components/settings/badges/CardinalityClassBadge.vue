<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <OBadge :variant="variant" :size="size" v-bind="$attrs" :data-test="dataTest">
    <slot>{{ cardinalityClass }}</slot>
  </OBadge>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant, BadgeSize } from "@/lib/core/Badge/OBadge.types";

const props = withDefaults(defineProps<{
  cardinalityClass: string;
  outline?: boolean;
  size?: BadgeSize;
  dataTest?: string;
}>(), {
  outline: false,
  size: "sm",
  dataTest: "cardinality-class-badge",
});

const baseVariant = computed((): BadgeVariant => {
  const map: Record<string, BadgeVariant> = {
    VeryLow: "success",
    Low: "success",
    Medium: "warning",
    High: "error",
    VeryHigh: "error",
  };
  return map[props.cardinalityClass] ?? "default";
});

const variant = computed((): BadgeVariant => {
  if (!props.outline) return baseVariant.value;
  return `${baseVariant.value}-outline` as BadgeVariant;
});
</script>
