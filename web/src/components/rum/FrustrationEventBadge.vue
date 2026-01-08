<!-- Copyright 2023 OpenObserve Inc.

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
    <q-badge
      v-for="(type, index) in frustrationTypes"
      :key="index"
      :class="getBadgeClass(type)"
      :label="getBadgeLabel(type)"
      class="frustration-event-badge"
      :data-test="`frustration-event-badge-${type}`"
    >
      <q-tooltip
        anchor="top middle"
        self="bottom middle"
        :offset="[0, 8]"
        class="bg-grey-8"
        data-test="frustration-event-badge-tooltip"
      >
        {{ getTooltipText(type) }}
      </q-tooltip>
    </q-badge>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  frustrationTypes: string[];
}

const props = defineProps<Props>();

const frustrationConfig: Record<string, { label: string; class: string; tooltip: string; icon?: string }> = {
  rage_click: {
    label: "Rage Click",
    class: "frustration-badge-rage",
    tooltip: "User clicked rapidly multiple times (3+) - indicating frustration",
  },
  dead_click: {
    label: "Dead Click",
    class: "frustration-badge-dead",
    tooltip: "Click produced no response - element may be broken or misleading",
  },
  error_click: {
    label: "Error Click",
    class: "frustration-badge-error",
    tooltip: "Click triggered a JavaScript error",
  },
  rage_tap: {
    label: "Rage Tap",
    class: "frustration-badge-rage",
    tooltip: "User tapped rapidly multiple times (3+) - indicating frustration",
  },
  error_tap: {
    label: "Error Tap",
    class: "frustration-badge-error",
    tooltip: "Tap triggered a JavaScript error",
  },
};

const getBadgeLabel = (type: string) => {
  return frustrationConfig[type]?.label || type;
};

const getBadgeClass = (type: string) => {
  return frustrationConfig[type]?.class || "frustration-badge-default";
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
  font-weight: 600;
  font-size: 0.65rem;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.frustration-badge-rage {
  background-color: #fed7aa !important;
  color: #7c2d12 !important;
  border: 1px solid #fb923c;
}

.frustration-badge-dead {
  background-color: #fef3c7 !important;
  color: #92400e !important;
  border: 1px solid #fbbf24;
}

.frustration-badge-error {
  background-color: #fecaca !important;
  color: #7f1d1d !important;
  border: 1px solid #ef4444;
}

.frustration-badge-default {
  background-color: #e5e7eb !important;
  color: #374151 !important;
  border: 1px solid #9ca3af;
}
</style>
