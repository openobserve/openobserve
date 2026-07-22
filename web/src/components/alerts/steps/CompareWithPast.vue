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
    ref="multiWindowContainerRef"
    class="step-compare-with-past w-full h-full flex flex-col mx-auto"
  >
    <div
      class="step-content rounded-default flex-1 min-h-0 overflow-auto bg-surface-overlay border border-border-default"
    >
      <div
        class="section-header flex items-center gap-0 py-2.5 px-3 border-b border-border-default"
      >
        <div
          class="section-header-accent w-0.75 h-4 rounded-default mr-2 shrink-0 bg-theme-accent"
        />
        <span class="section-header-title text-compact font-semibold text-text-heading">{{
          t("alerts.steps.compareWithPast")
        }}</span>
      </div>
      <div class="px-3 pb-2">
        <!-- Alert set for header -->
        <div
          class="multi-window-text flex items-center gap-2 py-2 mt-3 font-bold text-sm leading-6 align-middle text-text-body"
        >
          <span>{{ t("alerts.compareWithPast.alertSetFor") }}</span>
          <div class="h-px border-line flex-1"></div>
        </div>

        <!-- Current Window -->
        <div
          class="flex flex-row justify-between items-start min-h-27.5 px-3 py-2 bg-card-glass-bg border border-border-default"
        >
          <div
            class="multi-window-text w-auto text-left font-bold text-sm leading-6 align-middle text-text-body"
          >
            {{ t("alerts.compareWithPast.currentWindow") }}
          </div>

          <div class="flex flex-col items-start gap-2">
            <div
              class="multi-window-text w-auto text-left font-bold text-sm leading-6 align-middle text-text-body"
            >
              {{ t("alerts.compareWithPast.cycle") }}
              <span class="cursor-pointer">
                <OIcon
                  name="info"
                  size="sm"
                  class="ml-1 cursor-pointer"
                  :class="'text-text-secondary'"
                />
                <OTooltip
                  :content="t('alerts.compareWithPast.cycleTooltip')"
                  side="right"
                  align="center"
                  max-width="300px"
                />
              </span>
            </div>
            <div class="flex justify-between items-start gap-4">
              <div class="w-75 font-normal leading-5 text-sm">
                {{
                  t("alerts.compareWithPast.runningFor", {
                    period: convertMinutesToDisplayValue(period),
                    frequency: convertMinutesToDisplayValue(frequency),
                  })
                }}
              </div>
              <div>
                <span class="inline-block">
                  <OButton
                    class="min-w-auto opacity-30 pointer-events-none"
                    variant="ghost"
                    size="icon-circle-sm"
                    disable
                  >
                    <OIcon name="delete-outline" size="sm" />
                  </OButton>
                  <OTooltip
                    :content="t('alerts.compareWithPast.currentWindowCannotBeDeleted')"
                    side="top"
                    align="center"
                    :sideOffset="8"
                  />
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Comparing with header -->
        <div
          v-if="localMultiTimeRange.length > 0"
          class="multi-window-text flex items-center gap-2 py-2 mt-2 font-bold text-sm leading-6 align-middle text-text-body"
        >
          <span>{{ t("alerts.compareWithPast.comparingWith") }}</span>
          <div class="h-px border-line flex-1"></div>
        </div>

        <!-- Reference Windows List -->
        <!-- `:key` is the row UUID (NOT the array index) because the only per-row
           control is CustomDateTimePicker — a non-form widget bound by object
           reference (`v-model="picker.offSet"`), not by an index-based OForm*
           `name=`. The multi_time_range array is bridged into the form via
           setFieldValue (descendant) / emit (bare) — see commit(). -->
        <div
          v-for="(picker, index) in localMultiTimeRange"
          :key="picker.uuid"
          class="reference-window-container flex flex-row justify-between items-start min-h-27.5 mt-2 px-3 py-2 bg-card-glass-bg border border-border-default"
        >
          <div
            class="multi-window-text w-auto text-left font-bold text-sm leading-6 align-middle text-text-body"
          >
            {{ t("alerts.compareWithPast.referenceWindow") }} {{ index + 1 }}
          </div>

          <!-- Time Frame -->
          <div class="flex flex-col gap-2 items-start">
            <div class="flex items-center">
              <span class="mr-1"><OIcon name="schedule" size="sm" /></span>
              {{ t("alerts.compareWithPast.timeFrame") }}
              <span class="ml-2 cursor-pointer">
                <OIcon
                  name="info"
                  size="sm"
                  class="ml-1 cursor-pointer"
                  :class="'text-text-secondary'"
                />
                <OTooltip
                  :content="t('alerts.compareWithPast.timeFrameTooltip')"
                  side="right"
                  align="center"
                  max-width="300px"
                />
              </span>
            </div>
            <div class="datetime-picker-wrapper mt-2 border rounded-default !border-border-default">
              <CustomDateTimePicker
                v-model="picker.offSet"
                :picker="picker"
                :isFirstEntry="false"
                @update:model-value="updateDateTimePicker"
                :changeStyle="true"
              />
            </div>
          </div>

          <!-- Cycle Info -->
          <div class="flex flex-col items-start gap-2">
            <div
              class="multi-window-text w-auto text-left font-bold text-sm leading-6 align-middle text-text-body"
            >
              {{ t("alerts.compareWithPast.cycle") }}
              <span class="cursor-pointer">
                <OIcon
                  name="info"
                  size="sm"
                  class="ml-1 cursor-pointer"
                  :class="'text-text-secondary'"
                />
                <OTooltip
                  :content="t('alerts.compareWithPast.cycleTooltip')"
                  side="right"
                  align="center"
                  max-width="300px"
                />
              </span>
            </div>
            <div class="flex justify-between items-start gap-4">
              <div class="w-75 text-sm font-normal">
                {{
                  t("alerts.compareWithPast.comparingText", {
                    offset: getDisplayValue(picker.offSet),
                  })
                }}
              </div>
              <div>
                <OButton
                  data-test="multi-time-range-alerts-delete-btn"
                  variant="ghost"
                  size="icon-circle-sm"
                  @click="removeTimeShift(index)"
                >
                  <OIcon name="delete-outline" size="sm" />
                </OButton>
              </div>
            </div>
          </div>
        </div>

        <!-- Action Buttons Section -->
        <div class="w-full flex justify-center items-center gap-3 mt-2">
          <OButton
            data-test="multi-time-range-alerts-add-btn"
            variant="outline"
            size="sm"
            :disabled="isComparisonDisabled"
            @click="addTimeShift"
          >
            {{ t("alerts.compareWithPast.addComparisonWindow") }}
            <OTooltip
              v-if="isComparisonDisabled"
              :content="comparisonDisabledTooltip"
              side="top"
              align="center"
              :sideOffset="8"
            />
          </OButton>
        </div>
      </div>
      <!-- end px-3 py-2 -->
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, inject, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
    OIcon,
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
    const { t } = useI18n();
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

    // Static unit labels for the offset display ("15m" → "15 Minute(s)"). These
    // are NOT counted nouns — the literal "(s)" is part of the label — so they
    // stay plain keys and are deliberately NOT pluralized (unlike the *Count
    // keys used by convertMinutesToDisplayValue below).
    const relativePeriods = computed(() => [
      { label: t("alerts.compareWithPast.periodSeconds"), value: "s" },
      { label: t("alerts.compareWithPast.periodMinutes"), value: "m" },
      { label: t("alerts.compareWithPast.periodHours"), value: "h" },
      { label: t("alerts.compareWithPast.periodDays"), value: "d" },
      { label: t("alerts.compareWithPast.periodWeeks"), value: "w" },
      { label: t("alerts.compareWithPast.periodMonths"), value: "M" },
    ]);

    const getDisplayValue = (value: string) => {
      if (typeof value !== "string") return value;

      const match = value.match(/^(\d+)([smhdwM])$/);
      if (!match) return value;

      const [, numberPart, unitPart] = match;
      const period = relativePeriods.value.find((p) => p.value === unitPart);

      if (period) {
        return `${numberPart} ${period.label}`;
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
