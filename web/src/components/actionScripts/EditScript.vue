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
  <OPageLayout
    data-test="add-action-script-section"
    :title="isEditingActionScript ? t('actions.update') : t('actions.add')"
    :back="{
      label: t('actions.header'),
      onClick: () => router.back(),
      dataTest: 'add-action-script-back-btn',
    }"
    bleed
  >
      <template #title>
        <span data-test="add-action-script-title">{{
          isEditingActionScript ? t("actions.update") : t("actions.add")
        }}</span>
      </template>

    <!-- Inline (full-page) form. The footer Save lives INSIDE the <OForm>, so it
         is `type="submit"` and Enter submits natively — no `form-id` needed. -->
    <OForm
      :form="form"
      v-slot="{ isSubmitting }"
      class="w-full flex-1 min-h-0 flex flex-col"
    >
      <div class="w-full flex-1 min-h-0 px-2.5 pb-2.5 pt-1">
        <div
          class="bg-card-glass-bg overflow-auto"
          style="max-height: calc(100vh - var(--navbar-height) - 157px)"
        >
          <div
            ref="addAlertFormRef"
            class="px-4 pb-3"
            style="width: 1024px"
          >
            <div
              class="create-report-form"
            >
              <div
                data-test="add-action-script-name-input-wrapper"
                class="report-name-input pt-3"
              >
                <OFormInput
                  data-test="add-action-script-name-input"
                  name="name"
                  :label="t('alerts.name')"
                  required
                  class="showLabelOnTop"
                  tabindex="0"
                  style="width: 400px"
                  :help-text="t('actions.nameInvalidChars')"
                />
              </div>
              <div data-test="add-action-script-description-input" class="report-name-input pb-2">
                <OFormInput
                  name="description"
                  :label="t('reports.description')"
                  class="showLabelOnTop"
                  tabindex="0"
                  style="width: 800px"
                />
              </div>

              <div data-test="add-action-script-type" class="report-name-input mb-3">
                <OFormSelect
                  data-test="add-action-script-type-select"
                  name="type"
                  :label="t('common.type')"
                  required
                  :options="actionTypes"
                  labelKey="label"
                  valueKey="value"
                  class="showLabelOnTop no-case w-100"
                  :disabled="isEditingActionScript"
                />
              </div>

              <OStepper
                v-model="step"
                orientation="vertical"
                animated
                navigable
                class="mb-3"
              >
                <OStep
                  data-test="add-action-script-step-1"
                  :name="1"
                  :title="t('actions.uploadCodeZip')"
                  icon="edit"
                  :done="step > 1"
                >
                  <div
                    data-test="add-action-script-file-input"
                    class="flex items-center"
                  >
                    <OFormFile
                      v-if="
                        !isEditingActionScript || formData.fileNameToShow == ''
                      "
                      name="codeZip"
                      :label="t('actions.zipFile')"
                      :required="!isEditingActionScript"
                      accept=".zip"
                      data-test="add-action-script-file-input"
                    >
                      <template #hint>
                        {{ t('actions.zipFileHint') }}
                      </template>
                    </OFormFile>

                    <div
                      v-else-if="
                        isEditingActionScript && formData.fileNameToShow != ''
                      "
                    >
                      {{ formData.fileNameToShow }}
                      <OButton
                        data-test="add-action-script-edit-file-btn"
                        variant="ghost"
                        size="icon-sm"
                        @click="editFileToUpload"
                        ><OIcon name="edit" size="sm"
                      /></OButton>
                    </div>
                    <div
                      v-if="
                        isEditingActionScript && formData.fileNameToShow == ''
                      "
                      class="pt-3 mt-1 pl-3"
                    >
                      <OButton
                        data-test="cancel-upload-new-btn-file"
                        variant="outline-destructive"
                        size="sm-action"
                        @click="cancelUploadingNewFile"
                        >{{ t('common.cancel') }}</OButton
                      >
                    </div>
                  </div>
                  <div class="flex gap-2 mt-8">
                    <OButton
                      data-test="add-action-script-step1-continue-btn"
                      variant="primary"
                      size="sm"
                      @click="
                        goToStep(['codeZip'], formType === 'scheduled' ? 2 : 3)
                      "
                      >{{ t('alerts.continue') }}</OButton
                    >
                  </div>
                </OStep>

                <OStep
                  v-if="formType === 'scheduled'"
                  data-test="add-action-script-step-2"
                  :name="2"
                  :title="t('actions.schedule')"
                  icon="schedule"
                  :done="step > 2"
                  class="mt-3"
                >
                  <div class="my-2 px-2">
                    <div
                      style="font-size: var(--text-sm)"
                      class="font-bold text-text-secondary mb-2"
                      data-test="add-action-script-frequency-title"
                    >
                      {{ t("actions.frequency") }} *
                    </div>
                    <div class="p-1 rounded-default border border-card-glass-border w-fit">
                      <template
                        v-for="visual in frequencyTabs"
                        :key="visual.value"
                      >
                        <OButton
                          :data-test="`add-action-script-schedule-frequency-${visual.value}-btn`"
                          variant="ghost"
                          :active="visual.value === frequency.type"
                          size="xs"
                          :disabled="isEditingActionScript"
                          @click="frequency.type = visual.value"
                          >{{ visual.label }}</OButton
                        >
                      </template>
                    </div>

                    <div
                      v-if="frequency.type === 'once'"
                      class="flex justify-start items-center mt-3"
                      data-test="add-action-script-frequency-info"
                    >
                      <OIcon name="event" size="sm" class="mr-2" />
                      <div style="font-size: var(--text-sm)">
                        {{ t('actions.immediateTriggerHint') }}
                      </div>
                    </div>

                    <template v-if="frequency.type === 'repeat'">
                      <div class="flex">
                        <div
                          data-test="add-action-script-cron-input"
                          class="mr-2 pt-2"
                          style="width: 320px"
                        >
                          <div
                            class="mb-1 font-bold text-text-secondary"
                            data-test="add-action-script-cron-expression-title"
                          >
                            {{ t("reports.cronExpression") + " *" }}
                            <OIcon
                              data-test="add-action-script-cron-info"
                              name="info"
                              size="sm"
                              class="ml-1 cursor-pointer text-text-muted"
                            >
                              <OTooltip side="right" align="center">
                                <template #content>
                                  <span style="font-size: var(--text-sm)">
                                    {{ t('actions.cronPatternHint') }}
                                    <br />
                                    {{ t('actions.cronFormatHint') }}
                                    <br />
                                    {{ t('actions.cronWildcardHint') }} <br />
                                    {{ t('actions.cronExampleHint') }}
                                  </span>
                                </template>
                              </OTooltip>
                            </OIcon>
                          </div>

                          <OFormInput
                            name="cron"
                            class="showLabelOnTop w-full"
                            type="text"
                            :debounce="300"
                            :disabled="isEditingActionScript"
                            :readonly="isEditingActionScript"
                          />
                        </div>
                        <div class="flex pt-2.75">
                          <OFormSelect
                            data-test="add-action-script-timezone-select"
                            name="timezone"
                            :options="['UTC']"
                            :label="t('actions.timezone')"
                            required
                            :loading="isFetchingServiceAccounts"
                            class="showLabelOnTop no-case mb-[2.4rem]"
                            disabled
                            style="min-width: 250px !important; width: 250px !important;"
                          />
                        </div>
                      </div>
                    </template>
                  </div>
                  <div class="flex gap-2 mt-4">
                    <OButton
                      data-test="add-action-script-step2-back-btn"
                      variant="outline"
                      size="sm"
                      @click="step--"
                      >{{ t('common.back') }}</OButton
                    >
                    <OButton
                      data-test="add-action-script-step2-continue-btn"
                      variant="primary"
                      size="sm"
                      @click="goToStep(['cron', 'timezone'], 3)"
                      >{{ t('alerts.continue') }}</OButton
                    >
                  </div>
                </OStep>

                <OStep
                  data-test="add-action-script-step-3"
                  :name="3"
                  :title="t('actions.selectServiceAccount')"
                  icon="dashboard"
                  :done="step > 3"
                  class="mt-3"
                >
                  <div class="flex items-center">
                    <div>
                      <div
                        data-test="add-action-script-service-account-title"
                        class="mb-1 font-bold text-text-secondary"
                      >
                        {{ t("actions.serviceAccount") + " *" }}
                        <OIcon
                          name="info"
                          size="sm"
                          class="ml-1 cursor-pointer text-text-muted"
                        >
                          <OTooltip side="right" align="center">
                            <template #content>
                              <span style="font-size: var(--text-sm)">
                                {{ t('actions.serviceAccountPermissionsHint') }}
                              </span>
                            </template>
                          </OTooltip>
                        </OIcon>
                      </div>
                      <OFormSelect
                        data-test="add-action-script-service-account-select"
                        name="service_account"
                        required
                        :options="filteredServiceAccounts"
                        :loading="isFetchingServiceAccounts"
                        class="py-2 no-case"
                        labelKey="label"
                        valueKey="value"
                        style="min-width: 250px !important; width: 250px !important;"
                      />
                    </div>
                  </div>
                  <div class="flex gap-2 mt-4">
                    <OButton
                      data-test="add-action-script-step3-back-btn"
                      variant="outline"
                      size="sm"
                      @click="step === 3 ? (step = formType === 'scheduled' ? 2 : 1) : step--"
                      >{{ t('common.back') }}</OButton
                    >
                    <OButton
                      data-test="add-action-script-step3-continue-btn"
                      variant="primary"
                      size="sm"
                      @click="goToStep(['service_account'], 4)"
                      >{{ t('alerts.continue') }}</OButton
                    >
                  </div>
                </OStep>
                <OStep
                  data-test="add-action-script-step-4"
                  :name="4"
                  :title="t('actions.environmentalVariables')"
                  icon="lock"
                  :done="step > 4"
                  class="mt-3"
                >
                  <!-- Env vars are a dynamic key/value array bound to the
                       component-owned `environmentalVariables`, not part of the
                       form schema (no validation today). -->
                  <div
                    v-for="(header, index) in environmentalVariables"
                    :key="header.uuid"
                    class="flex gap-2"
                    data-test="add-action-script-env-variable"
                  >
                    <div class="w-5/12 ml-0">
                      <OInput
                        :data-test="`add-action-script-header-${header['key']}-key-input`"
                        v-model="header.key"
                        :placeholder="t('common.key')"
                        tabindex="0"
                      />
                    </div>
                    <div class="w-5/12 ml-0 mb-2">
                      <OInput
                        :data-test="`add-action-script-header-${header['key']}-value-input`"
                        v-model="header.value"
                        :placeholder="t('alert_destinations.api_header_value')"
                        tabindex="0"
                      />
                    </div>
                    <div class="w-1/6 ml-0">
                      <OButton
                        :data-test="`add-action-script-header-${header['key']}-delete-btn`"
                        variant="ghost"
                        size="icon-circle-sm"
                        :title="t('alert_templates.delete')"
                        @click="deleteApiHeader(header)"
                        ><OIcon name="delete" size="sm"
                      /></OButton>
                      <OButton
                        data-test="add-action-script-add-header-btn"
                        v-if="index === environmentalVariables.length - 1"
                        variant="ghost"
                        size="icon-circle-sm"
                        :title="t('alert_templates.edit')"
                        @click="addApiHeader()"
                        ><OIcon name="add" size="sm"
                      /></OButton>
                    </div>
                  </div>
                  <div class="flex gap-2 mt-4">
                    <OButton
                      data-test="add-action-script-step4-back-btn"
                      variant="outline"
                      size="sm"
                      @click="step--"
                      >{{ t('common.back') }}</OButton
                    >
                  </div>
                </OStep>
              </OStepper>

            </div>
          </div>
        </div>
      </div>
      <div class="mx-2">
        <div
          class="flex justify-end gap-2 px-3 w-full py-2.5 bg-card-glass-bg sticky"
          style="bottom: 0px; z-index: 2"
        >
          <OButton
            data-test="add-action-script-cancel-btn"
            variant="outline"
            size="sm-action"
            :disabled="isSubmitting"
            @click="openCancelDialog"
            >{{ t("alerts.cancel") }}</OButton
          >
          <OButton
            data-test="add-action-script-save-btn"
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
            >{{ t("alerts.save") }}</OButton
          >
        </div>
      </div>
    </OForm>
  </OPageLayout>

  <ConfirmDialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, watch } from "vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import {
  getUUID,
  getCronIntervalDifferenceInSeconds,
  isAboveMinRefreshInterval,
} from "@/utils/zincutils";
import { useStore } from "vuex";
import { onBeforeMount } from "vue";
import type { Ref } from "vue";
import actions from "@/services/action_scripts";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import CronExpressionParser from "cron-parser";
import service_accounts from "@/services/service_accounts";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm, type FormFieldPath } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormFile from "@/lib/forms/File/OFormFile.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeEditScriptSchema,
  type EditScriptForm,
} from "./EditScript.schema";

defineProps({
  report: {
    type: Object,
    default: null,
  },
});
const emit = defineEmits(["getActionScripts"]);

const defaultActionScript = {
  codeZip: null,
  description: "",
  enabled: true,
  name: "",
  orgId: "",
  start: 0,
  frequency: {
    interval: 1,
    type: "repeat",
    cron: "",
  },
  environment_variables: {},
  execution_details: "",
  timezone: "UTC",
  timezoneOffset: 0,
  lastTriggeredAt: null,
  createdAt: "",
  updatedAt: "",
  owner: "",
  lastEditedBy: "",
  fileNameToShow: "",
  id: "",
  service_account: "",
  type: "scheduled",
};

const { t } = useI18n();
const router = useRouter();

const originalActionScriptData: Ref<string> = ref("");

const step = ref(1);

const formData = ref(defaultActionScript);


const actionTypes = [
  {
    label: "Scheduled",
    value: "scheduled",
  },
  {
    label: "Real Time",
    value: "service",
  },
];

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

const frequencyTabs = [
  {
    label: "Cron Job",
    value: "repeat",
  },
  {
    label: "Once",
    value: "once",
  },
];

const store = useStore();

const isEditingActionScript = ref(false);

const isFetchingActionScript = ref(false);

const environmentalVariables = ref([{ key: "", value: "", uuid: getUUID() }]);

const frequency = ref({
  type: "once",
  custom: {
    interval: 1,
    period: "days",
  },
  cron: "",
});

// ── OForm wiring (Rule ③ OWNER pattern) ──────────────────────────────────────
// This component OWNS the <OForm> AND reads form state (`type`) to drive the
// OStepper's conditional "Schedule" step. Vue `provide` flows downward, so the
// owner cannot `inject` the form — it creates the form headlessly with useOForm
// and reads it reactively via form.useStore (NOT a formRef + form.state.values
// snapshot, which a computed cannot track). The form is handed to
// <OForm :form="form">; the save is wired through useOForm({ onSubmit }).

/**
 * Validates a non-empty cron expression: parse-ability + min-refresh-interval.
 * Returns an error message or "" when valid. Injected into the schema's
 * superRefine so the cron rules live in the schema (no hand-rolled validate()).
 */
const getCronError = (cron: string): string => {
  const value = String(cron ?? "").trim();
  if (!value) return "Invalid cron expression!";
  try {
    // cron-parser v5 dropped the `utc` option; parse validity is tz-independent here.
    CronExpressionParser.parse(value, {
      currentDate: new Date(),
    });
  } catch {
    return "Invalid cron expression!";
  }
  try {
    const intervalInSecs = getCronIntervalDifferenceInSeconds(value);
    if (
      typeof intervalInSecs === "number" &&
      !isAboveMinRefreshInterval(intervalInSecs, store.state?.zoConfig)
    ) {
      const minInterval =
        Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;
      return `Frequency should be greater than ${minInterval - 1} seconds.`;
    }
  } catch {
    return "Invalid cron expression!";
  }
  return "";
};

// Sticky flag: has the user edited the cron field? Byte-exact main parity — main
// only validated cron once its inline @update handler had run (i.e. after an edit),
// so a never-touched blank cron on create still saved. Flipped below the first time
// the cron form value changes from user input. Injected into the schema's cron gate.
const cronEdited = ref(false);

// Co-located Zod schema (factory keeps create-vs-edit + cron checks injectable).
const editScriptSchema = makeEditScriptSchema({
  t,
  getIsEditing: () => isEditingActionScript.value,
  getCronError,
  // Main validated cron via TWO paths (see EditScript.schema.ts):
  //   (a) submit-path gate on execution_details === "repeat" (fires on EDIT), and
  //   (b) the cron field's inline handler, which only ran after the user edited it.
  getExecutionDetails: () => formData.value.execution_details ?? "",
  getCronEdited: () => cronEdited.value,
});

// Dynamic (edit-prefill) defaults: projects the form-owned fields out of the
// component's `formData` / `frequency`. Seeds useOForm at create; re-applied
// via form.reset() when an edited record arrives async (see below).
const editScriptDefaults = computed((): EditScriptForm => ({
  name: formData.value.name ?? "",
  description: formData.value.description ?? "",
  type: formData.value.type ?? "scheduled",
  service_account: formData.value.service_account ?? "",
  timezone: formData.value.timezone ?? "UTC",
  codeZip: (formData.value.codeZip as File | null) ?? null,
  cron: frequency.value.cron ?? "",
  frequencyType: frequency.value.type ?? "once",
}));

// Headless form (Rule ③ owner). defaultValues seed the blank create form; the
// async edit record re-seeds via form.reset() below. onSubmit is deferred to
// saveActionScript (defined later) so <OForm :form> runs the same save.
const form = useOForm<EditScriptForm>({
  defaultValues: editScriptDefaults.value,
  schema: editScriptSchema,
  onSubmit: (value) => saveActionScript(value),
});

// Reproduce main's "validate cron only after the field is edited" gate. On CREATE
// the only cron-value changes come from user input — the field is disabled on edit
// and create never calls form.reset — so a change here means the user edited it
// (main's inline @update trigger). Guarded by !isEditing so the edit-load re-seed
// (form.reset) doesn't count. Sticky, so a typed-then-cleared cron still validates
// (matches main, which showed "Field is required!" on clear).
const cronFieldValue = form.useStore((s: any) => s?.values?.cron ?? "");
watch(cronFieldValue, () => {
  if (!isEditingActionScript.value) cronEdited.value = true;
});

// Read the form-owned `type` reactively (form.useStore) — the stepper's
// "Schedule" step shows only for a scheduled action.
const formTypeValue = form.useStore((s: any) => s.values.type);
const formType = computed<string>(
  () => (formTypeValue.value as string) ?? formData.value.type ?? "scheduled",
);

// The Schedule step only exists for scheduled actions. If the user switches
// type while ON that step, its panel unmounts and no step would be active —
// snap forward to the next step (mirrors the 1 → 3 Continue skip).
watch(formType, (t) => {
  if (t !== "scheduled" && step.value === 2) step.value = 3;
});

// ── Per-step "Continue" validation ───────────────────────────────────────────
// Continue used to blindly advance the OStepper; a user could walk past a blank
// required field and only discover it at Save. This runs the SAME schema-driven
// validation the footer Save uses (mirrors OForm.validate(): validate each field,
// then read its meta.errors), and gates the advance ONLY on the fields listed at
// the call site (the step's own fields — see the template's Continue buttons).
//
// We deliberately do NOT clear other fields' error meta here. The schema is
// form-level, so form.validateField() runs the whole Zod schema and records every
// field's error — but that write is additive, so Save's cross-step errors stay
// put (clearing them made a later Continue wipe the errors Save had just surfaced
// on other steps). We simply don't READ the out-of-step fields when deciding
// whether to advance.
const validateStepFields = async (fields: string[]): Promise<boolean> => {
  let valid = true;
  // Field names are validated dynamically; cast to the form's DeepKeys union.
  for (const name of fields as FormFieldPath<EditScriptForm>[]) {
    await form.validateField(name, "submit");
    const errors = form.getFieldMeta(name)?.errors ?? [];
    if (errors.length > 0) valid = false;
  }
  return valid;
};

// Validate the given fields; only advance to `next` when they all pass.
const goToStep = async (fields: string[], next: number) => {
  if (await validateStepFields(fields)) step.value = next;
};

// Map a Zod issue path to its OForm field name so we can match issues to the
// field that owns them: ["cron"] → "cron". Actions only has flat scalar fields,
// but keep the same helper reports uses (handles nested array paths too) for parity.
const issuePathToName = (path: readonly PropertyKey[]): string =>
  path.reduce<string>(
    (acc, seg) =>
      typeof seg === "number"
        ? `${acc}[${seg}]`
        : acc
          ? `${acc}.${String(seg)}`
          : String(seg),
    "",
  );

// Clear a field's error the instant its value becomes valid — scoped to that one
// field, never touching the others. Needed because the stepper's Continue
// validates with validateField("submit"), which does NOT flip the form into
// revalidate-on-change mode, so editing an OForm* field would otherwise leave a
// stale error until the next Save (e.g. the uploaded ZIP kept showing "ZIP File
// is required!" and a typed name kept showing "Name is required"). This ONLY
// clears — it never adds errors — so editing one field can't surface validation
// on another (no bleed to other steps).
const formValuesRef = form.useStore((s: any) => s.values);
watch(
  formValuesRef,
  () => {
    const res = editScriptSchema.safeParse(form.state.values);
    const invalidNames = new Set(
      res.success ? [] : res.error.issues.map((i) => issuePathToName(i.path)),
    );
    for (const name of Object.keys(
      form.state.fieldMeta ?? {},
    ) as FormFieldPath<EditScriptForm>[]) {
      const meta = form.getFieldMeta(name);
      if (!meta) continue;
      const hasError = (meta.errors?.length ?? 0) > 0;
      if (hasError && !invalidNames.has(name)) {
        form.setFieldMeta(name, { ...meta, errorMap: {} });
      }
    }

    // Also reconcile the FORM-LEVEL error map, not just per-field metas. A
    // Continue click validates via validateField("submit"); because the schema is
    // form-level, that runs the WHOLE Zod schema and records EVERY failing path
    // into the form's own errorMap.onDynamic. When the form later becomes fully
    // valid, clearing the field metas above is not enough: handleSubmit()
    // re-validates fields but never re-runs or clears this form-level result, so
    // canSubmit stays false and Save is silently blocked. Clear it here once the
    // whole schema passes — like the loop above, this ONLY clears, so it can never
    // reveal an error early.
    if (res.success) {
      const em: any = form.state.errorMap ?? {};
      if (em.onDynamic != null || em.onDynamicAsync != null) {
        form.setErrorMap({
          ...em,
          onDynamic: undefined,
          onDynamicAsync: undefined,
        });
      }
    }
  },
  { deep: true },
);

// Bridge the component-owned frequency tabs (repeat/once) into the form so the
// schema's cron superRefine can branch on it. Default-values seeds the initial
// value; this keeps it in sync on toggle (and re-validates cron after the first
// submit, per revalidateLogic).
watch(
  () => frequency.value.type,
  (v) => {
    form.setFieldValue("frequencyType", v);
  },
);

watch(
  () => router.currentRoute.value.query?.id,
  async () => {
    await handleActionScript();
  },
);

onBeforeMount(async () => {
  await handleActionScript();
});

// @ts-ignore
let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz: any) => {
  return tz;
});

const browserTime =
  "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

// Add the UTC option
timezoneOptions.unshift("UTC");
timezoneOptions.unshift(browserTime);

// @submit fires only once the whole Zod schema passes (name/type/service_account/
// timezone + the codeZip-on-create and cron-when-scheduled-repeat superRefines),
// so the schema — not a manual gate — blocks an invalid save and reveals errors.
// `value` is the validated payload (source of truth for the form-owned fields);
// env vars stay component-owned. The promise is returned so OForm's awaited
// isSubmitting drives the footer Save spinner.
const saveActionScript = async (value: EditScriptForm) => {
  let form: FormData | Record<string, any>;

  // FormData is needed on create, or when editing WITH a newly-uploaded file.
  const useFormData =
    !isEditingActionScript.value ||
    (isEditingActionScript.value && !!value.codeZip);
  form = useFormData ? new FormData() : {};

  const commonFields: Record<string, any> = {
    // Trim the name in the payload — parity with the pre-migration `v-model.trim`,
    // which saved the trimmed name. Schema `.trim()` only validates the trimmed
    // value; it is not written back into `value`, so trim it here.
    name: (value.name ?? "").trim(),
    description: value.description,
    // Use the validated form value (frequencyType), not the component-owned
    // frequency.value.type — the schema's cron rule branches on frequencyType,
    // so the payload must agree with what was validated.
    execution_details:
      value.type === "scheduled" ? value.frequencyType : value.type,
    service_account: value.service_account,
  };

  // Add cron expression for a scheduled action on a repeat schedule.
  if (value.type === "scheduled" && value.frequencyType === "repeat") {
    commonFields.cron_expr = String(value.cron ?? "").trim();
  }

  if (useFormData) {
    commonFields.owner = store.state.userInfo.email;
  }

  // Add environment variables if present (component-owned dynamic array).
  if (environmentalVariables.value.length > 0) {
    const environment_variables = environmentalVariables.value.reduce(
      (acc: any, curr: any) => {
        if (curr.key) {
          acc[curr.key] = curr.value;
        }
        return acc;
      },
      {},
    );
    commonFields.environment_variables = environment_variables;
  }

  // Populate form (either FormData or plain object)
  Object.entries(commonFields).forEach(([key, val]) => {
    if (useFormData) {
      (form as FormData).append(
        key,
        typeof val === "object" ? JSON.stringify(val) : val,
      );
    } else {
      (form as Record<string, any>)[key] = val;
    }
  });

  // Add file fields if using FormData
  if (useFormData && value.codeZip) {
    (form as FormData).append("file", value.codeZip as File);
    (form as FormData).append("filename", (value.codeZip as File).name || "");
  }

  if (isEditingActionScript.value && value.codeZip) {
    (form as FormData).append("id", formData.value.id);
  }

  const updateAction =
    isEditingActionScript.value && !value.codeZip
      ? actions.update
      : actions.create;

  const dismiss = toast({
    variant: "loading",
    message: "Please wait...",
    timeout: 0,
  });
  const actionId: string = (router.currentRoute.value.query?.id ||
    "") as string;

  return updateAction(
    store.state.selectedOrganization.identifier,
    actionId,
    form,
  )
    .then(() => {
      toast({
        variant: "success",
        message: `Action ${
          isEditingActionScript.value ? "updated" : "saved"
        } successfully.`,
      });
      goToActionScripts();
      emit("getActionScripts");
    })
    .catch((error) => {
      step.value = 3;
      if (error.response?.status != 403) {
        toast({
          variant: "error",
          message:
            error?.response?.data?.message ||
            `Error while ${
              isEditingActionScript.value ? "updating" : "saving"
            } Action.`,
        });
      }
    })
    .finally(() => {
      dismiss();
    });
};

const goToActionScripts = () => {
  router.replace({
    name: "actionScripts",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const setupEditingActionScript = async (report: any) => {
  formData.value = {
    ...report,
    timezone: report.timezone || "UTC",
  };
  formData.value.fileNameToShow = report.zip_file_name;

  formData.value.type = "scheduled";

  if (formData.value.execution_details === "service") {
    formData.value.type = "service";
  }

  // set frequency
  if (report.execution_details == "repeat") {
    frequency.value.type = "repeat";
    frequency.value.cron =
      report.cron_expr.split(" ").length === 7
        ? report.cron_expr.split(" ").slice(0, 6).join(" ")
        : report.cron_expr;
  } else {
    frequency.value.type = "once";
  }
  if (Object.keys(formData.value.environment_variables).length) {
    environmentalVariables.value = [];
    Object.entries(formData.value.environment_variables).forEach(
      ([key, value]: [string, any]) => {
        addApiHeader(key, value);
      },
    );
  }
};

const openCancelDialog = () => {
  // Dirty-check across BOTH sources of truth. The <OForm> now owns the scalar
  // fields (name/description/type/service_account/timezone/codeZip/cron), so
  // editing them updates TanStack state — NOT `formData`. A `formData`-only
  // compare therefore misses real edits and skips this confirmation (silent
  // discard). `form.state.isDirty` catches any edited form field; the `formData`
  // snapshot still catches the file-name display + env-var deletes, which remain
  // component-owned. Show the confirm if EITHER changed.
  const formEdited = form.state.isDirty;
  const formDataEdited =
    originalActionScriptData.value !== JSON.stringify(formData.value);
  if (!formEdited && !formDataEdited) {
    goToActionScripts();
    return;
  }
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel Action changes?";
  dialog.value.okCallback = goToActionScripts;
};
const editFileToUpload = () => {
  formData.value.fileNameToShow = "";
};
const cancelUploadingNewFile = () => {
  formData.value.fileNameToShow = JSON.parse(
    originalActionScriptData.value,
  ).zip_file_name;
};
const addApiHeader = (key: string = "", value: string = "") => {
  environmentalVariables.value.push({
    key: key,
    value: value,
    uuid: getUUID(),
  });
};
const deleteApiHeader = (header: any) => {
  environmentalVariables.value = environmentalVariables.value.filter(
    (_header) => _header.uuid !== header.uuid,
  );
  if (
    (formData.value.environment_variables as { [key: string]: any })[header.key]
  ) {
    delete (formData.value.environment_variables as { [key: string]: any })[
      header.key
    ];
  }

  if (!environmentalVariables.value.length) addApiHeader();
};
const handleActionScript = async () => {
  isEditingActionScript.value = !!router.currentRoute.value.query?.id;
  // Fresh load starts with an unedited cron field (edit-load re-seeds via
  // form.reset, which re-baselines isDirty; this covers route re-navigation).
  cronEdited.value = false;

  if (isEditingActionScript.value) {
    isEditingActionScript.value = true;
    isFetchingActionScript.value = true;

    const actionId: string = (router.currentRoute.value.query?.id ||
      "") as string;
    actions
      .get_by_id(store.state.selectedOrganization.identifier, actionId)
      .then(async (res: any) => {
        await setupEditingActionScript(res.data);

        originalActionScriptData.value = JSON.stringify(formData.value);

        // :default-values is read once at mount; the record arrives async, so
        // re-seed the form-owned fields when it loads (playbook §4.2/§5.8 —
        // form.reset(record), not a per-field setFieldValue loop).
        await nextTick();
        form.reset(editScriptDefaults.value);
      })
      .catch((err) => {
        if (err.response.status != 403) {
          toast({
            variant: "error",
            message: err?.data?.message || "Error while fetching Action!",
          });
        }
      })
      .finally(() => {
        isFetchingActionScript.value = false;
      });
  } else {
    originalActionScriptData.value = JSON.stringify(formData.value);
  }
};

const filteredServiceAccounts: Ref<{ label: string; value: string }[]> = ref(
  [],
);
const isFetchingServiceAccounts = ref(false);

const serviceAccountsOptions: any[] = [];

const getServiceAccounts = async () => {
  isFetchingServiceAccounts.value = true;
  try {
    const res = await service_accounts.list(
      store.state.selectedOrganization.identifier,
    );
    serviceAccountsOptions.push(
      ...res.data.data.map((account: any) => account.email),
    );
    filteredServiceAccounts.value = [...serviceAccountsOptions];
  } catch (err: any) {
    if (err.response?.status != 403) {
      toast({
        variant: "error",
        message:
          err.response?.data?.message ||
          "Error while fetching service accounts.",
      });
    }
  } finally {
    isFetchingServiceAccounts.value = false;
  }
};

onMounted(async () => {
  await getServiceAccounts();
});
</script>
