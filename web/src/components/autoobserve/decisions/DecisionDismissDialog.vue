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
  <ODialog
    :open="open"
    size="md"
    :title="copy.dismissTitle(subjectTitle)"
    :form-id="formId"
    :primary-button-label="copy.dismissButton()"
    primary-button-data-test="decision-dismiss-submit"
    :primary-button-disabled="!canSubmit"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    data-test="decision-dismiss-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <!-- The schema words a bad end date; the browser's own bubble would use another date format. -->
    <OForm :id="formId" :form="form" novalidate>
      <div class="flex flex-col gap-3">
        <!-- A refused reader can choose nothing, so only the refusal is shown. -->
        <template v-if="!locked">
          <OFormRadioGroup
            name="reason"
            :label="t('insight.decisions.dismiss.reason')"
            required
            :disabled="!ready || !!locked || submitting"
            data-test="decision-dismiss-reason"
          >
            <template v-for="option in DECISION_DISMISS_REASONS" :key="option">
              <ORadio
                :value="option"
                :label="copy.reasonLabel(option)"
                :data-test="`decision-dismiss-reason-${option}`"
              />
              <!-- One message line under the fields is reserved, so a refused date or time never grows the dialog. -->
              <div
                v-if="option === 'planned_work'"
                class="flex min-h-16.25 flex-wrap items-start gap-2 ps-6"
                data-test="decision-dismiss-until"
              >
                <OFormDate
                  class="min-w-36 flex-1"
                  name="untilDate"
                  :label="t('insight.decisions.dismiss.untilDate')"
                  :min="firstDay"
                  :max="lastDay"
                  size="sm"
                  :disabled="untilDisabled"
                  data-test="decision-dismiss-until-date"
                />
                <OFormTime
                  class="min-w-28 flex-1"
                  name="untilTime"
                  :label="t('insight.decisions.dismiss.untilTime')"
                  format24
                  size="sm"
                  :disabled="untilDisabled"
                  data-test="decision-dismiss-until-time"
                />
              </div>
              <OText
                v-if="option === 'false_positive'"
                variant="meta"
                as="p"
                class="ps-6"
                data-test="decision-dismiss-false-positive-help"
              >
                {{ t("insight.decisions.dismiss.falsePositiveHelp") }}
              </OText>
            </template>
          </OFormRadioGroup>

          <template v-if="isFinding">
            <OFormOptionGroup
              name="duration"
              type="radio"
              orientation="horizontal"
              :label="t('alertCalibration.dismiss.duration')"
              :options="durationOptions"
              :disabled="durationDisabled"
              data-test="decision-dismiss-duration"
            />
            <OFormTextarea
              name="note"
              :label="t('alertCalibration.dismiss.note')"
              :help-text="t('insight.decisions.dismiss.noteHelp')"
              :maxlength="NOTE_MAX_CHARS"
              :rows="2"
              :disabled="!ready || !!locked || submitting"
              data-test="decision-dismiss-note"
            />
          </template>
        </template>

        <div
          class="flex flex-col gap-1"
          :class="{ 'border-border-default min-h-16 border-t pt-3': !locked }"
          data-test="decision-dismiss-effect"
          :data-state="effectState"
        >
          <p
            v-if="notice"
            class="flex items-start gap-1 text-sm"
            :class="
              notice.variant === 'warning' ? 'text-status-warning-text' : 'text-status-error-text'
            "
            :data-severity="notice.variant"
            data-test="decision-dismiss-notice"
          >
            <OIcon :name="notice.variant === 'warning' ? 'warning' : 'error'" size="xs" />
            <span>{{ notice.text }}</span>
          </p>
          <p
            v-else-if="locked"
            class="text-status-error-text flex items-start gap-1 text-sm"
            data-severity="error"
            data-test="decision-dismiss-locked"
          >
            <OIcon name="lock" size="xs" class="mt-0.5" />
            <span>{{ copy.refusalText(locked) }}</span>
          </p>
          <p
            v-else-if="effectState === 'error'"
            class="text-status-error-text flex items-start gap-1 text-sm"
            data-severity="error"
          >
            <OIcon name="error" size="xs" class="mt-0.5" />
            <span>{{ effectText }}</span>
          </p>
          <p v-else class="text-text-secondary text-xs">{{ effectText }}</p>
        </div>
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useStore } from "vuex";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OFormDate from "@/lib/forms/Date/OFormDate.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";
import OFormOptionGroup from "@/lib/forms/OptionGroup/OFormOptionGroup.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import type { OptionGroupOption } from "@/lib/forms/OptionGroup/OOptionGroup.types";
import { useOrgId } from "@/composables/query";
import { useI18nTyped } from "@/types/i18n";
import { refusalOf, type Refusal } from "@/services/autoobserveDecisions";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import {
  decisionPreviewQuery,
  newRequestId,
  useDecisionRoute,
  type DecisionTransport,
} from "@/composables/autoobserve/useDecisionRoute";
import { decisionCopy, type DecisionNotice } from "@/components/autoobserve/insight/insightCopy";
import {
  dismissalCopy,
  DURATION_OPTIONS,
  NOTE_MAX_CHARS,
} from "@/components/alert_calibration/dismissals";
import {
  DECISION_DISMISS_REASONS,
  PLANNED_WORK_MAX_MS,
  decisionBodyOf,
  decisionDismissDefaults,
  localDate,
  makeDecisionDismissSchema,
  previewParamsOf,
  type DecisionDismissForm,
  type DecisionTarget,
} from "./decisionDismiss";

const props = defineProps<{
  open: boolean;
  target: DecisionTarget;
  /** Re-reads the records behind the dialog after a 404 or 409. */
  refresh?: () => void;
  /** Until the switch answers, nothing can be chosen or written. */
  transport?: Exclude<DecisionTransport, "compat">;
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t, locale } = useI18nTyped();
const orgId = useOrgId();
const store = useStore();
const queryClient = useQueryClient();
const route = useDecisionRoute();
const copy = computed(() => decisionCopy(t, locale.value));
const orgName = computed<string>(() => store.state.selectedOrganization?.label || orgId.value);
const formId = `decision-dismiss-${useId()}`;
const openedAt = ref(Date.now());
// One id per opening, so a double click or a retry after a lost answer writes once.
const requestId = ref(newRequestId());
const notice = ref<DecisionNotice | null>(null);
const refused = ref<Refusal | null>(null);

const form = useOForm<DecisionDismissForm>({
  defaultValues: decisionDismissDefaults(openedAt.value),
  schema: makeDecisionDismissSchema(t, Date.now, () => props.target.family),
  onSubmit: submit,
});
const values = form.useStore((s) => s.values);
const submitting = form.useStore((s) => s.isSubmitting);
// A refused typed end time leaves the old time in the values, so the term on screen isn't the one shown.
const untilTimeRefused = form.useStore(
  (s) => s.values.reason === "planned_work" && (s.fieldMeta.untilTime?.errors?.length ?? 0) > 0,
);

const firstDay = computed(() => localDate(openedAt.value));
const lastDay = computed(() => localDate(openedAt.value + PLANNED_WORK_MAX_MS));
const ready = computed(() => (props.transport ?? "decision") === "decision");
const untilDisabled = computed(
  () =>
    !ready.value || values.value.reason !== "planned_work" || !!locked.value || submitting.value,
);
const isFinding = computed(() => props.target.family === "alert_finding");
// Planned work ends at its chosen time, and the route refuses a length beside it.
const durationDisabled = computed(
  () =>
    !ready.value || values.value.reason === "planned_work" || !!locked.value || submitting.value,
);
const durationOptions = computed<OptionGroupOption[]>(() => {
  const labels = dismissalCopy(t, locale.value);
  return DURATION_OPTIONS.map((value) => ({ value, label: labels.durationLabel(value) }));
});

const params = computed(() => previewParamsOf(props.target, values.value, openedAt.value));
const preview = useQuery(() => ({
  ...decisionPreviewQuery(orgId.value, params.value),
  enabled: props.open && ready.value,
}));

const subjectTitle = computed(() => preview.data.value?.subject.title || props.target.title);
const locked = computed<Refusal | null>(() => {
  if (refused.value) return refused.value;
  const data = preview.data.value;
  return data && !data.may ? (data.locked ?? null) : null;
});
const effectState = computed(() => {
  if (notice.value) return notice.value.variant;
  if (locked.value) return "locked";
  if (props.transport === "failed") return "error";
  if (preview.error.value && !preview.data.value) return "error";
  if (!preview.data.value) return "loading";
  // Without a reason or with an end out of range the preview is of another term, so it is not shown as this one's.
  return "reason" in params.value && !untilTimeRefused.value ? "ready" : "incomplete";
});
const effectText = computed(() => {
  if (effectState.value === "error") return t("insight.decisions.dismiss.effectFailed");
  if (effectState.value === "incomplete") return t("insight.decisions.dismiss.effectNeedsChoice");
  const data = preview.data.value;
  return data
    ? copy.value.effect(data, orgName.value)
    : t("insight.decisions.dismiss.effectLoading");
});
/** Nothing is written until the reader has seen what it changes. */
const canSubmit = computed(
  () =>
    ready.value &&
    !!preview.data.value?.may &&
    !refused.value &&
    !preview.isPlaceholderData.value &&
    !untilTimeRefused.value,
);

async function submit(form: DecisionDismissForm) {
  const data = preview.data.value;
  if (!ready.value || !data?.may) return;
  try {
    await route.decide(
      decisionBodyOf(props.target, form, { requestId: requestId.value, revision: data.revision }),
      subjectTitle.value ?? null,
    );
    notice.value = null;
    emit("update:open", false);
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal) {
      refused.value = refusal;
      notice.value = { variant: "error", text: copy.value.writeError(error).text };
      return;
    }
    notice.value = copy.value.writeError(error);
    const status = (error as { response?: { status?: number } } | null)?.response?.status;
    if (status === 404 || status === 409) {
      void queryClient.invalidateQueries({
        queryKey: autoobserveKeys.decisionPreview(orgId.value, { ...params.value }),
      });
      props.refresh?.();
    }
  }
}

// Only a fresh open starts over; an error never clears what the reader entered.
watch(
  () => props.open,
  (open, was) => {
    if (!open || was) return;
    openedAt.value = Date.now();
    requestId.value = newRequestId();
    form.reset(decisionDismissDefaults(openedAt.value));
    notice.value = null;
    refused.value = null;
  },
);
</script>
