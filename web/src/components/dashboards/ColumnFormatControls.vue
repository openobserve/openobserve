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

<!--
  ColumnFormatControls — the shared formatting control sections (Value Format,
  Alignment, Cell Type, Styling, Conditional) used by BOTH the inline header
  popover (InlineColumnFormat) and the full Column Formatting dialog
  (OverrideConfigPopup), so the two editors look and behave identically.

  Operates directly on a reactive ColumnOverrideUI object (mutated in place).
  Numeric-only sections hide when `isNumeric` is false.
-->
<template>
  <div class="cf-controls">
    <!-- VALUE FORMATTING (numeric only) -->
    <div v-if="isNumeric" class="cf-section">
      <div class="o-input-label cf-section-label">
        {{ t("dashboard.sectionValueFormatting") }}
      </div>
      <OSelect
        v-model="col.unit"
        :options="unitOptions"
        class="tw:w-full"
        :data-test="`o2-format-unit-${col.field}`"
      />
      <OInput
        v-if="col.unit === 'custom'"
        v-model="col.customUnit"
        :label="t('dashboard.customunitLabel')"
        class="tw:w-full tw:mt-2"
        :data-test="`o2-format-custom-unit-${col.field}`"
      />
    </div>

    <!-- ALIGNMENT -->
    <div class="cf-section">
      <div class="o-input-label cf-section-label">
        {{ t("dashboard.sectionAlignment") }}
        <span class="cf-hint">· {{ t("dashboard.tapActiveToClear") }}</span>
      </div>
      <OToggleGroup
        class="cf-seg"
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

    <!-- CELL TYPE (numeric only) -->
    <div v-if="isNumeric" class="cf-section">
      <div class="o-input-label cf-section-label">
        {{ t("dashboard.sectionCellType") }}
      </div>
      <OToggleGroup v-model="col.cellType" type="single" class="cf-seg">
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
        class="cf-cs-row"
      >
        <div class="cf-cs-col">
          <span class="o-input-label">{{ t("dashboard.cellColor") }}</span>
          <ColorSwatchPicker v-model="col.progressColor" :swatches="ACCENT_SWATCHES" />
        </div>
        <div v-if="col.cellType === 'sparkline'" class="cf-cs-col">
          <span class="o-input-label">{{ t("dashboard.sparklineStyle") }}</span>
          <OToggleGroup v-model="col.sparklineStyle" type="single" class="cf-seg">
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
      </div>
    </div>

    <!-- STYLING -->
    <div class="cf-section">
      <div class="o-input-label cf-section-label">{{ t("dashboard.sectionStyling") }}</div>
      <div class="cf-subrow">
        <span class="o-input-label cf-inline-label">{{ t("dashboard.textColor") }}</span>
        <ColorSwatchPicker v-model="col.textColor" :swatches="TEXT_SWATCHES" />
      </div>
      <div class="cf-subrow">
        <span class="o-input-label cf-inline-label">{{ t("dashboard.bgColor") }}</span>
        <ColorSwatchPicker v-model="col.bgColor" :swatches="BG_SWATCHES" />
      </div>
      <button
        type="button"
        class="cf-toggle-box tw:mt-3"
        :class="{ 'cf-toggle-box--active': col.autoColor }"
        @click="col.autoColor = !col.autoColor"
      >
        <OCheckbox
          :model-value="col.autoColor"
          size="sm"
          class="tw:pointer-events-none"
        />
        <span class="o-input-label cf-toggle-label">{{
          t("dashboard.overrideConfigUniqueValueColor")
        }}</span>
      </button>
    </div>

    <!-- CONDITIONAL (numeric only) -->
    <div v-if="isNumeric" class="cf-section">
      <div class="o-input-label cf-section-label">
        {{ t("dashboard.sectionConditionalStyling") }}
      </div>
      <div v-if="!col.conditions.length" class="cf-empty">
        {{ t("dashboard.conditionNoRules") }}
      </div>
      <div
        v-for="(rule, ruleIdx) in col.conditions"
        :key="ruleIdx"
        class="cf-rule"
      >
        <div class="cf-rule-top">
          <OSelect
            v-model="rule.operator"
            :options="conditionOperators"
            class="cf-op"
          />
          <OInput
            v-model="rule.threshold"
            type="number"
            :placeholder="t('dashboard.conditionThreshold')"
            class="cf-grow"
          />
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="delete-outline"
            :title="t('common.remove')"
            @click="col.conditions.splice(ruleIdx, 1)"
          />
        </div>
        <div class="cf-rule-colors">
          <span class="o-input-label cf-inline-label cf-inline-label--muted">{{ t("dashboard.textColor") }}</span>
          <ColorSwatchPicker v-model="rule.textColor" :swatches="COND_TEXT_SWATCHES" />
        </div>
        <div class="cf-rule-colors">
          <span class="o-input-label cf-inline-label cf-inline-label--muted">{{ t("dashboard.bgColor") }}</span>
          <ColorSwatchPicker v-model="rule.bgColor" :swatches="COND_BG_SWATCHES" />
        </div>
      </div>
      <OButton
        variant="outline"
        size="sm"
        class="tw:mt-1"
        @click="col.conditions.push({ operator: '<', threshold: '', textColor: '', bgColor: '' })"
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
    /** The reactive column-override object being edited (mutated in place). */
    col: { type: Object as PropType<ColumnOverrideUI>, required: true },
    /** Numeric columns get value-format / cell-type / conditional sections. */
    isNumeric: { type: Boolean, default: false },
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

    // Alignment: OToggleGroup blocks empty emits, so support "tap active to
    // clear" by snapshotting before reka handles the click (capture phase) and
    // clearing only when the already-active item is re-clicked.
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
    };
  },
});
</script>

<style lang="scss" scoped>
.cf-section {
  padding: 8px 12px;

  & + & {
    border-top: 1px solid rgba(128, 128, 128, 0.08);
  }
}

.cf-section-label {
  display: block;
  margin-bottom: 6px;
}

.cf-hint {
  font-weight: 400;
  opacity: 0.6;
}

.cf-subrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.cf-inline-label {
  flex-shrink: 0;
  min-width: 64px;

  &--muted {
    color: var(--color-text-secondary, #9e9e9e);
    min-width: 64px;
  }
}

.cf-grow {
  flex: 1;
  min-width: 0;
}

// Segmented switchers: natural width, uniform 32px height matching the selects.
.cf-seg {
  height: 32px;

  :deep(button) {
    height: 100% !important;
    min-height: 0 !important;
  }
}

// Cell-type Color + Style side by side (label above each).
.cf-cs-row {
  display: flex;
  gap: 18px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.cf-cs-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

// "Unique value color" — bordered toggle box that highlights when active.
.cf-toggle-box {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid rgba(128, 128, 128, 0.28);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s, background 0.12s;

  &:hover {
    border-color: var(--color-primary-600, #1976d2);
  }

  &--active {
    border-color: var(--color-primary-600, #1976d2);
    background: color-mix(in srgb, var(--color-primary-600, #1976d2) 7%, transparent);
  }
}

.cf-toggle-label {
  cursor: pointer;
}

.cf-empty {
  font-size: var(--text-sm);
  color: var(--color-text-secondary, #9e9e9e);
  margin-bottom: 6px;
}

// ── Conditional rules ───────────────────────────────────────────────────────
.cf-rule {
  padding: 7px 8px;
  background: rgba(128, 128, 128, 0.04);
  border: 1px solid rgba(128, 128, 128, 0.1);
  border-radius: 6px;
  margin-bottom: 6px;
}

.cf-rule-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cf-op {
  width: 64px;
  flex-shrink: 0;
}

.cf-rule-colors {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
}
</style>
