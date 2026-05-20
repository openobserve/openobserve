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
  <div class="tw:inline-flex tw:items-center tw:justify-center" data-test="frustration-badge-container">
    <OBadge
      v-if="count > 0"
      :variant="severityVariant"
      size="sm"
      :data-test="`frustration-badge-${severity}`"
      :title="tooltipText"
      data-test-tooltip="frustration-badge-tooltip"
    >{{ count }}</OBadge>
    <span v-else class="tw:text-gray-400" data-test="frustration-badge-none">—</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

interface Props {
  count: number;
}

const props = defineProps<Props>();

// Severity levels:
// 1-3: Low friction — minor UX issues
// 4-7: Medium — concerning pattern, needs investigation
// 8+:  High — critical, immediate attention required
const SEVERITY_THRESHOLDS = {
  LOW: 3,
  MEDIUM: 7,
} as const;

const severity = computed(() => {
  if (props.count === 0) return "none";
  if (props.count <= SEVERITY_THRESHOLDS.LOW) return "low";
  if (props.count <= SEVERITY_THRESHOLDS.MEDIUM) return "medium";
  return "high";
});

const severityVariant = computed((): BadgeVariant => {
  switch (severity.value) {
    case "low":    return "warning-soft";
    case "medium": return "warning";
    case "high":   return "error-soft";
    default:       return "default";
  }
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
