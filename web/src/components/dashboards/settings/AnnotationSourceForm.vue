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

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import { getUUID } from "@/utils/zincutils";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm, type FormFieldPath } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import ColorSwatchPicker from "@/components/dashboards/ColorSwatchPicker.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormTemplateInput from "@/lib/forms/TemplateInput/OFormTemplateInput.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import { streamValuesLoader } from "@/components/filterBar/streamValues";
import type { FilterField } from "@/utils/query/filterBar";
import DashboardHeader from "./common/DashboardHeader.vue";
import AnnotationSourcePreview from "./AnnotationSourcePreview.vue";
import useStreams from "@/composables/useStreams";
import {
  ANNOTATION_PREVIEW_CONTEXT_KEY,
  runAnnotationSourceQuery,
} from "@/composables/dashboard/useDashboardAnnotationSources";
import {
  ANNOTATION_PREVIEW_ROW_LIMIT,
  annotationFiltersHaveBlankCondition,
  annotationPreviewHasProblems,
  buildAnnotationBuilderSql,
  sqlFromStream,
  sqlSelectAliases,
  summarizeAnnotationPreview,
  type AnnotationPreviewSummary,
} from "@/utils/dashboard/annotationSources";
import { TEXT_SWATCHES } from "@/composables/dashboard/useColumnFormatting";
import type { AnnotationConditionGroup, AnnotationSource } from "@/ts/interfaces/dashboard";
import {
  annotationSourceDefaults,
  annotationSourceToFormValues,
  emptyAnnotationFilterGroup,
  formValuesToAnnotationSource,
  makeAnnotationSourceSchema,
  type AnnotationPanelOption,
  type AnnotationSourceFormValues,
} from "./AnnotationSourceForm.schema";

const props = withDefaults(
  defineProps<{
    /** The source being edited; absent when adding. */
    source?: AnnotationSource | null;
    /** Index used to pick the next free colour for a new source. */
    colorIndex?: number;
    panelOptions?: AnnotationPanelOption[];
    /** Global dashboard variable names offered as `$name` filter values. */
    variableNames?: string[];
    /** Names of the dashboard's other sources, to block saving a duplicate. */
    siblingNames?: string[];
    dashboardId?: string;
    /** Persists the source; declared as a prop so the form's submit state spans the save. */
    onSave?: (_source: AnnotationSource) => Promise<void> | void;
  }>(),
  {
    source: null,
    colorIndex: 0,
    panelOptions: () => [],
    variableNames: () => [],
    siblingNames: () => [],
    dashboardId: "",
    onSave: undefined,
  },
);

const emit = defineEmits<{
  (_e: "cancel"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { getStreams, getStream } = useStreams(t);
const previewContext = inject(ANNOTATION_PREVIEW_CONTEXT_KEY, null);

const STREAM_TYPES = ["logs", "metrics", "traces", "enrichment_tables", "metadata"];
const PREVIEW_FALLBACK_WINDOW_US = 60 * 60 * 1_000_000;

const form = useOForm<AnnotationSourceFormValues>({
  defaultValues: props.source
    ? annotationSourceToFormValues(props.source)
    : annotationSourceDefaults(props.colorIndex),
  schema: makeAnnotationSourceSchema(t, props.siblingNames),
  onSubmit: async (value) => {
    // Save runs the same check as Run; a problem blocks the save outright, shown inline.
    if ((await checkSource()) === "problems") return;
    const id = props.source?.id ?? `source_${getUUID()}`;
    await props.onSave?.(formValuesToAnnotationSource(id, value));
  },
});

type FieldPath = FormFieldPath<AnnotationSourceFormValues>;
const setField = (name: string, value: unknown) =>
  form.setFieldValue(name as FieldPath, value as never);

const values = form.useStore((state) => state.values as AnnotationSourceFormValues);
const isSubmitting = form.useStore((state) => state.isSubmitting);
const queryErrors = form.useStore((state) => state.fieldMeta?.query?.errors ?? []);

const mode = computed(() => values.value.mode);
const confirmDiscardSql = ref(false);

const streams = ref<string[]>([]);
// `null` means the schema hasn't loaded yet or the fetch failed; distinct from a genuinely empty schema.
const schemaFields = ref<string[] | null>(null);
const streamLoadError = ref("");
const previewColumns = ref<string[]>([]);
const checkResult = ref<"ok" | "problems" | null>(null);
const previewSection = ref<HTMLElement | null>(null);
const hasBlockingError = computed(() => checkResult.value === "problems");

// Custom SQL offers the schema of the stream it reads, so fields are pickable before a Run.
const fieldsStream = computed(() =>
  mode.value === "sql" ? sqlFromStream(values.value.query) : values.value.stream,
);

const streamTypeOptions = STREAM_TYPES.map((type) => ({ label: raw(type), value: type }));
// Same list, labelled to read as a variable once mixed into a picker of real stream/field names.
const variablePickerItems = computed(() =>
  props.variableNames.map((name) => ({
    label: t("dashboard.addSettingVariable.variableSuffix", { name: raw(`$${name}`) }),
    value: `$${name}`,
  })),
);
const streamOptions = computed(() => [
  ...variablePickerItems.value,
  ...streams.value.map((name) => ({ label: raw(name), value: name })),
]);

// Offers `$variable` as a value suggestion, same as the old filter rows did.
const variableValues = () => props.variableNames.map((name) => `$${name}`);

const fieldNames = computed(() => [
  ...new Set(
    [
      ...(schemaFields.value ?? []),
      ...(mode.value === "sql" ? sqlSelectAliases(values.value.query) : []),
      ...previewColumns.value,
    ].filter(Boolean),
  ),
]);
const fieldOptions = computed(() => [
  ...variablePickerItems.value,
  ...fieldNames.value.map((name) => ({ label: raw(name), value: name })),
]);
const fieldSuggestions = computed(() => fieldNames.value.map((name) => ({ name })));
const filterFields = computed<FilterField[]>(() =>
  fieldOptions.value.map((option) => ({
    name: option.value,
    label: String(option.label),
    type: "string",
  })),
);

const loadStreams = async (streamType: string) => {
  streamLoadError.value = "";
  if (!streamType) {
    streams.value = [];
    return;
  }
  try {
    const result = (await getStreams(streamType, false)) as { list?: Array<{ name: string }> };
    // The shared stream store can briefly hold a stream twice; list each name once.
    streams.value = [...new Set((result?.list ?? []).map((stream) => stream.name))];
  } catch (error) {
    streams.value = [];
    streamLoadError.value = t("dashboard.annotationSources.streamsLoadFailed");
    console.error("Error loading streams for annotation source", error);
  }
};

// A `$variable` stream resolves to its current value, so the schema lookup checks the right stream.
const resolveVariableValue = (value: string): string => {
  if (!value.startsWith("$")) return value;
  const match = previewContext?.variables().find((variable) => variable.name === value.slice(1));
  const resolved = Array.isArray(match?.value) ? match.value[0] : match?.value;
  return typeof resolved === "string" ? resolved : "";
};

const filterValueLoader = computed(() =>
  streamValuesLoader({
    org: store.state.selectedOrganization?.identifier,
    streamType: values.value.streamType,
    streamName: resolveVariableValue(values.value.stream),
  }),
);

const loadFields = async (stream: string, streamType: string) => {
  const resolvedStream = resolveVariableValue(stream);
  if (!resolvedStream || !streamType) {
    schemaFields.value = null;
    return;
  }
  try {
    const result = (await getStream(resolvedStream, streamType, true)) as {
      schema?: Array<{ name: string }>;
    };
    schemaFields.value = (result?.schema ?? []).map((field) => field.name);
    streamLoadError.value = "";
  } catch (error) {
    schemaFields.value = null;
    streamLoadError.value = t("dashboard.annotationSources.schemaLoadFailed");
    console.error("Error loading the stream schema for annotation source", error);
  }
};

const onStreamTypeChange = async (streamType: string) => {
  setField("stream", "");
  schemaFields.value = null;
  await loadStreams(streamType);
};

watch(
  () => [fieldsStream.value, values.value.streamType] as const,
  ([stream, streamType]) => loadFields(stream, streamType),
);

// A filter built against the old stream's columns is meaningless (and may silently match the wrong field) on a new one.
watch(
  () => values.value.stream,
  () => setField("filters", emptyAnnotationFilterGroup()),
);

// Any edit invalidates the last check, so Save re-validates instead of trusting stale state.
watch(
  () => JSON.stringify(values.value),
  () => {
    checkResult.value = null;
  },
);

// A source whose loaded panels were already empty (every one later deleted) explains
// why, until the user fixes it by picking panels or Select all.
const panelsHelp = computed(() =>
  props.source?.panels?.length === 0 && values.value.panels.length === 0
    ? t("dashboard.annotationSources.panelsDeletedHint")
    : undefined,
);

const allPanelValues = computed(() =>
  props.panelOptions.filter((option) => !option.header).map((option) => option.value),
);

// "Select all" has no stored list of its own, so OSelect only knows a panel is
// selected if its id is actually in the model value — feed it every current id
// so the Select All row and each checkbox read as checked.
const panelsDisplayValue = computed(() =>
  values.value.panelsAll ? allPanelValues.value : values.value.panels,
);

// Mirrors every current panel id (Select All, or manually checking all of them) into
// the `panelsAll` flag instead of storing them, so future panels are included too.
// Anything short of that — including the native "deselect all" branch, which emits
// `[]` — is saved as the explicit list it is, and an empty one blocks Save.
const onPanelsUpdate = (value: unknown) => {
  const next = Array.isArray(value) ? (value as string[]) : [];
  const isEveryPanel =
    allPanelValues.value.length > 0 &&
    next.length === allPanelValues.value.length &&
    allPanelValues.value.every((panelValue) => next.includes(panelValue));
  setField("panelsAll", isEveryPanel);
  setField("panels", isEveryPanel ? [] : next);
};

// OSelect's clear emits `undefined` for a single-select; the save path trims unconditionally.
const onEndTimeFieldUpdate = (value: unknown) => {
  setField("endTimeField", typeof value === "string" ? value : "");
};

onMounted(async () => {
  await loadStreams(values.value.streamType);
  await loadFields(fieldsStream.value, values.value.streamType);
});

const updateFilters = (next: unknown) => setField("filters", next ?? emptyAnnotationFilterGroup());

const filtersGroup = computed(() => values.value.filters as AnnotationConditionGroup);
const hasBlankFilters = computed(() => annotationFiltersHaveBlankCondition(filtersGroup.value));

const builderSql = () =>
  buildAnnotationBuilderSql({ ...values.value, filters: filtersGroup.value }, schemaFields.value);

const onModeChange = (next: unknown) => {
  if ((next !== "builder" && next !== "sql") || next === mode.value) return;
  if (next === "sql") {
    // No stream means no valid FROM target, so pre-filling would hand the editor broken SQL.
    if (values.value.stream.trim()) setField("query", builderSql());
    setField("mode", "sql");
    confirmDiscardSql.value = false;
    return;
  }
  const query = values.value.query.trim();
  if (!query || query === builderSql()) {
    setField("mode", "builder");
    return;
  }
  confirmDiscardSql.value = true;
};

const discardSql = () => {
  confirmDiscardSql.value = false;
  setField("mode", "builder");
};

const isPreviewing = ref(false);
const previewError = ref("");
const preview = ref<AnnotationPreviewSummary | null>(null);

const previewWindow = () => {
  const range = previewContext?.timeRange();
  const start = range?.start_time?.getTime?.();
  const end = range?.end_time?.getTime?.();
  if (Number.isFinite(start) && Number.isFinite(end)) {
    return { start: start as number, end: end as number };
  }
  const now = Date.now() * 1000;
  return { start: now - PREVIEW_FALLBACK_WINDOW_US, end: now };
};

const showPreview = () => previewSection.value?.scrollIntoView?.({ block: "nearest" });

const VARIABLES_WAIT_ATTEMPTS = 20;
const VARIABLES_WAIT_INTERVAL_MS = 250;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the check and reports the outcome, without touching the Save-blocking state itself. */
const runCheck = async (): Promise<"ok" | "problems"> => {
  const value = values.value;
  previewError.value = "";
  preview.value = null;
  if (value.mode === "builder" && !value.stream) {
    previewError.value = t("dashboard.annotationSources.streamRequired");
    return "problems";
  }
  if (value.mode === "sql" && !value.query.trim()) {
    previewError.value = t("dashboard.annotationSources.queryRequired");
    return "problems";
  }
  if (!value.panelsAll && value.panels.length === 0) {
    previewError.value = t("dashboard.annotationSources.panelsRequired");
    return "problems";
  }
  const source = formValuesToAnnotationSource(props.source?.id ?? "preview", {
    ...value,
    enabled: true,
  });
  const window = previewWindow();
  isPreviewing.value = true;
  try {
    // A referenced variable still loading is retried rather than skipped, so Save never trusts a half-run check.
    let variables = previewContext?.variables() ?? [];
    const runQuery = () =>
      runAnnotationSourceQuery({
        source,
        startTime: window.start,
        endTime: window.end,
        variables,
        store,
        size: ANNOTATION_PREVIEW_ROW_LIMIT,
        schemaFields: schemaFields.value,
        dashboardId: props.dashboardId,
      });
    let result = await runQuery();
    for (let attempt = 0; result === null && attempt < VARIABLES_WAIT_ATTEMPTS; attempt++) {
      await wait(VARIABLES_WAIT_INTERVAL_MS);
      variables = previewContext?.variables() ?? [];
      result = await runQuery();
    }
    if (result === null) {
      previewError.value = t("dashboard.annotationSources.variablesLoading");
      return "problems";
    }
    previewColumns.value = [...new Set(result.rows.flatMap((row) => Object.keys(row)))];
    const summary = summarizeAnnotationPreview(
      source,
      result.rows,
      variables,
      schemaFields.value ?? [],
      result.columns,
    );
    preview.value = summary;
    return annotationPreviewHasProblems(summary) ? "problems" : "ok";
  } catch (error) {
    const data = (error as { response?: { data?: { message?: string; error?: string } } })?.response
      ?.data;
    previewError.value = data?.message || data?.error || (error as Error)?.message || "";
    return "problems";
  } finally {
    isPreviewing.value = false;
    await nextTick();
    showPreview();
  }
};

/** Runs the source like Run does; Save calls this itself so a stale check never lets a bad source through. */
const checkSource = async (): Promise<"ok" | "problems"> => {
  const result = await runCheck();
  checkResult.value = result;
  return result;
};

const runPreview = async () => {
  await checkSource();
};

const title = computed(() =>
  props.source
    ? t("dashboard.annotationSources.editTitle")
    : t("dashboard.annotationSources.addTitle"),
);
</script>

<template>
  <div class="flex h-full flex-col" data-test="dashboard-annotation-source-form">
    <DashboardHeader :title="title" back-button @back="emit('cancel')" />
    <OForm :form="form" class="flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-3 py-3">
        <div class="flex items-start gap-4 max-md:flex-col max-md:items-stretch">
          <OFormInput
            name="name"
            :label="t('dashboard.annotationSources.name')"
            :placeholder="t('dashboard.annotationSources.namePlaceholder')"
            required
            class="min-w-0 flex-1"
            data-test="dashboard-annotation-source-name"
          />
          <OFormSwitch
            name="enabled"
            :label="t('dashboard.annotationSources.enabled')"
            class="pt-6 max-md:pt-0"
            data-test="dashboard-annotation-source-enabled"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
            {{ t("dashboard.annotationSources.color") }}
          </span>
          <component :is="form.Field" name="color">
            <template #default="{ field }">
              <ColorSwatchPicker
                :model-value="field.state.value"
                :swatches="TEXT_SWATCHES"
                :allow-none="false"
                data-test="dashboard-annotation-source-color"
                @update:model-value="field.handleChange"
              />
            </template>
          </component>
        </div>

        <OFormSection
          :title="
            mode === 'sql'
              ? t('dashboard.annotationSources.querySection')
              : t('dashboard.annotationSources.sourceSection')
          "
          data-test="dashboard-annotation-source-query-section"
        >
          <template #actions>
            <OToggleGroup
              :model-value="mode"
              data-test="dashboard-annotation-source-mode"
              @update:model-value="onModeChange"
            >
              <OToggleGroupItem
                value="builder"
                size="sm"
                data-test="dashboard-annotation-source-mode-builder"
                >{{ t("dashboard.annotationSources.builder") }}</OToggleGroupItem
              >
              <OToggleGroupItem
                value="sql"
                size="sm"
                data-test="dashboard-annotation-source-mode-sql"
                >{{ t("dashboard.annotationSources.customSql") }}</OToggleGroupItem
              >
            </OToggleGroup>
          </template>

          <div class="flex flex-col gap-4 py-2">
            <OBanner
              v-if="confirmDiscardSql"
              variant="warning"
              dense
              inline-actions
              :content="t('dashboard.annotationSources.discardSqlConfirm')"
              data-test="dashboard-annotation-source-discard-sql"
            >
              <template #actions>
                <OButton
                  variant="outline"
                  size="sm"
                  data-test="dashboard-annotation-source-discard-sql-cancel"
                  @click="confirmDiscardSql = false"
                  >{{ t("dashboard.cancel") }}</OButton
                >
                <OButton
                  variant="destructive"
                  size="sm"
                  data-test="dashboard-annotation-source-discard-sql-confirm"
                  @click="discardSql"
                  >{{ t("dashboard.annotationSources.discard") }}</OButton
                >
              </template>
            </OBanner>

            <template v-if="mode === 'builder'">
              <OBanner
                v-if="streamLoadError"
                variant="error-soft"
                dense
                :content="raw(streamLoadError)"
                data-test="dashboard-annotation-source-stream-load-error"
              />
              <div class="flex items-start gap-4 max-md:flex-col max-md:gap-2">
                <OFormSelect
                  name="streamType"
                  :label="t('dashboard.selectStreamType')"
                  :options="streamTypeOptions"
                  required
                  class="min-w-0 flex-1"
                  data-test="dashboard-annotation-source-stream-type"
                  @update:model-value="onStreamTypeChange(String($event ?? ''))"
                />
                <OFormSelect
                  name="stream"
                  :label="t('dashboard.selectIndex')"
                  :options="streamOptions"
                  searchable
                  required
                  class="min-w-0 flex-1"
                  data-test="dashboard-annotation-source-stream"
                />
              </div>

              <div class="flex flex-col gap-2">
                <span class="text-compact text-input-label-text leading-tight font-medium">{{
                  t("dashboard.addSettingVariable.filters")
                }}</span>
                <FilterBuilder
                  profile="annotation"
                  :model-value="filtersGroup"
                  :fields="filterFields"
                  :load-values="filterValueLoader"
                  :extra-value-suggestions="variableValues"
                  data-test="dashboard-annotation-source-filters"
                  @update:model-value="updateFilters"
                />
                <p
                  v-if="hasBlankFilters"
                  class="text-text-secondary text-xs"
                  data-test="dashboard-annotation-source-filters-blank-hint"
                >
                  {{ t("dashboard.annotationSources.blankFiltersHint") }}
                </p>
              </div>
            </template>

            <div v-else class="flex flex-col gap-1">
              <div
                class="border-border-default rounded-default overflow-hidden border"
                data-test="dashboard-annotation-source-sql"
              >
                <QueryEditor
                  :query="values.query"
                  :languages="['sql']"
                  editor-height="8rem"
                  hide-nl-toggle
                  data-test-prefix="dashboard-annotation-source-sql-editor"
                  @update:query="setField('query', $event)"
                  @run-query="runPreview"
                />
              </div>
              <p
                v-if="queryErrors.length"
                class="text-status-error-text text-xs"
                data-test="dashboard-annotation-source-sql-error"
              >
                {{ raw(firstFieldError(queryErrors)) }}
              </p>
              <p v-else class="text-text-secondary text-xs">
                {{ t("dashboard.annotationSources.sqlHelp", { example: raw("{column}") }) }}
              </p>
            </div>
          </div>
        </OFormSection>

        <OFormSection
          :title="t('dashboard.annotationSources.markersSection')"
          data-test="dashboard-annotation-source-markers-section"
        >
          <div class="flex flex-col gap-4 py-2">
            <OFormTemplateInput
              name="title"
              :label="t('dashboard.annotationSources.markerTitle')"
              :placeholder="raw('{service} {version}')"
              :suggestions="fieldSuggestions"
              delimiter="single"
              required
              data-test="dashboard-annotation-source-title"
            >
              <template #tooltip>
                <OTooltip
                  :content="t('dashboard.annotationSources.templateHelp', { brace: raw('{') })"
                  max-width="15.625rem"
                />
              </template>
            </OFormTemplateInput>
            <OFormTemplateInput
              name="description"
              :label="t('dashboard.annotationSources.markerDescriptionFieldLabel')"
              :placeholder="raw('{message}')"
              :suggestions="fieldSuggestions"
              delimiter="single"
              data-test="dashboard-annotation-source-description"
            >
              <template #tooltip>
                <OTooltip
                  :content="t('dashboard.annotationSources.templateHelp', { brace: raw('{') })"
                  max-width="15.625rem"
                />
              </template>
            </OFormTemplateInput>
            <component :is="form.Field" name="endTimeField">
              <template #default="{ field }">
                <OSelect
                  :model-value="field.state.value"
                  :label="t('dashboard.annotationSources.endTimeField')"
                  :placeholder="t('dashboard.annotationSources.endTimeFieldNone')"
                  :options="fieldOptions"
                  :error="field.state.meta.errors.length > 0"
                  :error-message="
                    field.state.meta.errors.length > 0
                      ? raw(firstFieldError(field.state.meta.errors))
                      : undefined
                  "
                  searchable
                  :creatable="!fieldNames.length"
                  clearable
                  data-test="dashboard-annotation-source-end-time-field"
                  @update:model-value="onEndTimeFieldUpdate"
                  @blur="field.handleBlur"
                >
                  <template #tooltip>
                    <OTooltip
                      :content="t('dashboard.annotationSources.endTimeFieldHelp')"
                      max-width="15.625rem"
                    />
                  </template>
                </OSelect>
              </template>
            </component>
            <component :is="form.Field" name="panels">
              <template #default="{ field }">
                <OSelect
                  :model-value="panelsDisplayValue"
                  :label="t('dashboard.annotationSources.panelsFieldLabel')"
                  :placeholder="t('dashboard.annotationSources.selectPanelsPlaceholder')"
                  :all-selected-label="t('dashboard.annotationSources.allTimeSeriesPanels')"
                  :options="panelOptions"
                  :help-text="panelsHelp"
                  :error="field.state.meta.errors.length > 0"
                  :error-message="
                    field.state.meta.errors.length > 0
                      ? raw(firstFieldError(field.state.meta.errors))
                      : undefined
                  "
                  multiple
                  searchable
                  clearable
                  select-all
                  data-test="dashboard-annotation-source-panels"
                  @update:model-value="onPanelsUpdate"
                  @blur="field.handleBlur"
                >
                  <template #tooltip>
                    <OTooltip
                      :content="t('dashboard.annotationSources.panelsTooltip')"
                      max-width="15.625rem"
                    />
                  </template>
                </OSelect>
              </template>
            </component>
          </div>
        </OFormSection>

        <div ref="previewSection">
          <OFormSection
            :title="t('dashboard.annotationSources.previewSection')"
            data-test="dashboard-annotation-source-preview-section"
          >
            <template #actions>
              <OButton
                variant="outline"
                size="sm"
                icon-left="play-arrow"
                :loading="isPreviewing"
                data-test="dashboard-annotation-source-run"
                @click="runPreview"
                >{{ t("dashboard.annotationSources.run") }}</OButton
              >
            </template>
            <AnnotationSourcePreview
              :summary="preview"
              :error="previewError"
              :end-time-field="values.endTimeField"
              :timezone="store.state.timezone"
            />
          </OFormSection>
        </div>
      </div>

      <div
        class="border-border-default bg-dialog-bg shadow-sticky-footer sticky bottom-0 z-10 flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2.5"
      >
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="isSubmitting"
          data-test="dashboard-annotation-source-cancel"
          @click="emit('cancel')"
          >{{ t("dashboard.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          type="submit"
          :disabled="hasBlockingError"
          :loading="isSubmitting"
          data-test="dashboard-annotation-source-save"
          >{{ t("dashboard.save") }}</OButton
        >
      </div>
    </OForm>
  </div>
</template>
