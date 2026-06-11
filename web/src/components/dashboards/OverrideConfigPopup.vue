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

        <!-- Shared formatting controls — identical to the inline header popover. -->
        <ColumnFormatControls
          v-if="col.field"
          :col="col"
          :is-numeric="isNumericColumn(col.field)"
        />
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
import ColumnFormatControls from "./ColumnFormatControls.vue";
import {
  type ColumnOverrideUI,
  emptyColumnOverride,
  loadAllFromRaw,
  serializeOverrides,
} from "@/composables/dashboard/useColumnFormatting";

export default defineComponent({
  name: "OverrideConfigPopup",
  components: { OButton, ODialog, OSelect, OInput, OCheckbox, ColumnFormatControls },
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

    // ── Load existing config into UI state (shared loader) ─────────────────────
    const columnOverrides = ref<ColumnOverrideUI[]>([]);

    const initFromProps = () => {
      const loaded = loadAllFromRaw(props.overrideConfig.overrideConfigs ?? []);
      columnOverrides.value =
        loaded.length > 0 ? loaded : [emptyColumnOverride()];
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
    const addColumn = () => columnOverrides.value.push(emptyColumnOverride());
    const removeColumn = (idx: number) => columnOverrides.value.splice(idx, 1);

    // ── Actions ────────────────────────────────────────────────────────────────
    const closePopup = () => emit("close");

    const saveOverrides = () => {
      // Shared serializer keeps the dialog and inline menu output identical.
      const raw = serializeOverrides(columnOverrides.value, isNumericColumn);
      props.overrideConfig.overrideConfigs = raw;
      emit("save", raw);
      emit("close");
    };

    return {
      t,
      columnOverrides,
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
