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
  <!-- Blocked: persistent with no close button — the two ways out are setting a new password or
       signing out, and everything else on the instance is refused until one of them happens.
       Opened voluntarily from the expiry banner it is an ordinary, cancellable dialog. -->
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
    <div
      data-test="password-reset-dialog-banner"
      class="bg-banner-warning-bg border-banner-warning-border rounded-default mb-4 flex items-start gap-2 border p-3"
    >
      <OIcon name="warning" size="sm" class="text-banner-warning-text mt-0.5 shrink-0" />
      <span class="text-banner-warning-text text-sm">{{ bannerMessage }}</span>
    </div>

    <OForm id="update-password-form" :form="form" class="flex flex-col gap-5">
      <OFormInput
        data-test="password-reset-dialog-current-password"
        name="old_password"
        :type="isOldPwdHidden ? 'password' : 'text'"
        :label="t('passwordReset.currentPassword')"
        required
        autocomplete="current-password"
      >
        <template #icon-right>
          <OIcon
            :name="isOldPwdHidden ? 'visibility-off' : 'visibility'"
            size="sm"
            class="cursor-pointer"
            @click="isOldPwdHidden = !isOldPwdHidden"
          />
        </template>
      </OFormInput>

      <div>
        <OFormInput
          data-test="password-reset-dialog-new-password"
          name="new_password"
          :type="isNewPwdHidden ? 'password' : 'text'"
          :label="t('passwordReset.newPassword')"
          required
          autocomplete="new-password"
          @update:model-value="onNewPasswordInput"
        >
          <template #icon-right>
            <OIcon
              :name="isNewPwdHidden ? 'visibility-off' : 'visibility'"
              size="sm"
              class="cursor-pointer"
              @click="isNewPwdHidden = !isNewPwdHidden"
            />
          </template>
        </OFormInput>

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
        :type="isConfirmPwdHidden ? 'password' : 'text'"
        :label="t('passwordReset.confirmPassword')"
        required
        autocomplete="new-password"
      >
        <template #icon-right>
          <OIcon
            :name="isConfirmPwdHidden ? 'visibility-off' : 'visibility'"
            size="sm"
            class="cursor-pointer"
            @click="isConfirmPwdHidden = !isConfirmPwdHidden"
          />
        </template>
      </OFormInput>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { usePasswordComplexity } from "@/composables/usePasswordComplexity";
import { remediationOrg, usePasswordReset } from "@/composables/usePasswordReset";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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

const isOldPwdHidden = ref(true);
const isNewPwdHidden = ref(true);
const isConfirmPwdHidden = ref(true);
// Mirrored out of the form purely to drive the live checklist and strength bar; the form field
// itself stays the single source of truth for the value that gets submitted.
const newPassword = ref("");

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

// Reads the complexity on every run, so the schema instance created here follows the policy
// arriving after the dialog has already opened.
const schema = makeUpdatePasswordSchema(() => complexity.value, t);

// Headless so the owner can pin the server's reuse rejection onto the field.
const form = useOForm<UpdatePasswordForm>({
  defaultValues: updatePasswordDefaults(),
  schema,
  onSubmit: (values) => submit(values),
});

// A server error is not re-validated on change, so it would block every later submit unless
// cleared once the user starts over.
const onNewPasswordInput = (value: unknown) => {
  newPassword.value = String(value ?? "");
  setServerFieldErrors(form, {});
};

watch(
  isOpen,
  (open) => {
    if (!open) return;
    newPassword.value = "";
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
    // A reuse rejection belongs on the field: a toast would leave the user staring at a fully
    // ticked checklist with no idea what to change.
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

  // The session cookie IS the password (Basic email:password, re-verified per request), so the
  // credential in the browser went stale the moment the change landed — every later call would
  // 401. Signing out is the only correct end to this flow.
  toast({ variant: "success", message: t("passwordReset.updated") });
  signOut();
};
</script>
