<template>
  <form class="job-form flex flex-col flex-1 min-h-0 gap-2.5" @submit.prevent="save(false)">
    <AppPageHeader
      :back="{
        label: t('onlineEvals.job.backTo'),
        onClick: () => $emit('cancel'),
        dataTest: 'job-form-back-btn',
      }"
      class="px-3 border-b border-border-default"
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

    <div class="job-form__body flex-1 min-h-0 overflow-hidden flex gap-2">
      <div class="job-form__main flex-[6.5] min-w-0 min-h-0 overflow-auto flex flex-col gap-2 p-2">
        <!-- Target -->
        <section class="card-container border border-(--color-dialog-header-border,var(--color-border-default)) rounded-md overflow-hidden shrink-0">
          <div class="flex items-center py-[10px] px-3 border-b border-(--color-border-default,var(--color-border-default))">
            <div class="w-[3px] h-4 rounded-[2px] mr-2 shrink-0 bg-(--q-primary)" />
            <span class="text-[13px] font-semibold tracking-[0.01em] text-(--color-text-primary,currentColor)">{{ t("onlineEvals.job.targetSection") }}</span>
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
          <div class="job-field">
            <label class="flex items-center text-xs font-semibold text-(--color-text-primary,currentColor) mb-1">
              {{ t("onlineEvals.job.nameLabel") }}
              <span class="text-(--color-status-error-text) ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-(--color-text-secondary,var(--color-text-secondary))" />
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
            <label class="flex items-center text-xs font-semibold text-(--color-text-primary,currentColor) mb-1">
              {{ t("onlineEvals.job.streamLabel") }}
              <span class="text-(--color-status-error-text) ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-(--color-text-secondary,var(--color-text-secondary))" />
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
            <label class="flex items-center text-xs font-semibold text-(--color-text-primary,currentColor) mb-1">{{ t("onlineEvals.job.descriptionLabel") }}</label>
            <OInput
              v-model.trim="form.description"
              type="textarea"
              :placeholder="t('onlineEvals.job.descriptionPlaceholder')"
              size="sm"
              :rows="3"
              data-test="job-form-description-input"
            />
          </div>
          </div>
        </section>

        <!-- Scorers + Filter + Mapping -->
        <section class="card-container border border-(--color-dialog-header-border,var(--color-border-default)) rounded-md overflow-hidden shrink-0">
          <div class="flex items-center py-[10px] px-3 border-b border-(--color-border-default,var(--color-border-default))">
            <div class="w-[3px] h-4 rounded-[2px] mr-2 shrink-0 bg-(--q-primary)" />
            <span class="text-[13px] font-semibold tracking-[0.01em] text-(--color-text-primary,currentColor)">{{ t("onlineEvals.job.scorersSection") }}</span>
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
          <JobScorerPicker
            v-model="form.scorerIds"
            :scorers="scorers"
          />

          <JobFilterBuilder
            :group="filterGroup"
            @update:group="filterGroup = $event"
          />

          <JobInputMapping
            :selected-scorers="selectedScorers"
            :input-mappings="inputMappings"
            @update:input-mappings="inputMappings = $event"
          />
          </div>
        </section>

        <!-- Sampling -->
        <section class="card-container border border-(--color-dialog-header-border,var(--color-border-default)) rounded-md overflow-hidden shrink-0">
          <div class="flex items-center py-[10px] px-3 border-b border-(--color-border-default,var(--color-border-default))">
            <div class="w-[3px] h-4 rounded-[2px] mr-2 shrink-0 bg-(--q-primary)" />
            <span class="text-[13px] font-semibold tracking-[0.01em] text-(--color-text-primary,currentColor)">{{ t("onlineEvals.job.stepper.sampling") }}</span>
          </div>
          <div class="flex flex-col gap-3 py-3.5 px-4">
          <div class="job-field-row grid grid-cols-2 max-[1100px]:grid-cols-1 gap-[14px]">
            <div class="job-field">
              <label class="flex items-center text-xs font-semibold text-(--color-text-primary,currentColor) mb-1">{{ t("onlineEvals.job.samplingModeLabel") }}</label>
              <OSelect
                v-model="form.samplingMode"
                :options="samplingModeOptions"
                size="md"
                data-test="job-form-sampling-mode-select"
              />
              <div class="job-field__help text-[11.5px] text-(--color-text-secondary,var(--color-text-secondary)) mt-1">{{ t("onlineEvals.job.samplingHelp") }}</div>
            </div>

            <div class="job-field">
              <label class="flex items-center text-xs font-semibold text-(--color-text-primary,currentColor) mb-1">
                {{ t("onlineEvals.job.samplingValueLabel") }}
                <span v-if="form.samplingMode !== 'all'" class="text-(--color-status-error-text) ml-0.5">*</span>
              </label>
              <OInput
                v-model="form.samplingValue"
                size="sm"
                :disabled="form.samplingMode === 'all'"
                data-test="job-form-sampling-value-input"
              />
              <div class="job-field__help text-[11.5px] text-(--color-text-secondary,var(--color-text-secondary)) mt-1">
                {{ form.samplingMode === 'all'
                  ? t("onlineEvals.job.samplingValueAllHelp")
                  : t("onlineEvals.job.samplingValueHelp") }}
              </div>
            </div>
          </div>
          </div>
        </section>
      </div>

      <JobPreviewPanel
        :name="form.name"
        :stream-type="form.streamType"
        :mode="mode"
        :stream="form.stream"
        :filter-where="filterWhere"
        :filter-ready="filterReady"
      />
    </div>

    <footer class="sticky bottom-0 flex items-center justify-end gap-2 px-5.5 py-3 bg-(--color-surface-base) rounded-md shadow-[0_0_0.313rem_0.063rem_var(--color-hover-shadow)] shrink-0 z-1">
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

// Pauses the match-count query while a condition is half-filled (column picked
// but value still empty), so we don't query on every keystroke / partial edit.
const filterReady = computed<boolean>(() =>
  isJobFilterComplete(filterGroup.value),
);

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

<style lang="scss">
// Layout, spacing, colors, and text styling are Tailwind utilities in the
// template. Only descendant/`:deep` selectors (targeting child-component
// internals) and the responsive @media block remain here.
.job-form__main :deep(textarea) {
  max-height: 200px;
  overflow-y: auto;
}

.job-form__main .job-field--desc :deep(textarea) {
  max-height: 120px;
}

@media (max-width: 1100px) {
  .job-form__body {
    flex-direction: column;
  }
  .job-form__main {
    flex: 1 1 auto;
  }
  .job-field-row {
    grid-template-columns: 1fr;
  }
}
</style>
