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
  <ODialog
    data-test="override-config-popup-dialog"
    :open="open"
    @update:open="(v: boolean) => { if (!v) closePopup() }"
    :title="t('dashboard.columnFormattingTitle')"
    :width="70"
    :neutral-button-label="t('dashboard.overrideConfigAddNew')"
    neutral-button-variant="outline"
    :primary-button-label="t('dashboard.overrideConfigSave')"
    @click:neutral="addColumn"
    @click:primary="saveOverrides"
  >
    <!-- Scrollable body -->
    <div class="overrides-body">
      <div v-for="(col, idx) in columnOverrides" :key="idx" class="override-card">
        <!-- Field selector row -->
        <div class="override-card-head">
          <OSelect
            v-model="col.field"
            :options="columnOptionsFor(idx)"
            :label="t('dashboard.overrideConfigFieldLabel')"
            class="override-field-select"
            :data-test="`dashboard-addpanel-config-field-select-${idx}`"
          />
          <OButton
            variant="ghost"
            size="icon"
            icon-left="delete-outline"
            :data-test="`dashboard-addpanel-config-delete-column-${idx}`"
            @click="removeColumn(idx)"
          />
        </div>

        <template v-if="col.field">
          <!-- VALUE FORMATTING (numeric only) -->
          <template v-if="isNumericColumn(col.field)">
            <div class="config-section">
              <div class="section-label">{{ t("dashboard.sectionValueFormatting") }}</div>
              <div class="control-row">
                <OSelect
                  v-model="col.unit"
                  :options="unitOptions"
                  :label="t('dashboard.overrideConfigUnitLabel')"
                  style="min-width: 160px"
                />
                <OInput
                  v-if="col.unit === 'custom'"
                  v-model="col.customUnit"
                  :label="t('dashboard.customunitLabel')"
                  size="sm"
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
                <OButton
                  v-for="ct in cellTypeOptions"
                  :key="ct.value"
                  variant="ghost"
                  size="sm"
                  :class="['toggle-btn', col.cellType === ct.value && 'toggle-btn--active']"
                  @click="col.cellType = ct.value"
                >
                  {{ ct.label }}
                </OButton>
              </div>

              <!-- Color (shown for progress_bar and sparkline) -->
              <template v-if="col.cellType === 'progress_bar' || col.cellType === 'sparkline'">
                <div class="inline-control tw:mt-2">
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
                    <OButton variant="ghost" size="icon-xs" icon-left="close" @click="col.progressColor = ''" />
                  </template>
                  <span v-else class="color-none-text">{{ t("dashboard.colorNone") }}</span>
                </div>
              </template>

              <!-- Sparkline style -->
              <template v-if="col.cellType === 'sparkline'">
                <div class="inline-control tw:mt-2">
                  <span class="option-label">{{ t("dashboard.sparklineStyle") }}</span>
                  <div class="toggle-group">
                    <OButton
                      v-for="s in sparklineStyleOptions"
                      :key="s.value"
                      variant="ghost"
                      size="sm"
                      :class="['toggle-btn', (col.sparklineStyle || 'line') === s.value && 'toggle-btn--active']"
                      @click="col.sparklineStyle = s.value as 'line' | 'bar'"
                    >
                      {{ s.label }}
                    </OButton>
                  </div>
                </div>
              </template>
            </div>
          </template>

          <!-- ALIGNMENT -->
          <div class="config-section">
            <div class="section-label">{{ t("dashboard.sectionAlignment") }}</div>
            <div class="toggle-group">
              <OButton
                v-for="dir in alignOptions"
                :key="dir.value"
                variant="ghost"
                size="sm"
                :title="dir.label"
                :class="['toggle-btn', col.alignment === dir.value && 'toggle-btn--active']"
                @click="col.alignment = col.alignment === dir.value ? '' : dir.value"
              >
                {{ dir.label }}
              </OButton>
            </div>
          </div>

          <!-- STYLING -->
          <div class="config-section">
            <div class="section-label">{{ t("dashboard.sectionStyling") }}</div>
            <div class="control-row tw:flex-wrap" style="gap: 16px">
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
                  <OButton variant="ghost" size="icon-xs" icon-left="close" @click="col.textColor = ''" />
                </template>
                <span v-else class="color-none-text">{{ t("dashboard.colorNone") }}</span>
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
                  <OButton variant="ghost" size="icon-xs" icon-left="close" @click="col.bgColor = ''" />
                </template>
                <span v-else class="color-none-text">{{ t("dashboard.colorNone") }}</span>
              </div>

              <OCheckbox
                v-model="col.autoColor"
                :label="t('dashboard.overrideConfigUniqueValueColor')"
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
                <OSelect
                  v-model="rule.operator"
                  :options="conditionOperators"
                  class="condition-operator"
                />
                <OInput
                  v-model="rule.threshold"
                  :label="t('dashboard.conditionThreshold')"
                  type="number"
                  size="sm"
                  class="condition-value"
                />
                <div class="inline-control">
                  <span class="option-label color-none-text">{{ t("dashboard.textColor") }}</span>
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
                  <OButton v-if="rule.textColor" variant="ghost" size="icon-xs" icon-left="close" @click="rule.textColor = ''" />
                </div>
                <div class="inline-control">
                  <span class="option-label color-none-text">{{ t("dashboard.bgColor") }}</span>
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
                  <OButton v-if="rule.bgColor" variant="ghost" size="icon-xs" icon-left="close" @click="rule.bgColor = ''" />
                </div>
                <div class="tw:flex-1" />
                <OButton variant="ghost" size="icon-xs" icon-left="delete-outline" @click="col.conditions.splice(ruleIdx, 1)" />
              </div>
              <OButton
                variant="ghost"
                size="sm"
                class="tw:mt-1"
                @click="col.conditions.push({ operator: '<', threshold: '', textColor: '', bgColor: '' })"
              >
                {{ t("dashboard.conditionAddRule") }}
              </OButton>
            </div>
          </template>
        </template>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, PropType } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

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
  components: { OButton, ODialog, OSelect, OInput, OCheckbox },
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
  },
  emits: ["close", "save"],
  setup(props: any, { emit }: any) {
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
      { value: "left", label: t("dashboard.alignLeft") },
      { value: "center", label: t("dashboard.alignCenter") },
      { value: "right", label: t("dashboard.alignRight") },
    ];

    const cellTypeOptions = [
      { value: "text", label: t("dashboard.cellTypeText") },
      { value: "progress_bar", label: t("dashboard.cellTypeProgressBar") },
      { value: "sparkline", label: t("dashboard.cellTypeSparkline") },
    ];

    const sparklineStyleOptions = [
      { value: "line", label: t("dashboard.sparklineStyleLine") },
      { value: "bar", label: t("dashboard.sparklineStyleBar") },
    ];

    const conditionOperators = [
      { label: "<", value: "<" },
      { label: ">", value: ">" },
      { label: "<=", value: "<=" },
      { label: ">=", value: ">=" },
      { label: "=", value: "=" },
      { label: "!=", value: "!=" },
    ];

    // ── Load existing config into UI state ─────────────────────────────────────
    const emptyRow = (): ColumnOverrideUI => ({
      field: "",
      unit: "",
      customUnit: "",
      alignment: "",
      textColor: "",
      bgColor: "",
      autoColor: false,
      cellType: "text",
      progressColor: "",
      sparklineStyle: "line",
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

    const columnOverrides = ref<ColumnOverrideUI[]>([]);

    const initFromProps = () => {
      const loaded = loadFromRaw(props.overrideConfig.overrideConfigs ?? []);
      columnOverrides.value = loaded.length > 0 ? loaded : [emptyRow()];
    };

    // Re-initialize UI state whenever the dialog is (re)opened.
    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) initFromProps();
      },
      { immediate: true },
    );

    // ── Column helpers ─────────────────────────────────────────────────────────
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

    const availableColumnsToAdd = computed(() => {
      const used = new Set(
        columnOverrides.value.map((c) => c.field).filter(Boolean),
      );
      return allColumnOptions.value.filter((o: any) => !used.has(o.value));
    });

    const getFieldLabel = (alias: string) => {
      if (!alias) return "";
      return (
        allColumnOptions.value.find((o: any) => o.value === alias)?.label ??
        `${alias} (not found)`
      );
    };

    // ── Numeric column helper ──────────────────────────────────────────────────
    const isNumericColumn = (field: string): boolean => {
      if (!field) return false;
      return props.columns.find((c: any) => c.alias === field)?.isNumeric ?? false;
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
          if (c.unit && isNumericColumn(c.field))
            config.push({
              type: "unit",
              value: { unit: c.unit, customUnit: c.customUnit },
            });
          if (c.alignment)
            config.push({ type: "alignment", value: c.alignment });
          if (c.textColor)
            config.push({ type: "text_color", value: c.textColor });
          if (c.bgColor)
            config.push({ type: "background_color", value: c.bgColor });
          if (c.autoColor)
            config.push({ type: "unique_value_color", autoColor: true });

          if (c.cellType && c.cellType !== "text") {
            config.push({
              type: "cell_type",
              value: {
                type: c.cellType,
                color: c.progressColor || "",
                sparklineStyle:
                  c.cellType === "sparkline"
                    ? c.sparklineStyle || "line"
                    : undefined,
              },
            });
          }

          const validConditions = c.conditions.filter(
            (r) => r.threshold !== "" && r.operator,
          );
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
// ── Scrollable body ───────────────────────────────────────────────────────────
.overrides-body {
  max-height: min(60vh, 560px);
  overflow-y: auto;
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
  border-left: 3px solid var(--color-primary-600, #1976d2);
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

  .body--dark & {
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
  color: var(--color-text-secondary, #757575);
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

.color-none-text {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #9e9e9e);
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

  &:not(:last-child) {
    border-right: 1px solid rgba(128, 128, 128, 0.2) !important;
  }

  &--active {
    background: var(--color-primary-600, #1976d2) !important;
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
    border-color: var(--color-primary-600, #1976d2);
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
  color: var(--color-text-secondary, #757575);
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
  max-width: 90px;
}

.condition-value {
  min-width: 80px;
  max-width: 110px;
}
</style>
