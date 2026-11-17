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
  <DecisionDismissDialog
    v-if="mode !== 'compat'"
    :open="open"
    :target="decisionTarget"
    :transport="mode"
    :refresh="refresh"
    @update:open="emit('update:open', $event)"
  />
  <ODialog
    v-else
    :open="open"
    size="md"
    :title="copy.title(finding.alert_name)"
    :form-id="formId"
    :primary-button-label="copy.button()"
    primary-button-data-test="alert-calibration-dismiss-submit"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    data-test="alert-calibration-dismiss-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm :id="formId" :form="form">
      <div class="flex flex-col gap-4">
        <OBanner
          dense
          class="min-h-20 justify-center"
          :variant="notice?.variant ?? 'default'"
          :icon="NOTICE_ICON[notice?.variant ?? 'default']"
          :data-severity="notice?.variant ?? 'default'"
          data-test="alert-calibration-dismiss-notice"
        >
          {{ notice?.text ?? copy.scopeLine(orgName, duration, openedAt) }}
        </OBanner>

        <div class="flex flex-col gap-1">
          <span class="text-input-label-text text-compact leading-tight font-medium">
            {{ t("alertCalibration.dismiss.reason") }}
          </span>
          <OFormRadioGroup
            name="reason"
            :label="t('alertCalibration.dismiss.reason')"
            required
            :disabled="submitting"
            data-test="alert-calibration-dismiss-reason"
          >
            <ORadio
              v-for="reason in DISMISS_REASONS"
              :key="reason"
              :value="reason"
              :label="copy.reasonLabel(reason)"
              :data-test="`alert-calibration-dismiss-reason-${reason}`"
            />
          </OFormRadioGroup>
        </div>

        <OFormTextarea
          name="note"
          :label="t('alertCalibration.dismiss.note')"
          :help-text="t('alertCalibration.dismiss.noteHelp')"
          :maxlength="NOTE_MAX_CHARS"
          :rows="3"
          :required="reason === 'other'"
          :disabled="submitting"
          data-test="alert-calibration-dismiss-note"
        />

        <div class="flex flex-col gap-1">
          <OFormOptionGroup
            name="duration"
            type="radio"
            orientation="horizontal"
            :label="t('alertCalibration.dismiss.duration')"
            :options="durationOptions"
            :disabled="submitting"
            data-test="alert-calibration-dismiss-duration"
          />
          <OText variant="meta" as="p" data-test="alert-calibration-dismiss-ends">
            {{ copy.endsLine(duration, openedAt) }}
          </OText>
        </div>
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormOptionGroup from "@/lib/forms/OptionGroup/OFormOptionGroup.vue";
import type { OptionGroupOption } from "@/lib/forms/OptionGroup/OOptionGroup.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query";
import { useI18nTyped } from "@/types/i18n";
import { httpStatus } from "@/services/alert_calibration";
import { dismissFindingMutation } from "@/services/alert_calibration.queries";
import { alertCalibrationKeys } from "@/services/alert_calibration.querykeys";
import { useReopenDismissal } from "@/composables/alertCalibration/useDismissals";
import {
  useDecisionRoute,
  type DecisionTransport,
} from "@/composables/autoobserve/useDecisionRoute";
import DecisionDismissDialog from "@/components/autoobserve/decisions/DecisionDismissDialog.vue";
import type { DecisionTarget } from "@/components/autoobserve/decisions/decisionDismiss";
import { dismissDefaults, makeDismissSchema } from "./AlertCalibrationDismissDialog.schema";
import {
  dismissalCopy,
  dismissBodyOf,
  DISMISS_REASONS,
  DURATION_OPTIONS,
  NOTE_MAX_CHARS,
  type DismissForm,
  type DismissTarget,
  type WriteNotice,
} from "./dismissals";

const NOTICE_ICON = { default: "info", error: "error", warning: "warning" } as const;

const props = defineProps<{
  open: boolean;
  finding: DismissTarget;
  /** Re-reads the records behind the dialog after a 404 or 409. */
  refresh?: () => void;
}>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t, locale } = useI18nTyped();
const orgId = useOrgId();
const store = useStore();
const queryClient = useQueryClient();
const { reopen } = useReopenDismissal();
const orgName = computed<string>(() => store.state.selectedOrganization?.label || orgId.value);
const copy = computed(() => dismissalCopy(t, locale.value));
const formId = `alert-calibration-dismiss-${useId()}`;
const dismiss = useMutation(() => dismissFindingMutation(orgId.value));
const notice = ref<WriteNotice | null>(null);
const openedAt = ref(Date.now());

const form = useOForm<DismissForm>({
  defaultValues: dismissDefaults(),
  schema: makeDismissSchema(t),
  onSubmit: submit,
});
const reason = form.useStore((s) => s.values.reason);
const duration = form.useStore((s) => s.values.duration);
const submitting = form.useStore((s) => s.isSubmitting);

const decisionRoute = useDecisionRoute();
const mode = ref<DecisionTransport>(decisionRoute.transport.value);
const decisionTarget = computed<DecisionTarget>(() => ({
  family: "alert_finding",
  id: props.finding.finding_id,
  title: props.finding.alert_name ?? null,
}));
// A form the reader can fill keeps its transport while open; only a check still pending or failed resolves in place.
watch(decisionRoute.transport, (next) => {
  if (!props.open || mode.value === "pending" || mode.value === "failed") mode.value = next;
});
watch(
  () => props.open,
  (open, was) => {
    if (!open || was) return;
    mode.value = decisionRoute.transport.value;
    if (mode.value === "failed") void decisionRoute.probe.refetch();
  },
);

const durationOptions = computed<OptionGroupOption[]>(() =>
  DURATION_OPTIONS.map((value) => ({ value, label: copy.value.durationLabel(value) })),
);

/** The form keeps every entry on failure, so Dismiss is the retry. */
async function submit(values: DismissForm) {
  try {
    const view = await dismiss.mutateAsync({
      findingId: props.finding.finding_id,
      body: dismissBodyOf(props.finding, values),
    });
    notice.value = null;
    emit("update:open", false);
    const alert = props.finding.alert_name;
    toast({
      message: copy.value.savedWithUndo(view, alert),
      variant: "success",
      action: { label: copy.value.undo(), handler: () => void reopen(view) },
    });
  } catch (error) {
    notice.value = copy.value.writeError(error);
    const status = httpStatus(error);
    if (status === 404 || status === 409) {
      void queryClient.invalidateQueries({
        queryKey: alertCalibrationKeys.dismissals(orgId.value),
      });
      props.refresh?.();
    }
  }
}

// Only a fresh open starts over; an error never clears what the user entered.
watch(
  () => props.open,
  (open, was) => {
    if (!open || was) return;
    form.reset();
    notice.value = null;
    openedAt.value = Date.now();
  },
);
</script>
