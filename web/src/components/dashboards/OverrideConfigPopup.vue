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
  <div class="column-formatting-popup">
    <!-- Header -->
    <div class="popup-header">
      <span class="popup-title">{{ t("dashboard.columnFormattingTitle") }}</span>
      <q-btn icon="close" flat round size="sm" @click="closePopup" />
    </div>

    <!-- Scrollable body -->
    <div class="overrides-body">
      <div v-for="(col, idx) in columnOverrides" :key="idx" class="override-card">
        <!-- Field selector row -->
        <div class="override-card-head">
          <q-select
            v-model="col.field"
            :options="columnOptionsFor(idx)"
            :label="t('dashboard.overrideConfigFieldLabel')"
            :display-value="getFieldLabel(col.field)"
            dense
            borderless
            emit-value
            map-options
            input-debounce="0"
            hide-bottom-space
            class="override-field-select o2-custom-select-dashboard"
          />
          <q-btn icon="delete_outline" flat dense round size="sm" color="grey-6" @click="removeColumn(idx)" />
        </div>

        <template v-if="col.field">
          <!-- VALUE FORMATTING (numeric only) -->
          <template v-if="isNumericColumn(col.field)">
            <div class="config-section">
              <div class="section-label">{{ t("dashboard.sectionValueFormatting") }}</div>
              <div class="control-row">
                <q-select
                  v-model="col.unit"
                  :options="unitOptions"
                  :label="t('dashboard.overrideConfigUnitLabel')"
                  dense
                  outlined
                  emit-value
                  map-options
                  input-debounce="0"
                  hide-bottom-space
                  class="o2-custom-select-dashboard"
                  style="min-width: 160px"
                />
                <q-input
                  v-if="col.unit === 'custom'"
                  v-model="col.customUnit"
                  :label="t('dashboard.customunitLabel')"
                  dense
                  outlined
                  hide-bottom-space
                  style="min-width: 110px"
                />
              </div>
            </div>
          </template>

          <!-- CELL TYPE (numeric only) -->
          <template v-if="isNumericColumn(col.field)">
            <div class="config-section">
              <div class="section-label">{{ t("dashboard.sectionCellType") }}</div>
              <div class="toggle-group">
                <q-btn
                  v-for="ct in cellTypeOptions"
                  :key="ct.value"
                  :icon="ct.icon"
                  :label="ct.label"
                  flat
                  no-caps
                  size="sm"
                  :class="['toggle-btn', col.cellType === ct.value && 'toggle-btn--active']"
                  @click="col.cellType = ct.value"
                />
              </div>

              <!-- Color (shown for progress_bar and sparkline) -->
              <template v-if="col.cellType === 'progress_bar' || col.cellType === 'sparkline'">
                <div class="inline-control q-mt-sm">
                  <span class="option-label">{{ t("dashboard.progressColor") }}</span>
                  <label class="color-swatch-label">
                    <span
                      class="color-swatch"
                      :style="col.progressColor ? { background: col.progressColor } : {}"
                      :class="{ 'color-swatch--empty': !col.progressColor }"
                    />
                    <input
                      type="color"
                      class="color-input-hidden"
                      :value="col.progressColor || '#1976d2'"
                      @input="(e) => col.progressColor = (e.target as HTMLInputElement).value"
                    />
                  </label>
                  <template v-if="col.progressColor">
                    <span class="hex-value">{{ col.progressColor }}</span>
                    <q-btn icon="close" size="xs" flat round dense @click="col.progressColor = ''" />
                  </template>
                  <span v-else class="text-caption text-grey-5">{{ t("dashboard.colorNone") }}</span>
                </div>
              </template>

              <!-- Sparkline style -->
              <template v-if="col.cellType === 'sparkline'">
                <div class="inline-control q-mt-sm">
                  <span class="option-label">{{ t("dashboard.sparklineStyle") }}</span>
                  <div class="toggle-group">
                    <q-btn
                      v-for="s in sparklineStyleOptions"
                      :key="s.value"
                      :icon="s.icon"
                      :label="s.label"
                      flat
                      no-caps
                      size="sm"
                      :class="['toggle-btn', (col.sparklineStyle || 'line') === s.value && 'toggle-btn--active']"
                      @click="col.sparklineStyle = s.value as 'line' | 'bar'"
                    />
                  </div>
                </div>
              </template>
            </div>
          </template>

          <!-- ALIGNMENT -->
          <div class="config-section">
            <div class="section-label">{{ t("dashboard.sectionAlignment") }}</div>
            <div class="toggle-group">
              <q-btn
                v-for="dir in alignOptions"
                :key="dir.value"
                :icon="dir.icon"
                :title="dir.label"
                flat
                size="sm"
                :class="['toggle-btn', col.alignment === dir.value && 'toggle-btn--active']"
                @click="col.alignment = col.alignment === dir.value ? '' : dir.value"
              />
            </div>
          </div>

          <!-- STYLING -->
          <div class="config-section">
            <div class="section-label">{{ t("dashboard.sectionStyling") }}</div>
            <div class="control-row flex-wrap" style="gap: 16px">
              <div class="inline-control">
                <span class="option-label">{{ t("dashboard.textColor") }}</span>
                <label class="color-swatch-label">
                  <span
                    class="color-swatch"
                    :style="col.textColor ? { background: col.textColor } : {}"
                    :class="{ 'color-swatch--empty': !col.textColor }"
                  />
                  <input
                    type="color"
                    class="color-input-hidden"
                    :value="col.textColor || '#000000'"
                    @input="(e) => col.textColor = (e.target as HTMLInputElement).value"
                  />
                </label>
                <template v-if="col.textColor">
                  <span class="hex-value">{{ col.textColor }}</span>
                  <q-btn icon="close" size="xs" flat round dense @click="col.textColor = ''" />
                </template>
                <span v-else class="text-caption text-grey-5">{{ t("dashboard.colorNone") }}</span>
              </div>

              <div class="inline-control">
                <span class="option-label">{{ t("dashboard.bgColor") }}</span>
                <label class="color-swatch-label">
                  <span
                    class="color-swatch"
                    :style="col.bgColor ? { background: col.bgColor } : {}"
                    :class="{ 'color-swatch--empty': !col.bgColor }"
                  />
                  <input
                    type="color"
                    class="color-input-hidden"
                    :value="col.bgColor || '#ffffff'"
                    @input="(e) => col.bgColor = (e.target as HTMLInputElement).value"
                  />
                </label>
                <template v-if="col.bgColor">
                  <span class="hex-value">{{ col.bgColor }}</span>
                  <q-btn icon="close" size="xs" flat round dense @click="col.bgColor = ''" />
                </template>
                <span v-else class="text-caption text-grey-5">{{ t("dashboard.colorNone") }}</span>
              </div>

              <q-checkbox
                v-model="col.autoColor"
                :label="t('dashboard.overrideConfigUniqueValueColor')"
                dense
                size="sm"
              />
            </div>
          </div>

          <!-- CONDITIONAL STYLING (numeric only) -->
          <template v-if="isNumericColumn(col.field)">
            <div class="config-section">
              <div class="section-label">{{ t("dashboard.sectionConditionalStyling") }}</div>
              <div
                v-for="(rule, ruleIdx) in col.conditions"
                :key="ruleIdx"
                class="condition-rule"
              >
                <q-select
                  v-model="rule.operator"
                  :options="conditionOperators"
                  dense
                  outlined
                  emit-value
                  map-options
                  hide-bottom-space
                  class="condition-operator o2-custom-select-dashboard"
                />
                <q-input
                  v-model="rule.threshold"
                  :label="t('dashboard.conditionThreshold')"
                  type="number"
                  dense
                  outlined
                  hide-bottom-space
                  class="condition-value"
                />
                <div class="inline-control">
                  <span class="option-label text-grey-6">{{ t("dashboard.textColor") }}</span>
                  <label class="color-swatch-label">
                    <span
                      class="color-swatch color-swatch--sm"
                      :style="rule.textColor ? { background: rule.textColor } : {}"
                      :class="{ 'color-swatch--empty': !rule.textColor }"
                    />
                    <input
                      type="color"
                      class="color-input-hidden"
                      :value="rule.textColor || '#000000'"
                      @input="(e) => rule.textColor = (e.target as HTMLInputElement).value"
                    />
                  </label>
                  <q-btn v-if="rule.textColor" icon="close" size="xs" flat round dense @click="rule.textColor = ''" />
                </div>
                <div class="inline-control">
                  <span class="option-label text-grey-6">{{ t("dashboard.bgColor") }}</span>
                  <label class="color-swatch-label">
                    <span
                      class="color-swatch color-swatch--sm"
                      :style="rule.bgColor ? { background: rule.bgColor } : {}"
                      :class="{ 'color-swatch--empty': !rule.bgColor }"
                    />
                    <input
                      type="color"
                      class="color-input-hidden"
                      :value="rule.bgColor || '#ffffff'"
                      @input="(e) => rule.bgColor = (e.target as HTMLInputElement).value"
                    />
                  </label>
                  <q-btn v-if="rule.bgColor" icon="close" size="xs" flat round dense @click="rule.bgColor = ''" />
                </div>
                <q-space />
                <q-btn icon="delete_outline" flat dense round size="xs" color="grey-6" @click="col.conditions.splice(ruleIdx, 1)" />
              </div>
              <q-btn
                :label="t('dashboard.conditionAddRule')"
                no-caps
                flat
                dense
                size="sm"
                color="primary"
                class="q-mt-xs"
                @click="col.conditions.push({ operator: '<', threshold: '', textColor: '', bgColor: '' })"
              />
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- Add field override -->
    <div class="add-override-row">
      <q-btn
        :label="t('dashboard.overrideConfigAddNew')"
        no-caps
        flat
        class="add-override-btn full-width"
        :disable="availableColumnsToAdd.length === 0"
        @click="addColumn"
      />
    </div>

    <!-- Footer -->
    <div class="popup-footer">
      <q-btn :label="t('dashboard.cancel')" flat no-caps @click="closePopup" />
      <q-btn :label="t('dashboard.overrideConfigSave')" color="primary" no-caps unelevated @click="saveOverrides" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, PropType } from "vue";
import { useI18n } from "vue-i18n";

interface ConditionalRuleUI {
  operator: string;
  threshold: string;
  textColor: string;
  bgColor: string;
}

interface ColumnOverrideUI {
  field: string;
  unit: string;
  customUnit: string;
  alignment: string;
  textColor: string;
  bgColor: string;
  autoColor: boolean;
  cellType: string;
  progressColor: string;
  sparklineStyle: "line" | "bar";
  conditions: ConditionalRuleUI[];
}

export default defineComponent({
  name: "OverrideConfigPopup",
  props: {
    columns: {
      type: Array as PropType<Array<{ label: string; alias: string; isNumeric?: boolean }>>,
      required: true,
    },
    overrideConfig: {
      type: Object as PropType<{ overrideConfigs?: any[] }>,
      required: true,
    },
  },
  emits: ["close", "save"],
  setup(props, { emit }) {
    const { t } = useI18n();

    // ── Options ────────────────────────────────────────────────────────────────
    const unitOptions = [
      { label: t("dashboard.default"), value: "" },
      { label: t("dashboard.numbers"), value: "numbers" },
      { label: t("dashboard.bytes"), value: "bytes" },
      { label: t("dashboard.kilobytes"), value: "kilobytes" },
      { label: t("dashboard.megabytes"), value: "megabytes" },
      { label: t("dashboard.bytesPerSecond"), value: "bps" },
      { label: t("dashboard.seconds"), value: "seconds" },
      { label: t("dashboard.milliseconds"), value: "milliseconds" },
      { label: t("dashboard.microseconds"), value: "microseconds" },
      { label: t("dashboard.nanoseconds"), value: "nanoseconds" },
      { label: t("dashboard.percent1"), value: "percent-1" },
      { label: t("dashboard.percent"), value: "percent" },
      { label: t("dashboard.currencyDollar"), value: "currency-dollar" },
      { label: t("dashboard.currencyEuro"), value: "currency-euro" },
      { label: t("dashboard.currencyPound"), value: "currency-pound" },
      { label: t("dashboard.currencyYen"), value: "currency-yen" },
      { label: t("dashboard.currencyRupees"), value: "currency-rupee" },
      { label: t("dashboard.custom"), value: "custom" },
    ];

    const alignOptions = [
      { value: "left",   icon: "format_align_left",   label: "Left" },
      { value: "center", icon: "format_align_center",  label: "Center" },
      { value: "right",  icon: "format_align_right",   label: "Right" },
    ];

    const cellTypeOptions = [
      { value: "text",         icon: "text_fields",  label: t("dashboard.cellTypeText") },
      { value: "progress_bar", icon: "data_usage",   label: t("dashboard.cellTypeProgressBar") },
      { value: "sparkline",    icon: "show_chart",   label: t("dashboard.cellTypeSparkline") },
    ];

    const sparklineStyleOptions = [
      { value: "line", icon: "show_chart", label: t("dashboard.sparklineStyleLine") },
      { value: "bar",  icon: "bar_chart",  label: t("dashboard.sparklineStyleBar") },
    ];

    const conditionOperators = [
      { label: "<",  value: "<" },
      { label: ">",  value: ">" },
      { label: "<=", value: "<=" },
      { label: ">=", value: ">=" },
      { label: "=",  value: "=" },
      { label: "!=", value: "!=" },
    ];

    // ── Load existing config into UI state ─────────────────────────────────────
    const emptyRow = (): ColumnOverrideUI => ({
      field: "", unit: "", customUnit: "", alignment: "",
      textColor: "", bgColor: "", autoColor: false,
      cellType: "text", progressColor: "", sparklineStyle: "line",
      conditions: [],
    });

    const loadFromRaw = (raw: any[]): ColumnOverrideUI[] => {
      const byColumn: Record<string, ColumnOverrideUI> = {};
      for (const entry of raw ?? []) {
        const alias = entry?.field?.value;
        if (!alias) continue;
        if (!byColumn[alias]) byColumn[alias] = { ...emptyRow(), field: alias };
        for (const cfg of entry?.config ?? []) {
          switch (cfg?.type) {
            case "unit":
              byColumn[alias].unit = cfg.value?.unit ?? "";
              byColumn[alias].customUnit = cfg.value?.customUnit ?? "";
              break;
            case "unique_value_color":
              byColumn[alias].autoColor = !!cfg.autoColor;
              break;
            case "alignment":
              byColumn[alias].alignment = cfg.value ?? "";
              break;
            case "text_color":
              byColumn[alias].textColor = cfg.value ?? "";
              break;
            case "background_color":
              byColumn[alias].bgColor = cfg.value ?? "";
              break;
            case "cell_type":
              byColumn[alias].cellType = cfg.value?.type ?? "text";
              byColumn[alias].progressColor = cfg.value?.color ?? "";
              byColumn[alias].sparklineStyle = cfg.value?.sparklineStyle ?? "line";
              break;
            case "conditional_styles":
              byColumn[alias].conditions = (cfg.rules ?? []).map((r: any) => ({
                operator: r.operator ?? "<",
                threshold: r.threshold != null ? String(r.threshold) : "",
                textColor: r.textColor ?? "",
                bgColor: r.bgColor ?? "",
              }));
              break;
          }
        }
      }
      return Object.values(byColumn);
    };

    const columnOverrides = ref<ColumnOverrideUI[]>(
      loadFromRaw(props.overrideConfig.overrideConfigs ?? []),
    );

    if (columnOverrides.value.length === 0) {
      columnOverrides.value.push(emptyRow());
    }

    // ── Column helpers ─────────────────────────────────────────────────────────
    const allColumnOptions = computed(() =>
      props.columns.map((c) => ({ label: c.label, value: c.alias })),
    );

    const columnOptionsFor = (idx: number) => {
      const used = new Set(columnOverrides.value.map((c, i) => i !== idx ? c.field : null).filter(Boolean));
      return allColumnOptions.value.filter((o) => !used.has(o.value));
    };

    const availableColumnsToAdd = computed(() => {
      const used = new Set(columnOverrides.value.map((c) => c.field).filter(Boolean));
      return allColumnOptions.value.filter((o) => !used.has(o.value));
    });

    const getFieldLabel = (alias: string) => {
      if (!alias) return "";
      return allColumnOptions.value.find((o) => o.value === alias)?.label ?? `${alias} (not found)`;
    };

    // ── Numeric column helper ──────────────────────────────────────────────────
    const isNumericColumn = (field: string): boolean => {
      if (!field) return false;
      return props.columns.find((c) => c.alias === field)?.isNumeric ?? false;
    };

    // Reset numeric-only settings when user switches to a non-numeric column
    watch(
      () => columnOverrides.value.map((c) => c.field),
      (fields, prevFields) => {
        fields.forEach((field, i) => {
          if (field !== prevFields?.[i] && !isNumericColumn(field)) {
            columnOverrides.value[i].unit = "";
            columnOverrides.value[i].customUnit = "";
            columnOverrides.value[i].cellType = "text";
            columnOverrides.value[i].progressColor = "";
            columnOverrides.value[i].conditions = [];
          }
        });
      },
    );

    // ── Mutations ──────────────────────────────────────────────────────────────
    const addColumn = () => columnOverrides.value.push(emptyRow());
    const removeColumn = (idx: number) => columnOverrides.value.splice(idx, 1);

    // ── Serialize to override_config format ────────────────────────────────────
    const toRaw = (cols: ColumnOverrideUI[]): any[] =>
      cols
        .filter((c) => c.field)
        .map((c) => {
          const config: any[] = [];
          if (c.unit && isNumericColumn(c.field)) config.push({ type: "unit", value: { unit: c.unit, customUnit: c.customUnit } });
          if (c.alignment) config.push({ type: "alignment", value: c.alignment });
          if (c.textColor) config.push({ type: "text_color", value: c.textColor });
          if (c.bgColor) config.push({ type: "background_color", value: c.bgColor });
          if (c.autoColor) config.push({ type: "unique_value_color", autoColor: true });

          if (c.cellType && c.cellType !== "text") {
            config.push({
              type: "cell_type",
              value: {
                type: c.cellType,
                color: c.progressColor || "",
                sparklineStyle: c.cellType === "sparkline" ? (c.sparklineStyle || "line") : undefined,
              },
            });
          }

          const validConditions = c.conditions.filter((r) => r.threshold !== "" && r.operator);
          if (validConditions.length) {
            config.push({
              type: "conditional_styles",
              rules: validConditions.map((r) => ({
                operator: r.operator,
                threshold: parseFloat(r.threshold),
                textColor: r.textColor || "",
                bgColor: r.bgColor || "",
              })),
            });
          }

          return { field: { matchBy: "name", value: c.field }, config };
        })
        .filter((entry) => entry.config.length > 0);

    // ── Actions ────────────────────────────────────────────────────────────────
    const closePopup = () => emit("close");

    const saveOverrides = () => {
      const raw = toRaw(columnOverrides.value);
      props.overrideConfig.overrideConfigs = raw;
      emit("save", raw);
      emit("close");
    };

    return {
      t,
      columnOverrides,
      unitOptions,
      alignOptions,
      cellTypeOptions,
      sparklineStyleOptions,
      conditionOperators,
      columnOptionsFor,
      availableColumnsToAdd,
      getFieldLabel,
      isNumericColumn,
      addColumn,
      removeColumn,
      closePopup,
      saveOverrides,
    };
  },
});
</script>

<style lang="scss" scoped>
.column-formatting-popup {
  min-width: min(720px, 90vw);
  max-height: min(85vh, 680px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

// ── Header ────────────────────────────────────────────────────────────────────
.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}

.popup-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

// ── Scrollable body ───────────────────────────────────────────────────────────
.overrides-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.4) transparent;

  &::-webkit-scrollbar {
    width: 5px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.35);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(128, 128, 128, 0.6);
  }
}

// ── Override cards ────────────────────────────────────────────────────────────
.override-card {
  flex-shrink: 0; // prevent flex container from squeezing card height as more cards are added
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-left: 3px solid var(--q-primary, #1976d2);
  border-radius: 6px;
  max-height: 340px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.4) transparent;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.3);
    border-radius: 3px;
  }
}

.override-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(245, 245, 245, 0.97);
  border-bottom: 1px solid rgba(128, 128, 128, 0.1);
  position: sticky;
  top: 0;
  z-index: 1;

  body.body--dark & {
    background: rgba(30, 30, 30, 0.97);
  }
}

.override-field-select {
  flex: 1;
  min-width: 0;
}

// ── Config sections ───────────────────────────────────────────────────────────
.config-section {
  padding: 8px 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.08);
}

.section-label {
  font-size: 0.71rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--q-secondary, #757575);
  margin-bottom: 8px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-control {
  display: flex;
  align-items: center;
  gap: 6px;
}

.option-label {
  font-size: 0.8rem;
  flex-shrink: 0;
}

// ── Toggle button groups ──────────────────────────────────────────────────────
.toggle-group {
  display: inline-flex;
  border: 1px solid rgba(128, 128, 128, 0.28);
  border-radius: 6px;
  overflow: hidden;
}

.toggle-btn {
  border-radius: 0 !important;
  color: rgba(0, 0, 0, 0.55) !important;
  transition: background-color 0.12s, color 0.12s;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.6) !important;
  }

  &:not(:last-child) {
    border-right: 1px solid rgba(128, 128, 128, 0.2) !important;
  }

  &--active {
    background: var(--q-primary, #1976d2) !important;
    color: #fff !important;
  }
}

// ── Color pickers ─────────────────────────────────────────────────────────────
.color-swatch-label {
  cursor: pointer;
  position: relative;
  display: inline-flex;
  align-items: center;
}

.color-swatch {
  display: inline-block;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1.5px solid rgba(128, 128, 128, 0.35);
  vertical-align: middle;
  transition: border-color 0.12s, box-shadow 0.12s;

  .color-swatch-label:hover & {
    border-color: var(--q-primary, #1976d2);
    box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.18);
  }

  &--sm {
    width: 20px;
    height: 20px;
    border-radius: 4px;
  }

  &--empty {
    background: repeating-linear-gradient(
      45deg,
      rgba(128, 128, 128, 0.12),
      rgba(128, 128, 128, 0.12) 2px,
      transparent 2px,
      transparent 8px
    );
  }
}

.color-input-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.hex-value {
  font-family: monospace;
  font-size: 0.78rem;
  color: var(--q-secondary, #757575);
}

// ── Conditional rules ─────────────────────────────────────────────────────────
.condition-rule {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(128, 128, 128, 0.04);
  border: 1px solid rgba(128, 128, 128, 0.1);
  border-radius: 5px;
  margin-bottom: 5px;
  flex-wrap: wrap;
}

.condition-operator {
  min-width: 70px;
  max-width: 70px;
}

.condition-value {
  min-width: 80px;
  max-width: 110px;
}

// ── Add override button ───────────────────────────────────────────────────────
.add-override-row {
  padding: 8px 16px;
}

.add-override-btn {
  border: 1.5px dashed rgba(128, 128, 128, 0.3) !important;
  border-radius: 6px !important;
  transition: border-color 0.12s, color 0.12s;

  &:not([disabled]):hover {
    border-color: var(--q-primary, #1976d2) !important;
    color: var(--q-primary, #1976d2) !important;
  }
}

// ── Footer ────────────────────────────────────────────────────────────────────
.popup-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
}
</style>
