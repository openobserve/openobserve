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
    <OBadge
      v-if="count > 0"
      :variant="badgeVariant"
      class="frustration-badge"
      :title="tooltipText"
      :data-test="`frustration-badge-${severity}`"
    >
      {{ count }}
      <q-tooltip
        anchor="top middle"
        self="bottom middle"
        :offset="[0, 8]"
        class="bg-grey-8"
        data-test="frustration-badge-tooltip"
      >
        {{ tooltipText }}
      </q-tooltip>
    </OBadge>
    <span v-else class="text-grey-6" data-test="frustration-badge-none">—</span>
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

const badgeVariant = computed<BadgeVariant>(() => {
  switch (severity.value) {
    case "low": return "warning";
    case "medium": return "warning";
    case "high": return "error";
    default: return "default";
  }
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
  min-width: 2rem;
  text-align: center;
}
</style>