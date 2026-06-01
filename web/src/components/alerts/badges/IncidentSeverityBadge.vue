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
import type { BadgeVariant, BadgeSize } from "@/lib/core/Badge/OBadge.types";

const props = withDefaults(defineProps<{
  severity: string;
  size?: BadgeSize;
  dataTest?: string;
}>(), {
  size: "sm",
  dataTest: "incident-severity-badge",
});

const variant = computed((): BadgeVariant => {
  switch (props.severity?.toUpperCase()) {
    case "P1":
      return "error-soft";
    case "P2":
    case "P3":
      return "warning-soft";
    case "P4":
      return "default-soft";
    default:
      return "default-soft";
  }
});

const label = computed(() => props.severity?.toUpperCase() || "");
</script>
