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

<template>
  <div class="flex flex-col gap-4" data-test="dashboard-variable-query-editor">
    <div class="flex items-start gap-x-4 max-md:flex-col max-md:gap-y-2">
      <OFormToggleGroup
        name="query_data.query_type"
        :label="t('dashboard.queryVariable.language')"
        data-test="dashboard-variable-query-language"
        @update:model-value="onLanguageChange"
      >
        <OToggleGroupItem value="sql" size="sm" data-test="dashboard-variable-query-language-sql">{{
          raw("SQL")
        }}</OToggleGroupItem>
        <OToggleGroupItem
          value="promql"
          size="sm"
          data-test="dashboard-variable-query-language-promql"
          >{{ raw("PromQL") }}</OToggleGroupItem
        >
      </OFormToggleGroup>
      <OFormSelect
        v-if="language === 'sql'"
        name="query_data.stream_type"
        :label="t('dashboard.selectStreamType')"
        :options="streamTypeOptions"
        :searchable="false"
        class="flex-1"
        data-test="dashboard-variable-query-stream-type"
      />
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-2">
        <OText variant="label">{{ t("dashboard.queryVariable.query") }}</OText>
        <OPopover
          v-if="language === 'promql'"
          v-model:open="functionsOpen"
          side="bottom"
          align="end"
          :aria-label="t('dashboard.queryVariable.aboutFunctions')"
        >
          <template #trigger>
            <OButton
              variant="ghost"
              size="xs"
              icon-left="info-outline"
              data-test="dashboard-variable-query-functions-trigger"
            >
              <span class="max-md:sr-only">{{ t("dashboard.queryVariable.aboutFunctions") }}</span>
            </OButton>
          </template>
          <div
            class="flex w-120 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-3"
            data-test="dashboard-variable-query-functions"
          >
            <OText variant="body-strong">{{ t("dashboard.queryVariable.functionsTitle") }}</OText>
            <div
              v-for="fn in promFunctions"
              :key="fn.signature"
              class="flex items-center gap-2"
              :data-test="`dashboard-variable-query-function-${fn.id}`"
            >
              <div class="flex min-w-0 flex-1 flex-col">
                <OText variant="mono">{{ raw(fn.signature) }}</OText>
                <OText variant="meta">{{ fn.description }}</OText>
              </div>
              <OButton
                variant="ghost-primary"
                size="xs"
                :data-test="`dashboard-variable-query-function-insert-${fn.id}`"
                @click="insertExample(fn.example)"
                >{{ t("dashboard.queryVariable.insertExample") }}</OButton
              >
            </div>
            <OText variant="meta">{{ t("dashboard.queryVariable.variableReferenceHelp") }}</OText>
          </div>
        </OPopover>
      </div>
      <component :is="form.Field" name="query_data.query">
        <template #default="{ field }">
          <div
            class="rounded-default overflow-hidden border"
            :class="
              field.state.meta.errors.length ? 'border-input-border-error' : 'border-border-default'
            "
          >
            <UnifiedQueryEditor
              :key="`${language}-${editorKey}`"
              :languages="[language]"
              :default-language="language"
              :query="field.state.value ?? ''"
              :nlp-mode="false"
              hide-nl-toggle
              :debounce-time="300"
              editor-height="8rem"
              data-test-prefix="dashboard-variable-query"
              data-test="dashboard-variable-query-input"
              @update:query="onQueryUpdate(field, $event)"
              @run-query="runPreview"
            />
          </div>
          <div
            v-if="field.state.meta.errors.length"
            class="text-input-error-text text-xs"
            data-test="dashboard-variable-query-error"
          >
            {{ firstFieldError(field.state.meta.errors) }}
          </div>
        </template>
      </component>
      <OText variant="meta">{{
        language === "sql"
          ? t("dashboard.queryVariable.sqlHelp")
          : t("dashboard.queryVariable.promqlHelp")
      }}</OText>
    </div>

    <div class="flex flex-col gap-2" data-test="dashboard-variable-query-preview">
      <div class="flex flex-wrap items-center gap-2">
        <OButton
          variant="outline"
          size="sm"
          icon-left="play-arrow"
          :loading="preview.state === 'loading'"
          :disabled="!queryText.trim()"
          data-test="dashboard-variable-query-run-preview"
          @click="runPreview"
          >{{ t("dashboard.queryVariable.runPreview") }}</OButton
        >
        <OText variant="meta">{{ t("dashboard.queryVariable.previewContext") }}</OText>
        <OTag
          v-for="parent in referencedParents"
          :key="parent.name"
          variant="default-soft"
          :data-test="`dashboard-variable-query-parent-${parent.name}`"
          >{{ raw(`$${parent.name} = ${parent.display}`) }}</OTag
        >
      </div>

      <OBanner
        v-if="undefinedNames.length"
        variant="warning"
        icon="warning"
        dense
        data-test="dashboard-variable-query-undefined-variables"
        >{{
          t("dashboard.queryVariable.undefinedVariables", {
            names: undefinedNames.map((name) => `$${name}`).join(", "),
          })
        }}</OBanner
      >
      <OText
        v-if="preview.state === 'idle'"
        variant="meta"
        data-test="dashboard-variable-query-preview-idle"
        >{{ t("dashboard.queryVariable.previewIdle") }}</OText
      >
      <OBanner
        v-else-if="preview.state === 'error'"
        variant="error-soft"
        icon="error-outline"
        dense
        data-test="dashboard-variable-query-preview-error"
      >
        <div class="flex flex-col gap-0.5">
          <OText variant="body-strong">{{ t("dashboard.queryVariable.previewFailed") }}</OText>
          <OText variant="meta">{{ raw(preview.error) }}</OText>
        </div>
      </OBanner>
      <OEmptyState
        v-else-if="preview.state === 'success' && !preview.options.length"
        size="inline"
        icon="search-off"
        :title="t('dashboard.queryVariable.noValues')"
        :description="t('dashboard.queryVariable.noValuesDescription')"
        data-test="dashboard-variable-query-preview-empty"
      />
      <template v-else-if="preview.state === 'success'">
        <div class="flex flex-wrap items-center gap-2">
          <OTag variant="success-soft" data-test="dashboard-variable-query-preview-count">{{
            t(
              "dashboard.queryVariable.valuesCount",
              { count: preview.options.length },
              preview.options.length,
            )
          }}</OTag>
          <OText
            v-if="preview.capped"
            variant="meta"
            data-test="dashboard-variable-query-preview-capped"
            >{{ t("dashboard.queryVariable.cappedPreview", { count: preview.maxRecords }) }}</OText
          >
        </div>
        <OTable
          v-if="language === 'sql'"
          :data="previewRows"
          :columns="previewColumns"
          row-key="__previewRow"
          pagination="none"
          sorting="none"
          :show-global-filter="false"
          :fill-height="false"
          max-height="15rem"
          frame
          data-test="dashboard-variable-query-preview-table"
        />
        <div
          v-else
          class="flex flex-wrap gap-1.5"
          data-test="dashboard-variable-query-preview-values"
        >
          <OTag v-for="option in preview.options" :key="option.value" variant="default-soft">{{
            raw(option.label)
          }}</OTag>
        </div>
      </template>
    </div>

    <div class="flex items-start gap-x-4 max-md:flex-col max-md:gap-y-2">
      <template v-if="language === 'sql'">
        <OFormSelect
          name="query_data.value_field"
          :label="t('dashboard.queryVariable.valueField')"
          :help-text="t('dashboard.queryVariable.valueFieldHelp')"
          :options="valueColumnOptions"
          :placeholder="columns.length ? undefined : t('dashboard.queryVariable.runPreviewFirst')"
          :searchable="false"
          class="flex-1"
          data-test="dashboard-variable-query-value-field"
        />
        <OFormSelect
          name="query_data.label_field"
          :label="t('dashboard.queryVariable.labelField')"
          :help-text="t('dashboard.queryVariable.labelFieldHelp')"
          :options="labelColumnOptions"
          :placeholder="columns.length ? undefined : t('dashboard.queryVariable.runPreviewFirst')"
          :searchable="false"
          clearable
          class="flex-1"
          data-test="dashboard-variable-query-label-field"
        />
      </template>
      <OFormInput
        name="query_data.max_record_size"
        type="number"
        :label="t('dashboard.DefaultSize')"
        class="flex-1"
        data-test="dashboard-variable-query-max-record-size"
      >
        <template #tooltip><OTooltip :content="t('dashboard.maxRecordSize')" /></template>
      </OFormInput>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, reactive, ref } from "vue";
import UnifiedQueryEditor from "@/components/QueryEditor.vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";
import { extractVariableNames } from "@/utils/dashboard/variables/variablesDependencyUtils";
import {
  getQueryVariableMaxRecords,
  getUndefinedQueryVariableNames,
  substituteQueryVariables,
  type QueryVariableContextEntry,
  type QueryVariableLanguage,
  type QueryVariableOption,
} from "@/utils/dashboard/variables/queryVariableUtils";
import {
  getQueryVariableErrorMessage,
  loadQueryVariableValues,
  QueryVariableCancelledError,
  runSqlVariableQueryOnStream,
  type SqlVariableQueryRequest,
} from "@/utils/dashboard/variables/queryVariableLoader";

interface PreviewState {
  state: "idle" | "loading" | "success" | "error";
  options: QueryVariableOption[];
  rows: Record<string, unknown>[];
  columns: string[];
  capped: boolean;
  maxRecords: number;
  error: string;
}

const props = defineProps<{
  dashboardVariablesList?: any[];
  streamTypeOptions: { label: I18nText; value: string }[];
}>();

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const form: any = inject(FORM_CONTEXT_KEY);
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();

const queryData = form.useStore((s: any) => s.values?.query_data ?? {});
const variableName = form.useStore((s: any) => s.values?.name ?? "");
const language = computed<QueryVariableLanguage>(() =>
  queryData.value?.query_type === "promql" ? "promql" : "sql",
);
const queryText = computed<string>(() => queryData.value?.query ?? "");

const functionsOpen = ref(false);
const editorKey = ref(0);
const preview = reactive<PreviewState>({
  state: "idle",
  options: [],
  rows: [],
  columns: [],
  capped: false,
  maxRecords: 0,
  error: "",
});
let previewRun = 0;
let activeTraceId: string | null = null;

const promFunctions = computed(() => [
  {
    id: "label-values",
    signature: "label_values(label)",
    description: t("dashboard.queryVariable.fnLabelValues"),
    example: "label_values(job)",
  },
  {
    id: "label-values-selector",
    signature: "label_values(metric, label)",
    description: t("dashboard.queryVariable.fnLabelValuesForSelector"),
    example: "label_values(up, job)",
  },
  {
    id: "label-names",
    signature: "label_names()",
    description: t("dashboard.queryVariable.fnLabelNames"),
    example: "label_names()",
  },
  {
    id: "metrics",
    signature: "metrics(regex)",
    description: t("dashboard.queryVariable.fnMetrics"),
    example: "metrics(.*_total)",
  },
  {
    id: "query-result",
    signature: "query_result(expr)",
    description: t("dashboard.queryVariable.fnQueryResult"),
    example: "query_result(count by (job) (up))",
  },
]);

const routeValue = (name: string) => {
  const value = route.query[`var-${name}`];
  if (value === undefined || value === null || value === "") return undefined;
  return value;
};

// Current value of each other variable: the URL selection first, then its saved default.
const parentContext = computed<QueryVariableContextEntry[]>(() =>
  (props.dashboardVariablesList ?? [])
    .filter((v: any) => v?.name && v.name !== variableName.value)
    .map((v: any) => {
      let value: any = routeValue(v.name);
      if (value === undefined && v.type === "custom") {
        const selected = (v.options ?? []).filter((o: any) => o.selected).map((o: any) => o.value);
        value = v.multiSelect ? selected : (selected[0] ?? v.options?.[0]?.value);
      }
      if (value === undefined && v.selectAllValueForMultiSelect === "custom") {
        value = v.multiSelect ? v.customMultiSelectValue : v.customMultiSelectValue?.[0];
      }
      if (value === undefined) value = v.value;
      return { name: v.name, type: v.type, value, isVariablePartialLoaded: true };
    }),
);

const referencedParents = computed(() => {
  const names = new Set(parentContext.value.map((v) => v.name));
  const referenced = extractVariableNames(queryText.value, names);
  return parentContext.value
    .filter((v) => referenced.includes(v.name))
    .map((v) => {
      const values = Array.isArray(v.value) ? v.value : [v.value];
      const shown = values.filter((value) => value !== null && value !== undefined && value !== "");
      return { name: v.name, display: shown.length ? shown.join(", ") : "—" };
    });
});

const undefinedNames = computed(() =>
  getUndefinedQueryVariableNames(queryText.value, [
    variableName.value,
    ...(props.dashboardVariablesList ?? []).map((v: any) => v?.name).filter(Boolean),
  ]),
);

const getTimeRange = (): { startTime: number; endTime: number } => {
  const from = Number(route.query.from);
  const to = Number(route.query.to);
  if (!route.query.period && from && to) return { startTime: from, endTime: to };
  const relative =
    getConsumableRelativeTime(String(route.query.period ?? "15m")) ??
    getConsumableRelativeTime("15m");
  return { startTime: relative!.startTime, endTime: relative!.endTime };
};

const cancelActiveStream = () => {
  if (!activeTraceId) return;
  cancelStreamQueryBasedOnRequestId({
    trace_id: activeTraceId,
    org_id: store.state.selectedOrganization.identifier,
  });
  activeTraceId = null;
};

const runSql = (request: SqlVariableQueryRequest) => {
  cancelActiveStream();
  const { traceId } = generateTraceContext();
  activeTraceId = traceId;
  return runSqlVariableQueryOnStream(fetchQueryDataWithHttpStream, {
    ...request,
    orgId: store.state.selectedOrganization.identifier,
    traceId,
  }).finally(() => {
    if (activeTraceId === traceId) activeTraceId = null;
  });
};

const setField = (name: string, value: unknown) => form.setFieldValue(name, value);

const syncColumnFields = (columns: string[]) => {
  if (!columns.length) return;
  const valueField = queryData.value?.value_field;
  if (!valueField || !columns.includes(valueField)) setField("query_data.value_field", columns[0]);
  const labelField = queryData.value?.label_field;
  if (labelField && !columns.includes(labelField)) setField("query_data.label_field", "");
};

// Columns picked against an earlier result are unverified once the query fails, so they are not kept.
const clearColumnFields = () => {
  preview.columns = [];
  preview.rows = [];
  preview.options = [];
  setField("query_data.value_field", "");
  setField("query_data.label_field", "");
};

const runPreview = async () => {
  if (!queryText.value.trim()) return;
  const run = ++previewRun;
  const maxRecords = getQueryVariableMaxRecords({ query_data: queryData.value });
  preview.state = "loading";
  preview.error = "";
  try {
    const { startTime, endTime } = getTimeRange();
    const result = await loadQueryVariableValues({
      query: substituteQueryVariables(queryText.value, parentContext.value, language.value),
      language: language.value,
      streamType: queryData.value?.stream_type || "logs",
      valueField: queryData.value?.value_field,
      labelField: queryData.value?.label_field,
      maxRecords,
      startTime,
      endTime,
      orgId: store.state.selectedOrganization.identifier,
      runSql,
    });
    if (run !== previewRun) return;
    preview.options = result.options;
    preview.rows = result.rows.slice(0, maxRecords);
    preview.columns = result.columns;
    preview.capped = result.capped;
    preview.maxRecords = maxRecords;
    preview.state = "success";
    syncColumnFields(result.columns);
  } catch (error) {
    if (run !== previewRun || error instanceof QueryVariableCancelledError) return;
    preview.state = "error";
    preview.error = getQueryVariableErrorMessage(error);
    clearColumnFields();
  }
};

const resetPreview = () => {
  previewRun++;
  cancelActiveStream();
  preview.state = "idle";
  preview.options = [];
  preview.rows = [];
  preview.columns = [];
  preview.capped = false;
};

const onLanguageChange = () => {
  resetPreview();
  if (!queryData.value?.stream_type) setField("query_data.stream_type", "logs");
};

const onQueryUpdate = (field: any, value: string) => {
  if (value === (field.state.value ?? "")) return;
  field.handleChange(value);
};

const insertExample = (example: string) => {
  setField("query_data.query", example);
  editorKey.value++;
  functionsOpen.value = false;
  resetPreview();
};

const columns = computed<string[]>(() => {
  if (preview.columns.length) return preview.columns;
  return [queryData.value?.value_field, queryData.value?.label_field].filter(
    (column: unknown): column is string => typeof column === "string" && column !== "",
  );
});

const valueColumnOptions = computed(() =>
  columns.value.map((column) => ({ label: raw(column), value: column })),
);
const labelColumnOptions = valueColumnOptions;

const previewColumns = computed<OTableColumnDef[]>(() =>
  preview.columns.map((column, index) => ({
    id: `column_${index}`,
    header: raw(column),
    accessorFn: (row: Record<string, unknown>) => {
      const value = row[column];
      return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
    },
  })),
);

const previewRows = computed(() =>
  preview.rows.map((row, index) => ({ ...row, __previewRow: String(index) })),
);

onMounted(() => {
  if (language.value === "sql" && !queryData.value?.stream_type) {
    setField("query_data.stream_type", "logs");
  }
});

onUnmounted(() => {
  previewRun++;
  cancelActiveStream();
});

defineExpose({ runPreview, preview });
</script>
