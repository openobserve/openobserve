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
  <div class="frustration-badge-container" data-test="frustration-badge-container">
    <q-badge
      v-if="count > 0"
      :class="badgeClass"
      :label="count"
      class="frustration-badge"
      :title="tooltipText"
      :data-test="`frustration-badge-${severity}`"
    >
      <q-tooltip
        anchor="top middle"
        self="bottom middle"
        :offset="[0, 8]"
        class="bg-grey-8"
        data-test="frustration-badge-tooltip"
      >
        {{ tooltipText }}
      </q-tooltip>
    </q-badge>
    <span v-else class="text-grey-6" data-test="frustration-badge-none">—</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  count: number;
}

const props = defineProps<Props>();


// Standard Severity levels
// 0: None (green)
// 1-3: Low (yellow/warning)
// 4-7: Medium (orange/concerning)
// 8+: High (red/critical)
const SEVERITY_THRESHOLDS = {
  LOW: 3, // 1-3: Normal friction - minor UX issues
  MEDIUM: 7, // 4-7: Concerning pattern - needs investigation
  // 8+: Critical - immediate attention required
} as const;

const severity = computed(() => {
  if (props.count === 0) return "none";
  if (props.count <= SEVERITY_THRESHOLDS.LOW) return "low";
  if (props.count <= SEVERITY_THRESHOLDS.MEDIUM) return "medium";
  return "high";
});

const badgeClass = computed(() => {
  return `frustration-badge-${severity.value}`;
});

const tooltipText = computed(() => {
  if (props.count === 0) return "No frustration signals detected";
  if (props.count === 1) return "1 frustration signal detected";

  const severityLabel = {
    low: "Low severity",
    medium: "Medium severity",
    high: "High severity - requires attention",
  }[severity.value];

  return `${props.count} frustration signals (${severityLabel})`;
});
</script>

<style scoped lang="scss">
.frustration-badge-container {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.frustration-badge {
  font-weight: 600;
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  min-width: 2rem;
  text-align: center;
}

.frustration-badge-low {
  background-color: #fef3c7 !important;
  color: #92400e !important;
  border: 1px solid #fbbf24;
}

.frustration-badge-medium {
  background-color: #fed7aa !important;
  color: #7c2d12 !important;
  border: 1px solid #fb923c;
}

.frustration-badge-high {
  background-color: #fecaca !important;
  color: #7f1d1d !important;
  border: 1px solid #ef4444;
  animation: pulse-red 2s infinite;
}

@keyframes pulse-red {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}
</style>