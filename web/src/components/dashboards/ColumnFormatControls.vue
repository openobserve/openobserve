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
        <span class="tw:font-normal tw:opacity-60">· {{ t("dashboard.tapActiveToClear") }}</span>
      </div>
      <OToggleGroup
        class="cf-seg tw:h-8"
        type="single"
        :model-value="col.alignment"
        @update:model-value="setAlignment"
      >
        <OToggleGroupItem
          v-for="a in alignOptions"
          :key="a.value"
          :value="a.value"
          size="sm"
          :tooltip="a.label"
          :icon-left="a.icon"
          @pointerdown.capture="onAlignPointerDown"
          @click="onAlignClickItem(a.value)"
        />
      </OToggleGroup>
    </div>

    <!-- Cell type (numeric only) -->
    <div v-if="isNumeric" class="tw:px-3 tw:py-2">
      <div class="o-input-label tw:block tw:mb-1.5">
        {{ t("dashboard.sectionCellType") }}
      </div>
      <OToggleGroup v-model="col.cellType" type="single" class="cf-seg tw:h-8">
        <OToggleGroupItem
          v-for="ct in cellTypeOptionsCompact"
          :key="ct.value"
          :value="ct.value"
          size="sm"
          :icon-left="ct.icon"
        >
          {{ ct.label }}
        </OToggleGroupItem>
      </OToggleGroup>

      <div
        v-if="col.cellType === 'progress_bar' || col.cellType === 'sparkline'"
        class="tw:flex tw:flex-col tw:gap-3 tw:mt-2.5"
      >
        <div v-if="col.cellType === 'sparkline'" class="tw:flex tw:flex-col tw:gap-1.5">
          <span class="o-input-label">{{ t("dashboard.sparklineStyle") }}</span>
          <OToggleGroup v-model="col.sparklineStyle" type="single" class="cf-seg tw:h-8 tw:self-start">
            <OToggleGroupItem
              v-for="s in sparklineStyleOptions"
              :key="s.value"
              :value="s.value"
              size="sm"
              :icon-left="sparklineIcons[s.value]"
            >
              {{ s.label }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
        <div class="tw:flex tw:flex-col tw:gap-1.5">
          <span class="o-input-label">{{ t("dashboard.cellColor") }}</span>
          <ColorSwatchPicker v-model="col.progressColor" :swatches="ACCENT_SWATCHES" />
        </div>
      </div>
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
        <div class="tw:flex-1 tw:min-w-0 tw:py-[7px] tw:px-2 tw:rounded-md tw:bg-[rgba(128,128,128,0.04)] tw:border tw:border-[rgba(128,128,128,0.1)]">
          <div class="tw:flex tw:items-center tw:gap-1.5">
            <div class="tw:w-[64px] tw:shrink-0">
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
              class="tw:flex-1 tw:min-w-0"
            />
          </div>
          <div class="tw:flex tw:items-center tw:gap-2 tw:mt-[7px]">
            <span class="o-input-label tw:shrink-0 tw:min-w-16 tw:text-[var(--color-text-secondary,#9e9e9e)]">{{ t("dashboard.textColor") }}</span>
            <ColorSwatchPicker v-model="rule.textColor" :swatches="COND_TEXT_SWATCHES" />
          </div>
          <div class="tw:flex tw:items-center tw:gap-2 tw:mt-[7px]">
            <span class="o-input-label tw:shrink-0 tw:min-w-16 tw:text-[var(--color-text-secondary,#9e9e9e)]">{{ t("dashboard.bgColor") }}</span>
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
import { defineComponent, PropType } from "vue";
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
  ACCENT_SWATCHES,
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
    const { unitOptions, sparklineStyleOptions, conditionOperators } =
      useColumnFormattingOptions();

    const alignOptions = [
      { value: "left", label: t("dashboard.alignLeft"), icon: "align-left" },
      { value: "center", label: t("dashboard.alignCenter"), icon: "align-center" },
      { value: "right", label: t("dashboard.alignRight"), icon: "align-right" },
    ];

    const cellTypeOptionsCompact = [
      { value: "text", label: t("dashboard.cellTypeText"), icon: "text-fields" },
      { value: "progress_bar", label: t("dashboard.cellTypeBar"), icon: "bar-chart" },
      { value: "sparkline", label: t("dashboard.cellTypeSpark"), icon: "show-chart" },
    ];
    const sparklineIcons: Record<string, string> = {
      line: "show-chart",
      bar: "bar-chart",
    };

    // Tap-active-to-clear: snapshot before reka handles the click, clear if re-clicked.
    const setAlignment = (v: any) => {
      props.col.alignment = (v as string) || "";
    };
    let alignSnapshot = "";
    const onAlignPointerDown = () => {
      alignSnapshot = props.col.alignment;
    };
    const onAlignClickItem = (v: string) => {
      if (alignSnapshot === v) props.col.alignment = "";
    };

    return {
      t,
      unitOptions,
      alignOptions,
      cellTypeOptionsCompact,
      sparklineIcons,
      sparklineStyleOptions,
      conditionOperators,
      TEXT_SWATCHES,
      BG_SWATCHES,
      ACCENT_SWATCHES,
      COND_TEXT_SWATCHES,
      COND_BG_SWATCHES,
      setAlignment,
      onAlignPointerDown,
      onAlignClickItem,
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
