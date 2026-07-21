<template>
  <div data-test="add-stream-fields-section">
    <div v-if="showHeader" data-test="alert-conditions-text" class="o-input-label text-compact font-medium leading-tight text-input-label-text">

      {{ t("logStream.fields") }}
    </div>
    <template v-if="!formRows.length">
      <OButton
        data-test="add-stream-add-field-btn"
        variant="outline"
        size="sm-action"
        icon-left="add"
        class="mt-2"
        @click="addRow"
      >
        {{ t("logStream.addField") }}
      </OButton>
    </template>
    <template v-else>
      <!-- 🔑 :key MUST be the array INDEX (`i`), never row.uuid. The row fields
           bind by index-based `name` (`${formFieldName}[${i}].name`) and
           OForm*/TanStack form.Field resolves its `name` at CREATION; it does NOT
           re-bind when the name later changes. A stable-id key makes Vue
           reuse+reorder rows on a mid-list delete, leaving each surviving field
           on its OLD index → inputs render shifted/blank while form data stays
           correct. Index keys keep each position's `name` fixed. -->
      <div
        v-for="(row, index) in formRows as any[]"
        :key="index"
        class="flex flex-wrap items-start gap-2 mt-2"
        :data-test="`add-stream-field-row-${index}`"
      >
        <div data-test="add-stream-field-name-input" class="flex-1 min-w-40">
          <OFormInput
            :data-test="`add-stream-field-name-input-${index}`"
            :name="`${formFieldName}[${index}].name`"
            :label="index === 0 ? t('logStream.fieldName') : undefined"
            :help-text="t('logStream.streamNameHelpText')"
            required
            tabindex="0"
          />
        </div>
        <div
          v-if="visibleInputs.index_type"
          data-test="add-stream-field-index-type-select"
          class="min-w-35"
        >
          <OFormSelect
            :name="`${formFieldName}[${index}].index_type`"
            :label="index === 0 ? t('logStream.indexType') : undefined"
            :options="getIndexTypeOptions(row)"
            multiple
            clearable
          />
        </div>
        <div
          v-if="visibleInputs.data_type"
          class="min-w-25"
        >
          <OFormSelect
            data-test="add-stream-field-data-type-select"
            :name="`${formFieldName}[${index}].type`"
            :label="index === 0 ? t('logStream.dataType') : undefined"
            :options="dataTypes"
            label-key="label"
            value-key="value"
            clearable
            required
          />
        </div>
        <!-- Button column mirrors an input column's `flex flex-col gap-1` so the
             +/delete buttons line up with the inputs. On the first row an
             invisible, label-height spacer pushes the buttons down past the
             header labels — no magic pixel offset (same typography as the real
             OInput/OSelect labels). -->
        <div class="flex flex-col gap-1 shrink-0">
          <span
            v-if="index === 0"
            aria-hidden="true"
            class="text-sm font-semibold leading-tight select-none invisible"
          >&nbsp;</span>
          <div class="flex items-center gap-1">
            <OButton
              data-test="add-stream-add-field-btn"
              v-if="index === formRows.length - 1"
              variant="outline"
              size="icon-sm"
              :disabled="!String(row.name || '').trim()"
              :title="t('logStream.addField')"
              icon-left="add"
              @click="addRow"
            />
            <OButton
              data-test="add-stream-delete-field-btn"
              variant="outline-destructive"
              size="icon-sm"
              :title="t('logStream.deleteField')"
              icon-left="delete"
              @click="removeRow(index)"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import { inject } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import {
  makeStreamFieldRow,
} from "./StreamFieldInputs.schema";

// FORM-ONLY. The rows are owned by the parent's TanStack form: this component
// `inject`s that form, reads the array reactively via form.useStore, renders
// indexed OForm* fields (`${formFieldName}[i].name`), and mutates rows with
// form.pushFieldValue / form.removeFieldValue. Per-row validation lives in the
// parent schema (see StreamFieldInputs.schema.ts). It MUST be rendered inside an
// <OForm> whose schema has an array field named `formFieldName`.
const props = defineProps({
  /** Dot-path of the array field on the parent form (e.g. "fields"). */
  formFieldName: {
    type: String,
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

const { t } = useI18n();

// The parent's form (provided by <OForm>). Rows are read reactively so add /
// delete re-render immediately (a form.state.values read inside a computed would
// not track).
const form = inject(FORM_CONTEXT_KEY, null) as any;
const formRows = form.useStore(
  (s: any) => (s.values?.[props.formFieldName] as any[]) ?? [],
);

const addRow = () => form.pushFieldValue(props.formFieldName, makeStreamFieldRow());
const removeRow = (index: number) =>
  form.removeFieldValue(props.formFieldName, index);

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
  { label: "Utf8", value: "Utf8" },
  { label: "Int64", value: "Int64" },
  { label: "Uint64", value: "Uint64" },
  { label: "Float64", value: "Float64" },
  { label: "Boolean", value: "Boolean" },
];

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

// Exposed for tests + any parent that still drives rows programmatically.
defineExpose({
  addRow,
  removeRow,
  getIndexTypeOptions,
  disableOptions,
  streamIndexType,
  dataTypes,
});
</script>
