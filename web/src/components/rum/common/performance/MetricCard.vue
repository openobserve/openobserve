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
  <div
    class="p-3 rounded border border-solid border-[var(--o2-border-color)]"
    :class="statusClass"
    :data-test="dataTest"
  >
    <div class="flex items-start justify-between mb-1">
      <div class="flex items-center gap-2">
        <OIcon
          v-if="icon"
          :name="icon"
          size="sm"
          :class="statusColorClass"
        />
        <span class="text-xs font-medium text-[var(--o2-text-secondary)]">
          {{ label }}
        </span>
      </div>
      <OIcon
        v-if="status"
        :name="statusIcon"
        size="sm"
        :class="statusColorClass"
      />
    </div>

    <div class="flex items-baseline gap-2">
      <span class="text-2xl font-bold">
        {{ formattedValue }}
      </span>
      <span v-if="displayUnit" class="text-xs text-[var(--o2-text-secondary)]">
        {{ displayUnit }}
      </span>
    </div>

    <div v-if="description" class="mt-2 text-[10px] text-[var(--o2-text-secondary)]">
      {{ description }}
    </div>

    <div v-if="threshold" class="mt-2">
      <div class="flex justify-between text-[10px] mb-1">
        <span class="text-[var(--o2-text-secondary)]">Threshold</span>
        <span class="font-medium">{{ threshold }}</span>
      </div>
      <OProgressBar
        :value="progressValue"
        :variant="progressVariant"
        size="xs"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useEventFormatters } from "@/composables/useEventFormatters";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
interface Props {
  label: string;
  value: number | null | undefined;
  unit?: string;
  icon?: string;
  status?: "good" | "needs-improvement" | "poor" | null;
  threshold?: string;
  maxValue?: number;
  description?: string;
  dataTest?: string;
}

const props = withDefaults(defineProps<Props>(), {
  unit: "",
  icon: "",
  status: null,
  threshold: "",
  maxValue: 100,
  description: "",
  dataTest: "",
});

const { formatResourceDuration } = useEventFormatters();

const formattedValue = computed(() => {
  if (props.value == null) return "N/A";

  // Auto-format duration values
  if (props.unit === "ns") {
    // Convert nanoseconds to milliseconds for formatting
    const ms = props.value / 1000000;
    return formatResourceDuration(ms * 1000, false);
  }

  if (props.unit === "ms" || props.unit === "s") {
    return formatResourceDuration(props.value, false);
  }

  // Format numbers with commas
  if (typeof props.value === "number") {
    return props.value.toLocaleString("en-US");
  }

  return String(props.value);
});

const displayUnit = computed(() => {
  // Don't show unit for auto-formatted duration values
  if (props.unit === "ns" || props.unit === "ms" || props.unit === "s") {
    return "";
  }
  return props.unit;
});

const statusClass = computed(() => {
  if (!props.status) return "";

  const classes = {
    good: "bg-green-50 dark:bg-green-900/10",
    "needs-improvement": "bg-yellow-50 dark:bg-yellow-900/10",
    poor: "bg-red-50 dark:bg-red-900/10",
  };

  return classes[props.status] || "";
});

const statusIcon = computed(() => {
  if (!props.status) return "";

  const icons = {
    good: "check-circle",
    "needs-improvement": "warning",
    poor: "error",
  };

  return icons[props.status] || "";
});

const statusColorClass = computed(() => {
  if (!props.status) return "text-gray-500";

  const classes = {
    good: "text-[var(--o2-positive)]",
    "needs-improvement": "text-[var(--o2-warning)]",
    poor: "text-[var(--o2-negative)]",
  };

  return classes[props.status] || "text-gray-500";
});

const progressValue = computed(() => {
  if (props.value == null || !props.maxValue) return 0;
  return Math.min((props.value / props.maxValue) * 1, 1);
});
const progressVariant = computed(() => {
  if (!props.status) return "default";
  const map: Record<string, string> = {
    good: "default",
    "needs-improvement": "warning",
    poor: "danger",
  };
  return map[props.status] || "default";
});
</script>
