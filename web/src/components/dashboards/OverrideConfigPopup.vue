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
  <div class="column-formatting-popup" style="padding: 0 10px; min-width: min(720px, 90vw)">
    <!-- Header -->
    <div
      class="flex justify-between items-center q-py-md"
      style="border-bottom: 2px solid gray; margin-bottom: 8px"
    >
      <span class="q-table__title">{{ t("dashboard.columnFormattingTitle") }}</span>
      <q-btn icon="close" unelevated size="sm" round outline :title="t('dashboard.cancel')" @click="closePopup" />
    </div>

    <!-- Column override cards -->
    <div style="max-height: 65vh; overflow-y: auto">
      <div
        v-for="(col, idx) in columnOverrides"
        :key="idx"
        class="column-card q-mb-sm"
        style="border: 1px solid rgba(128,128,128,0.3); border-radius: 6px; padding: 12px"
      >
        <!-- Card header: column selector + remove -->
        <div class="flex items-center q-mb-sm" style="gap: 8px">
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
            class="flex-1 o2-custom-select-dashboard"
            style="min-width: 160px"
          />
          <q-btn icon="delete_outline" flat dense round size="sm" color="grey-6" @click="removeColumn(idx)" />
        </div>

        <template v-if="col.field">
          <!-- ── Value Formatting (numeric columns only) ── -->
          <template v-if="isNumericColumn(col.field)">
            <div class="section-label q-mb-xs">{{ t("dashboard.sectionValueFormatting") }}</div>
            <div class="flex items-start q-gutter-sm q-mb-sm">
              <q-select
                v-model="col.unit"
                :options="unitOptions"
                :label="t('dashboard.overrideConfigUnitLabel')"
                dense
                borderless
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
                borderless
                hide-bottom-space
                style="min-width: 120px"
              />
            </div>
          </template>

          <!-- ── Cell Type (numeric columns only) ── -->
          <template v-if="isNumericColumn(col.field)">
            <div class="section-label q-mb-xs">{{ t("dashboard.sectionCellType") }}</div>
            <div class="flex q-mb-sm" style="gap: 4px">
              <q-btn
                v-for="ct in cellTypeOptions"
                :key="ct.value"
                :icon="ct.icon"
                :label="ct.label"
                flat
                dense
                no-caps
                size="sm"
                :color="col.cellType === ct.value ? 'primary' : 'grey-5'"
                style="border: 1px solid rgba(128,128,128,0.3); border-radius: 4px; padding: 2px 8px"
                @click="col.cellType = ct.value"
              />
            </div>

            <!-- ── Progress Bar / Sparkline color (shown when a visual cell type is active) ── -->
            <template v-if="col.cellType === 'progress_bar' || col.cellType === 'sparkline'">
              <div class="section-label q-mb-xs">{{ t("dashboard.sectionProgressBar") }}</div>
              <div class="flex items-center q-gutter-sm q-mb-sm flex-wrap">
                <div class="flex items-center" style="gap: 6px">
                  <span class="text-caption">{{ t("dashboard.progressColor") }}</span>
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
                  <span v-if="col.progressColor" class="text-caption text-mono">{{ col.progressColor }}</span>
                  <q-btn v-if="col.progressColor" icon="close" size="xs" flat round dense @click="col.progressColor = ''" />
                  <span v-else class="text-caption text-grey-5">{{ t("dashboard.colorNone") }}</span>
                </div>
              </div>
              <!-- ── Sparkline style: Line / Bar ── -->
              <template v-if="col.cellType === 'sparkline'">
                <div class="section-label q-mb-xs">{{ t("dashboard.sparklineStyle") }}</div>
                <div class="flex q-mb-sm" style="gap: 4px">
                  <q-btn
                    v-for="s in sparklineStyleOptions"
                    :key="s.value"
                    :icon="s.icon"
                    :label="s.label"
                    flat dense no-caps size="sm"
                    :color="(col.sparklineStyle || 'line') === s.value ? 'primary' : 'grey-5'"
                    style="border: 1px solid rgba(128,128,128,0.3); border-radius: 4px; padding: 2px 8px"
                    @click="col.sparklineStyle = s.value as 'line' | 'bar'"
                  />
                </div>
              </template>
            </template>
          </template>

          <!-- ── Alignment ── -->
          <div class="section-label q-mb-xs">{{ t("dashboard.sectionAlignment") }}</div>
          <div class="flex q-mb-sm" style="gap: 4px">
            <q-btn
              v-for="dir in alignOptions"
              :key="dir.value"
              :icon="dir.icon"
              :title="dir.label"
              flat
              dense
              size="sm"
              :color="col.alignment === dir.value ? 'primary' : 'grey-5'"
              style="border: 1px solid rgba(128,128,128,0.3); border-radius: 4px"
              @click="col.alignment = col.alignment === dir.value ? '' : dir.value"
            />
          </div>

          <!-- ── Styling ── -->
          <div class="section-label q-mb-xs">{{ t("dashboard.sectionStyling") }}</div>
          <div class="flex items-center q-gutter-md q-mb-sm flex-wrap">
            <!-- Text color -->
            <div class="flex items-center" style="gap: 6px">
              <span class="text-caption">{{ t("dashboard.textColor") }}</span>
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
              <span v-if="col.textColor" class="text-caption text-mono">{{ col.textColor }}</span>
              <q-btn v-if="col.textColor" icon="close" size="xs" flat round dense @click="col.textColor = ''" />
              <span v-else class="text-caption text-grey-5">{{ t("dashboard.colorNone") }}</span>
            </div>

            <!-- Background color -->
            <div class="flex items-center" style="gap: 6px">
              <span class="text-caption">{{ t("dashboard.bgColor") }}</span>
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
              <span v-if="col.bgColor" class="text-caption text-mono">{{ col.bgColor }}</span>
              <q-btn v-if="col.bgColor" icon="close" size="xs" flat round dense @click="col.bgColor = ''" />
              <span v-else class="text-caption text-grey-5">{{ t("dashboard.colorNone") }}</span>
            </div>

            <!-- Auto-color by value -->
            <q-checkbox
              v-model="col.autoColor"
              :label="t('dashboard.overrideConfigUniqueValueColor')"
              dense
              size="sm"
            />
          </div>

          <!-- ── Conditional Styling (numeric columns only) ── -->
          <template v-if="isNumericColumn(col.field)">
          <div class="section-label q-mb-xs">{{ t("dashboard.sectionConditionalStyling") }}</div>
          <div
            v-for="(rule, ruleIdx) in col.conditions"
            :key="ruleIdx"
            class="flex items-center q-mb-xs flex-wrap"
            style="gap: 6px; padding: 6px 8px; background: rgba(128,128,128,0.05); border-radius: 4px"
          >
            <q-select
              v-model="rule.operator"
              :options="conditionOperators"
              dense
              borderless
              emit-value
              map-options
              hide-bottom-space
              style="min-width: 72px; max-width: 72px"
              class="o2-custom-select-dashboard"
            />
            <q-input
              v-model="rule.threshold"
              :label="t('dashboard.conditionThreshold')"
              type="number"
              dense
              borderless
              hide-bottom-space
              style="min-width: 80px; max-width: 100px"
            />
            <!-- Rule text color -->
            <div class="flex items-center" style="gap: 4px">
              <span class="text-caption text-grey-6">{{ t("dashboard.textColor") }}</span>
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
            <!-- Rule bg color -->
            <div class="flex items-center" style="gap: 4px">
              <span class="text-caption text-grey-6">{{ t("dashboard.bgColor") }}</span>
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
            <q-btn icon="delete_outline" flat dense round size="xs" color="grey-6" @click="col.conditions.splice(ruleIdx, 1)" />
          </div>
          <q-btn
            icon="add"
            :label="t('dashboard.conditionAddRule')"
            no-caps
            flat
            dense
            size="sm"
            class="q-mt-xs q-mb-sm"
            @click="col.conditions.push({ operator: '<', threshold: '', textColor: '', bgColor: '' })"
          />
          </template>
        </template>
      </div>
    </div>

    <!-- Add column -->
    <q-btn
      icon="add"
      :label="t('dashboard.overrideConfigAddNew')"
      no-caps
      flat
      class="q-mt-sm el-border"
      :disable="availableColumnsToAdd.length === 0"
      @click="addColumn"
    />

    <!-- Footer -->
    <q-card-actions align="right" class="q-pt-sm">
      <q-btn :label="t('dashboard.cancel')" flat @click="closePopup" />
      <q-btn :label="t('dashboard.overrideConfigSave')" color="primary" @click="saveOverrides" />
    </q-card-actions>
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
.section-label {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--q-secondary, #757575);
  padding-top: 4px;
}

.color-swatch-label {
  cursor: pointer;
  position: relative;
  display: inline-flex;
  align-items: center;
}

.color-swatch {
  display: inline-block;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid rgba(128, 128, 128, 0.4);
  vertical-align: middle;

  &--sm {
    width: 18px;
    height: 18px;
  }

  &--empty {
    background: repeating-linear-gradient(
      45deg,
      rgba(128, 128, 128, 0.15),
      rgba(128, 128, 128, 0.15) 2px,
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

.text-mono {
  font-family: monospace;
  font-size: 0.8rem;
}
</style>
