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
    <span
      v-for="(type, index) in frustrationTypes"
      :key="index"
      class="frustration-event-badge"
      :class="`frustration-badge-${getBadgeStyleClass(type)}`"
      :data-test="`frustration-event-badge-${type}`"
      :title="getTooltipText(type)"
    >{{ getBadgeLabel(type) }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  frustrationTypes: string[];
}

const props = defineProps<Props>();

const frustrationConfig: Record<
  string,
  { label: string; styleClass: string; tooltip: string }
> = {
  rage_click: {
    label: "Rage Click",
    styleClass: "rage",
    tooltip:
      "User clicked rapidly multiple times (3+) - indicating frustration",
  },
  dead_click: {
    label: "Dead Click",
    styleClass: "dead",
    tooltip: "Click produced no response - element may be broken or misleading",
  },
  error_click: {
    label: "Error Click",
    styleClass: "error",
    tooltip: "Click triggered a JavaScript error",
  },
  rage_tap: {
    label: "Rage Tap",
    styleClass: "rage",
    tooltip: "User tapped rapidly multiple times (3+) - indicating frustration",
  },
  error_tap: {
    label: "Error Tap",
    styleClass: "error",
    tooltip: "Tap triggered a JavaScript error",
  },
};

const getBadgeLabel = (type: string) => {
  return frustrationConfig[type]?.label || type;
};

const getBadgeStyleClass = (type: string): string => {
  return frustrationConfig[type]?.styleClass || "default";
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
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.625rem;
  font-weight: 600;
}

.frustration-badge-rage {
  background-color: rgb(254, 215, 170);
  color: rgb(124, 45, 18);
}

.frustration-badge-dead {
  background-color: rgb(229, 231, 235);
  color: rgb(55, 65, 81);
}

.frustration-badge-error {
  background-color: rgb(254, 202, 202);
  color: rgb(153, 27, 27);
}

.frustration-badge-default {
  background-color: rgb(229, 231, 235);
  color: rgb(55, 65, 81);
}
</style>
