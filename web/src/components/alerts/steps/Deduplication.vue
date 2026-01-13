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
  <div class="step-deduplication" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="step-content card-container tw:px-3 tw:py-4">
      <!-- Fingerprint Fields -->
      <div class="tw:mb-4">
        <div class="tw:font-semibold tw:pb-2 tw:flex tw:items-center">
          {{ t("alerts.deduplication.fingerprintFields") }}
          <q-icon
            name="info"
            size="17px"
            class="q-ml-xs cursor-pointer"
            :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
          >
            <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px">
              {{ t("alerts.deduplication.fingerprintFieldsTooltip") }}
            </q-tooltip>
          </q-icon>
        </div>
        <div class="tw:text-sm tw:text-gray-600 dark:tw:text-gray-400 tw:mb-2">
          {{ t("alerts.deduplication.fingerprintFieldsHint") }}
        </div>
        <q-select
          v-model="localDeduplication.fingerprint_fields"
          :options="filteredColumns"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop no-case fingerprint-select tw:max-w-[600px] tw:min-w-[300px]"
          dense
          borderless
          multiple
          use-chips
          use-input
          input-debounce="0"
          new-value-mode="add-unique"
          emit-value
          map-options
          @filter="filterColumns"
          @update:model-value="emitUpdate"
        >
          <template v-slot:hint>
            <div class="tw:text-xs">
              💡 Leave empty to auto-detect based on query (SQL: GROUP BY columns, PromQL: labels, Custom: condition
              fields)
            </div>
          </template>
        </q-select>
      </div>

      <!-- Time Window -->
      <div class="tw:mb-4">
        <div class="tw:font-semibold tw:pb-2 tw:flex tw:items-center">
          {{ t("alerts.deduplication.timeWindow") }}
          <q-icon
            name="info"
            size="17px"
            class="q-ml-xs cursor-pointer"
            :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
          >
            <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px">
              {{ t("alerts.deduplication.timeWindowTooltip") }}
            </q-tooltip>
          </q-icon>
        </div>
        <div class="tw:text-sm tw:text-gray-600 dark:tw:text-gray-400 tw:mb-2">
          {{ t("alerts.deduplication.timeWindowHint") }}
        </div>
        <div class="tw:flex tw:items-center">
          <div class="tw:w-[210px] tw:ml-0">
            <q-input
              v-model.number="localDeduplication.time_window_minutes"
              type="number"
              dense
              borderless
              min="1"
              :placeholder="t('alerts.placeholders.autoUsesCheckInterval')"
              :class="
                store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'
              "
              style="background: none;"
              @update:model-value="emitUpdate"
            />
          </div>
          <div
            style="min-width: 90px; margin-left: 0 !important; height: 36px; font-weight: normal"
            :style="store.state.theme === 'dark' ? 'border: 1px solid #2c2c2c' : ''"
            :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-grey-2'"
            class="flex justify-center items-center"
          >
            {{ t("alerts.minutes") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

export default defineComponent({
  name: "Step5Deduplication",
  props: {
    deduplication: {
      type: Object as PropType<any>,
      default: () => ({
        enabled: true,
        fingerprint_fields: [],
        time_window_minutes: undefined,
      }),
    },
    columns: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },
  emits: ["update:deduplication"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const localDeduplication = ref({
      enabled: true,
      fingerprint_fields: props.deduplication?.fingerprint_fields || [],
      time_window_minutes: props.deduplication?.time_window_minutes || undefined,
    });

    const filteredColumns = ref(props.columns || []);

    // Watch for prop changes
    watch(
      () => props.deduplication,
      (newVal) => {
        if (newVal) {
          localDeduplication.value = {
            enabled: true,
            fingerprint_fields: newVal.fingerprint_fields || [],
            time_window_minutes: newVal.time_window_minutes || undefined,
          };
        }
      },
      { deep: true }
    );

    // Watch for columns prop changes
    watch(
      () => props.columns,
      (newVal) => {
        filteredColumns.value = newVal || [];
      }
    );

    const emitUpdate = () => {
      emit("update:deduplication", {
        enabled: true,
        fingerprint_fields: localDeduplication.value.fingerprint_fields,
        time_window_minutes: localDeduplication.value.time_window_minutes,
      });
    };

    const filterColumns = (val: string, update: any) => {
      update(() => {
        if (val === '') {
          filteredColumns.value = props.columns || [];
        } else {
          const needle = val.toLowerCase();
          filteredColumns.value = (props.columns || []).filter((v: any) => {
            const str = typeof v === 'string' ? v : (v?.label || v?.value || '');
            return str.toLowerCase().indexOf(needle) > -1;
          });
        }
      });
    };

    return {
      t,
      store,
      localDeduplication,
      filteredColumns,
      emitUpdate,
      filterColumns,
    };
  },
});
</script>

<style scoped lang="scss">
.step-deduplication {
  width: 100%;
  height: 100%;
  margin: 0 auto;
  overflow: auto;

  .step-content {
    border-radius: 8px;
    min-height: 100%;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
  }
}

:deep(.fingerprint-select) {
  .q-field__control {
    min-height: 40px;
  }

  .q-field__control-container {
    padding-top: 4px;
    padding-bottom: 4px;
    padding-right: 36px; // Reserve space for dropdown arrow
  }

  .q-field__native {
    min-height: 32px;
    gap: 4px;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex !important;
    flex-wrap: nowrap !important;

    // Hide scrollbar but keep scrolling functionality
    scrollbar-width: none; // Firefox
    -ms-overflow-style: none; // IE/Edge

    &::-webkit-scrollbar {
      display: none; // Chrome/Safari/Opera
    }
  }

  .q-chip {
    margin: 0 !important;
    font-size: 13px;
    flex-shrink: 0;
  }

  // Ensure the input field stays visible and accessible
  input {
    min-width: 100px !important;
    flex-shrink: 0 !important;
  }

  // Ensure dropdown icon is always visible
  .q-field__append {
    padding-left: 8px;
  }
}
</style>
