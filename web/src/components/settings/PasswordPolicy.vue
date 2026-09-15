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
  <!-- Section header is provided full-width by the Settings shell. This is a CONSTRAINED section,
       so ConstrainedPage owns the scroll and gutter — the content just flows. -->
  <div class="password-policy">
    <div v-if="loading" data-test="password-policy-loading" class="py-8 text-center">
      <OSpinner size="sm" />
    </div>

    <!-- A non-admin of _meta is a designed state, not an error: the section is visible to every
         member of the org because the console has no per-org role to gate the nav entry on. -->
    <OEmptyState
      v-else-if="forbidden"
      data-test="password-policy-not-admin-empty-state"
      size="block"
      icon="lock"
      :title="t('passwordPolicy.notAdminTitle')"
      :description="t('passwordPolicy.notAdmin')"
      hide-action
    />

    <OEmptyState
      v-else-if="loadError"
      data-test="password-policy-load-error-empty-state"
      size="block"
      icon="error"
      :title="t('passwordPolicy.loadFailedTitle')"
      :description="t('passwordPolicy.loadFailed')"
      :action-label="t('common.retry')"
      @action="loadPolicy"
    />

    <template v-else>
      <!-- Headless form: the owner reads it (form.useStore) for the dependent rows, the previews
           and the dirty comparison against the loaded policy. -->
      <OForm id="password-policy-form" :form="form" v-slot="{ isSubmitting }">
        <div class="flex flex-col gap-4">
          <OFormSection :title="t('passwordPolicy.complexity')">
            <OSettingRow
              :label="t('passwordPolicy.minLength')"
              :description="t('passwordPolicy.minLengthDesc')"
              data-test="settings-password-policy-min-length"
            >
              <OFormInput name="min_length" type="number" :min="1" class="w-24" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.maxLength')"
              :description="t('passwordPolicy.maxLengthDesc')"
              data-test="settings-password-policy-max-length"
            >
              <OFormInput name="max_length" type="number" :min="0" class="w-24" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.requireUppercase')"
              :description="t('passwordPolicy.requireUppercaseDesc')"
              data-test="settings-password-policy-require-uppercase"
            >
              <OFormSwitch name="require_uppercase" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.requireLowercase')"
              :description="t('passwordPolicy.requireLowercaseDesc')"
              data-test="settings-password-policy-require-lowercase"
            >
              <OFormSwitch name="require_lowercase" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.requireDigit')"
              :description="t('passwordPolicy.requireDigitDesc')"
              data-test="settings-password-policy-require-digit"
            >
              <OFormSwitch name="require_digit" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.requireSpecial')"
              :description="t('passwordPolicy.requireSpecialDesc')"
              data-test="settings-password-policy-require-special"
            >
              <OFormSwitch name="require_special" />
            </OSettingRow>

            <OSettingRow
              v-if="values.require_special"
              :label="t('passwordPolicy.specialCharSet')"
              :description="t('passwordPolicy.specialCharSetDesc')"
              data-test="settings-password-policy-special-char-set"
            >
              <OFormInput name="special_char_set" class="w-56" :placeholder="raw('!@#$%^&*()')" />
            </OSettingRow>
          </OFormSection>

          <OFormSection :title="t('passwordPolicy.rotation')">
            <OSettingRow
              :label="t('passwordPolicy.rotationDays')"
              :description="t('passwordPolicy.rotationDaysDesc')"
              data-test="settings-password-policy-rotation-days"
            >
              <OFormInput name="rotation_days" type="number" :min="0" class="w-24" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.rotationWarningDays')"
              :description="t('passwordPolicy.rotationWarningDaysDesc')"
              :disabled="!rotationOn"
              data-test="settings-password-policy-rotation-warning-days"
            >
              <OFormInput
                name="rotation_warning_days"
                type="number"
                :min="0"
                class="w-24"
                :disabled="!rotationOn"
              />
            </OSettingRow>

            <p
              v-if="rotationOn"
              class="text-text-secondary py-3 text-xs"
              data-test="settings-password-policy-rotation-preview"
            >
              {{ rotationPreview }}
            </p>
          </OFormSection>

          <OFormSection :title="t('passwordPolicy.reuse')">
            <OSettingRow
              :label="t('passwordPolicy.historyCount')"
              :description="t('passwordPolicy.historyCountDesc')"
              data-test="settings-password-policy-history-count"
            >
              <OFormInput name="history_count" type="number" :min="0" class="w-24" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.historyMaxRetained')"
              :description="t('passwordPolicy.historyMaxRetainedDesc')"
              data-test="settings-password-policy-history-max-retained"
            >
              <OFormInput name="history_max_retained" type="number" :min="0" class="w-24" />
            </OSettingRow>

            <p class="text-text-secondary py-3 text-xs">
              {{ t("passwordPolicy.reuseExplainer") }}
            </p>
          </OFormSection>

          <OFormSection :title="t('passwordPolicy.lockout')">
            <OSettingRow
              :label="t('passwordPolicy.lockoutThreshold')"
              :description="t('passwordPolicy.lockoutThresholdDesc')"
              data-test="settings-password-policy-lockout-threshold"
            >
              <OFormInput name="lockout.threshold" type="number" :min="0" class="w-24" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.lockoutBucketSize')"
              :description="t('passwordPolicy.lockoutBucketSizeDesc')"
              :disabled="!lockoutOn"
              data-test="settings-password-policy-lockout-bucket-size"
            >
              <OFormInput
                name="lockout.bucket_size"
                type="number"
                :min="0"
                class="w-24"
                :disabled="!lockoutOn"
              />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.lockoutStartSecs')"
              :description="t('passwordPolicy.lockoutStartSecsDesc')"
              data-test="settings-password-policy-lockout-start-secs"
            >
              <OFormInput name="lockout.start_secs" type="number" :min="0" class="w-24" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.lockoutMaxSecs')"
              :description="t('passwordPolicy.lockoutMaxSecsDesc')"
              data-test="settings-password-policy-lockout-max-secs"
            >
              <OFormInput name="lockout.max_secs" type="number" :min="0" class="w-24" />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.lockoutBackoff')"
              :description="t('passwordPolicy.lockoutBackoffDesc')"
              data-test="settings-password-policy-lockout-backoff"
            >
              <OFormSelect
                name="lockout.backoff"
                :options="backoffOptions"
                :searchable="false"
                class="w-40"
              />
            </OSettingRow>

            <p
              v-if="lockoutOn"
              class="text-text-secondary py-3 text-xs"
              data-test="settings-password-policy-lockout-preview"
            >
              {{ lockoutPreview }}
            </p>
          </OFormSection>

          <OFormSection :title="t('passwordPolicy.session')">
            <OSettingRow
              :label="t('passwordPolicy.cookieMaxAge')"
              :description="
                t('passwordPolicy.cookieMaxAgeDesc', { envVar: raw('ZO_COOKIE_MAX_AGE') })
              "
              data-test="settings-password-policy-cookie-max-age"
            >
              <OFormInput name="cookie_max_age_secs" type="number" :min="0" class="w-24" />
            </OSettingRow>
          </OFormSection>

          <OFormSection :title="t('passwordPolicy.enforcement')">
            <OSettingRow
              :label="t('passwordPolicy.enforcementMode')"
              :description="t('passwordPolicy.enforcementModeDesc')"
              data-test="settings-password-policy-enforcement-mode"
            >
              <OFormSelect
                name="enforcement_mode"
                :options="enforcementOptions"
                :searchable="false"
                class="w-48"
              />
            </OSettingRow>

            <OSettingRow
              :label="t('passwordPolicy.applyToRoot')"
              :description="t('passwordPolicy.applyToRootDesc')"
              data-test="settings-password-policy-apply-to-root"
            >
              <OFormSwitch name="apply_to_root" @update:model-value="onApplyToRootChange" />
            </OSettingRow>

            <!-- Standing, not one-off: a warning that only appears once is a warning the next
                 administrator never sees. -->
            <OBanner
              v-if="values.apply_to_root"
              variant="error-soft"
              icon="warning"
              dense
              class="my-3"
              :content="t('passwordPolicy.rootWarning')"
              data-test="settings-password-policy-root-warning"
            />
          </OFormSection>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <OButton
            data-test="settings-password-policy-cancel-btn"
            variant="outline"
            size="sm-action"
            :disabled="!isDirty || isSubmitting"
            @click="resetForm"
          >
            {{ t("common.cancel") }}
          </OButton>
          <OButton
            data-test="settings-password-policy-save-btn"
            variant="primary"
            size="sm-action"
            type="submit"
            :disabled="!isDirty || !loadedPolicy"
          >
            {{ t("settings.saveChanges") }}
          </OButton>
        </div>
      </OForm>

      <!-- The one control on this page that can lock the instance out of itself gets its own
           acknowledgement; switching it back OFF is the safe direction and confirms nothing. -->
      <ODialog
        :open="rootDialogOpen"
        data-test="settings-password-policy-root-dialog"
        size="sm"
        :title="t('passwordPolicy.rootDialogTitle')"
        :secondary-button-label="t('common.cancel')"
        :primary-button-label="t('passwordPolicy.rootDialogConfirm')"
        primary-button-variant="destructive"
        :primary-button-disabled="!rootAcknowledged"
        @update:open="(open: boolean) => !open && cancelApplyToRoot()"
        @click:secondary="cancelApplyToRoot"
        @click:primary="rootDialogOpen = false"
      >
        <div class="flex flex-col gap-4">
          <OBanner
            variant="error"
            icon="warning"
            dense
            :content="t('passwordPolicy.rootWarning')"
          />
          <p class="text-text-body text-sm">{{ t("passwordPolicy.rootDialogMessage") }}</p>
          <OCheckbox
            v-model="rootAcknowledged"
            :label="t('passwordPolicy.rootDialogAck')"
            data-test="settings-password-policy-root-ack"
          />
        </div>
      </ODialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";

import { useConfirmDialog } from "@/composables/useConfirmDialog";
import OButton from "@/lib/core/Button/OButton.vue";
import { OEmptyState } from "@/lib/core/EmptyState";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import passwordPolicy, { type PasswordPolicy } from "@/services/passwordPolicy";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatDate } from "@/utils/date";
import { durationFormatter } from "@/utils/formatters";

import {
  buildPolicyPayload,
  INITIAL_POLICY,
  lockoutLadder,
  makePolicySchema,
  policyDefaults,
  type PolicyForm,
} from "./PasswordPolicy.schema";

const DAY_MS = 86_400_000;

const { t } = useI18nTyped();
const store = useStore();
const { confirm } = useConfirmDialog();

// The WHOLE policy as the server returned it. Held rather than reduced to the edited fields
// because the PUT is a full replacement — see buildPolicyPayload.
const loadedPolicy = ref<PasswordPolicy | null>(null);
const loading = ref(true);
const forbidden = ref(false);
const loadError = ref(false);
const rootDialogOpen = ref(false);
const rootAcknowledged = ref(false);

const schema = makePolicySchema(t);
const formDefaults = ref<PolicyForm>(policyDefaults(INITIAL_POLICY));

const form = useOForm<PolicyForm>({
  defaultValues: formDefaults.value,
  schema,
  onSubmit: (values) => save(values),
});

const values = form.useStore((s: any) => s.values as PolicyForm);

const backoffOptions = [
  { label: t("passwordPolicy.backoffExponential"), value: "exponential" },
  { label: t("passwordPolicy.backoffLinear"), value: "linear" },
];
const enforcementOptions = [
  { label: t("passwordPolicy.enforcementHardBlock"), value: "hard_block" },
  { label: t("passwordPolicy.enforcementRestrictWrites"), value: "restrict_writes" },
];

const rotationOn = computed(() => Number(values.value.rotation_days) > 0);
const lockoutOn = computed(() => Number(values.value.lockout.threshold) > 0);

// Two integers do not communicate a date; the two dates an operator reasons about do.
const rotationPreview = computed(() => {
  const days = Number(values.value.rotation_days);
  const warn = Number(values.value.rotation_warning_days);
  const expires = raw(formatDate(Date.now() + days * DAY_MS, "MMM D, YYYY"));
  if (warn <= 0) return t("passwordPolicy.rotationPreviewNoWarning", { expires });
  const warns = raw(formatDate(Date.now() + (days - warn) * DAY_MS, "MMM D, YYYY"));
  return t("passwordPolicy.rotationPreview", { expires, warns });
});

const lockoutPreview = computed(() => {
  const lockout = values.value.lockout;
  const [first, ...rest] = lockoutLadder(lockout).map((secs) => durationFormatter(secs));
  return t("passwordPolicy.lockoutPreview", {
    threshold: Number(lockout.threshold),
    // 0 reuses the first threshold for every later lockout.
    bucket: Number(lockout.bucket_size) || Number(lockout.threshold),
    first: raw(first),
    rest: raw(rest.join(", ")),
    max: raw(durationFormatter(Number(lockout.max_secs))),
  });
});

const isDirty = computed(() => {
  if (!loadedPolicy.value) return false;
  // Compare the payload this form would send, not the raw field values: a number input hands back
  // a string, so retyping the same number would otherwise read as a change.
  return (
    JSON.stringify(buildPolicyPayload(loadedPolicy.value, values.value)) !==
    JSON.stringify(loadedPolicy.value)
  );
});

const metaOrg = computed(() => store.state.zoConfig?.meta_org);

const loadPolicy = async () => {
  loading.value = true;
  forbidden.value = false;
  loadError.value = false;

  try {
    const response: any = await passwordPolicy.getPolicy(metaOrg.value);
    loadedPolicy.value = response.data;
    formDefaults.value = policyDefaults(response.data);
    form.reset(formDefaults.value);
  } catch (error: any) {
    // Two different 403s reach this page. The middleware's carries a code and means "you are an
    // admin, you just flagged yourself" — the reset dialog is already opening for it, so telling
    // this user they are not an administrator would be wrong and confusing.
    if (error?.response?.data?.code === "password_reset_required") return;
    if (error?.response?.status === 403) forbidden.value = true;
    else loadError.value = true;
  } finally {
    loading.value = false;
  }
};

const resetForm = () => {
  form.reset(formDefaults.value);
};

const onApplyToRootChange = (on: unknown) => {
  if (!on) return;
  rootAcknowledged.value = false;
  rootDialogOpen.value = true;
};

// The switch must not stay on behind a dialog the operator dismissed.
const cancelApplyToRoot = () => {
  rootDialogOpen.value = false;
  form.setFieldValue("apply_to_root", false);
};

const save = async (formValues: PolicyForm) => {
  if (!loadedPolicy.value) return;

  // Every save confirms, not only a tightening. The frontend deliberately holds no copy of the
  // server's is_stricter_than(): the sweep it triggers cannot be undone — there is no un-flag
  // endpoint, and loosening the policy back clears nothing — so the value of asking is that it
  // happens BEFORE the write, not that it is precisely targeted.
  const confirmed = await confirm({
    title: t("passwordPolicy.confirmTitle"),
    message: t("passwordPolicy.confirmMessage"),
    confirmLabel: t("settings.saveChanges"),
  });
  if (!confirmed) return;

  try {
    const response: any = await passwordPolicy.updatePolicy(
      metaOrg.value,
      buildPolicyPayload(loadedPolicy.value, formValues),
    );
    loadedPolicy.value = response.data.policy;
    formDefaults.value = policyDefaults(response.data.policy);
    form.reset(formDefaults.value);

    const flagged = response.data.users_flagged ?? 0;
    toast({
      variant: "success",
      message: t("passwordPolicy.saved", { count: flagged }, flagged),
    });
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("passwordPolicy.saveFailed"),
    });
  }
};

onMounted(loadPolicy);
</script>
