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

<!-- Per-column header "Format" affordance + popover — a second editor over the
     same config.override_config model the dialog edits. Each change serializes
     this column and emits the full upserted array (live preview). Numeric-only
     sections hide for text columns. -->
<template>
  <ODropdown
    side="bottom"
    align="end"
    :side-offset="6"
    @update:open="onOpenChange"
  >
    <template #trigger>
      <OButton
        variant="ghost"
        size="icon-xs"
        :title="t('dashboard.formatColumn')"
        :data-test="`o2-table-column-format-btn-${field}`"
        class="tw:ml-0.5 tw:shrink-0 tw:h-5! tw:w-5! tw:min-h-0! tw:p-0!"
        @click.stop
      >
        <OIcon
          name="tune"
          size="sm"
          :class="hasFormatting ? 'tw:text-[var(--color-primary-600)]' : 'tw:opacity-50'"
        />
      </OButton>
    </template>

    <!-- Popover panel -->
    <div
      class="inline-format-panel tw:w-[300px] tw:flex tw:flex-col tw:text-[0.8rem] tw:overflow-hidden"
      :data-test="`o2-table-column-format-panel-${field}`"
      @click.stop
      @keydown.stop
    >
      <!-- Header -->
      <div class="tw:flex tw:items-center tw:shrink-0 tw:py-[9px] tw:px-3 tw:border-b tw:border-[rgba(128,128,128,0.16)]">
        <div class="tw:flex tw:items-center tw:gap-[7px] tw:min-w-0">
          <span class="tw:text-[length:var(--text-sm)] tw:font-medium tw:text-[var(--color-text-secondary,#757575)] tw:shrink-0">{{ t("dashboard.formatColumn") }}</span>
          <span class="ifp-title-field" :title="label">{{ label }}</span>
        </div>
      </div>

      <div class="ifp-body tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden tw:py-0.5 tw:divide-y tw:divide-[rgba(128,128,128,0.08)]">
        <!-- Preview -->
        <div
          v-if="previewColumn && previewRows.length"
          class="tw:px-3 tw:py-2"
        >
          <div class="o-input-label tw:block tw:mb-1.5">{{ t("dashboard.inlinePreview") }}</div>
          <!-- wrap-cells disables the dashboard virtualizer (its ResizeObserver loops in the popover). -->
          <div class="ifp-preview-table tw:border tw:border-[rgba(128,128,128,0.2)] tw:rounded-md tw:overflow-hidden tw:max-h-[150px]">
            <TableRenderer
              :data="previewTableData"
              :value-mapping="valueMapping"
              :wrap-cells="true"
            />
          </div>
        </div>

        <!-- Value format (numeric only) -->
        <div v-if="isNumeric" class="tw:px-3 tw:py-2">
          <div class="o-input-label tw:block tw:mb-1.5">
            {{ t("dashboard.sectionValueFormatting") }}
          </div>
          <OSelect
            v-model="col.unit"
            :options="unitOptions"
            class="tw:w-full"
            :data-test="`o2-table-format-unit-${field}`"
          />
          <OInput
            v-if="col.unit === 'custom'"
            v-model="col.customUnit"
            :label="t('dashboard.customunitLabel')"
            class="tw:w-full tw:mt-2"
            :data-test="`o2-table-format-custom-unit-${field}`"
          />
        </div>

        <!-- Alignment -->
        <div class="tw:px-3 tw:py-2">
          <div class="o-input-label tw:block tw:mb-1.5">
            {{ t("dashboard.sectionAlignment") }}
            <span class="tw:font-normal tw:opacity-60">· {{ t("dashboard.tapActiveToClear") }}</span>
          </div>
          <OToggleGroup
            class="ifp-seg tw:h-8"
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
          <OToggleGroup v-model="col.cellType" type="single" class="ifp-seg tw:h-8">
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
              <span class="o-input-label tw:block">{{ t("dashboard.sparklineStyle") }}</span>
              <OToggleGroup v-model="col.sparklineStyle" type="single" class="ifp-seg tw:h-8 tw:self-start">
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
              <span class="o-input-label tw:block">{{ t("dashboard.cellColor") }}</span>
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
            :class="{ 'ifp-toggle-active': col.autoColor }"
            :data-test="`o2-format-unique-color-${field}`"
            @click="col.autoColor = !col.autoColor"
          >
            <OCheckbox
              :model-value="col.autoColor"
              size="sm"
              class="tw:pointer-events-none"
            />
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
            data-test="o2-format-add-rule"
            @click="col.conditions.push({ operator: '<', threshold: '', textColor: '', bgColor: '' })"
          >
            {{ t("dashboard.conditionAddRule") }}
          </OButton>
        </div>
      </div>

      <!-- Footer -->
      <div class="tw:flex tw:items-center tw:shrink-0 tw:gap-2 tw:py-2 tw:px-3 tw:border-t tw:border-[rgba(128,128,128,0.16)]">
        <OButton
          variant="outline"
          size="sm"
          icon-left="restart-alt"
          :data-test="`o2-table-format-reset-${field}`"
          @click="resetColumn"
        >
          {{ t("dashboard.resetColumn") }}
        </OButton>
        <div class="tw:flex-1" />
        <OButton
          variant="outline-primary"
          size="sm"
          icon-right="open-in-full"
          :data-test="`o2-table-format-editall-${field}`"
          @click="$emit('edit-all', field)"
        >
          {{ t("dashboard.editAll") }}
        </OButton>
      </div>
    </div>
  </ODropdown>
</template>

<script lang="ts">
import {
  defineComponent,
  defineAsyncComponent,
  reactive,
  computed,
  watch,
  PropType,
  nextTick,
} from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ColorSwatchPicker from "./ColorSwatchPicker.vue";
import {
  type ColumnOverrideUI,
  emptyColumnOverride,
  loadColumnFromRaw,
  serializeColumnOverride,
  upsertColumnOverride,
  useColumnFormattingOptions,
  TEXT_SWATCHES,
  BG_SWATCHES,
  ACCENT_SWATCHES,
  COND_TEXT_SWATCHES,
  COND_BG_SWATCHES,
} from "@/composables/dashboard/useColumnFormatting";

// Async import breaks the circular dependency (TableRenderer renders this popover).
const TableRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/TableRenderer.vue"),
);

export default defineComponent({
  name: "InlineColumnFormat",
  components: {
    OButton,
    OIcon,
    OSelect,
    OInput,
    OCheckbox,
    ODropdown,
    OToggleGroup,
    OToggleGroupItem,
    ColorSwatchPicker,
    TableRenderer,
  },
  props: {
    /** Column alias / data key. */
    field: { type: String, required: true },
    /** Display label for the header. */
    label: { type: String, default: "" },
    /** Numeric columns get value-format / cell-type / conditional sections. */
    isNumeric: { type: Boolean, default: false },
    /** Current config.override_config array (source of truth). */
    overrideConfigs: { type: Array as PropType<any[]>, default: () => [] },
    /** Live column definition (drives the mini-table preview). */
    previewColumn: { type: Object as PropType<any>, default: null },
    /** A few sample rows for the preview table. */
    previewRows: { type: Array as PropType<any[]>, default: () => [] },
    /** Panel value mappings, forwarded to the preview table. */
    valueMapping: { type: Array as PropType<any[]>, default: () => [] },
  },
  emits: ["update:override-config", "edit-all", "open-change"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const { unitOptions, sparklineStyleOptions, conditionOperators } =
      useColumnFormattingOptions();

    // Alignment as an icon-only segmented control (tooltip carries the label).
    const alignOptions = [
      { value: "left", label: t("dashboard.alignLeft"), icon: "align-left" },
      { value: "center", label: t("dashboard.alignCenter"), icon: "align-center" },
      { value: "right", label: t("dashboard.alignRight"), icon: "align-right" },
    ];

    // Compact cell-type switcher (short labels + icons) — fits the popover width.
    const cellTypeOptionsCompact = [
      { value: "text", label: t("dashboard.cellTypeText"), icon: "text-fields" },
      { value: "progress_bar", label: t("dashboard.cellTypeBar"), icon: "bar-chart" },
      { value: "sparkline", label: t("dashboard.cellTypeSpark"), icon: "show-chart" },
    ];
    const sparklineIcons: Record<string, string> = {
      line: "show-chart",
      bar: "bar-chart",
    };

    // Local editable copy of this column's formatting.
    const col = reactive<ColumnOverrideUI>(emptyColumnOverride(props.field));

    // Guards an emit feedback loop while we (re)load from props.
    let loading = false;

    const loadFromProps = () => {
      loading = true;
      Object.assign(col, loadColumnFromRaw(props.overrideConfigs, props.field));
      col.field = props.field;
      nextTick(() => {
        loading = false;
      });
    };

    const onOpenChange = (open: boolean) => {
      if (open) loadFromProps();
      // Parent freezes (apply-on-close) the rendered table while open.
      emit("open-change", open);
    };

    // Push every change up as a full, upserted override_config array (live).
    watch(
      col,
      () => {
        if (loading) return;
        const entry = serializeColumnOverride(col, props.isNumeric);
        const next = upsertColumnOverride(
          props.overrideConfigs,
          props.field,
          entry,
        );
        emit("update:override-config", next);
      },
      { deep: true },
    );

    // Tap-active-to-clear: OToggleGroup blocks empty emits, so snapshot in the
    // capture phase and clear only when the already-active item is re-clicked.
    const setAlignment = (v: any) => {
      col.alignment = (v as string) || "";
    };
    let alignSnapshot = "";
    const onAlignPointerDown = () => {
      alignSnapshot = col.alignment;
    };
    const onAlignClickItem = (v: string) => {
      if (alignSnapshot === v) col.alignment = "";
    };

    const resetColumn = () => {
      loading = true;
      Object.assign(col, emptyColumnOverride(props.field));
      const next = upsertColumnOverride(
        props.overrideConfigs,
        props.field,
        null,
      );
      emit("update:override-config", next);
      nextTick(() => {
        loading = false;
      });
    };

    const hasFormatting = computed(() =>
      (props.overrideConfigs ?? []).some(
        (e: any) => e?.field?.value === props.field && e?.config?.length,
      ),
    );

    // Stable data object for the mini preview TableRenderer.
    const previewTableData = computed(() => ({
      rows: props.previewRows,
      columns: props.previewColumn ? [props.previewColumn] : [],
    }));

    return {
      t,
      col,
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
      onOpenChange,
      setAlignment,
      onAlignPointerDown,
      onAlignClickItem,
      resetColumn,
      hasFormatting,
      previewTableData,
    };
  },
});
</script>

<style lang="scss" scoped>
// Cap to the dropdown's available height so it scrolls inside, never clips.
.inline-format-panel {
  max-height: min(560px, var(--reka-dropdown-menu-content-available-height, 72vh));
}

// Field-name code chip (themed).
.ifp-title-field {
  font-family: monospace;
  font-weight: 700;
  font-size: 0.82rem;
  padding: 2px 8px;
  border-radius: 5px;
  background: rgba(128, 128, 128, 0.14);
  color: var(--color-text-primary, #1a1a1a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 170px;
}
.body--dark .ifp-title-field {
  background: rgba(255, 255, 255, 0.12);
  color: #e8e8e8;
}

// Body scrollbar (layout is utilities).
.ifp-body {
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.4) transparent;

  &::-webkit-scrollbar {
    width: 5px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.35);
    border-radius: 3px;
  }
}

// Segmented switchers: child buttons fill the 32px outer height.
.ifp-seg :deep(button) {
  height: 100% !important;
  min-height: 0 !important;
}

// "Unique value color" toggle — active tint (color-mix has no Tailwind form).
.ifp-toggle-active {
  border-color: var(--color-primary-600, #1976d2) !important;
  background: color-mix(in srgb, var(--color-primary-600, #1976d2) 7%, transparent) !important;
}

// Mini preview: header-less, full-width column, no copy button.
.ifp-preview-table {
  :deep(thead) {
    display: none;
  }
  :deep([data-test="dashboard-table-pagination"]) {
    display: none;
  }
  :deep(.copy-cell-td) {
    width: 100% !important;
    max-width: none !important;
  }
  :deep([data-test="dashboard-table-cell-copy-btn"]) {
    display: none !important;
  }
}
</style>
