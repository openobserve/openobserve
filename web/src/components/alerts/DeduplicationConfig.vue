<!-- Copyright 2023 OpenObserve Inc.

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
    <div class="tw-w-full">
      <div class="tw-w-full tw-ml-2">
        <AlertsContainer
          :name="t('alerts.deduplication.title')"
          v-model:is-expanded="isExpanded"
          :label="t('alerts.deduplication.title')"
          :subLabel="t('alerts.deduplication.subtitle')"
          icon="filter_alt"
          class="tw-mt-1 tw-w-full col-12 tw-px-2 tw-py-2"
          :iconClass="'tw-mt-[2px]'"
        />
      </div>

      <div v-if="isExpanded" class="tw-w-full row alert-setup-container">
        <div class="q-mt-sm tw-w-full">
          <!-- Enable/Disable Toggle -->
          <div class="flex justify-start items-center tw-font-semibold tw-pb-3">
            <div style="width: 200px">{{ t("alerts.deduplication.enable") }}</div>
            <q-toggle
              v-model="localConfig.enabled"
              size="md"
              color="primary"
              class="text-bold q-pl-0 o2-toggle-button-sm tw-h-[36px] tw-ml-1"
              :class="store.state.theme === 'dark' ? 'o2-toggle-button-sm-dark' : 'o2-toggle-button-sm-light'"
              @update:model-value="emitUpdate"
            />
          </div>

          <template v-if="localConfig.enabled">
            <!-- Fingerprint Fields -->
            <div class="tw-mb-4">
              <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
                {{ t("alerts.deduplication.fingerprintFields") }}
                <q-icon
                  :name="outlinedInfo"
                  size="17px"
                  class="q-ml-xs cursor-pointer"
                  :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                >
                  <q-tooltip
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                    style="font-size: 12px;"
                  >
                    {{ t("alerts.deduplication.fingerprintFieldsTooltip") }}
                  </q-tooltip>
                </q-icon>
              </div>
              <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-2">
                {{ t("alerts.deduplication.fingerprintFieldsHint") }}
              </div>
              <q-select
                v-model="localConfig.fingerprint_fields"
                :options="availableFields"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop no-case"
                :class="store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'"
                filled
                dense
                multiple
                use-chips
                use-input
                input-debounce="0"
                new-value-mode="add-unique"
                emit-value
                map-options
                option-value="value"
                option-label="label"
                @update:model-value="emitUpdate"
              >
                <template v-slot:hint>
                  <div class="tw-text-xs">
                    Auto-detection: SQL uses GROUP BY, PromQL uses labels, Custom uses conditions
                  </div>
                </template>
              </q-select>
            </div>

            <!-- Time Window -->
            <div class="tw-mb-4">
              <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
                {{ t("alerts.deduplication.timeWindow") }}
                <q-icon
                  :name="outlinedInfo"
                  size="17px"
                  class="q-ml-xs cursor-pointer"
                  :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                >
                  <q-tooltip
                    anchor="center right"
                    self="center left"
                    max-width="300px"
                    style="font-size: 12px;"
                  >
                    {{ t("alerts.deduplication.timeWindowTooltip") }}
                  </q-tooltip>
                </q-icon>
              </div>
              <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-2">
                {{ t("alerts.deduplication.timeWindowHint") }}
              </div>
              <q-input
                v-model.number="localConfig.time_window_minutes"
                type="number"
                dense
                filled
                min="1"
                placeholder="Use alert period by default"
                :class="store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'"
                @update:model-value="emitUpdate"
              />
            </div>

            <!-- Grouping Configuration (Advanced) -->
            <div class="tw-mb-4">
              <q-expansion-item
                v-model="isGroupingExpanded"
                icon="settings"
                :label="t('alerts.deduplication.advancedGrouping')"
                dense
                class="tw-border tw-rounded"
              >
                <div class="q-pa-md">
                  <!-- Enable Grouping -->
                  <div class="flex justify-start items-center tw-font-semibold tw-pb-3">
                    <div style="width: 200px">{{ t("alerts.deduplication.enableGrouping") }}</div>
                    <q-toggle
                      v-model="groupingEnabled"
                      size="md"
                      color="primary"
                      class="text-bold q-pl-0 o2-toggle-button-sm tw-h-[36px] tw-ml-1"
                      :class="store.state.theme === 'dark' ? 'o2-toggle-button-sm-dark' : 'o2-toggle-button-sm-light'"
                      @update:model-value="updateGrouping"
                    />
                  </div>

                  <template v-if="groupingEnabled && localConfig.grouping">
                    <!-- Max Group Size -->
                    <div class="tw-mb-4">
                      <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
                        {{ t("alerts.deduplication.maxGroupSize") }}
                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                        >
                          <q-tooltip
                            anchor="center right"
                            self="center left"
                            max-width="300px"
                            style="font-size: 12px;"
                          >
                            {{ t("alerts.deduplication.maxGroupSizeTooltip") }}
                          </q-tooltip>
                        </q-icon>
                      </div>
                      <q-input
                        v-model.number="localConfig.grouping.max_group_size"
                        type="number"
                        dense
                        filled
                        min="1"
                        placeholder="100"
                        :class="store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'"
                        @update:model-value="emitUpdate"
                      />
                    </div>

                    <!-- Send Strategy -->
                    <div class="tw-mb-4">
                      <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
                        {{ t("alerts.deduplication.sendStrategy") }}
                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                        >
                          <q-tooltip
                            anchor="center right"
                            self="center left"
                            max-width="300px"
                            style="font-size: 12px;"
                          >
                            {{ t("alerts.deduplication.sendStrategyTooltip") }}
                          </q-tooltip>
                        </q-icon>
                      </div>
                      <q-select
                        v-model="localConfig.grouping.send_strategy"
                        :options="sendStrategyOptions"
                        color="input-border"
                        bg-color="input-bg"
                        class="showLabelOnTop no-case"
                        :class="store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'"
                        filled
                        dense
                        emit-value
                        map-options
                        @update:model-value="emitUpdate"
                      />
                    </div>

                    <!-- Group Wait Time -->
                    <div class="tw-mb-4">
                      <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
                        {{ t("alerts.deduplication.groupWaitTime") }}
                        <q-icon
                          :name="outlinedInfo"
                          size="17px"
                          class="q-ml-xs cursor-pointer"
                          :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                        >
                          <q-tooltip
                            anchor="center right"
                            self="center left"
                            max-width="300px"
                            style="font-size: 12px;"
                          >
                            {{ t("alerts.deduplication.groupWaitTimeTooltip") }}
                          </q-tooltip>
                        </q-icon>
                      </div>
                      <q-input
                        v-model.number="localConfig.grouping.group_wait_seconds"
                        type="number"
                        dense
                        filled
                        min="1"
                        placeholder="300"
                        :class="store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'"
                        @update:model-value="emitUpdate"
                      />
                    </div>
                  </template>
                </div>
              </q-expansion-item>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import AlertsContainer from "./AlertsContainer.vue";

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
    enabled: false,
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
const isExpanded = ref(!!props.modelValue?.enabled);
const isGroupingExpanded = ref(!!props.modelValue?.grouping?.enabled);

// Local config state - handle undefined modelValue
const localConfig = ref<DeduplicationConfig>({
  enabled: props.modelValue?.enabled ?? false,
  fingerprint_fields: props.modelValue?.fingerprint_fields ?? [],
  time_window_minutes: props.modelValue?.time_window_minutes ?? undefined,
  grouping: props.modelValue?.grouping ?? undefined,
});

const groupingEnabled = computed({
  get: () => !!localConfig.value.grouping?.enabled,
  set: (val: boolean) => {
    if (val) {
      localConfig.value.grouping = {
        enabled: true,
        max_group_size: 100,
        send_strategy: "first_with_count",
        group_wait_seconds: 300,
      };
    } else {
      localConfig.value.grouping = undefined;
    }
    emitUpdate();
  },
});

const sendStrategyOptions = computed(() => [
  { label: t("alerts.deduplication.sendStrategyFirstWithCount"), value: "first_with_count" },
  { label: t("alerts.deduplication.sendStrategySummary"), value: "summary" },
  { label: t("alerts.deduplication.sendStrategyAll"), value: "all" },
]);

const updateGrouping = () => {
  emitUpdate();
};

const emitUpdate = () => {
  // Only emit if enabled, otherwise emit undefined
  if (localConfig.value.enabled) {
    emit("update:modelValue", { ...localConfig.value });
  } else {
    emit("update:modelValue", {
      enabled: false,
      fingerprint_fields: [],
      time_window_minutes: undefined,
      grouping: undefined,
    });
  }
};

// Watch for external changes
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal) {
      localConfig.value = {
        enabled: newVal.enabled ?? false,
        fingerprint_fields: newVal.fingerprint_fields ?? [],
        time_window_minutes: newVal.time_window_minutes ?? undefined,
        grouping: newVal.grouping ?? undefined,
      };
      // Auto-expand if config is enabled
      if (newVal.enabled) {
        isExpanded.value = true;
      }
      // Auto-expand grouping section if grouping is enabled
      if (newVal.grouping?.enabled) {
        isGroupingExpanded.value = true;
      }
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
