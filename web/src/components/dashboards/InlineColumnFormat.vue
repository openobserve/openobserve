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
  InlineColumnFormat — the per-column header "Format" affordance + popover.

  Brings the Column Formatting controls to the rendered table header (the same
  "control on the column" pattern as Column Filtering). It is a SECOND editor
  over the same `config.override_config` model the dialog edits: on every
  change it serializes this one column and emits the full, upserted array so
  the parent can write it back to the panel config (live preview).

  Numeric-only sections (Value Format, Cell Type, Conditional) hide for text
  columns, mirroring the dialog.
-->
<template>
  <ODropdown
    side="bottom"
    align="end"
    :side-offset="6"
    :persistent="2"
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
          :class="
            hasFormatting
              ? 'tw:text-[var(--color-primary-600)]'
              : 'tw:opacity-50'
          "
        />
      </OButton>
    </template>

    <!-- Popover panel -->
    <div
      class="inline-format-panel"
      :data-test="`o2-table-column-format-panel-${field}`"
      @click.stop
      @keydown.stop
    >
      <!-- Header -->
      <div class="ifp-head">
        <div class="ifp-title">
          <span class="ifp-title-label">{{ t("dashboard.formatColumn") }}</span>
          <span class="ifp-title-field" :title="label">{{ label }}</span>
        </div>
      </div>

      <div class="ifp-body">
        <!-- PREVIEW -->
        <div
          v-if="previewColumn && previewRows.length"
          class="ifp-section ifp-preview"
        >
          <div class="o-input-label ifp-section-label">{{ t("dashboard.inlinePreview") }}</div>
          <!-- wrap-cells disables TenstackTable's dashboard virtualizer (and its
               ResizeObserver), which otherwise loops inside this popover. -->
          <div class="ifp-preview-table">
            <TableRenderer
              :data="previewTableData"
              :value-mapping="valueMapping"
              :wrap-cells="true"
            />
          </div>
        </div>

        <!-- VALUE FORMAT (numeric only) -->
        <div v-if="isNumeric" class="ifp-section">
          <div class="o-input-label ifp-section-label">
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

        <!-- ALIGNMENT -->
        <div class="ifp-section">
          <div class="o-input-label ifp-section-label">
            {{ t("dashboard.sectionAlignment") }}
            <span class="ifp-hint">· {{ t("dashboard.tapActiveToClear") }}</span>
          </div>
          <OToggleGroup
            class="ifp-seg"
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
        <div v-if="isNumeric" class="ifp-section">
          <div class="o-input-label ifp-section-label">
            {{ t("dashboard.sectionCellType") }}
          </div>
          <OToggleGroup v-model="col.cellType" type="single" class="ifp-seg">
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
            class="ifp-cs-row"
          >
            <div class="ifp-cs-col">
              <span class="o-input-label ifp-cs-label">{{ t("dashboard.cellColor") }}</span>
              <ColorSwatchPicker v-model="col.progressColor" :swatches="ACCENT_SWATCHES" />
            </div>
            <div v-if="col.cellType === 'sparkline'" class="ifp-cs-col">
              <span class="o-input-label ifp-cs-label">{{ t("dashboard.sparklineStyle") }}</span>
              <OToggleGroup v-model="col.sparklineStyle" type="single" class="ifp-seg">
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
        <div class="ifp-section">
          <div class="o-input-label ifp-section-label">{{ t("dashboard.sectionStyling") }}</div>
          <div class="ifp-subrow">
            <span class="o-input-label ifp-inline-label">{{ t("dashboard.textColor") }}</span>
            <ColorSwatchPicker v-model="col.textColor" :swatches="TEXT_SWATCHES" />
          </div>
          <div class="ifp-subrow">
            <span class="o-input-label ifp-inline-label">{{ t("dashboard.bgColor") }}</span>
            <ColorSwatchPicker v-model="col.bgColor" :swatches="BG_SWATCHES" />
          </div>
          <button
            type="button"
            class="ifp-toggle-box tw:mt-3"
            :class="{ 'ifp-toggle-box--active': col.autoColor }"
            :data-test="`o2-format-unique-color-${field}`"
            @click="col.autoColor = !col.autoColor"
          >
            <OCheckbox
              :model-value="col.autoColor"
              size="sm"
              class="tw:pointer-events-none"
            />
            <span class="o-input-label ifp-toggle-label">{{
              t("dashboard.overrideConfigUniqueValueColor")
            }}</span>
          </button>
        </div>

        <!-- CONDITIONAL (numeric only) -->
        <div v-if="isNumeric" class="ifp-section">
          <div class="o-input-label ifp-section-label">
            {{ t("dashboard.sectionConditionalStyling") }}
          </div>
          <div v-if="!col.conditions.length" class="ifp-empty">
            {{ t("dashboard.conditionNoRules") }}
          </div>
          <div
            v-for="(rule, ruleIdx) in col.conditions"
            :key="ruleIdx"
            class="ifp-rule"
          >
            <div class="ifp-rule-top">
              <OSelect
                v-model="rule.operator"
                :options="conditionOperators"
                class="ifp-op"
              />
              <OInput
                v-model="rule.threshold"
                type="number"
                :placeholder="t('dashboard.conditionThreshold')"
                class="ifp-grow"
              />
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="delete-outline"
                :title="t('common.remove')"
                @click="col.conditions.splice(ruleIdx, 1)"
              />
            </div>
            <div class="ifp-rule-colors">
              <span class="o-input-label ifp-inline-label ifp-inline-label--muted">{{ t("dashboard.textColor") }}</span>
              <ColorSwatchPicker v-model="rule.textColor" :swatches="COND_TEXT_SWATCHES" />
            </div>
            <div class="ifp-rule-colors">
              <span class="o-input-label ifp-inline-label ifp-inline-label--muted">{{ t("dashboard.bgColor") }}</span>
              <ColorSwatchPicker v-model="rule.bgColor" :swatches="COND_BG_SWATCHES" />
            </div>
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
      <div class="ifp-foot">
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
          variant="secondary"
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
  emits: ["update:override-config", "edit-all"],
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

    // OToggleGroup blocks empty emits (single-select can't deselect via the
    // model), so support "tap active to clear" by clearing on a direct click of
    // the active item; picking a different item flows through @update:model-value.
    const setAlignment = (v: any) => {
      col.alignment = (v as string) || "";
    };
    // OToggleGroup blocks empty emits, so support "tap active to clear" by
    // snapshotting the alignment in the capture phase (before reka processes the
    // click) and clearing only when the already-active item is re-clicked.
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

    // Stable data object for the mini preview TableRenderer — only changes when
    // the (already-stable) column/rows props change.
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
.inline-format-panel {
  width: 300px;
  // Cap to the space the dropdown actually has so it never overflows a small
  // screen — the body scrolls inside instead of getting clipped.
  max-height: min(
    560px,
    var(--reka-dropdown-menu-content-available-height, 72vh)
  );
  display: flex;
  flex-direction: column;
  font-size: 0.8rem;
  overflow: hidden;
}

// ── Header ──────────────────────────────────────────────────────────────────
.ifp-head {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 9px 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.16);
}

.ifp-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

// "Format column" reads as a muted prefix so the field name is the focal point.
.ifp-title-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary, #757575);
  flex-shrink: 0;
}

// Field name as a distinct code chip — easy to scan at a glance.
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

// ── Body ────────────────────────────────────────────────────────────────────
.ifp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 0;
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

.ifp-section {
  padding: 8px 12px;

  & + & {
    border-top: 1px solid rgba(128, 128, 128, 0.08);
  }
}

// Section labels reuse the global .o-input-label spec (sentence-case, 13px,
// weight 500) so they match every other field label in the config panel.
.ifp-section-label {
  display: block;
  margin-bottom: 6px;
}

.ifp-hint {
  font-weight: 400;
  opacity: 0.6;
}

.ifp-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ifp-grow {
  flex: 1;
  min-width: 0;
}

.ifp-subrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.ifp-inline-label {
  flex-shrink: 0;
  min-width: 64px;

  &--muted {
    color: var(--color-text-secondary, #9e9e9e);
    min-width: 64px;
  }
}

// Segmented switchers (alignment / cell type / style): natural width, with a
// uniform 32px outer height that matches the OSelect/OInput controls.
.ifp-seg {
  height: 32px;

  :deep(button) {
    height: 100% !important;
    min-height: 0 !important;
  }
}

// Cell-type Color + Style sit side by side (label above each), per the design.
.ifp-cs-row {
  display: flex;
  gap: 18px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.ifp-cs-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ifp-cs-label {
  display: block;
}

// "Unique value color" — bordered toggle box that highlights when active.
.ifp-toggle-box {
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

.ifp-toggle-label {
  cursor: pointer;
}

// Empty state for the conditional section.
.ifp-empty {
  font-size: var(--text-sm);
  color: var(--color-text-secondary, #9e9e9e);
  margin-bottom: 6px;
}

// ── Preview ─────────────────────────────────────────────────────────────────
// A compact, header-less mini TableRenderer rendering just this column, so the
// preview shows the real cells (progress bars / sparklines / conditional colors).
.ifp-preview-table {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 6px;
  overflow: hidden;
  max-height: 150px;

  // The popover title already names the column; drop the table header + footer.
  :deep(thead) {
    display: none;
  }

  :deep([data-test="dashboard-table-pagination"]) {
    display: none;
  }

  // Single preview column fills the box, so progress-bar tracks span the full
  // column width (otherwise the cell sizes to content and the track is a sliver).
  :deep(.copy-cell-td) {
    width: 100% !important;
    max-width: none !important;
  }

  // Hide the per-cell copy-to-clipboard button in the preview.
  :deep([data-test="dashboard-table-cell-copy-btn"]) {
    display: none !important;
  }
}

// ── Conditional rules ───────────────────────────────────────────────────────
.ifp-rule {
  padding: 7px 8px;
  background: rgba(128, 128, 128, 0.04);
  border: 1px solid rgba(128, 128, 128, 0.1);
  border-radius: 6px;
  margin-bottom: 6px;
}

.ifp-rule-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ifp-op {
  width: 64px;
  flex-shrink: 0;
}

.ifp-rule-colors {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
}

// ── Footer ──────────────────────────────────────────────────────────────────
.ifp-foot {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.16);
}
</style>
