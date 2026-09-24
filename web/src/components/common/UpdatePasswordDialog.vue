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
  <!-- Blocked: no close button, since every other request is refused until the password changes. -->
  <ODialog
    v-if="isOpen"
    data-test="password-reset-dialog"
    :open="isOpen"
    :persistent="!dismissible"
    :show-close="dismissible"
    size="md"
    :title="t('passwordReset.title')"
    :sub-title="t('passwordReset.signedInAs', { email: raw(userEmail) })"
    :neutral-button-label="dismissible ? undefined : t('passwordReset.signOut')"
    :secondary-button-label="dismissible ? t('common.cancel') : undefined"
    :primary-button-label="t('passwordReset.submit')"
    form-id="update-password-form"
    @click:neutral="signOut"
    @click:secondary="close"
    @update:open="(open: boolean) => !open && close()"
  >
    <div class="flex flex-col gap-4">
      <OBanner
        variant="warning"
        icon="warning"
        :content="bannerMessage"
        data-test="password-reset-dialog-banner"
      />

      <OForm id="update-password-form" :form="form" class="flex flex-col gap-5">
        <OFormInput
          data-test="password-reset-dialog-current-password"
          name="old_password"
          type="password"
          revealable
          :label="t('passwordReset.currentPassword')"
          required
          autocomplete="current-password"
        />

        <div>
          <OFormInput
            data-test="password-reset-dialog-new-password"
            name="new_password"
            type="password"
            revealable
            :label="t('passwordReset.newPassword')"
            required
            autocomplete="new-password"
          />

          <PasswordRequirementList
            :requirements="requirements"
            :password="newPassword"
            show-strength
            data-test="password-reset-dialog-requirements"
          />
        </div>

        <OFormInput
          data-test="password-reset-dialog-confirm-password"
          name="confirm_password"
          type="password"
          revealable
          :label="t('passwordReset.confirmPassword')"
          required
          autocomplete="new-password"
        />
      </OForm>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { usePasswordComplexity } from "@/composables/usePasswordComplexity";
import { remediationOrg, usePasswordReset } from "@/composables/usePasswordReset";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { setServerFieldErrors, useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import userService from "@/services/users";
import { raw, useI18nTyped } from "@/types/i18n";
import { reuseRejection } from "@/utils/passwordComplexity";
import { invalidateLoginData, useLocalCurrentUser, useLocalUserInfo } from "@/utils/zincutils";

import PasswordRequirementList from "./PasswordRequirementList.vue";
import {
  makeUpdatePasswordSchema,
  updatePasswordDefaults,
  type UpdatePasswordForm,
} from "./UpdatePasswordDialog.schema";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const { isOpen, reason, dismissible, close } = usePasswordReset();
const { complexity, requirements, load } = usePasswordComplexity();

const userEmail = computed(() => store.state.userInfo?.email ?? "");

const bannerMessage = computed(() => {
  switch (reason.value) {
    case "rotation_expired":
      return t("passwordReset.reasonRotationExpired");
    case "rotation_warning":
      return t("passwordReset.reasonRotationWarning");
    default:
      return t("passwordReset.reasonPolicyTightened");
  }
});

// Reads the complexity on every run: the policy may arrive after the dialog has opened.
const schema = makeUpdatePasswordSchema(() => complexity.value, t);

// Headless so the owner can pin the server's reuse rejection onto the field.
const form = useOForm<UpdatePasswordForm>({
  defaultValues: updatePasswordDefaults(),
  schema,
  onSubmit: (values) => submit(values),
});

const newPassword = form.useStore((s) => s.values.new_password);

// A server error is not re-validated on change, so it would block every later submit unless cleared.
watch(newPassword, () => setServerFieldErrors(form, {}));

watch(
  isOpen,
  (open) => {
    if (!open) return;
    form.reset(updatePasswordDefaults());
    // A failed fetch is not fatal: the form still submits and the server still validates.
    load();
  },
  { immediate: true },
);

const signOut = () => {
  invalidateLoginData();
  store.dispatch("logout");
  useLocalCurrentUser("", true);
  useLocalUserInfo("", true);
  close();
  router.push("/logout");
};

const submit = async (values: UpdatePasswordForm) => {
  try {
    await userService.update(
      {
        change_password: true,
        old_password: values.old_password,
        new_password: values.new_password,
      },
      remediationOrg(store),
      userEmail.value,
    );
  } catch (error: any) {
    // A reuse rejection belongs on the field, not a toast: every checklist row is ticked.
    const reused = reuseRejection(error, t);
    if (reused) {
      setServerFieldErrors(form, { new_password: reused });
      return;
    }
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("passwordReset.updateFailed"),
    });
    return;
  }

  // The session cookie IS the password, so the browser's credential went stale the moment the change landed.
  toast({ variant: "success", message: t("passwordReset.updated") });
  signOut();
};
</script>
