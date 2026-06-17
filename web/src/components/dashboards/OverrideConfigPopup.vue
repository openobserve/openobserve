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

<!-- "Edit all" column-formatting dialog (Variant B split editor): an accordion
     of columns, each expanding into shared controls (left) + a live preview
     (right). The ODialog body is the single, fixed-height scroll region. -->
<template>
  <ODialog
    data-test="override-config-popup-dialog"
    :open="open"
    @update:open="(v: boolean) => { if (!v) closePopup() }"
    :title="t('dashboard.columnFormattingTitle')"
    :sub-title="t('dashboard.columnFormattingSubtitle')"
    :width="74"
    :neutral-button-label="t('dashboard.cancel')"
    neutral-button-variant="outline"
    :primary-button-label="t('dashboard.overrideConfigSave')"
    @click:neutral="closePopup"
    @click:primary="saveOverrides"
  >
    <div
      class="cf-body tw:flex tw:flex-col tw:gap-2 tw:px-0.5 tw:py-1 tw:h-[calc(86vh-150px)] tw:overflow-y-auto"
      data-test="override-config-accordion"
    >
      <!-- Accordion of column overrides -->
      <div
        v-for="(col, idx) in columnOverrides"
        :key="idx"
        class="tw:border tw:border-[rgba(128,128,128,0.2)] tw:rounded-lg tw:overflow-hidden tw:shrink-0 tw:transition-colors"
        :class="isExpanded(idx) ? 'tw:border-[var(--color-primary-600)]!' : ''"
        :data-test="`override-config-row-${idx}`"
      >
        <!-- Row header: clickable toggle + sibling delete (no nested <button>) -->
        <div
          class="tw:flex tw:items-center tw:gap-1 tw:pr-2"
          :class="isExpanded(idx) ? 'tw:border-b tw:border-[rgba(128,128,128,0.14)] tw:bg-[rgba(128,128,128,0.06)]' : ''"
        >
          <button
            type="button"
            class="tw:flex tw:items-center tw:gap-2 tw:flex-1 tw:min-w-0 tw:py-2 tw:pl-2.5 tw:pr-1 tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-left tw:text-inherit tw:hover:bg-[rgba(128,128,128,0.05)]"
            :data-test="`override-config-row-toggle-${idx}`"
            @click="toggle(idx)"
          >
            <OIcon
              :name="isExpanded(idx) ? 'expand-more' : 'chevron-right'"
              size="sm"
              class="tw:shrink-0 tw:text-[var(--o2-text-2,#757575)]"
            />
            <span
              class="tw:shrink-0 tw:text-[9px] tw:font-bold tw:tracking-[0.05em] tw:uppercase tw:py-0.5 tw:px-[5px] tw:rounded"
              :class="isNumericColumn(col) ? 'tw:text-[#2e55a3] tw:bg-[rgba(46,85,163,0.1)]' : 'tw:text-[#6b7280] tw:bg-[rgba(107,114,128,0.12)]'"
            >
              {{ isNumericColumn(col) ? t("dashboard.typeNumeric") : t("dashboard.typeText") }}
            </span>
            <span
              class="tw:shrink-0 tw:font-semibold tw:text-[length:var(--text-sm,13px)] tw:max-w-[200px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
              :title="getFieldLabel(col.field)"
            >
              {{ getFieldLabel(col.field) || t("dashboard.columnFormattingPick") }}
            </span>

            <!-- Collapsed summary chips -->
            <span
              v-if="!isExpanded(idx) && col.field"
              class="tw:flex tw:items-center tw:gap-[5px] tw:overflow-hidden tw:flex-nowrap"
            >
              <span
                v-for="(chip, ci) in summaryChips(col)"
                :key="ci"
                class="tw:inline-flex tw:items-center tw:gap-1 tw:shrink-0 tw:text-[11px] tw:text-[var(--o2-text-2,#757575)] tw:bg-[rgba(128,128,128,0.08)] tw:py-px tw:px-[7px] tw:rounded-full tw:whitespace-nowrap"
              >
                <span
                  v-if="chip.swatch"
                  class="tw:inline-block tw:w-2.5 tw:h-2.5 tw:rounded-[3px] tw:border tw:border-[rgba(128,128,128,0.3)]"
                  :style="{ background: chip.swatch }"
                />
                {{ chip.text }}
              </span>
            </span>
          </button>

          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="delete-outline"
            :data-test="`dashboard-addpanel-config-delete-column-${idx}`"
            class="tw:shrink-0"
            @click.stop="removeColumn(idx)"
          />
        </div>

        <!-- Expanded split editor -->
        <div v-show="isExpanded(idx)" class="cf-row-body">
          <!-- Left: controls -->
          <div class="tw:flex tw:flex-col tw:gap-2.5 tw:min-w-0">
            <div class="tw:flex tw:flex-col tw:gap-1">
              <label class="o-input-label">{{ t("dashboard.overrideConfigFieldLabel") }}</label>
              <OSelect
                v-model="col.field"
                :options="columnOptionsFor(idx)"
                :placeholder="t('dashboard.columnFormattingPick')"
                :data-test="`dashboard-addpanel-config-field-select-${idx}`"
              />
            </div>

            <ColumnFormatControls
              v-if="col.field"
              :col="col"
              :is-numeric="isNumericColumn(col)"
            />
          </div>

          <!-- Right: live preview (real data, or type-based dummy data) -->
          <div class="tw:min-w-0 tw:flex tw:flex-col tw:gap-1.5">
            <div class="tw:flex tw:items-center tw:gap-[5px] tw:text-[10px] tw:font-bold tw:tracking-[0.06em] tw:uppercase tw:text-[var(--o2-text-2,#757575)]">
              <OIcon name="visibility" size="xs" />
              <span>{{ t("dashboard.inlinePreview") }}</span>
            </div>
            <div class="cf-preview-table tw:border tw:border-[rgba(128,128,128,0.18)] tw:rounded-md tw:overflow-hidden">
              <TableRenderer
                v-if="col.field && previews[idx]"
                :data="previews[idx]"
                :value-mapping="valueMapping"
                :wrap-cells="true"
                :show-pagination="false"
              />
              <div v-else class="tw:p-4 tw:text-center tw:text-xs tw:text-[var(--o2-text-2,#9e9e9e)]">
                {{ t("dashboard.columnFormattingPick") }}
              </div>
            </div>
            <div class="tw:text-[11px] tw:text-[var(--o2-text-2,#9e9e9e)]">{{ t("dashboard.columnFormattingSampleNote") }}</div>
          </div>
        </div>
      </div>

      <!-- Add column -->
      <button
        type="button"
        class="tw:flex tw:items-center tw:justify-center tw:gap-1.5 tw:w-full tw:shrink-0 tw:p-[9px] tw:rounded-lg tw:border tw:border-[rgba(128,128,128,0.35)] tw:bg-transparent tw:cursor-pointer tw:text-[length:var(--text-sm,13px)] tw:font-medium tw:text-[var(--color-primary-600,#1976d2)] tw:transition-colors tw:hover:bg-[rgba(25,118,210,0.05)] tw:hover:border-[var(--color-primary-600)]"
        data-test="dashboard-addpanel-config-add-column"
        @click="addColumn"
      >
        <OIcon name="add" size="sm" />
        {{ t("dashboard.columnFormattingAddColumn") }}
      </button>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, defineAsyncComponent, PropType } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ColumnFormatControls from "./ColumnFormatControls.vue";
import {
  type ColumnOverrideUI,
  emptyColumnOverride,
  loadAllFromRaw,
  serializeOverrides,
  serializeColumnOverride,
  useColumnFormattingOptions,
} from "@/composables/dashboard/useColumnFormatting";
import {
  parseOverrideConfigs,
  applyColumnOverrides,
  buildValueMappingCache,
  formatNumericValue,
} from "@/utils/dashboard/tableConfigUtils";

// Async import breaks the circular dependency (TableRenderer renders this dialog).
const TableRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/TableRenderer.vue"),
);

export default defineComponent({
  name: "OverrideConfigPopup",
  components: { OButton, OIcon, ODialog, OSelect, ColumnFormatControls, TableRenderer },
  props: {
    open: {
      type: Boolean,
      required: true,
    },
    columns: {
      type: Array as PropType<
        Array<{ label: string; alias: string; isNumeric?: boolean }>
      >,
      required: true,
    },
    overrideConfig: {
      type: Object as PropType<{ overrideConfigs?: any[] }>,
      required: true,
    },
    /** Per-column sample preview: { [aliasLower]: { column, rows } }. */
    previewData: {
      type: Object as PropType<Record<string, { column: any; rows: any[] }>>,
      default: () => ({}),
    },
    valueMapping: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    // Panel-level fallbacks so the preview matches the real table when a column
    // has no per-column unit / when the panel sets non-default decimals.
    panelUnit: {
      type: String,
      default: "",
    },
    panelUnitCustom: {
      type: String,
      default: "",
    },
    panelDecimals: {
      type: Number,
      default: 2,
    },
  },
  emits: ["close", "save"],
  setup(props: any, { emit }: any) {
    const { t } = useI18n();
    const { unitOptions, alignOptions } = useColumnFormattingOptions();

    const columnOverrides = ref<ColumnOverrideUI[]>([]);
    // Multi-expand: any number of rows can be open at once (indices).
    const expanded = ref<Set<number>>(new Set([0]));
    const isExpanded = (idx: number) => expanded.value.has(idx);

    const initFromProps = () => {
      const loaded = loadAllFromRaw(props.overrideConfig.overrideConfigs ?? []);
      columnOverrides.value =
        loaded.length > 0 ? loaded : [emptyColumnOverride()];
      expanded.value = new Set([0]);
    };

    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) initFromProps();
      },
      { immediate: true },
    );

    const toggle = (idx: number) => {
      const next = new Set(expanded.value);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      expanded.value = next;
    };

    const allColumnOptions = computed(() =>
      props.columns.map((c: any) => ({ label: c.label, value: c.alias })),
    );

    const columnOptionsFor = (idx: number) => {
      const used = new Set(
        columnOverrides.value
          .map((c, i) => (i !== idx ? c.field : null))
          .filter(Boolean),
      );
      return allColumnOptions.value.filter((o: any) => !used.has(o.value));
    };

    const getFieldLabel = (alias: string) => {
      if (!alias) return "";
      return (
        allColumnOptions.value.find((o: any) => o.value === alias)?.label ??
        `${alias}`
      );
    };

    // Auto-detected numeric-ness from the query data.
    const detectedNumeric = (field: string): boolean => {
      if (!field) return false;
      return props.columns.find((c: any) => c.alias === field)?.isNumeric ?? false;
    };

    // Effective numeric-ness: the per-column field-type override wins over
    // detection ("num"/"text" force it; "auto" keeps the detected value).
    const isNumericColumn = (col: ColumnOverrideUI): boolean =>
      col.fieldType === "num"
        ? true
        : col.fieldType === "text"
          ? false
          : detectedNumeric(col.field);

    // Reset numeric-only settings when a column becomes non-numeric.
    watch(
      () => columnOverrides.value.map((c) => c.field),
      (fields, prevFields) => {
        fields.forEach((field, i) => {
          if (field !== prevFields?.[i] && !isNumericColumn(columnOverrides.value[i])) {
            columnOverrides.value[i].unit = null;
            columnOverrides.value[i].customUnit = null;
            columnOverrides.value[i].conditions = [];
          }
        });
      },
    );

    const unitLabel = (unit: string) =>
      unitOptions.find((o) => o.value === unit)?.label ?? unit;
    const alignLabel = (align: string) =>
      alignOptions.find((o) => o.value === align)?.label ?? align;

    const summaryChips = (col: ColumnOverrideUI) => {
      const chips: Array<{ text: string; swatch?: string }> = [];
      if (col.unit)
        chips.push({
          text:
            col.unit === "custom"
              ? col.customUnit || t("dashboard.custom")
              : unitLabel(col.unit),
        });
      if (col.alignment) chips.push({ text: alignLabel(col.alignment) });
      if (col.autoColor) chips.push({ text: t("dashboard.overrideConfigUniqueValueColor") });
      else if (col.bgColor) chips.push({ text: "", swatch: col.bgColor });
      else if (col.textColor) chips.push({ text: "", swatch: col.textColor });
      if (col.conditions?.length)
        chips.push({ text: `${col.conditions.length} ${t("dashboard.conditionalStyling").toLowerCase()}` });
      return chips;
    };

    // Build a preview column def from the in-progress override, routing through
    // the SAME serialize -> parse -> apply pipeline the real table uses so the
    // preview can never diverge from the rendered result.
    const buildPreviewColumn = (base: any, col: ColumnOverrideUI, isNumeric: boolean) => {
      const c: any = { ...base };
      delete c.colorMode;
      delete c.textColor;
      delete c.bgColor;
      delete c.conditionalRules;

      const aliasLower = String(col.field ?? "").toLowerCase();
      const entry = serializeColumnOverride(col);
      const maps = parseOverrideConfigs(entry ? [entry] : []);
      applyColumnOverrides(c, aliasLower, maps, isNumeric ? "right" : "left");

      if (isNumeric) {
        const cache = buildValueMappingCache(props.valueMapping);
        // Match the real converter: fall back to the panel-level unit / decimals.
        const unit = maps.unitConfigMap[aliasLower]?.unit || props.panelUnit;
        const customUnit =
          maps.unitConfigMap[aliasLower]?.customUnit || props.panelUnitCustom;
        const decimals = props.panelDecimals ?? 2;
        c.format = (val: any) =>
          formatNumericValue(val, cache, unit, customUnit, decimals);
      }
      return c;
    };

    // Sample values used when the query returned no rows for a column, so the
    // preview still demonstrates the formatting. Picked by the effective type.
    const DUMMY_NUMERIC = [12, 47, 83, 100, 6];
    const DUMMY_TEXT = ["alpha", "bravo", "charlie", "delta", "echo"];
    const makeDummyRows = (dataKey: string, isNumeric: boolean) =>
      (isNumeric ? DUMMY_NUMERIC : DUMMY_TEXT).map((v) => ({ [dataKey]: v }));

    const previewFor = (col: ColumnOverrideUI) => {
      const pd = props.previewData ?? {};
      const key = String(col.field ?? "").toLowerCase();
      // Fast path by alias key, else match alias/field/name case-insensitively.
      let base = pd[key];
      if (!base?.column) {
        base = Object.values(pd).find((d: any) =>
          [d?.column?.alias, d?.column?.field, d?.column?.name].some(
            (v) => String(v ?? "").toLowerCase() === key,
          ),
        ) as any;
      }
      const isNumeric = isNumericColumn(col);
      // Synthesize a column when the field isn't in the preview data (e.g. the
      // query returned nothing), so the preview still renders.
      const label = getFieldLabel(col.field) || col.field;
      const baseColumn = base?.column ?? {
        field: col.field,
        alias: col.field,
        name: label,
        label,
      };
      const dataKey = String(
        baseColumn.field ?? baseColumn.alias ?? baseColumn.name ?? col.field,
      );
      // No real rows → fall back to type-appropriate dummy data so the unit,
      // conditional styling, etc. all have something to render.
      const rows = base?.rows?.length
        ? base.rows
        : makeDummyRows(dataKey, isNumeric);
      const previewCol = buildPreviewColumn(baseColumn, col, isNumeric);
      return { rows, columns: [previewCol] };
    };

    const previews = computed(() =>
      columnOverrides.value.map((c) => (c.field ? previewFor(c) : null)),
    );

    const addColumn = () => {
      columnOverrides.value.push(emptyColumnOverride());
      const next = new Set(expanded.value);
      next.add(columnOverrides.value.length - 1);
      expanded.value = next;
    };
    const removeColumn = (idx: number) => {
      columnOverrides.value.splice(idx, 1);
      // Drop the removed index and shift higher ones down by one.
      const next = new Set<number>();
      expanded.value.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      expanded.value = next;
    };

    const closePopup = () => emit("close");

    const saveOverrides = () => {
      const raw = serializeOverrides(columnOverrides.value);
      props.overrideConfig.overrideConfigs = raw;
      emit("save", raw);
      emit("close");
    };

    return {
      t,
      columnOverrides,
      isExpanded,
      toggle,
      columnOptionsFor,
      getFieldLabel,
      isNumericColumn,
      summaryChips,
      previews,
      addColumn,
      removeColumn,
      closePopup,
      saveOverrides,
    };
  },
});
</script>

<style lang="scss" scoped>
// Single fixed-height scroll region (scrollbar only; layout is utilities).
.cf-body {
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.4) transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.35);
    border-radius: 3px;
  }
}

// Expanded split editor — stacks to one column on narrow screens.
.cf-row-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  padding: 12px;

  @media (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

// Hide the per-cell copy button inside the mini preview.
.cf-preview-table :deep([data-test="dashboard-table-cell-copy-btn"]) {
  display: none !important;
}
</style>
