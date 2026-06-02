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
    {{ label }}
  </OBadge>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import { getObservationTypeColor } from "@/utils/llmUtils";
import type { BadgeVariant, BadgeSize } from "@/lib/core/Badge/OBadge.types";

const props = withDefaults(defineProps<{
  operationName: string | null | undefined;
  size?: BadgeSize;
  dataTest?: string;
}>(), {
  size: "sm",
  dataTest: "observation-type-badge",
});

const colorToVariantMap: Record<string, BadgeVariant> = {
  green: "success",
  blue: "primary",
  purple: "primary",
  orange: "warning",
  indigo: "primary",
  cyan: "primary",
  teal: "primary",
  pink: "primary",
  "deep-purple": "primary",
  "light-blue": "primary",
  red: "error",
  grey: "default",
  amber: "warning",
};

const variant = computed((): BadgeVariant => {
  const color = getObservationTypeColor(props.operationName);
  return colorToVariantMap[color] ?? "default";
});

const label = computed(() => {
  if (!props.operationName) return "";
  return props.operationName.charAt(0) + props.operationName.slice(1).toLowerCase();
});
</script>
