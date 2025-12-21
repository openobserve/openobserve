<template>
  <div class="operations-list">
    <div class="text-subtitle2 q-mb-sm">
      <q-icon name="functions" class="q-mr-xs" />
      Operations
      <q-btn
        flat
        dense
        round
        icon="add"
        size="sm"
        color="primary"
        @click="showOperationSelector = true"
        class="q-ml-sm"
      >
        <q-tooltip>Add operation</q-tooltip>
      </q-btn>
    </div>

    <!-- Empty State -->
    <div v-if="localOperations.length === 0" class="text-grey-7 q-pa-md text-center">
      No operations added yet. Click + to add an operation.
    </div>

    <!-- Operations List with Drag and Drop -->
    <draggable
      v-show="localOperations.length > 0"
      v-model="localOperations"
      :item-key="getItemKey"
      @change="onDragEnd"
      handle=".drag-handle"
      class="operations-container"
    >
      <template v-for="(element, index) in localOperations">
        <q-card flat bordered class="operation-item q-mb-sm">
          <q-card-section class="row items-center q-pa-sm">
            <!-- Drag Handle -->
            <div class="col-auto q-mr-sm drag-handle cursor-grab">
              <q-icon name="drag_indicator" color="grey-6" size="sm" />
            </div>

            <!-- Operation Name -->
            <div class="col-3">
              <div class="text-weight-medium">
                {{ getOperationDef(element.id)?.name || element.id }}
              </div>
              <div class="text-caption text-grey-7">
                {{ getOperationDef(element.id)?.category }}
              </div>
            </div>

            <!-- Operation Parameters -->
            <div class="col-7">
              <div class="row q-gutter-sm">
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
                    outlined
                    style="max-width: 120px"
                    @update:model-value="onOperationChange"
                  >
                    <template v-if="param.description" v-slot:hint>
                      {{ param.description }}
                    </template>
                  </q-input>

                  <!-- String Parameter -->
                  <q-input
                    v-else-if="param.type === 'string'"
                    v-model="element.params[paramIndex]"
                    :label="param.name"
                    :placeholder="param.placeholder"
                    dense
                    outlined
                    style="max-width: 200px"
                    @update:model-value="onOperationChange"
                  >
                    <template v-if="param.description" v-slot:hint>
                      {{ param.description }}
                    </template>
                  </q-input>

                  <!-- Select Parameter (if options provided) -->
                  <q-select
                    v-else-if="param.options"
                    v-model="element.params[paramIndex]"
                    :options="param.options"
                    :label="param.name"
                    dense
                    outlined
                    style="max-width: 150px"
                    @update:model-value="onOperationChange"
                  />
                </template>
              </div>
            </div>

            <!-- Remove Button -->
            <div class="col-1 text-right">
              <q-btn
                flat
                dense
                round
                icon="delete"
                color="negative"
                size="sm"
                @click="removeOperation(index)"
              >
                <q-tooltip>Remove operation</q-tooltip>
              </q-btn>
            </div>

            <!-- Documentation -->
            <div v-if="getOperationDef(element.id)?.documentation" class="col-12 q-mt-sm">
              <q-icon name="info" size="xs" color="info" class="q-mr-xs" />
              <span class="text-caption text-grey-7">
                {{ getOperationDef(element.id)?.documentation }}
              </span>
            </div>
          </q-card-section>
        </q-card>
      </template>
    </draggable>

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
            outlined
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

const localOperations = ref<QueryBuilderOperation[]>([...props.operations]);
const showOperationSelector = ref(false);
const searchQuery = ref("");

const categories = computed(() => promQueryModeller.getCategories());

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
  padding: 16px;
  background: #f5f5f5;
  border-radius: 4px;
}

.operations-container {
  max-height: 500px;
  overflow-y: auto;
}

.operation-item {
  transition: all 0.2s;

  &:hover {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
}

.drag-handle {
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}

.cursor-grab {
  cursor: grab;
}
</style>
