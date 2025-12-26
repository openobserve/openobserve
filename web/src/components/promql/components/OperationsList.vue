<template>
  <div class="tw-py-[0.25rem]">
    <div style="display: flex; flex-direction: row" class="q-pl-md">
      <div class="layout-name">{{ t("panel.operations") }}</div>
      <span class="layout-separator">:</span>
      <div class="axis-container scroll row">
        <!-- Operations with Drag and Drop -->
        <draggable
          v-if="props.operations.length"
          :modelValue="props.operations"
          @update:modelValue="handleDragUpdate"
          :item-key="getItemKey"
          handle=".drag-handle"
          class="operations-container"
        >
          <template v-for="(element, index) in props.operations">
            <div class="operation-item">
              <q-btn-group>
                <q-btn
                  square
                  icon="drag_indicator"
                  no-caps
                  dense
                  flat
                  size="sm"
                  class="drag-handle"
                  :data-test="`promql-operation-drag-${index}`"
                >
                  <q-tooltip>Drag to reorder</q-tooltip>
                </q-btn>
                <q-btn
                  square
                  icon-right="arrow_drop_down"
                  no-caps
                  dense
                  :no-wrap="true"
                  color="primary"
                  size="sm"
                  :label="computedLabel(element)"
                  class="q-pl-sm"
                  :data-test="`promql-operation-${index}`"
                >
                  <q-menu class="q-pa-md">
                    <div style="width: 350px">
                      <div class="text-weight-medium q-mb-sm">
                        {{ getOperationDef(element.id)?.name || element.id }}
                      </div>
                      <div class="text-caption text-grey-7 q-mb-md">
                        {{ getOperationDef(element.id)?.documentation }}
                      </div>

                      <!-- Operation Parameters -->
                      <template
                        v-for="(param, paramIndex) in getOperationDef(
                          element.id,
                        )?.params"
                        :key="paramIndex"
                      >
                        <!-- Number Parameter -->
                        <q-input
                          v-if="param.type === 'number'"
                          v-model.number="element.params[paramIndex] as number"
                          type="number"
                          :label="param.name"
                          dense
                          borderless
                          stack-label
                          hide-bottom-space
                          class="showLabelOnTop q-mb-sm"
                          :data-test="`promql-operation-param-${paramIndex}`"
                        />

                        <!-- String Parameter -->
                        <q-input
                          v-else-if="param.type === 'string'"
                          v-model="element.params[paramIndex] as string"
                          :label="param.name"
                          :placeholder="param.placeholder"
                          dense
                          borderless
                          stack-label
                          hide-bottom-space
                          class="showLabelOnTop q-mb-sm"
                          :data-test="`promql-operation-param-${paramIndex}`"
                        />

                        <!-- Multi-Select Parameter for labels -->
                        <q-select
                          v-else-if="param.type === 'select'"
                          v-model="element.params[paramIndex] as string[]"
                          :options="availableLabels"
                          :label="param.name"
                          dense
                          borderless
                          stack-label
                          hide-bottom-space
                          multiple
                          class="showLabelOnTop q-mb-sm"
                          :data-test="`promql-operation-param-${paramIndex}`"
                          :hint="
                            availableLabels.length
                              ? 'Select one or more labels'
                              : 'No labels available'
                          "
                        >
                          <template v-slot:no-option>
                            <q-item>
                              <q-item-section class="text-grey">
                                {{
                                  availableLabels.length
                                    ? "No matching labels"
                                    : "Select a metric first to load labels"
                                }}
                              </q-item-section>
                            </q-item>
                          </template>
                        </q-select>
                      </template>
                    </div>
                  </q-menu>
                </q-btn>
                <q-btn
                  size="xs"
                  dense
                  @click="removeOperation(index)"
                  icon="close"
                  :data-test="`promql-operation-remove-${index}`"
                />
              </q-btn-group>
            </div>
          </template>
        </draggable>

        <!-- Add Button -->
        <q-btn
          flat
          dense
          icon="add"
          size="sm"
          color="primary"
          @click="showOperationSelector = true"
          class="add-operation-btn tw-ml-[0.25rem]"
          data-test="promql-add-operation"
        >
          <q-tooltip>Add operation</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Operation Selector Dialog -->
    <q-dialog v-model="showOperationSelector">
      <q-card style="min-width: 500px">
        <q-card-section class="!tw-pt-[0.625rem] !tw-pb-[0.625rem]">
          <div class="tw-text-[1.2rem]">Add Operation</div>
        </q-card-section>

        <q-card-section class="!tw-py-[0.625rem]">
          <q-input
            v-model="searchQuery"
            dense
            borderless
            stack-label
            hide-bottom-space
            class="showLabelOnTop"
            clearable
          >
            <template v-slot:prepend>
              <q-icon name="search" />
            </template>
          </q-input>
        </q-card-section>

        <q-card-section class="q-pt-none" style="max-height: 400px; overflow-y: auto">
          <q-list bordered separator>
            <template v-for="category in categories" :key="category">
              <q-expansion-item
                :label="category"
                default-opened
                header-class="text-weight-medium"
              >
                <q-list>
                  <q-item
                    v-for="op in getFilteredOperationsForCategory(category)"
                    :key="op.id"
                    clickable
                    v-close-popup
                    @click="addOperation(op)"
                  >
                    <q-item-section>
                      <q-item-label>{{ op.name }}</q-item-label>
                      <q-item-label caption>{{ op.documentation }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-expansion-item>
            </template>
          </q-list>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { VueDraggableNext as draggable } from "vue-draggable-next";
import {
  QueryBuilderOperation,
  QueryBuilderOperationDef,
} from "@/components/promql/types";
import { promQueryModeller } from "@/components/promql/operations/queryModeller";

const props = defineProps<{
  operations: QueryBuilderOperation[];
  dashboardData?: any; // Dashboard data containing shared meta
}>();

const emit = defineEmits<{
  "update:operations": [value: QueryBuilderOperation[]];
}>();

const { t } = useI18n();
const showOperationSelector = ref(false);
const searchQuery = ref("");

// Access shared label options from meta
const availableLabels = computed(() => props.dashboardData?.meta?.promql?.availableLabels || []);

const categories = computed(() => promQueryModeller.getCategories());

const computedLabel = (operation: QueryBuilderOperation): string => {
  const opDef = getOperationDef(operation.id);
  if (!opDef) return operation.id;

  // Show operation name with parameters if any
  if (operation.params && operation.params.length > 0) {
    const displayParams = operation.params
      .map((p) => {
        // Handle array parameters (e.g., selected labels)
        if (Array.isArray(p)) {
          return p.length > 0 ? p.join(", ") : "";
        }
        // Handle primitive parameters
        return p !== "" && p !== null && p !== undefined ? String(p) : "";
      })
      .filter((p) => p !== "");

    if (displayParams.length > 0) {
      return `${opDef.name}(${displayParams.join(", ")})`;
    }
  }

  return opDef.name;
};

const getItemKey = (item: QueryBuilderOperation, index: number) => {
  return `${item.id}-${index}`;
};

const getOperationDef = (id: string): QueryBuilderOperationDef | undefined => {
  return promQueryModeller.getOperationDef(id);
};

const getFilteredOperationsForCategory = (
  category: string
): QueryBuilderOperationDef[] => {
  const operations = promQueryModeller.getOperationsForCategory(category);
  console.log("category operations ------ ", category, operations);
  if (!searchQuery.value) return operations;

  const needle = searchQuery.value.toLowerCase();
  return operations.filter(
    (op) =>
      op.name.toLowerCase().includes(needle) ||
      op.id.toLowerCase().includes(needle) ||
      op.documentation?.toLowerCase().includes(needle) ||
      op.category?.toLowerCase().includes(needle)
  );
};

const handleDragUpdate = (newVal: QueryBuilderOperation[]) => {
  // Clear and repopulate the array to maintain reactivity
  props.operations.splice(0, props.operations.length, ...newVal);
  // Emit the update to trigger parent watcher
  emit("update:operations", props.operations);
};

const addOperation = (opDef: QueryBuilderOperationDef) => {
  const newOp: QueryBuilderOperation = {
    id: opDef.id,
    params: [...opDef.defaultParams],
  };
  props.operations.push(newOp);
  showOperationSelector.value = false;
  searchQuery.value = "";
};

const removeOperation = (index: number) => {
  props.operations.splice(index, 1);
};

defineExpose({
  availableLabels,
});
</script>

<style scoped lang="scss">
.layout-name {
  font-size: 14px;
  white-space: nowrap;
  min-width: 86px;
  display: flex;
  align-items: center;
}

.layout-separator {
  display: flex;
  align-items: center;
  margin-left: 2px;
  margin-right: 2px;
}

.axis-container {
  margin: 5px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.operations-container {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.operation-item {
  display: flex;
  align-items: center;
}

.drag-handle {
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}

.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;
}
</style>
