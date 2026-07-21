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
    class="py-2 px-4 border-b border-solid border-card-glass-border"
  >
    <div class="flex items-center gap-3 flex-wrap">
      <span class="text-xs font-semibold opacity-70">
        {{ filterLabelComputed }}:
      </span>
      <div
        v-for="(value, key) in dimensions"
        :key="key"
        class="flex items-center gap-2"
      >
        <span
          class="text-xs font-semibold"
          :class="
            unstableDimensionKeys.has(key) ? 'opacity-60' : 'opacity-100'
          "
        >
          {{ key }}:
        </span>
        <OSelect
          :model-value="value"
          :options="getDimensionOptions(key, value)"
          labelKey="label"
          valueKey="value"
          @update:model-value="(newValue) => handleDimensionChange(key, newValue)"
          class="dimension-dropdown"
          style="min-width: 120px"
          :data-test="`dimension-filter-${key}`"
        />
        <OTooltip v-if="unstableDimensionKeys.has(key)" :content="unstableDimensionTooltipComputed" side="top" />
      </div>
      <!-- Apply Button -->
      <OButton
        v-if="showApplyButton"
        variant="outline"
        size="sm-action"
        :disabled="!hasPendingChanges"
        @click="handleApply"
        class="ml-2"
        data-test="apply-dimension-filters"
      >
        {{ applyLabelComputed }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

interface Props {
  dimensions: Record<string, string>;
  unstableDimensionKeys: Set<string>;
  getDimensionOptions: (
    key: string,
    value: string,
  ) => Array<{ label: string; value: string }>;
  hasPendingChanges?: boolean;
  showApplyButton?: boolean;
  filterLabel?: string;
  applyLabel?: string;
  unstableDimensionTooltip?: string;
}

// Props
const props = withDefaults(defineProps<Props>(), {
  hasPendingChanges: false,
  showApplyButton: true,
  filterLabel: undefined,
  applyLabel: undefined,
  unstableDimensionTooltip: undefined,
});

// Emits
const emit = defineEmits<{
  "update:dimension": [payload: { key: string; value: string }];
  apply: [];
}>();

// Composables
const { t } = useI18n();

// Computed labels with fallbacks
const filterLabelComputed = computed(
  () => props.filterLabel || t("correlation.filters"),
);
const applyLabelComputed = computed(
  () => props.applyLabel || t("common.apply"),
);
const unstableDimensionTooltipComputed = computed(
  () =>
    props.unstableDimensionTooltip || t("correlation.unstableDimensionTooltip"),
);

/**
 * Handle dimension value change
 */
const handleDimensionChange = (key: string, value: string) => {
  emit("update:dimension", { key, value });
};

/**
 * Handle apply button click
 */
const handleApply = () => {
  emit("apply");
};
</script>

