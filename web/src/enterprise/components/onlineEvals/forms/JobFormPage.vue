<template>
  <OForm
    class="job-form flex flex-col flex-1 min-h-0 gap-2.5"
    :form="form"
    v-slot="{ isSubmitting }"
  >
    <OPageLayout
      :back="{
        label: t('onlineEvals.job.backTo'),
        onClick: () => $emit('cancel'),
        dataTest: 'job-form-back-btn',
      }"
      bleed
    >
      <template #title>
        <span data-test="job-form-title">
          {{
            mode === "create"
              ? t("onlineEvals.job.createTitle")
              : t("onlineEvals.job.editTitle")
          }}
        </span>
      </template>
      <template #actions>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('onlineEvals.buttons.cancel')"
          :title="t('onlineEvals.buttons.cancel')"
          data-test="job-form-close-btn"
          :disabled="isSubmitting"
          @click="$emit('cancel')"
        />
      </template>

    <div
      class="flex min-h-0 flex-1 gap-2 overflow-hidden max-[68.75rem]:flex-col"
    >
      <div
        class="flex min-h-0 min-w-0 flex-[6.5] flex-col gap-2 overflow-auto p-2 [&_textarea]:max-h-[12.5rem] [&_textarea]:overflow-y-auto max-[68.75rem]:flex-[1_1_auto]"
      >
        <!-- Details — job identity only. Kept separate from Evaluation Target
             so each heading actually describes its fields: naming the job and
             choosing what it reads are different decisions. -->
        <section
          class="card-container shrink-0 overflow-hidden rounded-default border border-border-default"
          data-test="job-form-details-section"
        >
          <div
            class="flex items-center border-b border-border-default px-3 py-2.5"
          >
            <div
              class="mr-2 h-4 w-[0.1875rem] shrink-0 rounded-default bg-theme-accent"
            />
            <span
              class="text-compact font-semibold tracking-[0.01em] text-text-heading"
              >{{ t("onlineEvals.job.detailsSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
            <div>
              <OFormInput
                name="name"
                :label="t('onlineEvals.job.nameLabel')"
                :placeholder="t('onlineEvals.job.namePlaceholder')"
                size="sm"
                required
                :disabled="mode === 'edit'"
                data-test="job-form-name-input"
              >
                <template v-if="mode === 'edit'" #icon-left>
                  <OIcon name="lock" size="xs" class="text-text-secondary" />
                </template>
              </OFormInput>
            </div>

            <div class="[&_textarea]:max-h-[7.5rem]">
              <OFormTextarea
                name="description"
                :label="t('onlineEvals.job.descriptionLabel')"
                :placeholder="t('onlineEvals.job.descriptionPlaceholder')"
                size="sm"
                :rows="3"
                data-test="job-form-description-input"
              />
            </div>
          </div>
        </section>

        <!-- Evaluation Target -->
        <section
          class="card-container shrink-0 overflow-hidden rounded-default border border-border-default"
          data-test="job-form-target-section"
        >
          <div
            class="flex items-center border-b border-border-default px-3 py-2.5"
          >
            <div
              class="mr-2 h-4 w-[0.1875rem] shrink-0 rounded-default bg-theme-accent"
            />
            <span
              class="text-compact font-semibold tracking-[0.01em] text-text-heading"
              >{{ t("onlineEvals.job.targetSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
            <div>
              <OFormSelect
                name="targetScope"
                :label="t('onlineEvals.job.targetScopeLabel')"
                :options="targetScopeOptions"
                :help-text="
                  t(`onlineEvals.job.targetScopeHelp.${formValues.targetScope}`)
                "
                size="md"
                required
                data-test="job-form-target-scope-select"
              />
            </div>

            <div>
              <OFormSelect
                name="stream"
                :label="t('onlineEvals.job.streamLabel')"
                :options="streamOptions"
                :placeholder="t('onlineEvals.job.streamPlaceholder')"
                size="md"
                required
                :disabled="mode === 'edit'"
                data-test="job-form-stream-select"
              >
                <template v-if="mode === 'edit'" #icon-left>
                  <OIcon name="lock" size="xs" class="text-text-secondary" />
                </template>
              </OFormSelect>
            </div>
          </div>
        </section>

        <!-- Filtering — before Sampling: the pipeline filters first, then
             samples the matching subset (§OnlineEval-D15), so the form reads
             in the same order the job actually executes. -->
        <section
          class="card-container shrink-0 overflow-hidden rounded-default border border-border-default"
          data-test="job-form-filtering-section"
        >
          <div
            class="flex items-center border-b border-border-default px-3 py-2.5"
          >
            <div
              class="mr-2 h-4 w-[0.1875rem] shrink-0 rounded-default bg-theme-accent"
            />
            <span
              class="text-compact font-semibold tracking-[0.01em] text-text-heading"
              >{{ t("onlineEvals.job.filteringSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
            <JobFilterBuilder
              name-prefix="filterGroup"
              :target-scope="formValues.targetScope"
              :stream-fields="streamFields"
              data-test="job-form-filter-builder"
            />
          </div>
        </section>

        <!-- Sampling -->
        <section
          class="card-container shrink-0 overflow-hidden rounded-default border border-border-default"
          data-test="job-form-sampling-section"
        >
          <div
            class="flex items-center border-b border-border-default px-3 py-2.5"
          >
            <div
              class="mr-2 h-4 w-[0.1875rem] shrink-0 rounded-default bg-theme-accent"
            />
            <span
              class="text-compact font-semibold tracking-[0.01em] text-text-heading"
              >{{ t("onlineEvals.job.stepper.sampling") }}</span
            >
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
            <div
              class="grid grid-cols-2 gap-[0.875rem] max-[68.75rem]:grid-cols-1"
            >
              <div>
                <OFormSelect
                  name="samplingMode"
                  :label="t('onlineEvals.job.samplingModeLabel')"
                  :options="samplingModeOptions"
                  :help-text="t('onlineEvals.job.samplingHelp')"
                  size="md"
                  data-test="job-form-sampling-mode-select"
                />
              </div>

              <div>
                <OFormInput
                  name="samplingValue"
                  :label="t('onlineEvals.job.samplingValueLabel')"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  size="sm"
                  :required="formValues.samplingMode !== 'all'"
                  :disabled="formValues.samplingMode === 'all'"
                  :help-text="samplingValueHelp"
                  data-test="job-form-sampling-value-input"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Scorers + Mapping -->
        <section
          class="card-container shrink-0 overflow-hidden rounded-default border border-border-default"
          data-test="job-form-scorers-section"
        >
          <div
            class="flex items-center border-b border-border-default px-3 py-2.5"
          >
            <div
              class="mr-2 h-4 w-[0.1875rem] shrink-0 rounded-default bg-theme-accent"
            />
            <span
              class="text-compact font-semibold tracking-[0.01em] text-text-heading"
              >{{ t("onlineEvals.job.scorersSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
            <JobScorerPicker
              :model-value="formValues.scorerIds"
              :target-scope="formValues.targetScope"
              :scorers="scorers"
              @update:model-value="form.setFieldValue('scorerIds', $event)"
            />

            <JobInputMapping
              :target-scope="formValues.targetScope"
              :selected-scorers="selectedScorers"
              :input-mappings="inputMappings"
              :span-selectors="spanSelectors"
              :span-selector-bindings="spanSelectorBindings"
              :stream-fields="streamFields"
              @update:input-mappings="inputMappings = $event"
              @update:span-selectors="spanSelectors = $event"
              @update:span-selector-bindings="spanSelectorBindings = $event"
            />
          </div>
        </section>

        <!-- Trace/session completion -->
        <section
          v-if="formValues.targetScope !== 'span'"
          class="card-container shrink-0 overflow-hidden rounded-default border border-border-default"
          data-test="job-form-completion-section"
        >
          <div
            class="flex items-center border-b border-border-default px-3 py-2.5"
          >
            <div
              class="mr-2 h-4 w-[0.1875rem] shrink-0 rounded-default bg-theme-accent"
            />
            <span
              class="text-compact font-semibold tracking-[0.01em] text-text-heading"
              >{{ t("onlineEvals.job.completionSection") }}</span
            >
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
            <div class="text-xs text-input-help-text leading-none">
              {{
                t(`onlineEvals.job.completionHelp.${formValues.targetScope}`)
              }}
            </div>
            <div
              class="grid grid-cols-2 gap-[0.875rem] max-[68.75rem]:grid-cols-1"
            >
              <div>
                <OFormInput
                  name="idleWindowSecs"
                  :label="t('onlineEvals.job.idleWindowLabel')"
                  type="number"
                  :min="MIN_COMPLETION_IDLE_WINDOW_SECS"
                  size="sm"
                  :help-text="idleWindowHelp"
                  data-test="job-form-idle-window-input"
                />
              </div>
              <div>
                <OFormInput
                  name="maxAgeSecs"
                  :label="t('onlineEvals.job.maxAgeLabel')"
                  type="number"
                  min="1"
                  size="sm"
                  :help-text="maxAgeHelp"
                  data-test="job-form-max-age-input"
                />
              </div>
            </div>
            <JobFilterBuilder
              :target-scope="formValues.targetScope"
              :group="endSignalGroup"
              purpose="endSignal"
              :stream-fields="streamFields"
              data-test="job-form-end-signal-builder"
              @update:group="endSignalGroup = $event"
            />
          </div>
        </section>
      </div>

      <JobPreviewPanel
        :name="formValues.name"
        :stream-type="formValues.streamType"
        :target-scope="formValues.targetScope"
        :mode="mode"
        :stream="formValues.stream"
        :filter-where="filterWhere"
        :filter-ready="filterReady"
      />
    </div>

    <footer class="sticky bottom-0 flex items-center justify-end gap-2 px-5.5 py-3 bg-surface-base border-t border-border-default shrink-0 z-1">
      <OButton
        data-test="job-form-cancel-btn"
        type="button"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="$emit('cancel')"
      >
        {{ t("onlineEvals.buttons.cancel") }}
      </OButton>
      <template v-if="mode === 'create'">
        <!-- Both create actions submit through the form (so Enter + schema
             validation apply); the click sets which one before the form submit
             fires, and loading is form-driven (isSubmitting). -->
        <OButton
          data-test="job-form-save-draft-btn"
          type="submit"
          variant="outline"
          size="sm-action"
          :loading="isSubmitting && !activateOnSave"
          :disabled="isSubmitting && activateOnSave"
          @click="activateOnSave = false"
        >
          {{ t("onlineEvals.buttons.saveAsDraft") }}
        </OButton>
        <OButton
          data-test="job-form-save-activate-btn"
          type="submit"
          variant="primary"
          size="sm-action"
          :loading="isSubmitting && activateOnSave"
          :disabled="isSubmitting && !activateOnSave"
          @click="activateOnSave = true"
        >
          {{ t("onlineEvals.buttons.createAndActivate") }}
        </OButton>
      </template>
      <OButton
        v-else
        data-test="job-form-save-btn"
        type="submit"
        variant="primary"
        size="sm-action"
        :loading="isSubmitting"
      >
        {{ t("onlineEvals.buttons.save") }}
      </OButton>
    </footer>
    </OPageLayout>
  </OForm>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import useStreams from "@/composables/useStreams";
import onlineEvalsService, {
  type EvalJob,
  type EvalTargetScope,
  type Scorer,
  type SpanSelector,
} from "@/services/online-evals.service";
import {
  entityId,
  samplingModeOf,
  scorerRefId,
  scorerRefVersion,
  streamTypeOf,
  targetScopeOf,
  valueOf,
} from "../utils/evalEntity";
import { showError } from "../utils/evalFormat";
import {
  parseSamplingRate,
  samplingRateForForm,
  samplingRatePercent,
} from "../utils/jobSampling";
import {
  buildJobFilterConditionPayload,
  buildOptionalJobConditionPayload,
  cleanFilterGroup,
  createEmptyJobFilterGroup,
  isJobFilterComplete,
  normalizeJobFilterCondition,
} from "../utils/jobFilter";
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
import {
  buildJobInputMappingPayload,
  normalizeJobInputMappings,
  syncJobInputMappings,
} from "../utils/jobMappings";
import {
  buildCompletionConfigPayloads,
  completionWindowConfigFromJob,
  completionWindowDefaultsForScope,
  durationPartsFromSecs,
  MIN_COMPLETION_IDLE_WINDOW_SECS,
  TRACE_COMPLETION_WINDOW_DEFAULTS,
} from "../utils/completionWindow";
import JobScorerPicker from "./job/JobScorerPicker.vue";
import JobFilterBuilder from "./job/JobFilterBuilder.vue";
import JobInputMapping from "./job/JobInputMapping.vue";
import JobPreviewPanel from "./job/JobPreviewPanel.vue";
import { makeJobFormSchema, type JobForm } from "./JobFormPage.schema";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: EvalJob | null;
  scorers: Scorer[];
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

// Co-located Zod schema (factory keeps messages i18n-driven). The form is
// mounted fresh per create/edit action, so building it once is safe.
const jobFormSchema = makeJobFormSchema(t);

// This component owns <OForm>, so it creates the form with useOForm and reads
// it reactively via form.useStore (single source of truth, no mirror ref).
// `formValues` drives the parent-side reads a parent can't
// get from form context: JobPreviewPanel (name/streamType), the stream-option
// list (stream), selectedScorers + the mapping sync (scorerIds), and the
// sampling `v-if`/disabled (samplingMode). Writes go through form.setFieldValue
// (the composite JobScorerPicker bridges `scorerIds` that way); the @submit
// handler reads the validated `value`.
const form = useOForm<JobForm>({
  defaultValues: initForm(props.row),
  schema: jobFormSchema,
  onSubmit,
});
const formValues = form.useStore((s: any) => s.values as JobForm);

// The filter-builder tree is FORM-OWNED now: a reactive READ-VIEW of the
// form's `filterGroup` field (JobFilterBuilder renders FilterGroup in form mode
// and writes structural changes straight to the form). Single source of truth,
// no mirror ref. Drives the preview computeds below and the save payload.
const filterGroup = form.useStore(
  (s: any) => s.values.filterGroup ?? createEmptyJobFilterGroup(),
);
// The completion end-signal and mapping/selectors are composite working state
// built into the payload at submit.
const endSignalGroup = ref(initEndSignalGroup(props.row));
const inputMappings = ref(initInputMappings(props.row));
const spanSelectors = ref(initSpanSelectors(props.row));
const spanSelectorBindings = ref(initSpanSelectorBindings(props.row));
const scorerVersions = ref(initScorerVersions(props.row));
// Which create-mode submit was triggered (draft vs. create-and-activate). Set
// on click before the form submit fires; loading is form-driven (isSubmitting).
const activateOnSave = ref(false);

// SQL WHERE body built from the filter builder — feeds the live "matched
// spans" count in the preview panel. Built from the CLEANED group (incomplete
// conditions stripped) so the SQL is always valid. Same formatter the form's
// filter preview line uses (sqlMode → quoted, comparable values).
const filterWhere = computed<string>(() => {
  try {
    return buildConditionsString(cleanFilterGroup(filterGroup.value), {
      sqlMode: true,
      addWherePrefix: false,
      formatValues: true,
    });
  } catch {
    return "";
  }
});

// Sampling help doubles as live feedback: once the rate parses to a usable
// percentage we state the actual effect ("Evaluates 25% of matched targets"),
// and fall back to the 0.1 example only while the field is empty or invalid —
// that example is what teaches the 0–1 scale, so it earns its place then.
const samplingValueHelp = computed<string>(() => {
  if (formValues.value.samplingMode === "all") {
    return t("onlineEvals.job.samplingValueAllHelp");
  }

  const percent = samplingRatePercent(formValues.value.samplingValue);
  return percent === null
    ? t("onlineEvals.job.samplingValueHelp")
    : t("onlineEvals.job.samplingValuePreview", { percent });
});

// Completion help echoes the entered window back in readable units, because a
// bare `1800` in a seconds box says nothing about how long the user will wait.
// Unit labels come from i18n (same `common.*` keys AutoRefreshInterval uses),
// so the util hands back numbers and the wording is assembled here.
function humanizeSecs(value: string | number): string | null {
  const parts = durationPartsFromSecs(value);
  if (!parts) return null;

  const words: string[] = [];
  if (parts.hours) words.push(`${parts.hours} ${t("common.hr")}`);
  if (parts.minutes) words.push(`${parts.minutes} ${t("common.min")}`);
  if (parts.seconds) words.push(`${parts.seconds} ${t("common.sec")}`);

  return words.join(" ") || null;
}

// NOTE: `formValues` is a store ref; script reads need `.value` (templates
// auto-unwrap, script does not).
const idleWindowHelp = computed<string>(() => {
  const duration = humanizeSecs(formValues.value.idleWindowSecs);
  return duration
    ? t("onlineEvals.job.idleWindowHelp", { duration })
    : t("onlineEvals.job.idleWindowHelpEmpty");
});

const maxAgeHelp = computed<string>(() => {
  const duration = humanizeSecs(formValues.value.maxAgeSecs);
  return duration
    ? t("onlineEvals.job.maxAgeHelp", { duration })
    : t("onlineEvals.job.maxAgeHelpEmpty");
});

// Pauses the match-count query while a condition is half-filled (column picked
// but value still empty), so we don't query on every keystroke / partial edit.
const filterReady = computed<boolean>(() =>
  isJobFilterComplete(filterGroup.value),
);

const selectedScorers = computed(() =>
  formValues.value.scorerIds
    .map((id) => props.scorers.find((scorer) => entityId(scorer) === id))
    .filter((scorer): scorer is Scorer => Boolean(scorer)),
);

const { getStreams, getStream } = useStreams();
const traceStreams = ref<string[]>([]);
const RESERVED_EVAL_SOURCE_STREAMS = new Set([
  "_evaluator",
  "_llm_scores",
  "usage",
  "stats",
  "triggers",
  "errors",
  "data_retention_usage",
]);
const streamFields = ref<Array<{ label: string; value: string; type: string }>>(
  [],
);

const streamOptions = computed(() => {
  const opts = traceStreams.value.map((name) => ({ label: name, value: name }));
  // Ensure currently selected value is always present (e.g. on edit before list loads)
  if (
    formValues.value.stream &&
    !RESERVED_EVAL_SOURCE_STREAMS.has(formValues.value.stream.toLowerCase()) &&
    !opts.some((o) => o.value === formValues.value.stream)
  ) {
    opts.unshift({
      label: formValues.value.stream,
      value: formValues.value.stream,
    });
  }
  return opts;
});

async function loadTraceStreams() {
  try {
    const result: any = await getStreams("traces", false, false, false);
    const list = result?.list || result?.data?.list || [];
    traceStreams.value = list
      .map((s: any) => s.name)
      .filter(
        (name: unknown): name is string =>
          typeof name === "string" &&
          Boolean(name) &&
          !RESERVED_EVAL_SOURCE_STREAMS.has(name.toLowerCase()),
      );
  } catch {
    traceStreams.value = [];
  }
}

async function loadStreamFields() {
  if (!formValues.value.stream) {
    streamFields.value = [];
    return;
  }
  if (typeof getStream !== "function") {
    streamFields.value = [];
    return;
  }
  try {
    const stream: any = await getStream(
      formValues.value.stream,
      "traces",
      true,
    );
    streamFields.value = (stream?.schema || [])
      .map((field: any) => {
        const name = typeof field === "string" ? field : field?.name;
        if (!name) return null;
        return {
          label: name,
          value: name,
          type: typeof field === "string" ? "Utf8" : field?.type || "Utf8",
        };
      })
      .filter(
        (
          field: { label: string; value: string; type: string } | null,
        ): field is { label: string; value: string; type: string } =>
          field !== null,
      );
  } catch {
    streamFields.value = [];
  }
}

onMounted(() => {
  void loadTraceStreams();
  void loadStreamFields();
});

const samplingModeOptions = computed(() => [
  { label: t("onlineEvals.job.samplingModes.rate"), value: "rate" },
  { label: t("onlineEvals.job.samplingModes.all"), value: "all" },
]);

const targetScopeOptions = computed(() => [
  { label: t("onlineEvals.job.targetScopes.span"), value: "span" },
  { label: t("onlineEvals.job.targetScopes.trace"), value: "trace" },
  { label: t("onlineEvals.job.targetScopes.session"), value: "session" },
]);

watch(
  () => formValues.value.targetScope,
  (targetScope, previousScope) => {
    if (targetScope === previousScope) return;
    if (targetScope !== "trace") {
      spanSelectors.value = [];
      spanSelectorBindings.value = {};
    }
    const defaults = completionWindowDefaultsForScope(targetScope);
    if (!defaults) return;
    form.setFieldValue("idleWindowSecs", defaults.idleWindowSecs);
    form.setFieldValue("maxAgeSecs", defaults.maxAgeSecs);
  },
);

watch(
  () => formValues.value.stream,
  () => void loadStreamFields(),
);

watch(
  () => formValues.value.scorerIds.slice(),
  () => syncMappings(),
);
watch(
  () => props.scorers,
  () => syncMappings(),
);

function initForm(row: EvalJob | null): JobForm {
  if (!row) {
    return {
      name: "",
      description: "",
      stream: "",
      streamType: "traces",
      targetScope: "span",
      idleWindowSecs: TRACE_COMPLETION_WINDOW_DEFAULTS.idleWindowSecs,
      maxAgeSecs: TRACE_COMPLETION_WINDOW_DEFAULTS.maxAgeSecs,
      scorerIds: [] as string[],
      samplingMode: "rate",
      samplingValue: "0.1",
      filterGroup: initFilterGroup(row),
    };
  }
  const targetScope = targetScopeOf(row);
  const completionWindowDefaults =
    completionWindowDefaultsForScope(targetScope) ??
    TRACE_COMPLETION_WINDOW_DEFAULTS;
  const completionConfig = completionWindowConfigFromJob(row, targetScope);
  return {
    name: row.name,
    description: row.description || "",
    stream: row.stream,
    streamType: streamTypeOf(row),
    targetScope,
    idleWindowSecs:
      completionConfig?.idleWindowSecs ??
      completionWindowDefaults.idleWindowSecs,
    maxAgeSecs:
      completionConfig?.maxAgeSecs ?? completionWindowDefaults.maxAgeSecs,
    scorerIds: (row.scorers || []).map(scorerRefId),
    samplingMode: samplingModeOf(row),
    samplingValue: samplingRateForForm(
      valueOf(row, "samplingValue", "sampling_value"),
    ),
    filterGroup: initFilterGroup(row),
  };
}

function initEndSignalGroup(row: EvalJob | null) {
  if (!row) return createEmptyJobFilterGroup();
  const completionConfig = completionWindowConfigFromJob(
    row,
    targetScopeOf(row),
  );
  return normalizeJobFilterCondition(completionConfig?.endSignal);
}

function initFilterGroup(row: EvalJob | null) {
  if (!row) return createEmptyJobFilterGroup();
  return normalizeJobFilterCondition(
    valueOf(row, "filterCondition", "filter_condition"),
  );
}

function initInputMappings(row: EvalJob | null) {
  if (!row) return {} as Record<string, Record<string, string>>;
  const selectedScorerIds = (row.scorers || []).map(scorerRefId);
  return normalizeJobInputMappings(
    valueOf(row, "inputMapping", "input_mapping"),
    selectedScorerIds,
  );
}

function initSpanSelectors(row: EvalJob | null): SpanSelector[] {
  if (!row) return [];
  const selectors =
    valueOf<any[]>(row, "spanSelectors", "span_selectors") || [];
  return selectors.map((selector: any) => ({
    id: selector.id,
    name: selector.name,
    filterCondition:
      selector.filterCondition ?? selector.filter_condition ?? {},
    fieldMode: selector.fieldMode ?? selector.field_mode ?? "default",
    fields: Array.isArray(selector.fields) ? [...selector.fields] : [],
    maximumSpans: selector.maximumSpans ?? selector.maximum_spans ?? 5,
  }));
}

function initSpanSelectorBindings(row: EvalJob | null) {
  if (!row) return {} as Record<string, string>;
  return {
    ...(valueOf<Record<string, string>>(
      row,
      "spanSelectorBindings",
      "span_selector_bindings",
    ) || {}),
  };
}

function initScorerVersions(row: EvalJob | null) {
  if (!row) return {} as Record<string, number | null>;
  return Object.fromEntries(
    (row.scorers || []).map((scorer) => [
      scorerRefId(scorer),
      scorerRefVersion(scorer),
    ]),
  );
}

function syncMappings() {
  const { nextMappings, nextVersions } = syncJobInputMappings(
    formValues.value.scorerIds,
    props.scorers,
    inputMappings.value,
    scorerVersions.value,
  );
  inputMappings.value = nextMappings;
  scorerVersions.value = nextVersions;
  const selected = new Set(formValues.value.scorerIds);
  spanSelectorBindings.value = Object.fromEntries(
    Object.entries(spanSelectorBindings.value).filter(([scorerId]) =>
      selected.has(scorerId),
    ),
  );
}

// @submit handler — OForm only calls this once the schema passes (name/stream
// required + the sampling-value conditional), so the schema gates most fields;
// scorerIds is guarded here as a toast (the composite picker has no inline slot).
// The clicked create button sets `activateOnSave`; loading is form-driven
// (isSubmitting). The validated `value` is the source of truth.
async function onSubmit(value: JobForm) {
  if (!props.orgId) return;
  // Scorer selection is validated here, not in the schema: surface the empty
  // case as a toast since JobScorerPicker renders no inline error.
  if (!value.scorerIds.length) {
    showError(
      new Error(t("onlineEvals.job.selectAtLeastOne")),
      t("onlineEvals.job.saveError"),
    );
    return;
  }
  // Mirrors the backend's validate_for_activation(): EVERY trace scorer needs a
  // Span Selector binding, whether or not its prompt uses {{ spans }}. Keep this
  // in step with online_eval_jobs.rs — relaxing it here just trades a clear
  // client-side message for a server rejection.
  if (
    value.targetScope === "trace" &&
    (activateOnSave.value ||
      (props.mode === "edit" && props.row?.status === "active")) &&
    value.scorerIds.some((scorerId) => !spanSelectorBindings.value[scorerId])
  ) {
    showError(
      new Error(t("onlineEvals.job.spanSelector.validation.binding")),
      t("onlineEvals.job.saveError"),
    );
    return;
  }
  const activateAfter = activateOnSave.value;
  try {
    const completionConfigs = buildCompletionConfigPayloads(
      value.targetScope,
      {
        idleWindowSecs: value.idleWindowSecs,
        maxAgeSecs: value.maxAgeSecs,
      },
      buildOptionalJobConditionPayload(endSignalGroup.value),
    );
    const payload = {
      name: value.name.trim(),
      description: value.description?.trim() || null,
      stream: value.stream,
      streamType: value.streamType,
      targetScope: value.targetScope,
      filterCondition: buildJobFilterConditionPayload(value.filterGroup),
      scorers: value.scorerIds.map((id) => ({
        id,
        version: scorerVersions.value[id] ?? null,
      })),
      inputMapping: buildJobInputMappingPayload(
        value.scorerIds,
        inputMappings.value,
        value.targetScope as EvalTargetScope,
      ),
      spanSelectors: value.targetScope === "trace" ? spanSelectors.value : [],
      spanSelectorBindings:
        value.targetScope === "trace" ? spanSelectorBindings.value : {},
      ...completionConfigs,
      samplingMode: value.samplingMode as any,
      samplingValue:
        value.samplingMode === "all"
          ? null
          : parseSamplingRate(
              value.samplingValue ?? "",
              t("onlineEvals.job.samplingValueLabel"),
            ),
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.jobs.update(props.orgId, props.row.id, payload);
      toast({
        variant: "success",
        message: t("onlineEvals.saved", {
          label: t("onlineEvals.singular.jobs"),
        }),
      });
    } else {
      const created = await onlineEvalsService.jobs.create(
        props.orgId,
        payload,
      );
      if (activateAfter && created?.id) {
        try {
          await onlineEvalsService.jobs.activate(props.orgId, created.id);
          toast({
            variant: "success",
            message: t("onlineEvals.job.createdAndActivated"),
          });
        } catch (activateErr: any) {
          // Job was created but activation failed — surface the activation
          // error specifically so the user knows the job exists but is still a draft.
          showError(activateErr, t("onlineEvals.job.createdButActivateFailed"));
        }
      } else {
        toast({
          variant: "success",
          message: t("onlineEvals.saved", {
            label: t("onlineEvals.singular.jobs"),
          }),
        });
      }
    }
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.job.saveError"));
  } finally {
    activateOnSave.value = false;
  }
}
</script>
