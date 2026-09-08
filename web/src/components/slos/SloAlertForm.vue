<!--
  Copyright 2026 OpenObserve Inc.

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

<!--
  Authoring for an SLO alert, on the SLO page (Feature 5, Phase 1.1).

  Everything query-shaped is absent by construction rather than hidden: this
  family runs no query, so there is no stream, no lookback window and no count
  gate. What remains is the condition, how often it is re-read, how long it
  stays quiet after firing, and where it goes.
-->
<template>
  <div class="flex flex-col gap-4" data-test="slo-alert-form">
    <div class="grid grid-cols-2 gap-4">
      <OInput
        v-model="form.name"
        :label="t('alerts.name')"
        required
        :error="!!nameError"
        :error-message="nameError || undefined"
        data-test="slo-alert-form-name"
      />
      <OInput
        v-model="form.description"
        :label="t('alerts.description')"
        data-test="slo-alert-form-description"
      />
    </div>

    <!-- The SLO is context, not a field: it comes from the page. -->
    <SloAlertCondition v-model="form.condition" :slo="slo" :errors="conditionFieldErrors" />

    <!-- Sized to their content (`width="sm"`, minutes suffix) rather than a
         half-panel column each: a two-digit interval in a 60rem input reads as
         a mistake, and without the unit "10" says nothing. -->
    <div class="flex flex-wrap gap-4">
      <OInput
        v-model.number="form.frequencyMinutes"
        type="number"
        width="sm"
        suffix="min"
        :label="t('alerts.frequency')"
        required
        :error="!!fieldError('frequencyMinutes')"
        :error-message="fieldError('frequencyMinutes') || undefined"
        data-test="slo-alert-form-frequency"
      />
      <OInput
        v-model.number="form.silenceMinutes"
        type="number"
        width="sm"
        suffix="min"
        :label="t('alerts.silence')"
        required
        :error="!!fieldError('silenceMinutes')"
        :error-message="fieldError('silenceMinutes') || undefined"
        data-test="slo-alert-form-silence"
      />
    </div>

    <!-- The same complete field the generic alert form uses — label, tooltip,
         picker, refresh/create buttons and error chrome all come with it. -->
    <AlertDestinationsField
      v-model:destinations="form.destinations"
      v-model:workflows="form.workflows"
      :destination-options="destinationOptions"
      :error="fieldError('destinations') || undefined"
      data-test="slo-alert-form-targets"
      @refresh="loadDestinations"
    />

    <OBanner v-if="saveError" variant="error" data-test="slo-alert-form-error">
      {{ saveError }}
    </OBanner>

    <div class="flex justify-end gap-2">
      <OButton
        variant="outline"
        size="sm-action"
        @click="emit('cancel')"
        data-test="slo-alert-form-cancel"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton size="sm-action" :loading="saving" @click="submit" data-test="slo-alert-form-submit">
        {{ t("common.save") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { makeSloAlertSchema } from "./SloAlertForm.schema";
import { scrollToFirstError } from "@/lib/forms/Form/scrollToFirstError";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import AlertDestinationsField from "@/components/alerts/AlertDestinationsField.vue";
import SloAlertCondition from "@/components/slos/SloAlertCondition.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import type { Slo } from "@/ts/interfaces/slo";
import { buildSloAlertPayload, deriveSloAlertName } from "@/utils/alerts/sloAlertPayload";

const props = defineProps<{ slo: Slo; alertId?: string | null }>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
  (e: "load-error", message: string): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

const org = computed(() => store.state.selectedOrganization?.identifier);
const saving = ref(false);
const saveError = ref("");
const destinationOptions = ref<string[]>([]);

/** The stored alert when editing. Held so the PUT can carry every field this
 *  form does not own — the update replaces the alert wholesale. */
const existing = ref<Record<string, any> | null>(null);

// A STABLE reactive object. `SloAlertCondition` writes through `defineModel` by
// mutating what it is given, so handing it a fresh literal per render would
// silently discard every preset click and keystroke.
const form = reactive({
  name: "",
  description: "",
  enabled: true,
  frequencyMinutes: 10,
  silenceMinutes: 30,
  destinations: [] as string[],
  workflows: [] as string[],
  condition: {
    slo_id: props.slo.id,
    kind: "burn_rate",
    operator: ">",
    critical: null as number | null,
    warning: null as number | null,
    long_window_secs: 3600,
    short_window_secs: snapWindow(300),
  } as Record<string, any>,
});

// `error` is a BOOLEAN prop on OInput and the text comes from `errorMessage`
// (`OInput.vue:64-67` returns a bare space when the flag is set without a
// message, which the bottom row then deliberately refuses to render). Passing
// the message to `error` alone tints the field and says nothing.
//
// `alerts.nameRequired` is the key the generic alert form already uses; there
// is no `alerts.validation.nameRequired`, and a missing key renders as the key.
// The rule itself lives in SloAlertForm.schema.ts.
/** Keep the suggested name in step with the condition until the user types
 *  their own. Two alerts on one SLO are told apart by name, so a blank or
 *  duplicated default is the failure mode worth designing out. */
const nameIsUserEdited = ref(false);
watch(
  () => [form.condition.kind, form.condition.critical, form.condition.long_window_secs],
  () => {
    if (!nameIsUserEdited.value && !props.alertId) {
      form.name = deriveSloAlertName(props.slo, form.condition);
    }
  },
  { immediate: true },
);
watch(
  () => form.name,
  (next) => {
    if (next && next !== deriveSloAlertName(props.slo, form.condition)) {
      nameIsUserEdited.value = true;
    }
  },
);

/// Only the name was checked before, so a missing destination reached the server
/// and came back as a banner reading "Alert destination or workflows is
/// required" — accurate, but attached to nothing the user can see is wrong.
/// These name the field instead.
///
/// Shown only after a submit attempt: unlike the name, which is prefilled from
/// the condition, these start empty on every new alert and would otherwise paint
/// the form red before anyone has typed.
const attemptedSubmit = ref(false);

/** The "no message" value. Branded so it is assignable to `error-message`. */
const NO_ERROR = raw("");

/// Rules live in `SloAlertForm.schema.ts`, the arrangement the generic alert
/// forms use — see the note at the top of that file for why `kind` changes the
/// required set rather than merely relaxing it.
const validation = computed(() =>
  makeSloAlertSchema(t).safeParse({
    name: form.name,
    frequencyMinutes: form.frequencyMinutes,
    silenceMinutes: form.silenceMinutes,
    destinations: form.destinations,
    workflows: form.workflows,
    condition: form.condition,
  }),
);

const validationIssues = computed<Record<string, I18nText>>(() => {
  const result = validation.value;
  if (result.success) return {};
  const out: Record<string, I18nText> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    if (!(key in out)) out[key] = issue.message as I18nText;
  }
  return out;
});

/// Submit-then-change, the timing `useOForm` configures everywhere else: these
/// fields start empty on every new alert and would otherwise paint the form red
/// before anyone has typed. The name is the exception — it is prefilled from the
/// condition, so it is marked as soon as it is emptied.
const fieldError = (path: string): I18nText =>
  attemptedSubmit.value ? (validationIssues.value[path] ?? NO_ERROR) : NO_ERROR;

const nameError = computed(() => validationIssues.value["name"] ?? NO_ERROR);

/// Handed to SloAlertCondition so its inputs render their own inline markers,
/// rather than the form reporting a condition problem far from the input.
const conditionFieldErrors = computed(() => ({
  critical: fieldError("condition.critical"),
  long: fieldError("condition.long_window_secs"),
  short: fieldError("condition.short_window_secs"),
}));

const submit = async () => {
  saveError.value = "";
  attemptedSubmit.value = true;

  // Refuse to send a knowingly-invalid alert. Previously only the name was
  // checked, and it returned SILENTLY — no banner, no field marker — so a
  // rejected name looked exactly like nothing happening.
  if (!validation.value.success) {
    await scrollToFirstError();
    saveError.value = t("slos.validation.summary");
    return;
  }

  saving.value = true;
  try {
    const body = buildSloAlertPayload(form, { slo: props.slo, existing: existing.value });
    if (props.alertId) {
      await alertsService.update_by_alert_id(org.value, body);
    } else {
      await alertsService.create_by_alert_id(org.value, body);
    }
    emit("saved");
  } catch (e: any) {
    saveError.value = e?.response?.data?.message || t("alerts.saveFailed");
  } finally {
    saving.value = false;
  }
};

// Named so the field's refresh button can re-run it after the user creates a
// destination in the other tab.
const loadDestinations = () => {
  destinationService
    .list({ org_identifier: org.value, module: "alert" })
    .then((res: any) => {
      destinationOptions.value = (res.data ?? []).map((d: any) => d.name ?? d);
    })
    .catch(() => {
      destinationOptions.value = [];
    });
};

function snapWindow(secs: number): number {
  const slice = props.slo.slice_interval_secs ?? 0;
  if (slice <= 0) return secs;
  const onGrid = Math.round(secs / slice) * slice;
  return Math.max(onGrid, 2 * slice);
}

onMounted(async () => {
  loadDestinations();

  if (!props.alertId) return;

  // A failed load must NOT leave an empty create form behind: saving from one
  // would make a second alert rather than editing the first.
  try {
    const res = await alertsService.get_by_alert_id(org.value, props.alertId);
    const alert = res.data;
    existing.value = alert;
    form.name = alert.name ?? "";
    form.description = alert.description ?? "";
    form.enabled = alert.enabled ?? true;
    form.frequencyMinutes = alert.trigger_condition?.frequency ?? 10;
    form.silenceMinutes = alert.trigger_condition?.silence ?? 30;
    form.destinations = [...(alert.destinations ?? [])];
    form.workflows = [...(alert.workflows ?? [])];
    Object.assign(form.condition, alert.query_condition?.slo_condition ?? {});
    nameIsUserEdited.value = true;
  } catch (e: any) {
    emit("load-error", e?.response?.data?.message || t("alerts.loadFailed"));
  }
});
</script>
