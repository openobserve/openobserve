<template>
  <div class="operations-list">
    <div style="display: flex; flex-direction: row" class="q-pl-md">
      <div class="layout-name">{{ t("panel.operations") }}</div>
      <span class="layout-separator">:</span>
      <div class="axis-container scroll row">
        <!-- Operations with Drag and Drop -->
        <draggable
          v-model="localOperations"
          :item-key="getItemKey"
          @change="onDragEnd"
          handle=".drag-handle"
          class="operations-container"
        >
          <template v-for="(element, index) in localOperations">
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
                        v-for="(param, paramIndex) in getOperationDef(element.id)?.params"
                        :key="paramIndex"
                      >
                        <!-- Number Parameter -->
                        <q-input
                          v-if="param.type === 'number'"
                          v-model.number="element.params[paramIndex]"
                          type="number"
                          :label="param.name"
                          dense
                          borderless
                          stack-label
                          hide-bottom-space
                          class="showLabelOnTop q-mb-sm"
                          @update:model-value="onOperationChange"
                          :data-test="`promql-operation-param-${paramIndex}`"
                        />

                        <!-- String Parameter -->
                        <q-input
                          v-else-if="param.type === 'string'"
                          v-model="element.params[paramIndex]"
                          :label="param.name"
                          :placeholder="param.placeholder"
                          dense
                          borderless
                          stack-label
                          hide-bottom-space
                          class="showLabelOnTop q-mb-sm"
                          @update:model-value="onOperationChange"
                          :data-test="`promql-operation-param-${paramIndex}`"
                        />

                        <!-- Select Parameter (if options provided) -->
                        <q-select
                          v-else-if="param.options"
                          v-model="element.params[paramIndex]"
                          :options="param.options"
                          :label="param.name"
                          dense
                          borderless
                          stack-label
                          hide-bottom-space
                          class="showLabelOnTop q-mb-sm"
                          @update:model-value="onOperationChange"
                          :data-test="`promql-operation-param-${paramIndex}`"
                        />
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
          class="add-operation-btn"
          data-test="promql-add-operation"
        >
          <q-tooltip>Add operation</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Operation Selector Dialog -->
    <q-dialog v-model="showOperationSelector">
      <q-card style="min-width: 500px">
        <q-card-section>
          <div class="text-h6">Add Operation</div>
        </q-card-section>

        <q-card-section>
          <q-input
            v-model="searchQuery"
            label="Search operations"
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
}>();

const emit = defineEmits<{
  "update:operations": [value: QueryBuilderOperation[]];
}>();

const { t } = useI18n();
const localOperations = ref<QueryBuilderOperation[]>([...props.operations]);
const showOperationSelector = ref(false);
const searchQuery = ref("");

const categories = computed(() => promQueryModeller.getCategories());

const computedLabel = (operation: QueryBuilderOperation): string => {
  const opDef = getOperationDef(operation.id);
  if (!opDef) return operation.id;

  // Show operation name with parameters if any
  if (operation.params && operation.params.length > 0 && operation.params.some(p => p !== "" && p !== null && p !== undefined)) {
    const paramsStr = operation.params
      .filter(p => p !== "" && p !== null && p !== undefined)
      .join(", ");
    return `${opDef.name}(${paramsStr})`;
  }

  return opDef.name;
};

onMounted(() => {
  console.log("OperationsList mounted");
  console.log("Categories:", categories.value);
  console.log("All operations:", promQueryModeller.getAllOperations());
  console.log("Initial operations:", localOperations.value);
});

// Watch for prop changes
watch(
  () => props.operations,
  (newOps) => {
    localOperations.value = [...newOps];
  },
  { deep: true }
);

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
  if (!searchQuery.value) return operations;

  const needle = searchQuery.value.toLowerCase();
  return operations.filter(
    (op) =>
      op.name.toLowerCase().includes(needle) ||
      op.id.toLowerCase().includes(needle) ||
      op.documentation?.toLowerCase().includes(needle)
  );
};

const addOperation = (opDef: QueryBuilderOperationDef) => {
  console.log("Adding operation:", opDef.name, opDef);
  const newOp: QueryBuilderOperation = {
    id: opDef.id,
    params: [...opDef.defaultParams],
  };
  localOperations.value.push(newOp);
  console.log("Local operations after add:", localOperations.value);
  showOperationSelector.value = false;
  searchQuery.value = "";
  onOperationChange();
};

const removeOperation = (index: number) => {
  localOperations.value.splice(index, 1);
  onOperationChange();
};

const onDragEnd = () => {
  onOperationChange();
};

const onOperationChange = () => {
  emit("update:operations", localOperations.value);
};
</script>

<style scoped lang="scss">
.operations-list {
  margin-bottom: 8px;
}

.layout-name {
  font-size: 14px;
  white-space: nowrap;
  min-width: 130px;
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

.add-operation-btn {
  margin-left: 4px;
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
