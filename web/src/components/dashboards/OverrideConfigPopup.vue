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
    :sub-title="t('dashboard.columnFormattingSubtitle')"
    :width="80"
  >
    <div
      data-test="override-config-accordion"
      class="grid grid-cols-[16.5rem_minmax(0,1fr)_22.5rem] max-[56.25rem]:grid-cols-[13.75rem_minmax(0,1fr)] h-[calc(86vh-9.375rem)] overflow-hidden -mx-dialog-content-px -my-dialog-content-py"
    >
      <!-- Left: add-field dropdown + list of added fields -->
      <div
        class="flex flex-col gap-2.5 min-w-0 p-3 border-r border-[color-mix(in_srgb,var(--color-grey-500)_18%,transparent)]"
      >
        <ODropdown
          v-model:open="addOpenLeft"
          align="start"
          content-class="min-w-(--reka-popper-anchor-width)!"
        >
          <template #trigger>
            <button
              type="button"
              data-test="dashboard-addpanel-config-add-column"
              class="flex items-center justify-center gap-1.5 w-full shrink-0 p-2.25 rounded-default border border-dashed border-[color-mix(in_srgb,var(--color-primary-600)_50%,transparent)] bg-transparent cursor-pointer text-sm font-medium text-accent transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary-600)_5%,transparent)] hover:border-accent"
            >
              <OIcon name="add" size="sm" />
              {{ t("dashboard.columnFormattingAddField") }}
            </button>
          </template>
          <div class="max-h-[17.5rem] overflow-y-auto">
            <ODropdownItem
              v-for="opt in availableToAdd"
              :key="opt.value"
              :data-test="`dashboard-addpanel-config-add-field-${opt.value}`"
              @select="addField(opt.value)"
            >
              <span class="flex items-center gap-2">
                <span class="shrink-0 text-3xs font-bold tracking-[0.05em] uppercase py-0.5 px-1.25 rounded-default" :class="badgeClass(opt.isNumeric)">
                  {{ opt.isNumeric ? t("dashboard.typeNumeric") : t("dashboard.typeText") }}
                </span>
                <span>{{ opt.label }}</span>
              </span>
            </ODropdownItem>
            <div
              v-if="!availableToAdd.length"
              class="py-2 px-2.5 text-xs text-text-secondary"
            >
              {{ t("dashboard.columnFormattingAllAdded") }}
            </div>
          </div>
        </ODropdown>

        <div
          v-if="columnOverrides.length"
          class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1"
        >
          <div
            v-for="(col, idx) in columnOverrides"
            :key="idx"
            role="button"
            tabindex="0"
            :data-test="`override-config-row-${idx}`"
            class="group relative flex items-center gap-2 w-full py-2 pl-2.25 pr-1.5 rounded-default border-l-[0.1875rem] border-transparent cursor-pointer outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--color-grey-500)_5%,transparent)]"
            :class="
              idx === selectedIdx
                ? 'bg-[color-mix(in_srgb,var(--color-primary-600)_6%,transparent)] border-l-primary-600!'
                : ''
            "
            @click="selectedIdx = idx"
            @keydown.enter.prevent="selectedIdx = idx"
            @keydown.space.prevent="selectedIdx = idx"
          >
            <span class="shrink-0 text-3xs font-bold tracking-[0.05em] uppercase py-0.5 px-1.25 rounded-default" :class="badgeClass(isNumericColumn(col))">
              {{ isNumericColumn(col) ? t("dashboard.typeNumeric") : t("dashboard.typeText") }}
            </span>
            <span
              class="flex-1 min-w-0 font-semibold text-sm overflow-hidden text-ellipsis whitespace-nowrap group-hover:pr-7"
            >
              {{ getFieldLabel(col.field) || t("dashboard.columnFormattingPick") }}
            </span>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="close"
              :title="t('common.remove')"
              :data-test="`dashboard-addpanel-config-delete-column-${idx}`"
              class="absolute! right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
              @click.stop="removeColumn(idx)"
            />
          </div>
        </div>
        <div
          v-else
          class="flex-1 flex flex-col items-center justify-center gap-1.5 text-center p-4"
        >
          <OIcon
            name="format-color-text"
            size="lg"
            class="text-text-secondary"
          />
          <div class="font-semibold text-sm">
            {{ t("dashboard.columnFormattingNoFields") }}
          </div>
          <div class="text-xs text-text-secondary leading-[1.4]">
            {{ t("dashboard.columnFormattingNoFieldsHint") }}
          </div>
        </div>
      </div>

      <!-- Detail: controls + live preview for the selected field -->
      <template v-if="selectedCol">
        <div class="min-w-0 overflow-y-auto">
          <ColumnFormatControls
            :col="selectedCol"
            :is-numeric="isNumericColumn(selectedCol)"
          />
        </div>
        <div
          class="flex flex-col gap-2 min-w-0 overflow-y-auto p-3 border-l border-[color-mix(in_srgb,var(--color-grey-500)_18%,transparent)]"
        >
          <div
            class="flex items-center gap-1.25 text-3xs font-bold tracking-[0.06em] uppercase text-text-secondary"
          >
            <OIcon name="visibility" size="xs" />
            <span>{{ t("dashboard.inlinePreview") }}</span>
          </div>
          <div
            class="border border-[color-mix(in_srgb,var(--color-grey-500)_18%,transparent)] rounded-default overflow-hidden [&_[data-test=dashboard-table-cell-copy-btn]]:hidden!"
          >
            <TableRenderer
              v-if="selectedPreview"
              :data="selectedPreview"
              :value-mapping="valueMapping"
              :wrap-cells="true"
              :show-pagination="false"
            />
          </div>
          <div class="text-2xs text-text-secondary">
            {{ t("dashboard.columnFormattingSampleNote") }}
          </div>
        </div>
      </template>

      <!-- Empty state: nothing added yet -->
      <div
        v-else
        class="col-start-2 col-end-4 max-[56.25rem]:col-end-3 flex items-center justify-center p-6"
      >
        <OEmptyState
          size="block"
          :title="t('dashboard.columnFormattingEmptyTitle')"
          :description="t('dashboard.columnFormattingEmptyHint')"
        >
          <template #illustration>
            <div
              class="w-18 h-18 rounded-default bg-[color-mix(in_srgb,var(--color-grey-500)_8%,transparent)] flex items-center justify-center text-text-secondary"
            >
              <OIcon name="tune" size="xl" />
            </div>
          </template>
          <template #actions>
            <ODropdown
              v-model:open="addOpenCenter"
              align="start"
              content-class="min-w-(--reka-popper-anchor-width)!"
            >
              <template #trigger>
                <OButton
                  variant="primary"
                  icon-left="add"
                  data-test="dashboard-addpanel-config-add-column-empty"
                >
                  {{ t("dashboard.columnFormattingAddField") }}
                </OButton>
              </template>
              <div class="max-h-[17.5rem] overflow-y-auto">
                <ODropdownItem
                  v-for="opt in availableToAdd"
                  :key="opt.value"
                  :data-test="`dashboard-addpanel-config-add-field-empty-${opt.value}`"
                  @select="addField(opt.value)"
                >
                  <span class="flex items-center gap-2">
                    <span class="shrink-0 text-3xs font-bold tracking-[0.05em] uppercase py-0.5 px-1.25 rounded-default" :class="badgeClass(opt.isNumeric)">
                      {{ opt.isNumeric ? t("dashboard.typeNumeric") : t("dashboard.typeText") }}
                    </span>
                    <span>{{ opt.label }}</span>
                  </span>
                </ODropdownItem>
                <div
                  v-if="!availableToAdd.length"
                  class="py-2 px-2.5 text-xs text-text-secondary"
                >
                  {{ t("dashboard.columnFormattingAllAdded") }}
                </div>
              </div>
            </ODropdown>
          </template>
        </OEmptyState>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <span class="text-xs text-text-secondary">{{ footerSummary }}</span>
        <div class="flex gap-2">
          <OButton
            variant="outline"
            data-test="override-config-popup-cancel"
            @click="closePopup"
          >
            {{ t("dashboard.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            data-test="override-config-popup-save"
            @click="saveOverrides"
          >
            {{ t("dashboard.overrideConfigSave") }}
          </OButton>
        </div>
      </div>
    </template>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, defineAsyncComponent, PropType } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ColumnFormatControls from "./ColumnFormatControls.vue";
import {
  type ColumnOverrideUI,
  emptyColumnOverride,
  loadAllFromRaw,
  serializeOverrides,
  serializeColumnOverride,
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
  components: { OButton, OIcon, ODialog, ODropdown, ODropdownItem, OEmptyState, ColumnFormatControls, TableRenderer },
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
    // Panel-level fallbacks so the preview matches the real table.
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

    const columnOverrides = ref<ColumnOverrideUI[]>([]);
    const selectedIdx = ref<number>(-1);
    const addOpenLeft = ref(false);
    const addOpenCenter = ref(false);

    const initFromProps = () => {
      columnOverrides.value = loadAllFromRaw(
        props.overrideConfig.overrideConfigs ?? [],
      );
      selectedIdx.value = columnOverrides.value.length ? 0 : -1;
    };

    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) initFromProps();
      },
      { immediate: true },
    );

    const allColumnOptions = computed(() => {
      const seen = new Set<string>();
      const out: Array<{ label: string; value: string; isNumeric: boolean }> = [];
      for (const c of props.columns as any[]) {
        if (!c?.alias || seen.has(c.alias)) continue;
        seen.add(c.alias);
        // Mirror the table renderer (convertTableData uses `label || alias`):
        // fall back to the alias so columns with an empty label (e.g. custom-SQL
        // columns) still show a name instead of a blank row.
        out.push({
          label: c.label || c.alias,
          value: c.alias,
          isNumeric: !!c.isNumeric,
        });
      }
      return out;
    });

    const availableToAdd = computed(() => {
      const used = new Set(
        columnOverrides.value.map((c) => c.field).filter(Boolean),
      );
      return allColumnOptions.value.filter((o: any) => !used.has(o.value));
    });

    const selectedCol = computed(
      () => columnOverrides.value[selectedIdx.value] ?? null,
    );

    const footerSummary = computed(() => {
      const n = columnOverrides.value.length;
      if (n === 0) return t("dashboard.columnFormattingNoFieldsToFormat");
      if (n === 1) return t("dashboard.columnFormattingOneFieldToFormat");
      return `${n} ${t("dashboard.columnFormattingFieldsToFormat")}`;
    });

    // Field-type badge colour (num = blue, text = grey).
    const badgeClass = (isNum: boolean) =>
      isNum
        ? "text-field-type-number-text bg-field-type-number-bg"
        : "text-field-type-string-text bg-field-type-string-bg";

    const getFieldLabel = (alias: string) => {
      if (!alias) return "";
      return (
        allColumnOptions.value.find((o: any) => o.value === alias)?.label ??
        `${alias}`
      );
    };

    const detectedNumeric = (field: string): boolean => {
      if (!field) return false;
      return props.columns.find((c: any) => c.alias === field)?.isNumeric ?? false;
    };

    const isNumericColumn = (col: ColumnOverrideUI): boolean =>
      col.fieldType === "num"
        ? true
        : col.fieldType === "text"
          ? false
          : detectedNumeric(col.field);

    watch(
      () => columnOverrides.value.map((c) => `${c.field}|${c.fieldType}`),
      (keys, prevKeys) => {
        const prevTypeByField = new Map<string, string>();
        (prevKeys ?? []).forEach((k) => {
          const sep = k.lastIndexOf("|");
          prevTypeByField.set(k.slice(0, sep), k.slice(sep + 1));
        });
        columnOverrides.value.forEach((c) => {
          const prevType = prevTypeByField.get(c.field);
          if (prevType !== undefined && prevType !== c.fieldType && !isNumericColumn(c)) {
            c.unit = null;
            c.customUnit = null;
            c.conditions = [];
          }
        });
      },
    );

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
        const unit = maps.unitConfigMap[aliasLower]?.unit || props.panelUnit;
        const customUnit =
          maps.unitConfigMap[aliasLower]?.customUnit || props.panelUnitCustom;
        const decimals = props.panelDecimals ?? 2;
        c.format = (val: any) =>
          formatNumericValue(val, cache, unit, customUnit, decimals);
      }
      return c;
    };

    const DUMMY_NUMERIC = [12, 47, 83, 100, 6];
    const DUMMY_TEXT = ["alpha", "bravo", "charlie", "delta", "echo"];
    const makeDummyRows = (dataKey: string, isNumeric: boolean) =>
      (isNumeric ? DUMMY_NUMERIC : DUMMY_TEXT).map((v) => ({ [dataKey]: v }));

    const previewFor = (col: ColumnOverrideUI) => {
      const pd = props.previewData ?? {};
      const key = String(col.field ?? "").toLowerCase();
      let base = pd[key];
      if (!base?.column) {
        base = Object.values(pd).find((d: any) =>
          [d?.column?.alias, d?.column?.field, d?.column?.name].some(
            (v) => String(v ?? "").toLowerCase() === key,
          ),
        ) as any;
      }
      const isNumeric = isNumericColumn(col);
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
      const rows = base?.rows?.length
        ? base.rows
        : makeDummyRows(dataKey, isNumeric);
      const previewCol = buildPreviewColumn(baseColumn, col, isNumeric);
      return { rows, columns: [previewCol] };
    };

    const selectedPreview = computed(() => {
      const c = selectedCol.value;
      return c && c.field ? previewFor(c) : null;
    });

    const addField = (alias: string) => {
      if (!alias) return;
      columnOverrides.value.push(emptyColumnOverride(alias));
      selectedIdx.value = columnOverrides.value.length - 1;
      addOpenLeft.value = false;
      addOpenCenter.value = false;
    };

    const removeColumn = (idx: number) => {
      columnOverrides.value.splice(idx, 1);
      if (selectedIdx.value >= columnOverrides.value.length) {
        selectedIdx.value = columnOverrides.value.length - 1;
      } else if (selectedIdx.value > idx) {
        selectedIdx.value -= 1;
      }
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
      selectedIdx,
      selectedCol,
      footerSummary,
      availableToAdd,
      addOpenLeft,
      addOpenCenter,
      badgeClass,
      getFieldLabel,
      isNumericColumn,
      selectedPreview,
      addField,
      removeColumn,
      closePopup,
      saveOverrides,
    };
  },
});
</script>
