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
  <div class="column-formatting-popup" style="padding: 0 10px; min-width: min(680px, 90vw)">
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
          <!-- ── Value Formatting ── -->
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
          <div class="flex items-center q-gutter-md q-mb-xs flex-wrap">
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
                  @change="(e) => col.textColor = (e.target as HTMLInputElement).value"
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
                  @change="(e) => col.bgColor = (e.target as HTMLInputElement).value"
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
import { defineComponent, ref, computed, PropType } from "vue";
import { useI18n } from "vue-i18n";

interface ColumnOverrideUI {
  field: string;
  unit: string;
  customUnit: string;
  alignment: string;
  textColor: string;
  bgColor: string;
  autoColor: boolean;
}

export default defineComponent({
  name: "OverrideConfigPopup",
  props: {
    columns: {
      type: Array as PropType<Array<{ label: string; alias: string }>>,
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

    // ── Load existing config into UI state ─────────────────────────────────────
    const loadFromRaw = (raw: any[]): ColumnOverrideUI[] => {
      const byColumn: Record<string, ColumnOverrideUI> = {};
      for (const entry of raw ?? []) {
        const alias = entry?.field?.value;
        if (!alias) continue;
        if (!byColumn[alias]) {
          byColumn[alias] = { field: alias, unit: "", customUnit: "", alignment: "", textColor: "", bgColor: "", autoColor: false };
        }
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
          }
        }
      }
      return Object.values(byColumn);
    };

    const columnOverrides = ref<ColumnOverrideUI[]>(
      loadFromRaw(props.overrideConfig.overrideConfigs ?? []),
    );

    // If nothing loaded yet, start with one empty row
    if (columnOverrides.value.length === 0) {
      columnOverrides.value.push({ field: "", unit: "", customUnit: "", alignment: "", textColor: "", bgColor: "", autoColor: false });
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

    // ── Mutations ──────────────────────────────────────────────────────────────
    const addColumn = () => {
      columnOverrides.value.push({ field: "", unit: "", customUnit: "", alignment: "", textColor: "", bgColor: "", autoColor: false });
    };

    const removeColumn = (idx: number) => {
      columnOverrides.value.splice(idx, 1);
    };

    // ── Serialize to override_config format ────────────────────────────────────
    const toRaw = (cols: ColumnOverrideUI[]): any[] =>
      cols
        .filter((c) => c.field)
        .map((c) => {
          const config: any[] = [];
          if (c.unit) config.push({ type: "unit", value: { unit: c.unit, customUnit: c.customUnit } });
          if (c.alignment) config.push({ type: "alignment", value: c.alignment });
          if (c.textColor) config.push({ type: "text_color", value: c.textColor });
          if (c.bgColor) config.push({ type: "background_color", value: c.bgColor });
          if (c.autoColor) config.push({ type: "unique_value_color", autoColor: true });
          return { field: { matchBy: "name", value: c.field }, config };
        });

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
      columnOptionsFor,
      availableColumnsToAdd,
      getFieldLabel,
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
