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
  <span
    class="frustration-event-badge-wrapper"
    data-test="frustration-event-badge-wrapper"
  >
    <OBadge
      v-for="(type, index) in frustrationTypes"
      :key="index"
      :variant="getBadgeVariant(type)"
      class="frustration-event-badge"
      :data-test="`frustration-event-badge-${type}`"
    >
      {{ getBadgeLabel(type) }}
      <OTooltip
        side="top"
        align="center"
        :sideOffset="8"
        :content="getTooltipText(type)"
        data-test="frustration-event-badge-tooltip"
      />
    </OBadge>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

interface Props {
  frustrationTypes: string[];
}

const props = defineProps<Props>();

const frustrationConfig: Record<
  string,
  { label: string; variant: BadgeVariant; tooltip: string; icon?: string }
> = {
  rage_click: {
    label: "Rage Click",
    variant: "warning",
    tooltip:
      "User clicked rapidly multiple times (3+) - indicating frustration",
  },
  dead_click: {
    label: "Dead Click",
    variant: "warning",
    tooltip: "Click produced no response - element may be broken or misleading",
  },
  error_click: {
    label: "Error Click",
    variant: "error",
    tooltip: "Click triggered a JavaScript error",
  },
  rage_tap: {
    label: "Rage Tap",
    variant: "warning",
    tooltip: "User tapped rapidly multiple times (3+) - indicating frustration",
  },
  error_tap: {
    label: "Error Tap",
    variant: "error",
    tooltip: "Tap triggered a JavaScript error",
  },
};

const getBadgeLabel = (type: string) => {
  return frustrationConfig[type]?.label || type;
};

const getBadgeVariant = (type: string): BadgeVariant => {
  return frustrationConfig[type]?.variant || "default";
};

const getTooltipText = (type: string) => {
  return frustrationConfig[type]?.tooltip || `Frustration signal: ${type}`;
};
</script>

<style scoped lang="scss">
.frustration-event-badge-wrapper {
  display: inline-flex;
  gap: 0.25rem;
  align-items: center;
}

.frustration-event-badge {
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
</style>
