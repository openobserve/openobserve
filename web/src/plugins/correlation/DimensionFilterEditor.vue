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
  <q-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    @hide="handleClose"
    data-test="dimension-filter-editor-dialog"
  >
    <q-card style="min-width: 600px; max-width: 800px">
      <!-- Header -->
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ t('correlation.logs.filters.title') }}</div>
        <q-space />
        <q-btn
          icon="close"
          flat
          round
          dense
          v-close-popup
          :aria-label="t('common.close')"
          data-test="close-dialog-btn"
        />
      </q-card-section>

      <q-separator class="q-mt-md" />

      <!-- Content -->
      <q-card-section class="q-pt-md">
        <!-- Description -->
        <div class="tw:mb-4 tw:text-sm tw:text-gray-600">
          {{ t('correlation.logs.filters.description') }}
        </div>

        <!-- Matched Dimensions (Stable) -->
        <div class="tw:mb-6">
          <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
            <h3 class="tw:text-base tw:font-semibold tw:m-0">
              {{ t('correlation.logs.filters.matchedDimensions') }}
            </h3>
            <q-icon name="info" size="sm" color="primary">
              <q-tooltip max-width="300px">
                {{ t('correlation.logs.filters.matchedDimensionsTooltip') }}
              </q-tooltip>
            </q-icon>
          </div>

          <div class="tw:space-y-3">
            <div
              v-for="(value, key) in matchedDimensions"
              :key="`matched-${key}`"
              class="tw:flex tw:items-center tw:gap-3 tw:p-3 tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:rounded"
              :data-test="`matched-dimension-${key}`"
            >
              <div class="tw:flex-1 tw:flex tw:items-center tw:gap-3">
                <q-icon name="lock" size="sm" color="primary" />
                <span class="tw:font-semibold tw:text-sm">{{ key }}:</span>
                <q-input
                  v-model="pendingFilters[key]"
                  dense
                  outlined
                  class="tw:flex-1"
                  :placeholder="String(value)"
                  :data-test="`matched-dimension-input-${key}`"
                />
              </div>
              <q-icon name="check_circle" size="sm" color="positive">
                <q-tooltip>
                  {{ t('correlation.logs.filters.stableDimension') }}
                </q-tooltip>
              </q-icon>
            </div>
          </div>
        </div>

        <!-- Additional Dimensions (Unstable) -->
        <div v-if="Object.keys(additionalDimensions).length > 0" class="tw:mb-4">
          <div class="tw:flex tw:items-center tw:gap-2 tw:mb-3">
            <h3 class="tw:text-base tw:font-semibold tw:m-0">
              {{ t('correlation.logs.filters.additionalDimensions') }}
            </h3>
            <q-icon name="info" size="sm" color="warning">
              <q-tooltip max-width="300px">
                {{ t('correlation.logs.filters.additionalDimensionsTooltip') }}
              </q-tooltip>
            </q-icon>
          </div>

          <div class="tw:space-y-3">
            <div
              v-for="(value, key) in additionalDimensions"
              :key="`additional-${key}`"
              class="tw:flex tw:items-center tw:gap-3 tw:p-3 tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:rounded tw:bg-gray-50"
              :data-test="`additional-dimension-${key}`"
            >
              <div class="tw:flex-1 tw:flex tw:flex-col tw:gap-2">
                <div class="tw:flex tw:items-center tw:gap-3">
                  <q-icon name="warning" size="sm" color="warning" />
                  <span class="tw:font-semibold tw:text-sm">{{ key }}:</span>
                  <q-input
                    v-model="pendingFilters[key]"
                    dense
                    outlined
                    class="tw:flex-1"
                    :placeholder="String(value)"
                    :data-test="`additional-dimension-input-${key}`"
                  />
                </div>
                <div class="tw:ml-8">
                  <q-btn
                    flat
                    dense
                    size="sm"
                    no-caps
                    :label="
                      pendingFilters[key] === SELECT_ALL_VALUE
                        ? t('correlation.logs.filters.showingAll')
                        : t('correlation.logs.filters.setToAll')
                    "
                    :color="pendingFilters[key] === SELECT_ALL_VALUE ? 'positive' : 'primary'"
                    icon="all_inclusive"
                    @click="toggleWildcard(key)"
                    :data-test="`toggle-wildcard-${key}`"
                  />
                  <span class="tw:ml-2 tw:text-xs tw:text-gray-500">
                    {{ t('correlation.logs.filters.wildcardHelp') }}
                  </span>
                </div>
              </div>
              <q-icon name="sync_problem" size="sm" color="warning">
                <q-tooltip>
                  {{ t('correlation.logs.filters.unstableDimension') }}
                </q-tooltip>
              </q-icon>
            </div>
          </div>
        </div>

        <!-- No Additional Dimensions Message -->
        <div
          v-else
          class="tw:p-3 tw:border tw:border-dashed tw:border-gray-300 tw:rounded tw:text-center tw:text-sm tw:text-gray-500"
        >
          {{ t('correlation.logs.filters.noAdditionalDimensions') }}
        </div>
      </q-card-section>

      <q-separator />

      <!-- Actions -->
      <q-card-actions align="right" class="q-pa-md">
        <q-btn
          flat
          :label="t('common.cancel')"
          @click="handleCancel"
          data-test="cancel-btn"
        />
        <q-btn
          flat
          :label="t('common.reset')"
          icon="restart_alt"
          @click="handleReset"
          data-test="reset-btn"
        />
        <q-btn
          :label="t('common.apply')"
          color="primary"
          class="o2-primary-button"
          @click="handleApply"
          :disable="!hasChanges"
          data-test="apply-btn"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { SELECT_ALL_VALUE } from '@/utils/dashboard/constants';

interface Props {
  modelValue: boolean;
  matchedDimensions: Record<string, string>;
  additionalDimensions?: Record<string, string>;
  currentFilters: Record<string, string>;
  availableDimensions?: Record<string, any>;
}

// Props & Emits
const props = defineProps<Props>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:filters': [filters: Record<string, string>];
  'close': [];
}>();

// Composables
const { t } = useI18n();

// State - Pending filters (staged changes)
const pendingFilters = ref<Record<string, string>>({ ...props.currentFilters });

// Computed
const hasChanges = computed(() => {
  const current = props.currentFilters;
  const pending = pendingFilters.value;

  // Check if any keys are different
  const allKeys = new Set([...Object.keys(current), ...Object.keys(pending)]);
  for (const key of allKeys) {
    if (current[key] !== pending[key]) {
      return true;
    }
  }

  return false;
});

/**
 * Toggle a dimension between specific value and wildcard (SELECT_ALL_VALUE)
 */
const toggleWildcard = (key: string) => {
  if (pendingFilters.value[key] === SELECT_ALL_VALUE) {
    // Restore original value
    const originalValue =
      props.additionalDimensions?.[key] || props.matchedDimensions[key] || '';
    pendingFilters.value[key] = String(originalValue);
  } else {
    // Set to wildcard
    pendingFilters.value[key] = SELECT_ALL_VALUE;
  }
};

/**
 * Handle apply button click
 */
const handleApply = () => {
  emit('update:filters', { ...pendingFilters.value });
  emit('update:modelValue', false);
};

/**
 * Handle cancel button click
 */
const handleCancel = () => {
  // Restore original filters
  pendingFilters.value = { ...props.currentFilters };
  emit('update:modelValue', false);
  emit('close');
};

/**
 * Handle reset button click
 */
const handleReset = () => {
  // Reset to matched dimensions only
  pendingFilters.value = { ...props.matchedDimensions };
};

/**
 * Handle dialog close
 */
const handleClose = () => {
  // Restore original filters on close
  pendingFilters.value = { ...props.currentFilters };
  emit('close');
};

// Watch for prop changes
watch(
  () => props.currentFilters,
  (newFilters) => {
    pendingFilters.value = { ...newFilters };
  },
  { deep: true }
);

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      // Reset pending filters when dialog opens
      pendingFilters.value = { ...props.currentFilters };
    }
  }
);
</script>

<style lang="scss" scoped>
.tw\\:bg-gray-50 {
  background-color: rgba(0, 0, 0, 0.02);
}

// Dark theme adjustments
:deep(.q-dark) {
  .tw\\:bg-gray-50 {
    background-color: rgba(255, 255, 255, 0.03);
  }

  .tw\\:text-gray-500 {
    color: rgba(255, 255, 255, 0.6);
  }

  .tw\\:text-gray-600 {
    color: rgba(255, 255, 255, 0.7);
  }
}
</style>
