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

<!-- Shared formatting sections (Value Format, Alignment, Cell Type, Styling,
     Conditional) used by both the inline popover and the "Edit all" dialog.
     Mutates the ColumnOverrideUI in place; numeric-only sections hide when not numeric. -->
<template>
  <div class="tw:divide-y tw:divide-[rgba(128,128,128,0.08)]">
    <!-- Field type: Auto detects from data; Num/Text force the interpretation -->
    <div class="tw:px-3 tw:py-2">
      <div class="o-input-label tw:block tw:mb-1.5">
        {{ t("dashboard.sectionFieldType") }}
      </div>
      <OToggleGroup
        class="cf-seg tw:h-8"
        type="single"
        v-model="col.fieldType"
      >
        <OToggleGroupItem
          v-for="ft in fieldTypeOptions"
          :key="ft.value"
          :value="ft.value"
          size="sm"
          :data-test="`${dataTestPrefix}-field-type-${ft.value}-${col.field}`"
        >
          {{ ft.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Value formatting (numeric only) -->
    <div v-if="isNumeric" class="tw:px-3 tw:py-2">
      <div class="o-input-label tw:block tw:mb-1.5">
        {{ t("dashboard.sectionValueFormatting") }}
      </div>
      <OSelect
        v-model="col.unit"
        :options="unitOptions"
        class="tw:w-full"
        :data-test="`${dataTestPrefix}-unit-${col.field}`"
      />
      <OInput
        v-if="col.unit === 'custom'"
        v-model="col.customUnit"
        :label="t('dashboard.customunitLabel')"
        class="tw:w-full tw:mt-2"
        :data-test="`${dataTestPrefix}-custom-unit-${col.field}`"
      />
    </div>

    <!-- Alignment -->
    <div class="tw:px-3 tw:py-2">
      <div class="o-input-label tw:block tw:mb-1.5">
        {{ t("dashboard.sectionAlignment") }}
      </div>
      <OToggleGroup
        class="cf-seg tw:h-8"
        type="single"
        v-model="alignmentModel"
      >
        <OToggleGroupItem
          v-for="a in alignOptions"
          :key="a.value"
          :value="a.value"
          size="sm"
        >
          {{ a.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>


    <!-- Styling -->
    <div class="tw:px-3 tw:py-2">
      <div class="o-input-label tw:block tw:mb-1.5">{{ t("dashboard.sectionStyling") }}</div>
      <div class="tw:flex tw:items-center tw:gap-2 tw:mt-2 tw:flex-wrap">
        <span class="o-input-label tw:shrink-0 tw:min-w-16">{{ t("dashboard.textColor") }}</span>
        <ColorSwatchPicker v-model="col.textColor" :swatches="TEXT_SWATCHES" />
      </div>
      <div class="tw:flex tw:items-center tw:gap-2 tw:mt-2 tw:flex-wrap">
        <span class="o-input-label tw:shrink-0 tw:min-w-16">{{ t("dashboard.bgColor") }}</span>
        <ColorSwatchPicker v-model="col.bgColor" :swatches="BG_SWATCHES" />
      </div>
      <button
        type="button"
        class="tw:inline-flex tw:items-center tw:gap-2 tw:py-1.5 tw:px-2.5 tw:mt-3 tw:rounded-md tw:border tw:border-[rgba(128,128,128,0.28)] tw:bg-transparent tw:cursor-pointer tw:text-left tw:transition-colors tw:hover:border-[var(--color-primary-600)]"
        :class="{ 'cf-toggle-active': col.autoColor }"
        :data-test="`${dataTestPrefix}-unique-color-${col.field}`"
        @click="col.autoColor = !col.autoColor"
      >
        <OCheckbox :model-value="col.autoColor" size="sm" class="tw:pointer-events-none" />
        <span class="o-input-label tw:cursor-pointer">{{
          t("dashboard.overrideConfigUniqueValueColor")
        }}</span>
      </button>
    </div>

    <!-- Conditional (numeric only) -->
    <div v-if="isNumeric" class="tw:px-3 tw:py-2">
      <div class="o-input-label tw:block tw:mb-1.5">
        {{ t("dashboard.sectionConditionalStyling") }}
      </div>
      <div
        v-if="!col.conditions.length"
        class="tw:text-[length:var(--text-sm)] tw:text-[var(--color-text-secondary,#9e9e9e)] tw:mb-1.5"
      >
        {{ t("dashboard.conditionNoRules") }}
      </div>
      <div
        v-for="(rule, ruleIdx) in col.conditions"
        :key="ruleIdx"
        class="tw:flex tw:items-start tw:gap-1 tw:mb-1.5"
      >
        <div class="tw:flex-1 tw:min-w-0 tw:py-2 tw:px-2.5 tw:rounded-md tw:bg-[rgba(128,128,128,0.04)] tw:border tw:border-[rgba(128,128,128,0.1)] tw:flex tw:flex-col tw:gap-2">
          <!-- If value is [operator] [value] -->
          <div class="tw:flex tw:items-center tw:gap-1.5 tw:flex-wrap">
            <span class="o-input-label tw:shrink-0">{{ t("dashboard.conditionIfValue") }}</span>
            <div class="tw:w-[150px] tw:shrink-0">
              <OSelect
                v-model="rule.operator"
                :options="conditionOperators"
                class="tw:w-full"
              />
            </div>
            <OInput
              v-model="rule.threshold"
              type="number"
              :placeholder="t('dashboard.conditionThreshold')"
              class="tw:flex-1 tw:min-w-[80px]"
            />
          </div>
          <!-- then text color [picker] -->
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
            <span class="o-input-label tw:shrink-0 tw:text-[var(--color-text-secondary,#9e9e9e)]">{{ t("dashboard.conditionThenText") }}</span>
            <ColorSwatchPicker v-model="rule.textColor" :swatches="COND_TEXT_SWATCHES" />
          </div>
          <!-- and background [picker] -->
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
            <span class="o-input-label tw:shrink-0 tw:text-[var(--color-text-secondary,#9e9e9e)]">{{ t("dashboard.conditionAndBg") }}</span>
            <ColorSwatchPicker v-model="rule.bgColor" :swatches="COND_BG_SWATCHES" />
          </div>
        </div>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="close"
          :title="t('common.remove')"
          class="tw:shrink-0 tw:mt-2"
          @click="col.conditions.splice(ruleIdx, 1)"
        />
      </div>
      <OButton
        variant="outline"
        size="sm"
        class="tw:mt-1"
        :data-test="`${dataTestPrefix}-add-rule-${col.field}`"
        @click="col.conditions.push(emptyConditionalRule())"
      >
        {{ t("dashboard.conditionAddRule") }}
      </OButton>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ColorSwatchPicker from "./ColorSwatchPicker.vue";
import {
  type ColumnOverrideUI,
  emptyConditionalRule,
  useColumnFormattingOptions,
  TEXT_SWATCHES,
  BG_SWATCHES,
  COND_TEXT_SWATCHES,
  COND_BG_SWATCHES,
} from "@/composables/dashboard/useColumnFormatting";

export default defineComponent({
  name: "ColumnFormatControls",
  components: {
    OButton,
    OSelect,
    OInput,
    OCheckbox,
    OToggleGroup,
    OToggleGroupItem,
    ColorSwatchPicker,
  },
  props: {
    col: { type: Object as PropType<ColumnOverrideUI>, required: true },
    isNumeric: { type: Boolean, default: false },
    /** Prefix for the data-test hooks (lets the inline editor keep its own ids). */
    dataTestPrefix: { type: String, default: "o2-format" },
  },
  setup(props) {
    const { t } = useI18n();
    const { unitOptions, fieldTypeOptions, conditionOperators } =
      useColumnFormattingOptions();

    const alignOptions = [
      // "auto" is a sentinel — null alignment means the renderer auto-aligns by
      // type (numeric → right, text → left). The toggle group blocks
      // null/""/undefined, so we map "auto" ⇄ null via alignmentModel below.
      { value: "auto", label: t("dashboard.auto") },
      { value: "left", label: t("dashboard.alignLeft") },
      { value: "center", label: t("dashboard.alignCenter") },
      { value: "right", label: t("dashboard.alignRight") },
    ];

    // Explicit "Auto" replaces tap-to-clear: null ⇄ the "auto" sentinel item.
    const alignmentModel = computed({
      get: () => props.col.alignment ?? "auto",
      set: (v: string) => {
        props.col.alignment = v === "auto" ? null : v;
      },
    });

    return {
      t,
      unitOptions,
      fieldTypeOptions,
      alignOptions,
      alignmentModel,
      conditionOperators,
      TEXT_SWATCHES,
      BG_SWATCHES,
      COND_TEXT_SWATCHES,
      COND_BG_SWATCHES,
      emptyConditionalRule,
    };
  },
});
</script>

<style lang="scss" scoped>
// Segmented switchers: child buttons fill the 32px outer height.
.cf-seg :deep(button) {
  height: 100% !important;
  min-height: 0 !important;
}

// "Unique value color" toggle — active tint (color-mix has no Tailwind form).
.cf-toggle-active {
  border-color: var(--color-primary-600, #1976d2) !important;
  background: color-mix(in srgb, var(--color-primary-600, #1976d2) 7%, transparent) !important;
}
</style>
