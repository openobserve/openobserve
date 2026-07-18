<template>
    <div style="display: flex; flex-direction: row" class="pl-2">
      <div
        data-test="promql-operations-list-label"
        class="text-sm whitespace-nowrap flex items-center min-w-21.5"
      >{{ t("panel.operations") }}</div>
      <span class="flex items-center ml-0.5 mr-0.5">:</span>
      <div class="m-0.5 flex gap-2 flex-wrap items-center scroll">
        <!-- Operations with Drag and Drop -->
        <draggable
          v-if="props.operations.length"
          :modelValue="props.operations"
          @update:modelValue="handleDragUpdate"
          :item-key="getItemKey"
          handle=".drag-handle"
          class="flex gap-2 flex-wrap items-center"
        >
          <template v-for="(element, index) in props.operations">
            <div data-test="promql-operations-item">
              <OButtonGroup class="axis-field" radius="sm">
                <OButton
                  variant="outline"
                  size="icon-chip"
                  class="drag-handle cursor-grab"
                  :data-test="`promql-operation-drag-${index}`"
                >
                  <template #icon-left>
                    <OIcon name="drag-indicator" size="xs" />
                  </template>
                  <OTooltip :content="t('metrics.operationsList.dragToReorder')" side="top" />
                </OButton>
                <ODropdown>
                  <template #trigger>
                    <OButton
                      variant="primary"
                      size="chip"
                      class="!text-[12px]"
                      :no-wrap="true"
                      :data-test="`promql-operation-${index}`"
                    >
                      {{ computedLabel(element) }}
                      <template #icon-right
                        ><OIcon name="arrow-drop-down" size="sm"
                      /></template>
                    </OButton>
                  </template>
                  <div
                    class="operations-list-dropdown p-4 shadow-[0px_3px_15px_rgba(0,0,0,0.1)] translate-y-2 rounded-none"
                    :data-test="`promql-operation-${index}-menu`"
                  >
                    <div style="width: 350px">
                      <div class="text-weight-medium">
                        {{ getStepSpec(element.id)?.name || element.id }}
                      </div>
                      <div class="text-xs text-gray-400">
                        {{ getStepSpec(element.id)?.documentation }}
                      </div>

                      <!-- Operation Parameters -->
                      <template
                        v-for="(param, paramIndex) in getStepSpec(
                          element.id,
                        )?.params"
                        :key="paramIndex"
                      >
                        <!-- Number Parameter -->
                        <OInput
                          v-if="param.type === 'number'"
                          v-model.number="element.params[paramIndex] as number"
                          type="number"
                          :label="param.name"
                          class="showLabelOnTop mb-2"
                          :data-test="`promql-operation-param-${paramIndex}`"
                        />

                        <!-- String Parameter -->
                        <OInput
                          v-else-if="param.type === 'string'"
                          v-model="element.params[paramIndex] as string"
                          :label="param.name"
                          :placeholder="param.placeholder"
                          class="showLabelOnTop mb-2"
                          :data-test="`promql-operation-param-${paramIndex}`"
                        />

                        <!-- Multi-Select Parameter for labels -->
                        <OSelect
                          v-else-if="param.type === 'select'"
                          v-model="element.params[paramIndex] as string[]"
                          :options="availableLabels"
                          :label="param.name"
                          multiple
                          searchable
                          class="operation-label-selector showLabelOnTop no-case mb-2"
                          :data-test="`promql-operation-param-${paramIndex}`"
                        >
                          <template #empty>
                            <span>{{ availableLabels.length ? t('metrics.operationsList.noMatchingLabels') : t('metrics.operationsList.selectMetricFirst') }}</span>
                          </template>
                        </OSelect>
                      </template>
                    </div>
                  </div>
                </ODropdown>
                <OButton
                  variant="outline"
                  size="icon-chip"
                  @click="removeOperation(index)"
                  :data-test="`promql-operation-remove-${index}`"
                  icon-left="close"
                >
                </OButton>
              </OButtonGroup>
            </div>
          </template>
        </draggable>

        <!-- Add Button -->
        <OButton
          variant="ghost-primary"
          size="sm"
          @click="showOperationSelector = true"
          class="add-operation-btn"
          data-test="promql-add-operation"
        >
          <OIcon name="add" size="sm" />
          <OTooltip :content="t('metrics.operationsList.addOperation')" side="top" />
        </OButton>
      </div>
    </div>

    <!-- Operation Selector Dialog -->
    <ODialog data-test="operations-list-operation-selector-dialog" v-model:open="showOperationSelector" size="sm" :title="t('metrics.operationsList.addOperationTitle')"
      :primary-button-label="t('metrics.operationsList.close')"
      @click:primary="showOperationSelector = false"
    >
      <OSearchInput
        v-model="searchQuery"
        data-test="operations-list-search-input"
        clearable
      />

      <div style="max-height: 400px; overflow-y: auto">
        <div class="border border-border rounded-md divide-y divide-border">
          <div
            v-for="category in categories"
            :key="category"
            :data-test="`operations-list-category-${category}`"
          >
            <OCollapsible
              :default-open="true"
              :label="category"
            >
              <div>
                <div
                  v-for="op in getFilteredOperationsForCategory(category)"
                  :key="op.id"
                  :data-test="`promql-operation-option-${op.id}`"
                  :data-test-value="op.name"
                  class="promql-operation-option px-4 py-2 cursor-pointer hover:bg-primary-background text-sm"
                  @click="addOperation(op); showOperationSelector = false"
                >
                  <div class="font-medium">{{ op.name }}</div>
                  <div class="text-xs text-text-secondary mt-0.5">{{ op.documentation }}</div>
                </div>
              </div>
            </OCollapsible>
          </div>
        </div>
      </div>
    </ODialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { useI18n } from "vue-i18n";
import { VueDraggableNext as draggable } from "vue-draggable-next";
import {
  PromqlStep,
  PromqlStepSpec,
} from "@/components/promql/types";
import { promqlRenderer } from "@/components/promql/operations/queryModeller";

const props = defineProps<{
  operations: PromqlStep[];
  dashboardData?: any; // Dashboard data containing shared meta
}>();

const emit = defineEmits<{
  "update:operations": [value: PromqlStep[]];
}>();

const { t } = useI18n();
const showOperationSelector = ref(false);


// Access shared label options from meta
const availableLabels = computed(
  () => props.dashboardData?.meta?.promql?.availableLabels || [],
);

// Search query for filtering operations in the operation selector dialog
const searchQuery = ref("");

const categories = computed(() => promqlRenderer.getGroups());

const computedLabel = (operation: PromqlStep): string => {
  const opDef = getStepSpec(operation.id);
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

const getItemKey = (item: PromqlStep, index: number) => {
  return `${item.id}-${index}`;
};

const getStepSpec = (id: string): PromqlStepSpec | undefined => {
  return promqlRenderer.getStepSpec(id);
};

const getFilteredOperationsForCategory = (
  category: string,
): PromqlStepSpec[] => {
  const operations = promqlRenderer.getStepsForGroup(category);
  // Operations for this category
  if (!searchQuery.value) return operations;

  const needle = searchQuery.value.toLowerCase();
  return operations.filter(
    (op) =>
      op.name.toLowerCase().includes(needle) ||
      op.id.toLowerCase().includes(needle) ||
      op.documentation?.toLowerCase().includes(needle) ||
      op.group?.toLowerCase().includes(needle),
  );
};

const handleDragUpdate = (newVal: PromqlStep[]) => {
  // Create new array instead of mutating props
  const newOperations = [...newVal];
  emit("update:operations", newOperations);
};

const addOperation = (opDef: PromqlStepSpec) => {
  const newOp: PromqlStep = {
    id: opDef.id,
    params: [...opDef.defaultParams],
  };
  const newOperations = [...props.operations, newOp];
  emit("update:operations", newOperations);
  showOperationSelector.value = false;
  searchQuery.value = "";
};

const removeOperation = (index: number) => {
  const newOperations = props.operations.filter((_, idx) => idx !== index);
  emit("update:operations", newOperations);
};

defineExpose({
  availableLabels,
});
</script>

<style>
/* Deep override — must stay in CSS */
:deep(
  .operation-label-selector.q-field--labeled.showLabelOnTop.q-select
    .q-field__control-container
    .q-field__native
    > :first-child
) {
  text-transform: none;
  max-width: 75% !important;
}

/* drag-handle :active state — compound pseudo-class selector, keep in CSS */
.drag-handle:active {
  cursor: grabbing;
}
</style>
