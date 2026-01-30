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
    class="tw:py-2 tw:px-4 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]"
  >
    <div class="tw:flex tw:items-center tw:gap-3 tw:flex-wrap">
      <span class="tw:text-xs tw:font-semibold tw:opacity-70">
        {{ filterLabelComputed }}:
      </span>
      <div
        v-for="(value, key) in dimensions"
        :key="key"
        class="tw:flex tw:items-center tw:gap-2"
      >
        <span
          class="tw:text-xs tw:font-semibold"
          :class="
            unstableDimensionKeys.has(key) ? 'tw:opacity-60' : 'tw:opacity-100'
          "
        >
          {{ key }}:
        </span>
        <q-select
          :model-value="value"
          :options="getDimensionOptions(key, value)"
          dense
          outlined
          emit-value
          map-options
          @update:model-value="
            (newValue) => handleDimensionChange(key, newValue)
          "
          class="dimension-dropdown"
          borderless
          style="min-width: 120px"
          :data-test="`dimension-filter-${key}`"
        />
        <q-tooltip v-if="unstableDimensionKeys.has(key)">
          {{ unstableDimensionTooltipComputed }}
        </q-tooltip>
      </div>
      <!-- Apply Button -->
      <q-btn
        v-if="showApplyButton"
        flat
        dense
        no-caps
        text-color="light-text"
        :label="applyLabelComputed"
        :disable="!hasPendingChanges"
        @click="handleApply"
        class="o2-secondary-button tw:ml-2"
        data-test="apply-dimension-filters"
        style="line-height: 2.2rem !important"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

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

<style lang="scss" scoped>
// Dimension dropdown styling
.dimension-dropdown {
  :deep(.q-field__control) {
    min-height: 2rem;
    padding: 0 0.5rem;
  }

  :deep(.q-field__native) {
    font-size: 0.875rem;
    padding: 0.25rem 0;
  }

  :deep(.q-field__append) {
    padding-left: 0.25rem;
  }
}
</style>
