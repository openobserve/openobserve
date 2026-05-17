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
  <div class="deduplication-config q-pa-none q-ma-none">
    <div class="tw:w-full">
      <div class="tw:w-full">
        <AlertsContainer
          :name="t('alerts.deduplication.title')"
          v-model:is-expanded="isExpanded"
          :label="t('alerts.deduplication.title')"
          :subLabel="t('alerts.deduplication.subtitle')"
          icon="filter_alt"
          class="tw:w-full col-12 tw:pl-4 tw:pr-2 tw:py-2"
          :iconClass="'tw:mt-[2px]'"
        />
      </div>

      <div v-if="isExpanded" class="tw:w-full row alert-setup-container">
        <q-separator class="tw:my-2"/>
        <div class="q-mt-sm tw:w-full tw:pl-3">
            <!-- Fingerprint Fields -->
            <div class="tw:mb-4">
              <div class="tw:font-semibold tw:pb-2 tw:flex tw:items-center">
                {{ t("alerts.deduplication.fingerprintFields") }}
                <OIcon
                  name="info"
                  size="17px"
                  class="q-ml-xs cursor-pointer"
                  :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                >
                  <OTooltip
                    side="right"
                    align="center"
                    :max-width="'300px'"
                    :content="t('alerts.deduplication.fingerprintFieldsTooltip')"
                  />
                </OIcon>
              </div>
              <div class="tw:text-sm tw:text-gray-600 dark:tw:text-gray-400 tw:mb-2">
                {{ t("alerts.deduplication.fingerprintFieldsHint") }}
              </div>
              <OSelect
                v-model="localConfig.fingerprint_fields"
                :options="availableFields"
                class="showLabelOnTop no-case"
                :class="store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'"
                multiple
                valueKey="value"
                labelKey="label"
                @update:model-value="emitUpdate"
              >
                <template v-slot:hint>
                  <div class="tw:text-xs">
                    💡 Leave empty to auto-detect based on query (SQL: GROUP BY columns, PromQL: labels, Custom: condition fields)
                  </div>
                </template>
              </OSelect>
            </div>

            <!-- Time Window -->
            <div class="tw:mb-4">
              <div class="tw:font-semibold tw:pb-2 tw:flex tw:items-center">
                {{ t("alerts.deduplication.timeWindow") }}
                <OIcon
                  name="info"
                  size="17px"
                  class="q-ml-xs cursor-pointer"
                  :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                >
                  <OTooltip
                    side="right"
                    align="center"
                    :max-width="'300px'"
                    :content="t('alerts.deduplication.timeWindowTooltip')"
                  />
                </OIcon>
              </div>
              <div class="tw:text-sm tw:text-gray-600 dark:tw:text-gray-400 tw:mb-2">
                {{ t("alerts.deduplication.timeWindowHint") }}
              </div>
              <OInput
                v-model.number="localConfig.time_window_minutes"
                type="number"
                min="1"
                suffix="minutes"
                :placeholder="t('alerts.placeholders.autoUsesCheckInterval')"
                :class="store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'"
                @update:model-value="emitUpdate"
              />
            </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import AlertsContainer from "./AlertsContainer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18n();

interface DeduplicationConfig {
  enabled: boolean;
  fingerprint_fields: string[];
  time_window_minutes?: number;
  grouping?: {
    enabled: boolean;
    max_group_size: number;
    send_strategy: "first_with_count" | "summary" | "all";
    group_wait_seconds: number;
  };
}

interface FieldOption {
  label: string;
  value: string;
  type?: string;
}

interface Props {
  modelValue?: DeduplicationConfig;
  availableFields?: (string | FieldOption)[];
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({
    enabled: true, // Always enabled by default
    fingerprint_fields: [],
    time_window_minutes: undefined,
    grouping: undefined,
  }),
  availableFields: () => [],
});

const emit = defineEmits<{
  (e: "update:modelValue", value: DeduplicationConfig): void;
}>();

const store = useStore();

// Auto-expand if there's existing config
const isExpanded = ref(true);

// Local config state - deduplication is always enabled by default
const localConfig = ref<DeduplicationConfig>({
  enabled: true, // Always enabled
  fingerprint_fields: props.modelValue?.fingerprint_fields ?? [],
  time_window_minutes: props.modelValue?.time_window_minutes ?? undefined,
  grouping: undefined, // Grouping removed
});

const sanitizeTimeWindow = (val: any): number | undefined => {
  if (val == null || val === "") return undefined;
  const num = Number(val);
  return isNaN(num) ? undefined : num;
};

const emitUpdate = () => {
  // Always emit as enabled
  emit("update:modelValue", {
    enabled: true,
    fingerprint_fields: localConfig.value.fingerprint_fields,
    time_window_minutes: sanitizeTimeWindow(localConfig.value.time_window_minutes),
    grouping: undefined,
  });
};

// Watch for external changes
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal) {
      localConfig.value = {
        enabled: true, // Always enabled
        fingerprint_fields: newVal.fingerprint_fields ?? [],
        time_window_minutes: newVal.time_window_minutes ?? undefined,
        grouping: undefined, // Grouping removed
      };
    }
  },
  { deep: true, immediate: true }
);
</script>

<style scoped lang="scss">
.deduplication-config {
  width: 100%;
}

.alert-setup-container {
  padding: 0 16px;
}
</style>
