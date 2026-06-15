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
     same config.override_config model the dialog edits. The editor body is the
     shared <ColumnFormatControls>; this component only adds the popover chrome
     (trigger, header, live preview, footer). Each change serializes this column
     and emits the full upserted array (live preview). -->
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

        <!-- Shared editor body (same component the "Edit all" dialog embeds). -->
        <ColumnFormatControls
          :col="col"
          :is-numeric="isNumeric"
          data-test-prefix="o2-table-format"
        />
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
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ColumnFormatControls from "./ColumnFormatControls.vue";
import {
  type ColumnOverrideUI,
  emptyColumnOverride,
  loadColumnFromRaw,
  serializeColumnOverride,
  upsertColumnOverride,
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
    ODropdown,
    ColumnFormatControls,
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
      onOpenChange,
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
