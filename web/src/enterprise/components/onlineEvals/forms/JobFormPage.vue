<template>
  <form class="job-form" @submit.prevent="save(false)">
    <AppPageHeader
      :back="{
        label: t('onlineEvals.job.backTo'),
        onClick: () => $emit('cancel'),
        dataTest: 'job-form-back-btn',
      }"
      class="card-container tw:px-3 tw:border-b tw:border-border-default"
      style="flex-shrink: 0"
    >
      <template #title>
        <span data-test="job-form-title">
          {{ mode === "create" ? t("onlineEvals.job.createTitle") : t("onlineEvals.job.editTitle") }}
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
          @click="$emit('cancel')"
        />
      </template>
    </AppPageHeader>

    <div class="job-form__body">
      <div class="job-form__main">
        <!-- Section 01: Target -->
        <section class="job-section">
          <div class="job-section__head">
            <span class="job-section__num">01</span>
            <h3 class="job-section__title">{{ t("onlineEvals.job.targetSection") }}</h3>
          </div>

          <div class="job-field">
            <label class="job-field__label">
              {{ t("onlineEvals.job.nameLabel") }}
              <span class="job-field__req">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="job-field__lock" />
            </label>
            <OInput
              v-model.trim="form.name"
              :placeholder="t('onlineEvals.job.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="job-form-name-input"
            />
          </div>

          <div class="job-field">
            <label class="job-field__label">
              {{ t("onlineEvals.job.streamLabel") }}
              <span class="job-field__req">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="job-field__lock" />
            </label>
            <OSelect
              v-model="form.stream"
              :options="streamOptions"
              :placeholder="t('onlineEvals.job.streamPlaceholder')"
              size="md"
              :disabled="mode === 'edit'"
              data-test="job-form-stream-select"
            />
          </div>

          <div class="job-field job-field--desc">
            <label class="job-field__label">{{ t("onlineEvals.job.descriptionLabel") }}</label>
            <OInput
              v-model.trim="form.description"
              type="textarea"
              :placeholder="t('onlineEvals.job.descriptionPlaceholder')"
              size="sm"
              :rows="3"
              data-test="job-form-description-input"
            />
          </div>
        </section>

        <!-- Section 02: Scorers + Filter + Mapping -->
        <section class="job-section">
          <div class="job-section__head">
            <span class="job-section__num">02</span>
            <h3 class="job-section__title">{{ t("onlineEvals.job.scorersSection") }}</h3>
          </div>

          <JobScorerPicker
            v-model="form.scorerIds"
            :scorers="scorers"
          />

          <JobFilterBuilder
            :group="filterGroup"
            @update:group="filterGroup = $event"
          />

          <div class="job-presets">
            <span class="job-presets__label">{{ t("onlineEvals.job.presets.label") }}</span>
            <button
              type="button"
              class="job-presets__chip"
              data-test="job-form-preset-root-spans"
              @click="applyPreset('rootSpans')"
            >
              {{ t("onlineEvals.job.presets.rootSpans") }}
            </button>
            <button
              type="button"
              class="job-presets__chip"
              data-test="job-form-preset-llm-calls"
              @click="applyPreset('llmCalls')"
            >
              {{ t("onlineEvals.job.presets.llmCalls") }}
            </button>
            <button
              type="button"
              class="job-presets__chip"
              data-test="job-form-preset-tool-calls"
              @click="applyPreset('toolCalls')"
            >
              {{ t("onlineEvals.job.presets.toolCalls") }}
            </button>
          </div>

          <JobInputMapping
            :selected-scorers="selectedScorers"
            :input-mappings="inputMappings"
            @update:input-mappings="inputMappings = $event"
          />
        </section>

        <!-- Section 03: Sampling -->
        <section class="job-section">
          <div class="job-section__head">
            <span class="job-section__num">03</span>
            <h3 class="job-section__title">{{ t("onlineEvals.job.stepper.sampling") }}</h3>
          </div>

          <div class="job-field-row">
            <div class="job-field">
              <label class="job-field__label">{{ t("onlineEvals.job.samplingModeLabel") }}</label>
              <OSelect
                v-model="form.samplingMode"
                :options="samplingModeOptions"
                size="md"
                data-test="job-form-sampling-mode-select"
              />
              <div class="job-field__help">{{ t("onlineEvals.job.samplingHelp") }}</div>
            </div>

            <div class="job-field">
              <label class="job-field__label">
                {{ t("onlineEvals.job.samplingValueLabel") }}
                <span v-if="form.samplingMode !== 'all'" class="job-field__req">*</span>
              </label>
              <OInput
                v-model="form.samplingValue"
                size="sm"
                :disabled="form.samplingMode === 'all'"
                data-test="job-form-sampling-value-input"
              />
              <div class="job-field__help">
                {{ form.samplingMode === 'all'
                  ? t("onlineEvals.job.samplingValueAllHelp")
                  : t("onlineEvals.job.samplingValueHelp") }}
              </div>
            </div>
          </div>
        </section>
      </div>

      <JobPreviewPanel :name="form.name" :stream-type="form.streamType" :mode="mode" />
    </div>

    <footer class="job-form__foot">
      <OButton
        data-test="job-form-cancel-btn"
        type="button"
        variant="outline"
        size="sm-action"
        @click="$emit('cancel')"
      >
        {{ t("onlineEvals.buttons.cancel") }}
      </OButton>
      <template v-if="mode === 'create'">
        <OButton
          data-test="job-form-save-draft-btn"
          type="button"
          variant="outline"
          size="sm-action"
          :loading="isSaving && !pendingActivateOnSave"
          :disabled="isSaving && pendingActivateOnSave"
          @click="save(false)"
        >
          {{ t("onlineEvals.buttons.saveAsDraft") }}
        </OButton>
        <OButton
          data-test="job-form-save-activate-btn"
          type="button"
          variant="primary"
          size="sm-action"
          :loading="isSaving && pendingActivateOnSave"
          :disabled="isSaving && !pendingActivateOnSave"
          @click="save(true)"
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
        :loading="isSaving"
      >
        {{ t("onlineEvals.buttons.save") }}
      </OButton>
    </footer>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import useStreams from "@/composables/useStreams";
import onlineEvalsService, {
  type EvalJob,
  type Scorer,
} from "@/services/online-evals.service";
import {
  entityId,
  samplingModeOf,
  scorerRefId,
  scorerRefVersion,
  streamTypeOf,
  valueOf,
} from "../utils/evalEntity";
import { parseJson, showError, stringifyJson } from "../utils/evalFormat";
import {
  buildJobFilterConditionPayload,
  createEmptyJobFilterGroup,
  normalizeJobFilterCondition,
} from "../utils/jobFilter";
import {
  buildJobInputMappingPayload,
  normalizeJobInputMappings,
  syncJobInputMappings,
} from "../utils/jobMappings";
import JobScorerPicker from "./job/JobScorerPicker.vue";
import JobFilterBuilder from "./job/JobFilterBuilder.vue";
import JobInputMapping from "./job/JobInputMapping.vue";
import JobPreviewPanel from "./job/JobPreviewPanel.vue";

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
const form = ref(initForm(props.row));
const filterGroup = ref(initFilterGroup(props.row));
const inputMappings = ref(initInputMappings(props.row));
const scorerVersions = ref(initScorerVersions(props.row));
const isSaving = ref(false);
const pendingActivateOnSave = ref(false);

const selectedScorers = computed(() =>
  form.value.scorerIds
    .map((id) => props.scorers.find((scorer) => entityId(scorer) === id))
    .filter((scorer): scorer is Scorer => Boolean(scorer)),
);

const { getStreams } = useStreams();
const traceStreams = ref<string[]>([]);

const streamOptions = computed(() => {
  const opts = traceStreams.value.map((name) => ({ label: name, value: name }));
  // Ensure currently selected value is always present (e.g. on edit before list loads)
  if (form.value.stream && !opts.some((o) => o.value === form.value.stream)) {
    opts.unshift({ label: form.value.stream, value: form.value.stream });
  }
  return opts;
});

async function loadTraceStreams() {
  try {
    const result: any = await getStreams("traces", false, false, false);
    const list = result?.list || result?.data?.list || [];
    traceStreams.value = list.map((s: any) => s.name).filter(Boolean);
  } catch {
    traceStreams.value = [];
  }
}

onMounted(() => {
  void loadTraceStreams();
});

const samplingModeOptions = computed(() => [
  { label: t("onlineEvals.job.samplingModes.rate"), value: "rate" },
  { label: t("onlineEvals.job.samplingModes.all"), value: "all" },
  { label: t("onlineEvals.job.samplingModes.count"), value: "count" },
]);

watch(() => form.value.scorerIds.slice(), () => syncMappings());
watch(() => props.scorers, () => syncMappings());

function initForm(row: EvalJob | null) {
  if (!row) {
    return {
      name: "",
      description: "",
      stream: "",
      streamType: "traces",
      scorerIds: [] as string[],
      samplingMode: "rate",
      samplingValue: "0.1",
    };
  }
  return {
    name: row.name,
    description: row.description || "",
    stream: row.stream,
    streamType: streamTypeOf(row),
    scorerIds: (row.scorers || []).map(scorerRefId),
    samplingMode: samplingModeOf(row),
    samplingValue: stringifyJson(valueOf(row, "samplingValue", "sampling_value")),
  };
}

function initFilterGroup(row: EvalJob | null) {
  if (!row) return createEmptyJobFilterGroup();
  return normalizeJobFilterCondition(valueOf(row, "filterCondition", "filter_condition"));
}

function initInputMappings(row: EvalJob | null) {
  if (!row) return {} as Record<string, Record<string, string>>;
  const selectedScorerIds = (row.scorers || []).map(scorerRefId);
  return normalizeJobInputMappings(
    valueOf(row, "inputMapping", "input_mapping"),
    selectedScorerIds,
  );
}

function initScorerVersions(row: EvalJob | null) {
  if (!row) return {} as Record<string, number | null>;
  return Object.fromEntries(
    (row.scorers || []).map((scorer) => [scorerRefId(scorer), scorerRefVersion(scorer)]),
  );
}

function applyPreset(preset: "rootSpans" | "llmCalls" | "toolCalls") {
  const presets: Record<string, { column: string; operator: string; value: string }> = {
    rootSpans: { column: "parent_span_id", operator: "=", value: "" },
    llmCalls: { column: "gen_ai_system", operator: "!=", value: "" },
    toolCalls: { column: "gen_ai_operation_name", operator: "=", value: "execute_tool" },
  };
  const cond = presets[preset];
  filterGroup.value = {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [
      {
        filterType: "condition",
        column: cond.column,
        operator: cond.operator,
        value: cond.value,
        values: [],
        logicalOperator: "AND",
      },
    ],
  } as any;
}

function syncMappings() {
  const { nextMappings, nextVersions } = syncJobInputMappings(
    form.value.scorerIds,
    props.scorers,
    inputMappings.value,
    scorerVersions.value,
  );
  inputMappings.value = nextMappings;
  scorerVersions.value = nextVersions;
}

async function save(activateAfter = false) {
  if (!props.orgId) return;
  if (!form.value.scorerIds.length) {
    showError(new Error(t("onlineEvals.job.selectAtLeastOne")), t("onlineEvals.job.saveError"));
    return;
  }

  isSaving.value = true;
  pendingActivateOnSave.value = activateAfter;
  try {
    const payload = {
      name: form.value.name,
      description: form.value.description || null,
      stream: form.value.stream,
      streamType: form.value.streamType,
      filterCondition: buildJobFilterConditionPayload(filterGroup.value),
      scorers: form.value.scorerIds.map((id) => ({ id, version: scorerVersions.value[id] ?? null })),
      inputMapping: buildJobInputMappingPayload(form.value.scorerIds, inputMappings.value),
      samplingMode: form.value.samplingMode as any,
      samplingValue: form.value.samplingMode === "all"
        ? null
        : parseJson(form.value.samplingValue, t("onlineEvals.job.samplingValueLabel")),
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.jobs.update(props.orgId, props.row.id, payload);
      toast({
        variant: "success",
        message: t("onlineEvals.saved", { label: t("onlineEvals.singular.jobs") }),
      });
    } else {
      const created = await onlineEvalsService.jobs.create(props.orgId, payload);
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
          message: t("onlineEvals.saved", { label: t("onlineEvals.singular.jobs") }),
        });
      }
    }
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.job.saveError"));
  } finally {
    isSaving.value = false;
    pendingActivateOnSave.value = false;
  }
}
</script>

<style lang="scss" scoped>
.job-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 10px;
}

.job-form__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  gap: 10px;
}

.job-form__main {
  min-width: 0;
  overflow: auto;
  padding: 18px 24px 24px;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 0.313rem 0.063rem var(--o2-hover-shadow);
}

.job-form__foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 0.313rem 0.063rem var(--o2-hover-shadow);
  flex-shrink: 0;
  z-index: 1;
}

.job-form__main :deep(textarea) {
  max-height: 200px;
  overflow-y: auto;
}

.job-form__main .job-field--desc :deep(textarea) {
  max-height: 120px;
}

.job-section {
  margin-bottom: 24px;
}

.job-section__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  margin-bottom: 12px;
}

.job-section__num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-weight: 700;
  font-size: 11px;
}

.job-section__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.job-field {
  margin-bottom: 12px;
}

.job-field__label {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  margin-bottom: 4px;
}

.job-field__req {
  color: var(--o2-status-error-text);
  margin-left: 2px;
}

.job-field__help {
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-top: 4px;
}

.job-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.job-field__lock {
  margin-left: 6px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-presets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 16px;
}

.job-presets__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.job-presets__chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 999px;
  background: var(--color-card-bg);
  color: var(--color-text-primary, currentColor);
  font: 500 11px inherit;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}

.job-presets__chip:hover {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 6%, var(--color-card-bg));
  color: var(--color-primary-600, #3F7994);
}

@media (max-width: 1100px) {
  .job-form__body {
    grid-template-columns: 1fr;
  }
  .job-field-row {
    grid-template-columns: 1fr;
  }
}
</style>
