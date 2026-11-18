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

<!-- One row per past window, each with its own Remove; the add link sits under the last one. -->
<template>
  <div
    ref="multiWindowContainerRef"
    class="step-compare-with-past flex w-full flex-col"
    data-test="add-alert-compare"
  >
    <OSettingRow
      v-for="(picker, index) in localMultiTimeRange"
      :key="picker.uuid"
      :label="index === 0 ? t('alerts.plain.compareTitle') : noLabel"
      fill
      data-test="add-alert-compare-window"
    >
      <i18n-t
        keypath="alerts.compareWithPast.comparingText"
        tag="div"
        scope="global"
        class="text-text-body flex flex-wrap items-center gap-2 text-sm"
      >
        <template #offset>
          <span class="flex items-center gap-2">
            <OInput
              type="number"
              min="1"
              fit-content
              class="max-w-32! min-w-16"
              :model-value="parseOffset(picker.offSet).amount"
              :aria-label="t('alerts.plain.compareTitle')"
              data-test="multi-time-range-offset-input"
              @update:model-value="setOffset(index, $event, parseOffset(picker.offSet).unit)"
            />
            <OSelect
              class="w-30"
              :model-value="parseOffset(picker.offSet).unit"
              :options="unitOptions"
              labelKey="label"
              valueKey="value"
              :searchable="false"
              :aria-label="t('common.unitFor', { label: t('alerts.plain.compareTitle') })"
              data-test="multi-time-range-offset-unit"
              @update:model-value="
                setOffset(index, parseOffset(picker.offSet).amount, String($event))
              "
            />
          </span>
        </template>
      </i18n-t>
      <OButton
        v-if="index === localMultiTimeRange.length - 1"
        class="-ms-3.5 mt-2 self-start max-[85.5rem]:-ms-3"
        data-test="multi-time-range-alerts-add-btn"
        variant="ghost-primary"
        size="sm"
        icon-left="add"
        @click="addTimeShift"
      >
        {{ t("alerts.form.compare.addWindow") }}
      </OButton>
      <template #actions>
        <OButton
          data-test="multi-time-range-alerts-delete-btn"
          variant="ghost-primary"
          size="sm"
          @click="removeTimeShift(index)"
        >
          {{ t("common.remove") }}
        </OButton>
      </template>
    </OSettingRow>
    <OSettingRow
      v-if="!localMultiTimeRange.length"
      :label="t('alerts.plain.compareTitle')"
      fill
      data-test="add-alert-compare-empty"
    >
      <OButton
        class="-ms-3.5 self-start max-[85.5rem]:-ms-3"
        data-test="multi-time-range-alerts-add-btn"
        variant="ghost-primary"
        size="sm"
        icon-left="add"
        :disabled="isComparisonDisabled"
        @click="addTimeShift"
      >
        {{ t("alerts.plain.compareAddWindow") }}
        <OTooltip
          v-if="isComparisonDisabled"
          :content="raw(comparisonDisabledTooltip)"
          side="top"
          align="center"
          :sideOffset="8"
        />
      </OButton>
    </OSettingRow>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, inject, type PropType } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
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
    OButton,
    OInput,
    OSelect,
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
        offSet: "1d",
        uuid: getUUID(),
      };
      localMultiTimeRange.value.push(newTimeShift);
      commit();
    };

    const removeTimeShift = (index: number) => {
      localMultiTimeRange.value.splice(index, 1);
      commit();
    };

    const UNIT_KEYS: Record<string, I18nKey> = {
      s: "alerts.form.units.seconds",
      m: "alerts.form.units.minutes",
      h: "alerts.form.units.hours",
      d: "alerts.form.units.days",
      w: "alerts.form.units.weeks",
      M: "alerts.form.units.months",
    };
    const unitOptions = computed(() =>
      Object.entries(UNIT_KEYS).map(([value, key]) => ({ label: t(key), value })),
    );
    const noLabel = raw("");

    // An offset is stored as a code such as "15m" or "1d".
    const parseOffset = (code: string) => {
      const match = String(code ?? "").match(/^(\d+)([smhdwM])$/);
      return match ? { amount: Number(match[1]), unit: match[2] } : { amount: 1, unit: "d" };
    };
    const setOffset = (index: number, amount: unknown, unit: string) => {
      const n = Math.max(1, Math.floor(Number(amount)) || 1);
      localMultiTimeRange.value[index].offSet = `${n}${unit}`;
      commit();
    };

    return {
      raw,
      t,
      store,
      multiWindowContainerRef,
      localMultiTimeRange,
      addTimeShift,
      removeTimeShift,
      unitOptions,
      noLabel,
      parseOffset,
      setOffset,
      isComparisonDisabled,
      comparisonDisabledTooltip,
    };
  },
});
</script>
