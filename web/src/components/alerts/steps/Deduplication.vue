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
    class="step-deduplication w-full h-full overflow-auto mx-auto"
  >
    <div
      class="step-content rounded-lg min-h-full bg-surface-overlay border border-border-default"
    >
      <div
        class="section-header flex items-center gap-0 py-2.5 px-3 border-b border-border-default"
      >
        <div class="section-header-accent w-0.75 h-4 rounded-sm mr-2 shrink-0 bg-[var(--color-theme-accent)]" />
        <span
          class="section-header-title text-compact font-semibold text-text-primary"
        >{{
          t("alerts.steps.deduplication")
        }}</span>
      </div>
      <div class="px-3 py-2">
        <!-- Fingerprint Fields -->
        <div class="mb-4">
          <div class="font-semibold pb-2 flex items-center">
            {{ t("alerts.deduplication.fingerprintFields") }}
            <OIcon name="info" size="sm" class="ml-1 cursor-pointer">
              <OTooltip
                :content="t('alerts.deduplication.fingerprintFieldsTooltip')"
                side="right"
              />
            </OIcon>
          </div>
          <div
            class="text-sm mb-2 text-text-secondary"
          >
            {{ t("alerts.deduplication.fingerprintFieldsHint") }}
          </div>
          <div class="relative">
            <OSelect
              v-model="localDeduplication.fingerprint_fields"
              :options="props.columns || []"
              multiple
              creatable
              data-test="alert-dedup-fingerprint-fields"
              class="max-w-150 min-w-75"
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
        <div class="mb-4">
          <div class="font-semibold pb-2 flex items-center">
            {{ t("alerts.deduplication.timeWindow") }}
            <OIcon name="info" size="sm" class="ml-1 cursor-pointer">
              <OTooltip
                :content="t('alerts.deduplication.timeWindowTooltip')"
                side="right"
              />
            </OIcon>
          </div>
          <div
            class="text-sm mb-2 text-text-secondary"
          >
            {{ t("alerts.deduplication.timeWindowHint") }}
          </div>
          <div class="flex items-center">
            <div class="w-52.5 ml-0">
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
              class="flex justify-center items-center bg-surface-subtle"
            >
              {{ t("alerts.minutes") }}
            </div>
          </div>
        </div>
      </div>
      <!-- end px-3 py-2 -->
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
