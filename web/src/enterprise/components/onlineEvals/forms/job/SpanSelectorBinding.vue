<template>
  <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
    <OSelect
      v-if="selectors.length"
      :model-value="binding || undefined"
      :options="selectorOptions"
      :placeholder="t('onlineEvals.job.spanSelector.select')"
      size="sm"
      clearable
      class="min-w-[11.875rem] flex-1"
      :data-test="`span-selector-binding-${scorerId}`"
      @update:model-value="selectBinding"
    />

    <OButton
      type="button"
      size="xs"
      variant="outline"
      :aria-label="t('onlineEvals.job.spanSelector.createForScorerTitle')"
      :title="t('onlineEvals.job.spanSelector.createForScorerTitle')"
      :data-test="`span-selector-create-${scorerId}`"
      @click="createSelector"
    >
      {{ t("onlineEvals.job.spanSelector.createForScorer") }}
    </OButton>
    <OButton
      v-if="boundSelector"
      type="button"
      size="xs"
      variant="ghost-primary"
      :data-test="`span-selector-edit-${scorerId}`"
      @click="editSelector(boundSelector)"
    >
      {{ t("common.edit") }}
    </OButton>
    <OTag v-if="!boundSelector" variant="warning-soft" size="xs">
      {{ t("onlineEvals.job.inputMapping.systemProvided.selectorRequired") }}
    </OTag>

    <ODrawer
      v-model:open="drawerOpen"
      :title="t('onlineEvals.job.spanSelector.editorTitle')"
      size="lg"
      :form-id="formId"
      :primary-button-label="t('common.save')"
      :secondary-button-label="t('common.cancel')"
      data-test="span-selector-drawer"
      @click:secondary="drawerOpen = false"
    >
      <!-- No p-4: ODrawer already applies the app-wide body inset. gap-5 is the
           mandated OForm field spacing (was gap-4, with gap-2 nested inside). -->
      <OForm :id="formId" :form="form" class="flex flex-col gap-5">
        <OFormInput
          name="name"
          :label="t('onlineEvals.job.spanSelector.name')"
          required
          size="sm"
          data-test="span-selector-name"
        />

        <component :is="form.Field" name="filterReady">
          <template #default="{ field }">
            <JobFilterBuilder
              target-scope="trace"
              purpose="selector"
              :group="filterGroup"
              :stream-fields="streamFields"
              @update:group="updateFilterGroup"
            />
            <OBanner
              v-if="field.state.meta.errors.length > 0"
              variant="error-soft"
              dense
              data-test="span-selector-filter-error"
            >
              {{ firstFieldError(field.state.meta.errors) }}
            </OBanner>
          </template>
        </component>

        <!-- Two mutually exclusive choices — a radio group rather than a
             dropdown that must be opened to reveal it holds only two options.
             Same pattern as AddEnrichmentTable.vue. -->
        <OFormOptionGroup
          name="fieldMode"
          :label="t('onlineEvals.job.spanSelector.schemaMode')"
          :options="fieldModeOptions"
          orientation="horizontal"
          required
          data-test="span-selector-field-mode"
        />

        <div v-if="formValues.fieldMode === 'default'" class="flex flex-col gap-1.5">
          <span class="text-input-help-text text-xs leading-none">
            {{ t("onlineEvals.job.spanSelector.defaultSchemaHelp") }}
          </span>
          <!-- These are the actual field names that reach the scorer, so they
               read as data rather than chrome: a colour variant instead of the
               default grey, and sm so the long gen_ai_* names stay legible. -->
          <div class="flex flex-wrap gap-1.5">
            <OTag
              v-for="field in DEFAULT_FIELDS"
              :key="field"
              variant="primary-soft"
              size="sm"
              :data-test="`span-selector-default-field-${field}`"
            >
              {{ field }}
            </OTag>
          </div>
        </div>

        <OFormSelect
          v-else
          name="fields"
          :label="t('onlineEvals.job.spanSelector.fields')"
          :options="streamFields"
          :help-text="t('onlineEvals.job.spanSelector.fieldsHelp')"
          multiple
          searchable
          required
          size="md"
          data-test="span-selector-fields"
        />

        <!-- Last: the cap is bounded by how many fields were chosen above, so
             it reads after that choice. The size rule itself lives in
             SpanSelectorBinding.schema.ts and is enforced on save — not
             recomputed here. -->
        <OFormInput
          name="maximumSpans"
          :label="t('onlineEvals.job.spanSelector.maximumSpans')"
          type="number"
          min="1"
          :help-text="t('onlineEvals.job.spanSelector.budget')"
          required
          size="sm"
          data-test="span-selector-maximum-spans"
        />
      </OForm>
    </ODrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormOptionGroup from "@/lib/forms/OptionGroup/OFormOptionGroup.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import type { SpanSelector } from "@/services/online-evals.service";
import {
  buildJobFilterConditionPayload,
  createEmptyJobFilterGroup,
  isJobFilterComplete,
  normalizeJobFilterCondition,
} from "../../utils/jobFilter";
import JobFilterBuilder from "./JobFilterBuilder.vue";
import { makeSpanSelectorSchema, type SpanSelectorForm } from "./SpanSelectorBinding.schema";

const DEFAULT_FIELDS = [
  "name",
  "status",
  "gen_ai_tool_name",
  "gen_ai_tool_call_id",
  "gen_ai_tool_call_arguments",
  "gen_ai_tool_call_result",
  "gen_ai_input_messages",
  "gen_ai_output_messages",
] as const;

const props = defineProps<{
  scorerId: string;
  selectors: SpanSelector[];
  binding?: string;
  streamFields: Array<{ label: string; value: string; type: string }>;
}>();

const emit = defineEmits<{
  (e: "update:selectors", value: SpanSelector[]): void;
  (e: "update:binding", value: string): void;
}>();

const { t } = useI18n();
type JobFilterGroup = ReturnType<typeof createEmptyJobFilterGroup>;
const drawerOpen = ref(false);
const filterGroup = ref(createEmptyJobFilterGroup());
const formId = computed(
  () => `span-selector-form-${props.scorerId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
);

const selectorOptions = computed(() =>
  props.selectors.map((selector) => ({
    label: selector.name,
    value: selector.id,
  })),
);
const fieldModeOptions = computed(() => [
  {
    label: t("onlineEvals.job.spanSelector.defaultSchema"),
    value: "default",
  },
  {
    label: t("onlineEvals.job.spanSelector.customSchema"),
    value: "custom",
  },
]);

const spanSelectorSchema = makeSpanSelectorSchema(t, {
  defaultFieldCount: DEFAULT_FIELDS.length,
  isDuplicateName: (name, id) =>
    props.selectors.some(
      (selector) =>
        selector.id !== id && selector.name.trim().toLowerCase() === name.trim().toLowerCase(),
    ),
});

const form = useOForm<SpanSelectorForm>({
  defaultValues: {
    id: "",
    name: "",
    fieldMode: "default",
    fields: [],
    maximumSpans: 5,
    filterReady: false,
  },
  schema: spanSelectorSchema,
  onSubmit: saveSelector,
});
const formValues = form.useStore((state: any) => state.values as SpanSelectorForm);

const boundSelector = computed(() =>
  props.selectors.find((selector) => selector.id === props.binding),
);

function generatedId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `span_selector_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function loadDraft(selector: SpanSelector) {
  filterGroup.value = normalizeJobFilterCondition(selector.filterCondition);
  form.reset({
    id: selector.id,
    name: selector.name,
    fieldMode: selector.fieldMode,
    fields: [...(selector.fields || [])],
    maximumSpans: selector.maximumSpans,
    filterReady: isJobFilterComplete(filterGroup.value),
  });
  drawerOpen.value = true;
}

function createSelector() {
  loadDraft({
    id: generatedId(),
    name: `span_selector_${props.selectors.length + 1}`,
    filterCondition: {},
    fieldMode: "default",
    fields: [],
    maximumSpans: 5,
  });
}

function editSelector(selector: SpanSelector) {
  loadDraft(selector);
}

function selectBinding(value: SelectModelValue) {
  emit("update:binding", typeof value === "string" ? value : "");
}

function updateFilterGroup(value: JobFilterGroup) {
  filterGroup.value = value;
  form.setFieldValue("filterReady", isJobFilterComplete(value));
}

function saveSelector(value: SpanSelectorForm) {
  const selector: SpanSelector = {
    id: value.id,
    name: value.name.trim(),
    filterCondition: buildJobFilterConditionPayload(filterGroup.value),
    fieldMode: value.fieldMode,
    fields: value.fieldMode === "custom" ? [...value.fields] : [],
    maximumSpans: Number(value.maximumSpans),
  };
  const existingIndex = props.selectors.findIndex((item) => item.id === selector.id);
  const selectors = [...props.selectors];
  if (existingIndex >= 0) selectors.splice(existingIndex, 1, selector);
  else selectors.push(selector);
  emit("update:selectors", selectors);
  emit("update:binding", selector.id);
  drawerOpen.value = false;
}
</script>
