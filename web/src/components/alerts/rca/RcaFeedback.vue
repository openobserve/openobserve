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

<!-- "Is this the cause?" (README §9, J4): Yes / No / Correct the cause on a
     finished graded run. Only the caller's own row is read and shown; other
     authors' feedback stays private. Undo deletes the caller's row.
     The root is `display: contents` inside the card's wrapping facts row: the
     segmented control ends that row, and the panels and the saved message take
     a full-width line under it (template layout). -->
<template>
  <div data-test="rca-feedback" class="contents">
    <div class="ms-auto flex flex-wrap items-center gap-2">
      <span :id="questionId" class="text-text-muted text-xs">
        {{ t("alerts.incidents.rcaFeedback.question") }}
      </span>
      <div
        role="group"
        :aria-labelledby="questionId"
        class="border-border-control rounded-default inline-flex overflow-hidden border"
      >
        <button
          v-for="option in options"
          :key="option.verdict"
          type="button"
          :data-test="`rca-feedback-${option.verdict}`"
          :aria-pressed="pressed === option.verdict"
          :disabled="busy"
          class="border-border-control h-7 cursor-pointer px-2.5 text-xs font-semibold not-first:border-s disabled:cursor-not-allowed disabled:opacity-60"
          :class="
            pressed === option.verdict
              ? 'bg-surface-accent text-text-heading'
              : 'bg-surface-base text-text-body hover:bg-surface-subtle-hover'
          "
          @click="choose(option.verdict)"
        >
          {{ option.label }}
        </button>
      </div>
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
          class="border-border-control inline-flex h-6.5 cursor-pointer items-center rounded-full border px-2.5 text-xs"
          :class="
            reasons.includes(reason)
              ? 'bg-surface-accent text-text-heading'
              : 'bg-surface-base text-text-body hover:bg-surface-subtle-hover'
          "
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
      />
      <div class="flex justify-end gap-2">
        <OButton data-test="rca-feedback-cancel" variant="ghost" size="sm" @click="closePanel">
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
      />
      <div class="flex justify-end gap-2">
        <OButton data-test="rca-feedback-cancel" variant="ghost" size="sm" @click="closePanel">
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
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OnCallResolveCauseForm from "@/components/oncall/OnCallResolveCauseForm.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import incidentsService, {
  type PutRcaFeedbackRequest,
  type RcaFeedback,
  type RcaFeedbackReason,
  type RcaFeedbackVerdict,
} from "@/services/incidents";
import type { ResolutionCause } from "@/ts/interfaces/oncall";

const props = defineProps<{
  orgId: string;
  incidentId: string;
  runId: string;
}>();

const { t } = useI18nTyped();
const questionId = useId();
const noPromptId = useId();

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

/** The caller's saved row, or null. */
const mine = ref<RcaFeedback | null>(null);
/** The open form: No (reasons) or Correct the cause. */
const panel = ref<"no" | "change" | null>(null);
const reasons = ref<RcaFeedbackReason[]>([]);
const cause = ref<ResolutionCause | "">("");
const note = ref("");
const loading = ref(false);
const saving = ref(false);
const undoing = ref(false);
const error = ref<I18nText | null>(null);
/** One request at a time: the GET, a save or an Undo. */
const busy = computed(() => loading.value || saving.value || undoing.value);

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

/** Each mount and run change reads the caller's row; a late answer for another run is dropped. */
let generation = 0;
const load = async () => {
  const current = ++generation;
  mine.value = null;
  panel.value = null;
  error.value = null;
  // A save or Undo still in flight belongs to the previous run: it must not keep this run busy.
  saving.value = false;
  undoing.value = false;
  if (!props.runId) return;
  loading.value = true;
  try {
    const response = await incidentsService.getRcaFeedback(
      props.orgId,
      props.incidentId,
      props.runId,
    );
    if (current === generation) mine.value = response.data.mine;
  } catch (failure) {
    console.error("Failed to load RCA feedback:", failure);
    if (current === generation) {
      error.value = errorText(failure, t("alerts.incidents.rcaFeedback.loadFailed"));
    }
  } finally {
    if (current === generation) loading.value = false;
  }
};

watch(() => [props.orgId, props.incidentId, props.runId], load, { immediate: true });

const choose = (verdict: RcaFeedbackVerdict) => {
  error.value = null;
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
  error.value = null;
};

const toggleReason = (reason: RcaFeedbackReason) => {
  reasons.value = reasons.value.includes(reason)
    ? reasons.value.filter((item) => item !== reason)
    : [...reasons.value, reason];
};

const save = async (body: PutRcaFeedbackRequest) => {
  if (busy.value) return;
  const current = generation;
  saving.value = true;
  error.value = null;
  try {
    const response = await incidentsService.putRcaFeedback(
      props.orgId,
      props.incidentId,
      props.runId,
      body,
    );
    if (current !== generation) return;
    mine.value = response.data;
    panel.value = null;
  } catch (failure) {
    console.error("Failed to save RCA feedback:", failure);
    if (current === generation) {
      error.value = errorText(failure, t("alerts.incidents.rcaFeedback.saveFailed"));
    }
  } finally {
    if (current === generation) saving.value = false;
  }
};

const undo = async () => {
  if (busy.value) return;
  const current = generation;
  undoing.value = true;
  error.value = null;
  try {
    await incidentsService.deleteRcaFeedback(props.orgId, props.incidentId, props.runId);
    if (current === generation) mine.value = null;
  } catch (failure) {
    console.error("Failed to undo RCA feedback:", failure);
    if (current === generation) {
      error.value = errorText(failure, t("alerts.incidents.rcaFeedback.undoFailed"));
    }
  } finally {
    if (current === generation) undoing.value = false;
  }
};
</script>
