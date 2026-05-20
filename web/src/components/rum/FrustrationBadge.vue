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
  <div class="frustration-badge-container" data-test="frustration-badge-container">
    <span
      v-if="count > 0"
      class="frustration-badge"
      :class="`frustration-badge-${severity}`"
      :data-test="`frustration-badge-${severity}`"
      :title="tooltipText"
      data-test-tooltip="frustration-badge-tooltip"
    >{{ count }}</span>
    <span v-else class="tw:text-gray-400" data-test="frustration-badge-none">—</span>
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

const tooltipText = computed(() => {
  if (props.count === 0) return "No frustration signals detected";
  if (props.count === 1) return "1 frustration signal detected";

  const severityLabel = {
    low: "Low severity",
    medium: "Medium severity",
    high: "High severity - requires attention",
  }[severity.value as "low" | "medium" | "high"];

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
  min-width: 2rem;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.frustration-badge-low {
  background-color: rgb(253, 224, 132);
  color: rgb(113, 63, 18);
}

.frustration-badge-medium {
  background-color: rgb(254, 215, 170);
  color: rgb(124, 45, 18);
}

.frustration-badge-high {
  background-color: rgb(254, 202, 202);
  color: rgb(153, 27, 27);
}
</style>
