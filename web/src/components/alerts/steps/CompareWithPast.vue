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
  <div ref="multiWindowContainerRef" class="step-compare-with-past flex w-full flex-col">
    <OSettingRow
      :label="t('alerts.plain.compareTitle')"
      :description="
        t('alerts.compareWithPast.runningFor', {
          period: convertMinutesToDisplayValue(period),
          frequency: convertMinutesToDisplayValue(frequency),
        })
      "
      fill
      data-test="add-alert-compare"
    >
      <div class="flex flex-col items-start gap-1">
        <!-- `:key` is the row UUID: the picker is bound by object reference, not by an index `name=`. -->
        <div
          v-for="(picker, index) in localMultiTimeRange"
          :key="picker.uuid"
          class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          data-test="add-alert-compare-window"
        >
          <i18n-t
            keypath="alerts.compareWithPast.comparingText"
            tag="span"
            scope="global"
            class="text-text-body flex flex-wrap items-center gap-x-1"
          >
            <template #offset>
              <span class="datetime-picker-wrapper rounded-default border-border-default border">
                <CustomDateTimePicker
                  v-model="picker.offSet"
                  :picker="picker"
                  :isFirstEntry="false"
                  @update:model-value="updateDateTimePicker"
                  :changeStyle="true"
                />
              </span>
            </template>
          </i18n-t>
          <OButton
            data-test="multi-time-range-alerts-delete-btn"
            variant="ghost-primary"
            size="sm"
            @click="removeTimeShift(index)"
          >
            {{ t("common.remove") }}
          </OButton>
        </div>
        <OButton
          data-test="multi-time-range-alerts-add-btn"
          variant="ghost-primary"
          size="sm"
          icon-left="add"
          :disabled="isComparisonDisabled"
          @click="addTimeShift"
        >
          {{
            localMultiTimeRange.length
              ? t("alerts.form.compare.addWindow")
              : t("alerts.plain.compareAddWindow")
          }}
          <OTooltip
            v-if="isComparisonDisabled"
            :content="raw(comparisonDisabledTooltip)"
            side="top"
            align="center"
            :sideOffset="8"
          />
        </OButton>
      </div>
    </OSettingRow>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, inject, type PropType } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";

interface TimeShiftPicker {
  offSet: string;
  uuid: string;
}

export default defineComponent({
  name: "Step4CompareWithPast",
  components: {
    CustomDateTimePicker,
    OButton,
    OSettingRow,
    OTooltip,
  },
  props: {
    multiTimeRange: {
      type: Array as PropType<TimeShiftPicker[]>,
      default: () => [],
    },
    period: {
      type: Number,
      default: 10,
    },
    frequency: {
      type: Number,
      default: 10,
    },
    frequencyType: {
      type: String,
      default: "minutes",
    },
    cron: {
      type: String,
      default: "",
    },
    selectedTab: {
      type: String,
      default: "custom",
    },
  },
  emits: ["update:multiTimeRange"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();

    // CompareWithPast has no OForm* fields — its only per-row control is the
    // CustomDateTimePicker, a non-form widget (a relative/absolute date-time
    // dropdown, not a plain input). It stays bare and its value is bridged into
    // the form: when a parent OForm exists (descendant mode) we write the
    // multi_time_range array straight into that form via setFieldValue;
    // otherwise we emit (bare) so the parent's @update:multiTimeRange→setF
    // bridge stays the write path.
    const injectedForm = inject(FORM_CONTEXT_KEY, null);
    const hasParentForm = !!injectedForm;

    const multiWindowContainerRef = ref<HTMLElement | null>(null);
    // Deep-clone rows into a LOCAL working copy so the bare CustomDateTimePicker
    // mutates real local reactive objects, never the form's internal state.
    const cloneRows = (rows: TimeShiftPicker[] | undefined): TimeShiftPicker[] =>
      (rows || []).map((p) => ({ offSet: p.offSet, uuid: p.uuid }));
    const localMultiTimeRange = ref<TimeShiftPicker[]>(cloneRows(props.multiTimeRange));

    // Watch for prop changes (props.multiTimeRange is fed FROM the form in
    // descendant mode, so this keeps the local working copy in sync both ways).
    watch(
      () => props.multiTimeRange,
      (newVal) => {
        localMultiTimeRange.value = cloneRows(newVal);
      },
      { deep: true },
    );

    // Single write path: form (descendant) or emit (bare). Fresh clones so the
    // form never shares mutable refs with the local working copy.
    const commit = () => {
      const rows = cloneRows(localMultiTimeRange.value);
      if (hasParentForm) {
        injectedForm!.setFieldValue("query_condition.multi_time_range", rows);
      } else {
        emit("update:multiTimeRange", rows);
      }
    };

    // Check if comparison window should be disabled (only SQL mode supports comparison)
    const isComparisonDisabled = computed(() => {
      return props.selectedTab !== "sql";
    });

    const comparisonDisabledTooltip = computed(() => {
      if (props.selectedTab !== "sql") {
        return t("alerts.compareWithPast.comparisonDisabledTooltip");
      }
      return "";
    });

    const addTimeShift = () => {
      const newTimeShift: TimeShiftPicker = {
        offSet: "15m",
        uuid: getUUID(),
      };
      localMultiTimeRange.value.push(newTimeShift);
      commit();
    };

    const removeTimeShift = (index: number) => {
      localMultiTimeRange.value.splice(index, 1);
      commit();
    };

    const updateDateTimePicker = () => {
      commit();
    };

    // Offset code ("15m") → counted noun. Shares the *Count plural keys with
    // convertMinutesToDisplayValue so "1m" reads "1 Minute", not "1 Minutes".
    const UNIT_COUNT_KEYS: Record<string, I18nKey> = {
      s: "alerts.compareWithPast.secondCount",
      m: "alerts.compareWithPast.minuteCount",
      h: "alerts.compareWithPast.hourCount",
      d: "alerts.compareWithPast.dayCount",
      w: "alerts.compareWithPast.weekCount",
      M: "alerts.compareWithPast.monthCount",
    };

    const getDisplayValue = (value: string) => {
      if (typeof value !== "string") return value;

      const match = value.match(/^(\d+)([smhdwM])$/);
      if (!match) return value;

      const [, numberPart, unitPart] = match;
      const countKey = UNIT_COUNT_KEYS[unitPart];

      if (countKey) {
        return t(countKey, Number(numberPart));
      }

      return value;
    };

    // Counted nouns → vue-i18n plural forms ("{n} Minute | {n} Minutes"),
    // called as t(key, n). vue-i18n picks the singular form only for n === 1
    // (n === 0 → "0 Minutes").
    const convertMinutesToDisplayValue = (minutes: number) => {
      if (minutes < 60) {
        return t("alerts.compareWithPast.minuteCount", minutes);
      } else if (minutes < 1440) {
        return t("alerts.compareWithPast.hourCount", Math.floor(minutes / 60));
      } else if (minutes < 10080) {
        return t("alerts.compareWithPast.dayCount", Math.floor(minutes / 1440));
      } else if (minutes < 43200) {
        return t("alerts.compareWithPast.weekCount", Math.floor(minutes / 10080));
      } else {
        return t("alerts.compareWithPast.monthCount", Math.floor(minutes / 43200));
      }
    };

    return {
      raw,
      t,
      store,
      multiWindowContainerRef,
      localMultiTimeRange,
      addTimeShift,
      removeTimeShift,
      updateDateTimePicker,
      getDisplayValue,
      convertMinutesToDisplayValue,
      isComparisonDisabled,
      comparisonDisabledTooltip,
    };
  },
});
</script>
