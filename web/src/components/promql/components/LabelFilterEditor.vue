<template>
  <div class="label-filter-editor">
    <div class="text-subtitle2 q-mb-sm">
      <q-icon name="label" class="q-mr-xs" />
      Label Filters
      <q-btn
        flat
        dense
        round
        icon="add"
        size="sm"
        color="primary"
        @click="addLabel"
        class="q-ml-sm"
      >
        <q-tooltip>Add label filter</q-tooltip>
      </q-btn>
    </div>

    <div v-if="localLabels.length === 0" class="text-grey-7 q-pa-md text-center">
      No label filters added yet. Click + to add a filter.
    </div>

    <div v-else class="labels-list">
      <q-card
        v-for="(label, index) in localLabels"
        :key="index"
        flat
        bordered
        class="label-item q-mb-sm"
      >
        <q-card-section class="row items-center q-pa-sm">
          <!-- Label Name -->
          <div class="col-3">
            <q-input
              v-model="label.label"
              dense
              outlined
              placeholder="Label name"
              @update:model-value="onLabelChange"
            />
          </div>

          <!-- Operator -->
          <div class="col-2 q-px-sm">
            <q-select
              v-model="label.op"
              :options="operators"
              dense
              outlined
              @update:model-value="onLabelChange"
            />
          </div>

          <!-- Value -->
          <div class="col-6">
            <q-input
              v-model="label.value"
              dense
              outlined
              placeholder="Value"
              @update:model-value="onLabelChange"
            >
              <template v-slot:hint>
                {{ getOperatorHint(label.op) }}
              </template>
            </q-input>
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
              @click="removeLabel(index)"
            >
              <q-tooltip>Remove filter</q-tooltip>
            </q-btn>
          </div>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { QueryBuilderLabelFilter } from "@/components/promql/types";

const props = defineProps<{
  labels: QueryBuilderLabelFilter[];
  metric?: string;
}>();

const emit = defineEmits<{
  "update:labels": [value: QueryBuilderLabelFilter[]];
}>();

const localLabels = ref<QueryBuilderLabelFilter[]>([...props.labels]);

const operators = [
  { label: "= (equals)", value: "=" },
  { label: "!= (not equals)", value: "!=" },
  { label: "=~ (regex match)", value: "=~" },
  { label: "!~ (regex not match)", value: "!~" },
];

// Watch for prop changes
watch(
  () => props.labels,
  (newLabels) => {
    localLabels.value = [...newLabels];
  }
);

const addLabel = () => {
  localLabels.value.push({
    label: "",
    op: "=",
    value: "",
  });
  onLabelChange();
};

const removeLabel = (index: number) => {
  localLabels.value.splice(index, 1);
  onLabelChange();
};

const onLabelChange = () => {
  emit("update:labels", localLabels.value);
};

const getOperatorHint = (op: string): string => {
  switch (op) {
    case "=":
      return "Exact match";
    case "!=":
      return "Not equal to";
    case "=~":
      return "Regex pattern (e.g., prod.*)";
    case "!~":
      return "Regex not matching (e.g., test.*)";
    default:
      return "";
  }
};
</script>

<style scoped lang="scss">
.label-filter-editor {
  padding: 16px;
  background: #f5f5f5;
  border-radius: 4px;
}

.labels-list {
  max-height: 400px;
  overflow-y: auto;
}

.label-item {
  transition: all 0.2s;

  &:hover {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
}
</style>
