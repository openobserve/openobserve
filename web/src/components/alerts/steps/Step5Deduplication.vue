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
    <div class="step-content card-container tw-px-3 tw-py-4">
      <!-- Fingerprint Fields -->
      <div class="tw-mb-4">
        <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
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
        <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-2">
          {{ t("alerts.deduplication.fingerprintFieldsHint") }}
        </div>
        <q-select
          v-model="localDeduplication.fingerprint_fields"
          :options="columns"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop no-case"
          :class="
            store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'
          "
          filled
          dense
          multiple
          use-chips
          use-input
          input-debounce="0"
          new-value-mode="add-unique"
          emit-value
          map-options
          @update:model-value="emitUpdate"
          style="width: 300px;"
        >
          <template v-slot:hint>
            <div class="tw-text-xs">
              💡 Leave empty to auto-detect based on query (SQL: GROUP BY columns, PromQL: labels, Custom: condition
              fields)
            </div>
          </template>
        </q-select>
      </div>

      <!-- Time Window -->
      <div class="tw-mb-4">
        <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
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
        <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-2">
          {{ t("alerts.deduplication.timeWindowHint") }}
        </div>
        <q-input
          v-model.number="localDeduplication.time_window_minutes"
          type="number"
          dense
          filled
          min="1"
          suffix="minutes"
          :placeholder="t('alerts.placeholders.autoUsesCheckInterval')"
          :class="
            store.state.theme === 'dark' ? 'input-box-bg-dark input-border-dark' : 'input-box-bg-light input-border-light'
          "
          @update:model-value="emitUpdate"
          style="max-width: 300px"
        />
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

    const emitUpdate = () => {
      emit("update:deduplication", {
        enabled: true,
        fingerprint_fields: localDeduplication.value.fingerprint_fields,
        time_window_minutes: localDeduplication.value.time_window_minutes,
      });
    };

    return {
      t,
      store,
      localDeduplication,
      emitUpdate,
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
</style>
