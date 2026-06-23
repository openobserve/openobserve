<template>
  <div data-test="add-stream-fields-section">
    <div v-if="showHeader" data-test="alert-conditions-text" class="tw:text-[var(--o2-text-label)] tw:text-sm">
      {{ t("logStream.fields") }}
    </div>
    <template v-if="!fields.length">
      <OButton
        data-test="add-stream-add-field-btn"
        variant="outline"
        size="sm-action"
        icon-left="add"
        class="tw:mt-2"
        @click="addApiHeader"
      >
        {{ t("logStream.addField") }}
      </OButton>
    </template>
    <template v-else>
      <div
        v-for="(field, index) in fields as any"
        :key="field.uuid"
        class="tw:flex tw:flex-wrap tw:items-start tw:gap-2 tw:mt-2"
        :data-test="`add-stream-field-row-${index}`"
      >
        <div data-test="add-stream-field-name-input" class="tw:flex-1 tw:min-w-[160px]">
          <OInput
            :data-test="`add-stream-field-name-input-${index}`"
            v-model="field.name"
            :placeholder="t('logStream.fieldName') + ' *'"
            :error="!!fieldNameErrors[index]"
            :error-message="fieldNameErrors[index] || ''"
            :help-text="!fieldNameErrors[index] ? fieldNameHelpText : undefined"
            @update:model-value="validateFieldName(Number(index))"
            tabindex="0"
          />
        </div>
        <div
          v-if="visibleInputs.index_type"
          data-test="add-stream-field-index-type-select"
          class="tw:min-w-[140px]"
        >
          <OSelect
            v-model="field.index_type"
            :options="getIndexTypeOptions(field)"
            multiple
            clearable
            :placeholder="t('logStream.indexType')"
            @update:model-value="emits('input:update', 'conditions', field)"
          />
        </div>
        <div
          v-if="visibleInputs.data_type"
          class="tw:min-w-[100px]"
        >
          <OSelect
            data-test="add-stream-field-data-type-select"
            v-model="field.type"
            :options="dataTypes"
            label-key="label"
            value-key="value"
            clearable
            :placeholder="t('logStream.dataType') + ' *'"
            :error="!!fieldDataTypeErrors[index]"
            :error-message="fieldDataTypeErrors[index] || ''"
            @update:model-value="fieldDataTypeErrors[index] = ''; emits('input:update', 'conditions', field)"
          />
        </div>
        <div class="tw:flex tw:items-center tw:gap-1 tw:shrink-0">
          <OButton
            data-test="add-stream-add-field-btn"
            v-if="index === fields.length - 1"
            variant="outline"
            size="icon-sm"
            :disabled="!field.name.trim()"
            :title="t('logStream.addField')"
            icon-left="add"
            @click="addApiHeader"
          />
          <OButton
            data-test="add-stream-delete-field-btn"
            variant="outline-destructive"
            size="icon-sm"
            :title="t('logStream.deleteField')"
            icon-left="delete"
            @click="deleteApiHeader(field, index)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

const props = defineProps({
  fields: {
    type: Array,
    default: () => [],
    required: true,
  },
  showHeader: {
    type: Boolean,
    default: true,
  },
  isInSchema: {
    type: Boolean,
    default: false,
  },
  visibleInputs: {
    type: Object,
    default: () => ({
      name: true,
      data_type: true,
      index_type: true,
    }),
  },
});

const emits = defineEmits(["add", "remove", "input:update"]);

const streamIndexType = [
  { label: "Full text search", value: "fullTextSearchKey" },
  { label: "Secondary index", value: "secondaryIndexKey" },
  { label: "Bloom filter", value: "bloomFilterKey" },
  { label: "KeyValue partition", value: "keyPartition" },
  { label: "Prefix partition", value: "prefixPartition" },
  { label: "Hash partition (8 Buckets)", value: "hashPartition_8" },
  { label: "Hash partition (16 Buckets)", value: "hashPartition_16" },
  { label: "Hash partition (32 Buckets)", value: "hashPartition_32" },
  { label: "Hash partition (64 Buckets)", value: "hashPartition_64" },
  { label: "Hash partition (128 Buckets)", value: "hashPartition_128" },
];

const dataTypes = [
  {
    label: "Utf8",
    value: "Utf8",
  },
  {
    label: "Int64",
    value: "Int64",
  },
  {
    label: "Uint64",
    value: "Uint64",
  },
  {
    label: "Float64",
    value: "Float64",
  },
  {
    label: "Boolean",
    value: "Boolean",
  },
];

const store = useStore();

const { t } = useI18n();
const fieldNameErrors = ref<string[]>([]);
const fieldDataTypeErrors = ref<string[]>([]);

// Allowed characters mirror the backend `format_stream_name` regex
// (src/config/src/utils/schema.rs): alphanumeric, underscore and colon only.
const fieldNameRegex = /^[a-zA-Z0-9_:]+$/;
const fieldNameHelpText = "Use alphanumeric characters, underscore and colon only.";

const validateFieldName = (index: number) => {
  const field = (props.fields as any[])[index];
  if (field?.name && !fieldNameRegex.test(field.name)) {
    fieldNameErrors.value[index] = fieldNameHelpText;
  } else {
    fieldNameErrors.value[index] = "";
  }
};

const isFocused = ref(false);
//repetitive need to refactor
const isDataTypeFocused = ref(false);

const deleteApiHeader = (field: any, index: number) => {
  emits("remove", field, index);
  emits("input:update", "conditions", field);
};

const addApiHeader = () => {
  emits("add");
};

const getIndexTypeOptions = (field: any) => {
  return streamIndexType.map((option) => ({
    ...option,
    disabled: disableOptions(field, option),
  }));
};

const disableOptions = (schema: any, option: any) => {
  let selectedHashPartition = "";

  let selectedIndices = "";

  for (let i = 0; i < (schema?.index_type || []).length; i++) {
    if (schema.index_type[i].includes("hashPartition")) {
      selectedHashPartition = schema.index_type[i];
    }
    selectedIndices += schema.index_type[i];
  }
  if (
    selectedIndices.includes("prefixPartition") &&
    option.value.includes("keyPartition")
  ) {
    return true;
  }
  if (
    selectedIndices.includes("keyPartition") &&
    option.value.includes("prefixPartition")
  ) {
    return true;
  }
  if (
    selectedIndices.includes("hashPartition") &&
    selectedHashPartition !== option.value &&
    (option.value.includes("hashPartition") ||
      option.value.includes("keyPartition") ||
      option.value.includes("prefixPartition"))
  )
    return true;
  if (
    (selectedIndices.includes("keyPartition") ||
      selectedIndices.includes("prefixPartition")) &&
    option.value.includes("hashPartition")
  )
    return true;

  return false;
};

const handleFocus = () => {
  isFocused.value = true;
};

const handleBlur = () => {
  isFocused.value = false;
};
const handleDataTypeFocus = () => {
  isDataTypeFocused.value = true;
};

const handleDataTypeBlur = () => {
  isDataTypeFocused.value = false;
};

const validate = () => {
  const fields = props.fields as any[];
  fields.forEach((field, index) => {
    if (!field.name.trim()) {
      fieldNameErrors.value[index] = t("logStream.fieldRequired");
    } else if (!fieldNameRegex.test(field.name)) {
      fieldNameErrors.value[index] = fieldNameHelpText;
    }
    if (props.visibleInputs.data_type && !field.type) {
      fieldDataTypeErrors.value[index] = t("logStream.dataTypeRequired");
    }
  });
  return fields.every(
    (field) =>
      field.name.trim() &&
      fieldNameRegex.test(field.name) &&
      (!props.visibleInputs.data_type || field.type),
  );
};

// Expose methods and data for testing
defineExpose({
  validate,
  validateFieldName,
  deleteApiHeader,
  addApiHeader,
  disableOptions,
  handleFocus,
  handleBlur,
  handleDataTypeFocus,
  handleDataTypeBlur,
  streamIndexType,
  dataTypes,
  isFocused,
  isDataTypeFocused,
  store,
  t,
});
</script>



