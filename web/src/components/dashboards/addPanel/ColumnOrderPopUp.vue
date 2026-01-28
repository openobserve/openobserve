<!-- Copyright 2023 OpenObserve Inc.

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
  <q-card
    class="column-order-popup scroll"
    data-test="dashboard-column-order-popup"
    style="padding: 0px 10px; min-width: min(700px, 90vw); max-height: 80vh"
  >
    <!-- Header -->
    <div
      class="flex justify-between items-center q-pa-md header"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span>{{ t("dashboard.columnOrder") }}</span>
      </div>
      <q-btn
        icon="close"
        class="q-ml-xs"
        unelevated
        size="sm"
        round
        outline
        @click.stop="cancelEdit"
        data-test="dashboard-column-order-cancel"
      />
    </div>

    <!-- Content -->
    <div class="scrollable-content">
      <div class="text-caption text-grey-7 q-mb-md">
        {{ t("dashboard.columnOrderDescription") }}
      </div>

      <!-- Empty state -->
      <div
        v-if="!editColumnOrder || editColumnOrder.length === 0"
        class="text-center q-pa-xl text-grey-6"
      >
        <q-icon name="view_column" size="48px" class="q-mb-md" />
        <div class="text-body1">{{ t("dashboard.noColumnsOrdered") }}</div>
        <div class="text-caption">
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
          class="column-order-row"
          :data-test="`column-order-row-${index}`"
        >
            <!-- Drag handle -->
            <div class="drag-handle">
              <q-icon
                name="drag_indicator"
                color="grey-6"
                size="20px"
                :data-test="`column-order-drag-handle-${index}`"
              />
            </div>

            <!-- Column number -->
            <div class="column-number">{{ index + 1 }}.</div>

            <!-- Column name -->
            <div class="column-name">{{ column }}</div>

            <!-- Actions -->
            <div class="column-actions">
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="arrow_upward"
                :disable="index === 0"
                @click="moveColumnUp(index)"
                :data-test="`column-order-move-up-${index}`"
              >
                <q-tooltip>{{ t("dashboard.moveUp") }}</q-tooltip>
              </q-btn>
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="arrow_downward"
                :disable="index === editColumnOrder.length - 1"
                @click="moveColumnDown(index)"
                :data-test="`column-order-move-down-${index}`"
              >
                <q-tooltip>{{ t("dashboard.moveDown") }}</q-tooltip>
              </q-btn>
            </div>
          </div>
      </draggable>
    </div>

    <!-- Footer -->
    <div class="sticky-footer q-pa-md">
      <q-btn
        :label="t('common.cancel')"
        outline
        no-caps
        @click.stop="cancelEdit"
        data-test="dashboard-column-order-cancel-btn"
      />
      <q-btn
        :label="t('common.save')"
        color="primary"
        no-caps
        @click.stop="saveEdit"
        data-test="dashboard-column-order-save-btn"
      />
    </div>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { VueDraggableNext } from "vue-draggable-next";

export default defineComponent({
  name: "ColumnOrderPopUp",
  components: {
    draggable: VueDraggableNext as any,
  },
  props: {
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
          props.availableColumns.includes(col)
        );

        // Find columns in availableColumns that are not in columnOrder
        const remaining = props.availableColumns.filter(
          (col) => !filtered.includes(col)
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
      { deep: true }
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

<style scoped lang="scss">
.column-order-popup {
  .scrollable-content {
    overflow-y: auto;
    max-height: calc(80vh - 190px);
    padding: 12px;

    &::-webkit-scrollbar {
      width: 6px;
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 4px;
    }
    scrollbar-width: thin;
    scrollbar-color: #d1d5db transparent;
  }

  .column-order-row {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    margin-bottom: 4px;
    border-bottom: 1px solid #cccccc70;
    transition: background-color 0.2s;

    &:hover {
      background-color: rgba(0, 0, 0, 0.02);
    }

    &:last-child {
      border-bottom: none;
    }

    .drag-handle {
      cursor: move;
      padding: 2px 4px;
      margin-right: 8px;
      display: flex;
      align-items: center;
    }

    .column-number {
      min-width: 32px;
      color: #666;
      font-weight: 500;
      font-size: 13px;
    }

    .column-name {
      flex: 1;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }

    .column-actions {
      display: flex;
      gap: 2px;
      margin-left: 8px;
    }
  }
}

.sticky-footer {
  position: sticky;
  bottom: 0;
  left: 0;
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  z-index: 10;
  border-top: 1px solid #eee;
  box-shadow: rgb(240, 240, 240) 0px -4px 7px 0px;
  background: white;
}

// Dark mode support
.body--dark {
  .column-order-popup {
    .column-order-row {
      border-bottom-color: rgba(255, 255, 255, 0.12);

      &:hover {
        background-color: rgba(255, 255, 255, 0.05);
      }

      .column-number {
        color: #aaa;
      }
    }
  }

  .sticky-footer {
    border-top-color: rgba(255, 255, 255, 0.28);
    box-shadow: rgba(0, 0, 0, 0.3) 0px -4px 7px 0px;
    background: var(--q-dark);
  }
}
</style>
