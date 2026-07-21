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
    :open="open"
    @update:open="(v) => { if (!v) cancelEdit() }"
    :title="t('dashboard.columnOrder')"
    size="lg"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('common.save')"
    @click:secondary="cancelEdit"
    @click:primary="saveEdit"
    data-test="dashboard-column-order-popup"
  >
    <!-- Content -->
    <div>
      <div class="text-xs text-text-secondary mb-3" data-test="dashboard-column-order-description">
        {{ t("dashboard.columnOrderDescription") }}
      </div>

      <!-- Empty state -->
      <div
        v-if="!editColumnOrder || editColumnOrder.length === 0"
        class="text-center p-6 text-text-muted"
        data-test="dashboard-column-order-empty-state"
      >
        <OIcon name="view-column" class="mb-3 w-12 h-12" />
        <div class="text-base">{{ t("dashboard.noColumnsOrdered") }}</div>
        <div class="text-xs">
          {{ t("dashboard.columnsDefaultOrder") }}
        </div>
      </div>

      <!-- Draggable list -->
      <draggable
        v-else
        v-model="editColumnOrder"
        :options="dragOptions"
        @mousedown.stop="() => {}"
        data-test="dashboard-column-order-drag"
      >
        <div
          v-for="(column, index) in editColumnOrder"
          :key="`column-${index}`"
          class="flex items-center px-3 py-2 mb-1 border-b border-border-default transition-colors hover:bg-surface-subtle-hover last:border-b-0"
          :data-test="`column-order-row-${index}`"
        >
          <!-- Drag handle -->
          <div class="cursor-move px-1 mr-2 flex items-center" data-test="dashboard-column-order-drag-handle">
            <OIcon
              name="drag-indicator"
              size="md"
              :data-test="`column-order-drag-handle-${index}`"
            />
          </div>

          <!-- Column number -->
          <div class="min-w-8 font-medium text-compact text-text-secondary" data-test="dashboard-column-order-column-number">{{ index + 1 }}.</div>

          <!-- Column name -->
          <div class="flex-1 font-medium overflow-hidden text-ellipsis whitespace-nowrap text-compact" data-test="dashboard-column-order-column-name">{{ column }}</div>

          <!-- Actions -->
          <div class="flex gap-0.5 ml-2" data-test="dashboard-column-order-column-actions">
            <OButton
              variant="ghost"
              size="icon"
              :disabled="index === 0"
              @click="moveColumnUp(index)"
              :data-test="`column-order-move-up-${index}`"
              icon-left="arrow-upward"
            >
              <OTooltip :content="t('dashboard.moveUp')" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon"
              :disabled="index === editColumnOrder.length - 1"
              @click="moveColumnDown(index)"
              :data-test="`column-order-move-down-${index}`"
              icon-left="arrow-downward"
            >
              <OTooltip :content="t('dashboard.moveDown')" />
            </OButton>
          </div>
        </div>
      </draggable>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { VueDraggableNext } from "vue-draggable-next";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export default defineComponent({
  name: "ColumnOrderPopUp",
  components: {
    draggable: VueDraggableNext as any,
    OButton,
    ODialog,
    OIcon,
    OTooltip,
},
  props: {
    open: {
      type: Boolean,
      required: true,
    },
    columnOrder: {
      type: Array as () => string[],
      default: () => [],
    },
    availableColumns: {
      type: Array as () => string[],
      default: () => [],
    },
  },
  emits: ["cancel", "save"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const editColumnOrder = ref<string[]>([]);

    // Drag options
    const dragOptions = {
      animation: 200,
      handle: ".drag-handle",
      ghostClass: "ghost",
    };

    // Initialize edit column order from props
    const initializeColumnOrder = () => {
      if (props.columnOrder && props.columnOrder.length > 0) {
        // Filter the column order to only include columns that are in availableColumns
        const filtered = props.columnOrder.filter((col) =>
          props.availableColumns.includes(col),
        );

        // Find columns in availableColumns that are not in columnOrder
        const remaining = props.availableColumns.filter(
          (col) => !filtered.includes(col),
        );

        // Combine: ordered columns first, then remaining in their natural order
        editColumnOrder.value = [...filtered, ...remaining];
      } else {
        // Start with available columns in their natural order
        editColumnOrder.value = [...props.availableColumns];
      }
    };

    onMounted(() => {
      initializeColumnOrder();
    });

    // Watch for changes in availableColumns and re-initialize the entire list
    watch(
      () => props.availableColumns,
      () => {
        initializeColumnOrder();
      },
      { deep: true },
    );

    const moveColumnUp = (index: number) => {
      if (index > 0) {
        const temp = editColumnOrder.value[index];
        editColumnOrder.value[index] = editColumnOrder.value[index - 1];
        editColumnOrder.value[index - 1] = temp;
      }
    };

    const moveColumnDown = (index: number) => {
      if (index < editColumnOrder.value.length - 1) {
        const temp = editColumnOrder.value[index];
        editColumnOrder.value[index] = editColumnOrder.value[index + 1];
        editColumnOrder.value[index + 1] = temp;
      }
    };

    const cancelEdit = () => {
      // Reset in-progress edits so re-opening the popup starts from the persisted
      // column order — the component stays mounted across open/close cycles, so
      // onMounted/availableColumns-watch wouldn't otherwise re-initialise.
      initializeColumnOrder();
      emit("cancel");
    };

    const saveEdit = () => {
      emit("save", editColumnOrder.value);
    };

    return {
      t,
      editColumnOrder,
      dragOptions,
      moveColumnUp,
      moveColumnDown,
      cancelEdit,
      saveEdit,
    };
  },
});
</script>
