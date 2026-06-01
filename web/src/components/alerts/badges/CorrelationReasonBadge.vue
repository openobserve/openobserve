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
    <OTooltip v-if="tooltip" :content="tooltip" side="top" />
  </OBadge>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { BadgeVariant, BadgeSize } from "@/lib/core/Badge/OBadge.types";

const props = withDefaults(defineProps<{
  reason: string;
  size?: BadgeSize;
  dataTest?: string;
}>(), {
  size: "sm",
  dataTest: "correlation-reason-badge",
});

const LABEL_MAP: Record<string, string> = {
  service_discovery: "Service Discovery",
  primary_match: "Primary Match",
  secondary_match: "Secondary Match",
  alert_id: "Alert ID",
};

const TOOLTIP_MAP: Record<string, string> = {
  service_discovery: "Alert grouped by shared service labels detected via service discovery",
  primary_match: "Alert matched the primary correlation rule for this incident",
  secondary_match: "Alert matched a secondary correlation rule for this incident",
  alert_id: "Alert was correlated by explicit alert ID reference",
};

const variant = computed((): BadgeVariant => {
  switch (props.reason) {
    case "service_discovery":
    case "primary_match":
      return "primary-outline";
    case "secondary_match":
      return "warning-outline";
    case "alert_id":
      return "default-outline";
    default:
      return "default-outline";
  }
});

const label = computed(() => LABEL_MAP[props.reason] ?? props.reason);

const tooltip = computed(() => TOOLTIP_MAP[props.reason] ?? "");
</script>
