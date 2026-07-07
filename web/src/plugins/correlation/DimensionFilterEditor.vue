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
  <ODialog data-test="dimension-filter-editor-dialog"
    :open="modelValue"
    @update:open="(v) => { $emit('update:modelValue', v); if (!v) handleClose(); }"
    size="md"
    :title="t('correlation.logs.filters.title')"
    :secondary-button-label="t('common.cancel')"
    :neutral-button-label="t('common.reset')"
    :primary-button-label="t('common.apply')"
    :primary-button-disabled="!hasChanges"
    @click:secondary="handleCancel"
    @click:neutral="handleReset"
    @click:primary="handleApply"
  >
        <!-- Description -->
        <div class="mb-4 text-sm text-gray-600">
          {{ t('correlation.logs.filters.description') }}
        </div>

        <!-- Matched Dimensions (Stable) -->
        <div class="mb-6">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-base font-semibold m-0">
              {{ t('correlation.logs.filters.matchedDimensions') }}
            </h3>
            <OIcon name="info" size="sm">
              <OTooltip :content="t('correlation.logs.filters.matchedDimensionsTooltip')" side="top" />
            </OIcon>
          </div>

          <div class="space-y-3">
            <div
              v-for="(value, key) in matchedDimensions"
              :key="`matched-${key}`"
              class="flex items-center gap-3 p-3 border border-solid border-[var(--o2-border-color)] rounded"
              :data-test="`matched-dimension-${key}`"
            >
              <div class="flex-1 flex items-center gap-3">
                <OIcon name="lock" size="sm" />
                <span class="font-semibold text-sm">{{ key }}:</span>
                <OInput
                  v-model="pendingFilters[key]"
                  class="flex-1"
                  :placeholder="String(value)"
                  :data-test="`matched-dimension-input-${key}`"
                />
              </div>
              <OIcon name="check-circle" size="sm">
                <OTooltip :content="t('correlation.logs.filters.stableDimension')" side="top" />
              </OIcon>
            </div>
          </div>
        </div>

        <!-- Additional Dimensions (Unstable) -->
        <div v-if="Object.keys(additionalDimensions).length > 0" class="mb-4">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-base font-semibold m-0">
              {{ t('correlation.logs.filters.additionalDimensions') }}
            </h3>
            <OIcon name="info" size="sm">
              <OTooltip :content="t('correlation.logs.filters.additionalDimensionsTooltip')" side="top" />
            </OIcon>
          </div>

          <div class="space-y-3">
            <div
              v-for="(value, key) in additionalDimensions"
              :key="`additional-${key}`"
              class="flex items-center gap-3 p-3 border border-solid border-[var(--o2-border-color)] rounded bg-surface-panel"
              :data-test="`additional-dimension-${key}`"
            >
              <div class="flex-1 flex flex-col gap-2">
                <div class="flex items-center gap-3">
                  <OIcon name="warning" size="sm" />
                  <span class="font-semibold text-sm">{{ key }}:</span>
                  <OInput
                    v-model="pendingFilters[key]"
                    class="flex-1"
                    :placeholder="String(value)"
                    :data-test="`additional-dimension-input-${key}`"
                  />
                </div>
                <div class="ml-8">
                  <OButton
                    icon-left="all-inclusive"
                    variant="ghost"
                    size="sm-action"
                    :class="pendingFilters[key] === SELECT_ALL_VALUE ? 'text-green-600' : ''"
                    @click="toggleWildcard(key)"
                    :data-test="`toggle-wildcard-${key}`"
                  >
                    {{
                      pendingFilters[key] === SELECT_ALL_VALUE
                        ? t('correlation.logs.filters.showingAll')
                        : t('correlation.logs.filters.setToAll')
                    }}
                  </OButton>
                  <span class="ml-2 text-xs text-gray-500">
                    {{ t('correlation.logs.filters.wildcardHelp') }}
                  </span>
                </div>
              </div>
              <OIcon name="sync-problem" size="sm">
                <OTooltip :content="t('correlation.logs.filters.unstableDimension')" side="top" />
              </OIcon>
            </div>
          </div>
        </div>

        <!-- No Additional Dimensions Message -->
        <div
          v-else
          class="p-3 border border-dashed border-gray-300 rounded text-center text-sm text-gray-500"
        >
          {{ t('correlation.logs.filters.noAdditionalDimensions') }}
        </div>

  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { SELECT_ALL_VALUE } from '@/utils/dashboard/constants';
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";

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

