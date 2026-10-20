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
  <div data-test="rca-feedback" class="contents">
    <div class="ms-auto flex flex-wrap items-center gap-2">
      <span :id="questionId" class="text-text-muted text-xs">
        {{ t("alerts.incidents.rcaFeedback.question") }}
      </span>
      <OToggleGroup :model-value="pressed ?? ''" :disabled="busy" :aria-labelledby="questionId">
        <OToggleGroupItem
          v-for="option in options"
          :key="option.verdict"
          :value="option.verdict"
          :data-test="`rca-feedback-${option.verdict}`"
          size="sm"
          @click="choose(option.verdict)"
        >
          {{ option.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- No: reasons, an optional note, Send feedback. -->
    <div
      v-if="panel === 'no'"
      data-test="rca-feedback-no-panel"
      class="rounded-default border-border-default bg-surface-base flex basis-full flex-col gap-2 border p-3"
    >
      <span :id="noPromptId" class="text-text-secondary text-xs">{{
        t("alerts.incidents.rcaFeedback.noPrompt")
      }}</span>
      <div class="flex flex-wrap gap-1.5" role="group" :aria-labelledby="noPromptId">
        <button
          v-for="reason in REASONS"
          :key="reason"
          type="button"
          :data-test="`rca-feedback-chip-${reason}`"
          :aria-pressed="reasons.includes(reason)"
          class="border-border-control inline-flex h-6.5 cursor-pointer items-center rounded-full border px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            reasons.includes(reason)
              ? 'bg-surface-accent text-text-heading'
              : 'bg-surface-base text-text-body hover:bg-surface-subtle-hover'
          "
          :disabled="busy"
          @click="toggleReason(reason)"
        >
          {{ t(`alerts.incidents.rcaFeedback.reason.${reason}`) }}
        </button>
      </div>
      <OTextarea
        v-model="note"
        data-test="rca-feedback-note"
        :label="t('alerts.incidents.rcaFeedback.noteLabel')"
        :placeholder="t('alerts.incidents.rcaFeedback.notePlaceholder')"
        :rows="2"
        :maxlength="MAX_NOTE_CHARS"
        :disabled="busy"
      />
      <div class="flex justify-end gap-2">
        <OButton
          data-test="rca-feedback-cancel"
          variant="ghost"
          size="sm"
          :disabled="busy"
          @click="closePanel"
        >
          {{ t("alerts.incidents.rcaFeedback.cancel") }}
        </OButton>
        <OButton
          data-test="rca-feedback-send"
          variant="primary"
          size="sm"
          :loading="saving"
          @click="save({ verdict: 'no', reasons, note: trimmedNote })"
        >
          {{ t("alerts.incidents.rcaFeedback.send") }}
        </OButton>
      </div>
    </div>

    <!-- Correct the cause: the on-call cause form, without "still unknown". -->
    <div
      v-else-if="panel === 'change'"
      data-test="rca-feedback-change-panel"
      class="rounded-default border-border-default bg-surface-base flex basis-full flex-col gap-2 border p-3"
    >
      <OnCallResolveCauseForm
        v-model:cause="cause"
        v-model:note="note"
        data-test-prefix="rca-feedback-change"
        :cause-label="t('alerts.incidents.rcaFeedback.changeLabel')"
        :cause-hint="null"
        :note-label="t('alerts.incidents.rcaFeedback.changeNoteLabel')"
        :exclude-causes="['still_unknown']"
        :note-maxlength="MAX_NOTE_CHARS"
        :disabled="busy"
      />
      <div class="flex justify-end gap-2">
        <OButton
          data-test="rca-feedback-cancel"
          variant="ghost"
          size="sm"
          :disabled="busy"
          @click="closePanel"
        >
          {{ t("alerts.incidents.rcaFeedback.cancel") }}
        </OButton>
        <OButton
          data-test="rca-feedback-save"
          variant="primary"
          size="sm"
          :disabled="!cause"
          :loading="saving"
          @click="cause && save({ verdict: 'change', cause, note: trimmedNote })"
        >
          {{ t("alerts.incidents.rcaFeedback.save") }}
        </OButton>
      </div>
    </div>

    <p
      v-else-if="savedMessage"
      data-test="rca-feedback-message"
      class="text-text-body m-0 flex basis-full items-center gap-1.5 text-xs"
    >
      <OIcon name="check-circle" size="xs" class="text-status-positive" />
      {{ savedMessage }}
      <OButton
        data-test="rca-feedback-undo"
        variant="ghost"
        size="sm"
        :loading="undoing"
        :disabled="saving"
        @click="undo"
      >
        {{ t("alerts.incidents.rcaFeedback.undo") }}
      </OButton>
    </p>

    <p
      v-if="error"
      data-test="rca-feedback-error"
      role="alert"
      class="text-status-error-text m-0 basis-full text-xs"
    >
      {{ error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OnCallResolveCauseForm from "@/components/oncall/OnCallResolveCauseForm.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  ListRcaFeedbackResponse,
  PutRcaFeedbackRequest,
  RcaFeedbackReason,
  RcaFeedbackVerdict,
} from "@/services/incidents";
import {
  deleteRcaFeedbackMutation,
  putRcaFeedbackMutation,
  rcaFeedbackQuery,
} from "@/services/incidents.queries";
import { incidentKeys } from "@/services/incidents.querykeys";
import type { ResolutionCause } from "@/ts/interfaces/oncall";

const props = defineProps<{
  orgId: string;
  incidentId: string;
  runId: string;
}>();

const { t } = useI18nTyped();
const questionId = useId();
const noPromptId = useId();
const queryClient = useQueryClient();

/** The server's note limit (J2). */
const MAX_NOTE_CHARS = 1000;

const REASONS: RcaFeedbackReason[] = [
  "wrong_service",
  "symptom_not_cause",
  "evidence_does_not_hold",
  "missed_change",
];

const options = computed<{ verdict: RcaFeedbackVerdict; label: I18nText }[]>(() => [
  { verdict: "yes", label: t("alerts.incidents.rcaFeedback.yes") },
  { verdict: "no", label: t("alerts.incidents.rcaFeedback.no") },
  { verdict: "change", label: t("alerts.incidents.rcaFeedback.change") },
]);

const read = useQuery(() =>
  Object.assign(rcaFeedbackQuery(props.orgId, props.incidentId, props.runId), {
    enabled: !!props.runId,
  }),
);
const saveMutation = useMutation(() =>
  putRcaFeedbackMutation(props.orgId, props.incidentId, props.runId),
);
const undoMutation = useMutation(() =>
  deleteRcaFeedbackMutation(props.orgId, props.incidentId, props.runId),
);

/** The caller's saved row, or null. */
const mine = computed(() => read.data.value?.mine ?? null);
/** The open form: No (reasons) or Correct the cause. */
const panel = ref<"no" | "change" | null>(null);
const reasons = ref<RcaFeedbackReason[]>([]);
const cause = ref<ResolutionCause | "">("");
const note = ref("");
const saving = computed(() => saveMutation.isPending.value);
const undoing = computed(() => undoMutation.isPending.value);
/** A write's failure; a read failure comes from the query. */
const writeError = ref<I18nText | null>(null);
/** One request at a time: the read, a save or an Undo. */
const busy = computed(() => read.isLoading.value || saving.value || undoing.value);

const trimmedNote = computed(() => note.value.trim() || undefined);

const pressed = computed<RcaFeedbackVerdict | null>(
  () => panel.value ?? mine.value?.verdict ?? null,
);

const savedMessage = computed<I18nText | null>(() => {
  switch (mine.value?.verdict) {
    case "yes":
      return t("alerts.incidents.rcaFeedback.yesSaved");
    case "no":
      return t("alerts.incidents.rcaFeedback.noSaved");
    case "change":
      return mine.value.subject_type === "alert"
        ? t("alerts.incidents.rcaFeedback.changeSavedAlert")
        : t("alerts.incidents.rcaFeedback.changeSavedIncident");
    default:
      return null;
  }
});

const errorText = (failure: unknown, fallback: I18nText): I18nText => {
  const status = isAxiosError(failure) ? failure.response?.status : undefined;
  if (status === 403) return t("alerts.incidents.rcaFeedback.forbidden");
  if (status === 409) return t("alerts.incidents.rcaFeedback.notRateable");
  const body: unknown = isAxiosError(failure) ? failure.response?.data : null;
  const message =
    body && typeof body === "object" && "message" in body && typeof body.message === "string"
      ? body.message
      : "";
  return message ? raw(message) : fallback;
};

const error = computed<I18nText | null>(() => {
  if (writeError.value) return writeError.value;
  const failure = read.error.value;
  return failure ? errorText(failure, t("alerts.incidents.rcaFeedback.loadFailed")) : null;
});

watch(read.error, (failure) => {
  if (failure) console.error("Failed to load RCA feedback:", failure);
});

// Another run starts with its own row and a closed form; the old run's writes no longer hold it busy.
watch(
  () => [props.orgId, props.incidentId, props.runId],
  () => {
    panel.value = null;
    writeError.value = null;
    saveMutation.reset();
    undoMutation.reset();
  },
);

const choose = (verdict: RcaFeedbackVerdict) => {
  writeError.value = null;
  if (verdict === "yes") {
    if (mine.value?.verdict !== "yes") void save({ verdict: "yes" });
    else panel.value = null;
    return;
  }
  if (panel.value === verdict) {
    closePanel();
    return;
  }
  // Reopening a saved state shows the saved values.
  const saved = mine.value?.verdict === verdict ? mine.value : null;
  reasons.value = verdict === "no" ? [...(saved?.reasons ?? [])] : [];
  cause.value = verdict === "change" ? (saved?.cause ?? "") : "";
  note.value = saved?.note ?? "";
  panel.value = verdict;
};

const closePanel = () => {
  panel.value = null;
  writeError.value = null;
};

const toggleReason = (reason: RcaFeedbackReason) => {
  reasons.value = reasons.value.includes(reason)
    ? reasons.value.filter((item) => item !== reason)
    : [...reasons.value, reason];
};

/** Puts the caller's row into that run's cached read, so the form shows it before the refetch. */
const setMine = (runId: string, row: ListRcaFeedbackResponse["mine"]) => {
  queryClient.setQueryData<ListRcaFeedbackResponse>(
    incidentKeys.rcaFeedback(props.orgId, props.incidentId, runId),
    (current) => ({ items: current?.items ?? [], mine: row }),
  );
};

const save = async (body: PutRcaFeedbackRequest) => {
  if (busy.value) return;
  const runId = props.runId;
  writeError.value = null;
  try {
    const row = await saveMutation.mutateAsync(body);
    setMine(runId, row);
    if (runId === props.runId) panel.value = null;
  } catch (failure) {
    console.error("Failed to save RCA feedback:", failure);
    if (runId === props.runId) {
      writeError.value = errorText(failure, t("alerts.incidents.rcaFeedback.saveFailed"));
    }
  }
};

const undo = async () => {
  if (busy.value) return;
  const runId = props.runId;
  writeError.value = null;
  try {
    await undoMutation.mutateAsync();
    setMine(runId, null);
  } catch (failure) {
    console.error("Failed to undo RCA feedback:", failure);
    if (runId === props.runId) {
      writeError.value = errorText(failure, t("alerts.incidents.rcaFeedback.undoFailed"));
    }
  }
};
</script>
