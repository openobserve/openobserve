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
      <!-- Headless form: the owner reads it (form.useStore) to show the special-character row
           only while the requirement is on, and to compare against the loaded values. -->
      <OForm id="password-policy-form" :form="form" v-slot="{ isSubmitting }">
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
            v-if="requireSpecial"
            :label="t('passwordPolicy.specialCharSet')"
            :description="t('passwordPolicy.specialCharSetDesc')"
            data-test="settings-password-policy-special-char-set"
          >
            <OFormInput name="special_char_set" class="w-56" :placeholder="raw('!@#$%^&*()')" />
          </OSettingRow>
        </OFormSection>

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
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import passwordPolicy, { type PasswordPolicy } from "@/services/passwordPolicy";
import { raw, useI18nTyped } from "@/types/i18n";

import {
  buildPolicyPayload,
  complexityDefaults,
  makeComplexitySchema,
  type ComplexityForm,
} from "./PasswordPolicy.schema";

const { t } = useI18nTyped();
const store = useStore();
const { confirm } = useConfirmDialog();

// The WHOLE policy as the server returned it. Held rather than reduced to the seven edited fields
// because the PUT is a full replacement — see buildPolicyPayload.
const loadedPolicy = ref<PasswordPolicy | null>(null);
const loading = ref(true);
const forbidden = ref(false);
const loadError = ref(false);

const schema = makeComplexitySchema(t);
const formDefaults = ref<ComplexityForm>(
  complexityDefaults({
    min_length: 8,
    max_length: 0,
    require_uppercase: false,
    require_lowercase: false,
    require_digit: false,
    require_special: false,
    special_char_set: "",
  }),
);

const form = useOForm<ComplexityForm>({
  defaultValues: formDefaults.value,
  schema,
  onSubmit: (values) => save(values),
});

const requireSpecial = form.useStore((s: any) => s.values.require_special);
const currentValues = form.useStore((s: any) => s.values);

const isDirty = computed(() => {
  if (!loadedPolicy.value) return false;
  // Compare the payload this form would send, not the raw field values: a number input hands back
  // a string, so retyping the same number would otherwise read as a change.
  return (
    JSON.stringify(buildPolicyPayload(loadedPolicy.value, currentValues.value)) !==
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
    formDefaults.value = complexityDefaults(response.data);
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

const save = async (values: ComplexityForm) => {
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
      buildPolicyPayload(loadedPolicy.value, values),
    );
    loadedPolicy.value = response.data.policy;
    formDefaults.value = complexityDefaults(response.data.policy);
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
