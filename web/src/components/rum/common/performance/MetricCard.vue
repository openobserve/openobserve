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
    class="tw:p-3 tw:rounded tw:border tw:border-solid tw:border-[var(--o2-border-color)]"
    :class="statusClass"
    :data-test="dataTest"
  >
    <div class="tw:flex tw:items-start tw:justify-between tw:mb-1">
      <div class="tw:flex tw:items-center tw:gap-2">
        <q-icon
          v-if="icon"
          :name="icon"
          size="1rem"
          :color="statusColor"
        />
        <span class="tw:text-xs tw:font-medium tw:text-[var(--o2-text-secondary)]">
          {{ label }}
        </span>
      </div>
      <q-icon
        v-if="status"
        :name="statusIcon"
        size="0.875rem"
        :color="statusColor"
      />
    </div>

    <div class="tw:flex tw:items-baseline tw:gap-2">
      <span class="tw:text-2xl tw:font-bold">
        {{ formattedValue }}
      </span>
      <span v-if="displayUnit" class="tw:text-xs tw:text-[var(--o2-text-secondary)]">
        {{ displayUnit }}
      </span>
    </div>

    <div v-if="description" class="tw:mt-2 tw:text-[10px] tw:text-[var(--o2-text-secondary)]">
      {{ description }}
    </div>

    <div v-if="threshold" class="tw:mt-2">
      <div class="tw:flex tw:justify-between tw:text-[10px] tw:mb-1">
        <span class="tw:text-[var(--o2-text-secondary)]">Threshold</span>
        <span class="tw:font-medium">{{ threshold }}</span>
      </div>
      <q-linear-progress
        :value="progressValue"
        :color="statusColor"
        size="4px"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useEventFormatters } from "@/composables/useEventFormatters";

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
    return props.value.toLocaleString();
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
    good: "tw:bg-green-50 dark:tw:bg-green-900/10",
    "needs-improvement": "tw:bg-yellow-50 dark:tw:bg-yellow-900/10",
    poor: "tw:bg-red-50 dark:tw:bg-red-900/10",
  };

  return classes[props.status] || "";
});

const statusIcon = computed(() => {
  if (!props.status) return "";

  const icons = {
    good: "check_circle",
    "needs-improvement": "warning",
    poor: "error",
  };

  return icons[props.status] || "";
});

const statusColor = computed(() => {
  if (!props.status) return "grey";

  const colors = {
    good: "positive",
    "needs-improvement": "warning",
    poor: "negative",
  };

  return colors[props.status] || "grey";
});

const progressValue = computed(() => {
  if (props.value == null || !props.maxValue) return 0;
  return Math.min((props.value / props.maxValue) * 1, 1);
});
</script>
