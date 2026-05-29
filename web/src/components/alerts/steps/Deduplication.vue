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
    class="step-deduplication"
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
    <div class="step-content card-container">
      <div class="section-header">
        <div class="section-header-accent" />
        <span class="section-header-title">{{
          t("alerts.steps.deduplication")
        }}</span>
      </div>
      <div class="tw:px-3 tw:py-2">
        <!-- Fingerprint Fields -->
        <div class="tw:mb-4">
          <div class="tw:font-semibold tw:pb-2 tw:flex tw:items-center">
            {{ t("alerts.deduplication.fingerprintFields") }}
            <OIcon name="info" size="sm" class="tw:ml-1 tw:cursor-pointer">
              <OTooltip
                :content="t('alerts.deduplication.fingerprintFieldsTooltip')"
                side="right"
              />
            </OIcon>
          </div>
          <div
            class="tw:text-sm tw:mb-2"
            :class="
              store.state.theme === 'dark'
                ? 'tw:text-gray-400'
                : 'tw:text-gray-600'
            "
          >
            {{ t("alerts.deduplication.fingerprintFieldsHint") }}
          </div>
          <div class="tw:relative">
            <OSelect
              v-model="localDeduplication.fingerprint_fields"
              :options="props.columns || []"
              multiple
              creatable
              data-test="alert-dedup-fingerprint-fields"
              class="tw:max-w-[600px] tw:min-w-[300px]"
              helpText="Leave empty to auto-detect based on query (SQL: GROUP BY columns, PromQL: labels, Custom: condition fields)"
              @update:model-value="emitUpdate"
              @create="addFingerprintField"
            />
            <OTooltip
              v-if="localDeduplication.fingerprint_fields?.length > 0"
              :content="localDeduplication.fingerprint_fields.join(', ')"
              max-width="400px"
            />
          </div>
        </div>

        <!-- Time Window -->
        <div class="tw:mb-4">
          <div class="tw:font-semibold tw:pb-2 tw:flex tw:items-center">
            {{ t("alerts.deduplication.timeWindow") }}
            <OIcon name="info" size="sm" class="tw:ml-1 tw:cursor-pointer">
              <OTooltip
                :content="t('alerts.deduplication.timeWindowTooltip')"
                side="right"
              />
            </OIcon>
          </div>
          <div
            class="tw:text-sm tw:mb-2"
            :class="
              store.state.theme === 'dark'
                ? 'tw:text-gray-400'
                : 'tw:text-gray-600'
            "
          >
            {{ t("alerts.deduplication.timeWindowHint") }}
          </div>
          <div class="tw:flex tw:items-center">
            <div class="tw:w-[210px] tw:ml-0">
              <OInput
                v-model="localDeduplication.time_window_minutes"
                type="number"
                min="1"
                data-test="alert-dedup-time-window"
                :placeholder="t('alerts.placeholders.autoUsesCheckInterval')"
                @update:model-value="emitUpdate"
              />
            </div>
            <div
              style="
                min-width: 90px;
                margin-left: 0 !important;
                height: 28px;
                font-weight: normal;
              "
              :class="store.state.theme === 'dark' ? 'tw:bg-gray-700' : 'tw:bg-gray-100'"
              class="tw:flex tw:justify-center tw:items-center"
            >
              {{ t("alerts.minutes") }}
            </div>
          </div>
        </div>
      </div>
      <!-- end tw:px-3 tw:py-2 -->
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, type PropType } from "vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "Step5Deduplication",
  components: { OIcon, OInput, OSelect, OTooltip },
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
      enabled: (props.deduplication?.fingerprint_fields?.length ?? 0) > 0,
      fingerprint_fields: props.deduplication?.fingerprint_fields || [],
      time_window_minutes:
        props.deduplication?.time_window_minutes || undefined,
    });

    // Watch for prop changes
    watch(
      () => props.deduplication,
      (newVal) => {
        if (newVal) {
          const fields = newVal.fingerprint_fields || [];
          localDeduplication.value = {
            enabled: fields.length > 0,
            fingerprint_fields: fields,
            time_window_minutes: newVal.time_window_minutes || undefined,
          };
        }
      },
      { deep: true },
    );

    const sanitizeTimeWindow = (val: any): number | undefined => {
      if (val == null || val === "") return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    };

    const emitUpdate = () => {
      const hasFields = localDeduplication.value.fingerprint_fields?.length > 0;
      emit("update:deduplication", {
        enabled: hasFields,
        fingerprint_fields: localDeduplication.value.fingerprint_fields,
        time_window_minutes: sanitizeTimeWindow(
          localDeduplication.value.time_window_minutes,
        ),
      });
    };

    const addFingerprintField = (value: string) => {
      if (!localDeduplication.value.fingerprint_fields) {
        localDeduplication.value.fingerprint_fields = [];
      }
      if (!localDeduplication.value.fingerprint_fields.includes(value)) {
        localDeduplication.value.fingerprint_fields.push(value);
        emitUpdate();
      }
    };

    return {
      t,
      store,
      props,
      localDeduplication,
      emitUpdate,
      addFingerprintField,
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
    .section-header {
      border-bottom: 1px solid #343434;
    }
    .section-header-title {
      color: #e0e0e0;
    }
    .section-header-accent {
      background: var(--q-primary);
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
    .section-header {
      border-bottom: 1px solid #eeeeee;
    }
    .section-header-title {
      color: #374151;
    }
    .section-header-accent {
      background: var(--q-primary);
    }
  }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 10px 12px;
}
.section-header-accent {
  width: 3px;
  height: 16px;
  border-radius: 2px;
  margin-right: 8px;
  flex-shrink: 0;
}
.section-header-title {
  font-size: 13px;
  font-weight: 600;
}

:deep(.fingerprint-select) {
  .q-field__control {
    min-height: 40px;
    display: flex;
    align-items: center;
  }

  .q-field__control-container {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    padding-right: 36px; // Reserve space for dropdown arrow
    display: flex;
    align-items: center;
  }

  .q-field__native {
    min-height: 32px;
    gap: 4px;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex !important;
    flex-wrap: nowrap !important;
    align-items: center !important; // Center align chips vertically
    padding-top: 6px !important;
    padding-bottom: 6px !important;

    // Hide scrollbar but keep scrolling functionality
    scrollbar-width: none; // Firefox
    -ms-overflow-style: none; // IE/Edge

    &::-webkit-scrollbar {
      display: none; // Chrome/Safari/Opera
    }
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

// NOTE: Dark/light fingerprint chip styling moved to OBadge variants since the
// `q-chip` element no longer renders post-Quasar removal. If chip-specific
// visual tweaks are needed, use `<OBadge variant="default">` and rely on its
// built-in light/dark token-driven background.
</style>
