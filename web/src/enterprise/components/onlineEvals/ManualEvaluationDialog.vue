<template>
  <ODialog
    :open="open"
    size="sm"
    :title="dialogTitle"
    :primary-button-label="t('onlineEvals.manualEvaluation.run')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="loadingJobs || jobOptions.length === 0"
    :form-id="formId"
    data-test="manual-evaluation-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1">
        <p class="text-sm text-text-body">
          {{ t("onlineEvals.manualEvaluation.description") }}
        </p>
        <p class="text-xs text-text-secondary break-all">
          {{ targetLabel }}: <span class="font-mono">{{ targetId }}</span>
        </p>
      </div>

      <OBanner
        v-if="loadError"
        variant="error-soft"
        dense
        data-test="manual-evaluation-jobs-error"
      >
        {{ loadError }}
      </OBanner>

      <OBanner
        v-else-if="!loadingJobs && jobOptions.length === 0"
        variant="info"
        dense
        data-test="manual-evaluation-no-jobs"
      >
        {{
          t("onlineEvals.manualEvaluation.noCompatibleJobs", {
            scope: targetScopeLabel,
            stream,
          })
        }}
      </OBanner>

      <OForm
        :id="formId"
        :form="form"
        class="flex flex-col gap-5"
      >
        <OFormSelect
          name="jobId"
          :label="t('onlineEvals.manualEvaluation.jobLabel')"
          :placeholder="t('onlineEvals.manualEvaluation.jobPlaceholder')"
          :options="jobOptions"
          :loading="loadingJobs"
          :disabled="loadingJobs || jobOptions.length === 0"
          required
          size="md"
          data-test="manual-evaluation-job-select"
        />
      </OForm>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import onlineEvalsService, {
  type EvalJob,
  type EvalTargetScope,
  type ManualEvalJobResult,
} from "@/services/online-evals.service";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeManualEvaluationDialogSchema,
  type ManualEvaluationDialogForm,
} from "./ManualEvaluationDialog.schema";

const props = defineProps<{
  open: boolean;
  orgId: string;
  stream: string;
  targetScope: EvalTargetScope;
  targetId: string;
  startTime: number;
  endTime: number;
  traceId?: string;
  sessionId?: string;
}>();

const emit = defineEmits<{
  (event: "update:open", open: boolean): void;
  (event: "submitted", result: ManualEvalJobResult): void;
}>();

const { t } = useI18n();
const formId = "manual-evaluation-form";
const loadedJobs = ref<EvalJob[]>([]);
const loadingJobs = ref(false);
const loadError = ref("");
const compatibleJobs = computed(() => loadedJobs.value.filter(isCompatibleJob));
const jobOptions = computed(() =>
  compatibleJobs.value.map((job) => ({
    label: job.name,
    value: job.id,
  })),
);

const targetScopeLabel = computed(() =>
  t(`onlineEvals.manualEvaluation.scopes.${props.targetScope}`),
);
const targetLabel = computed(() =>
  t(`onlineEvals.manualEvaluation.targetLabels.${props.targetScope}`),
);
const dialogTitle = computed(() =>
  t(`onlineEvals.manualEvaluation.titles.${props.targetScope}`),
);

const form = useOForm<ManualEvaluationDialogForm>({
  defaultValues: { jobId: "" },
  schema: makeManualEvaluationDialogSchema(t),
  onSubmit,
});

function isCompatibleJob(job: EvalJob): boolean {
  const scope = job.targetScope ?? job.target_scope;
  const streamType = job.streamType ?? job.stream_type ?? "traces";
  return (
    job.status !== "archived" &&
    job.stream === props.stream &&
    streamType === "traces" &&
    scope === props.targetScope &&
    job.scorers.length > 0
  );
}

async function loadJobs(): Promise<void> {
  loadingJobs.value = true;
  loadError.value = "";
  loadedJobs.value = [];
  form.reset({ jobId: "" });
  try {
    loadedJobs.value = await onlineEvalsService.jobs.list(props.orgId);
    if (compatibleJobs.value.length === 1) {
      form.setFieldValue("jobId", compatibleJobs.value[0].id);
    }
  } catch {
    loadError.value = t("onlineEvals.manualEvaluation.loadJobsError");
  } finally {
    loadingJobs.value = false;
  }
}

async function onSubmit(value: ManualEvaluationDialogForm): Promise<void> {
  try {
    const result = await onlineEvalsService.jobs.manualEval(
      props.orgId,
      value.jobId,
      {
        targetId: props.targetId,
        startTime: props.startTime,
        endTime: props.endTime,
        spanId: props.targetScope === "span" ? props.targetId : undefined,
        traceId:
          props.targetScope === "trace" ? props.targetId : props.traceId,
        sessionId:
          props.targetScope === "session" ? props.targetId : props.sessionId,
      },
    );
    toast({
      variant: "success",
      message: t("onlineEvals.manualEvaluation.queued", {
        count: result.tasksCreated,
      }),
    });
    emit("submitted", result);
    emit("update:open", false);
  } catch {
    toast({
      variant: "error",
      message: t("onlineEvals.manualEvaluation.runError"),
    });
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadJobs();
  },
  { immediate: true },
);
</script>
