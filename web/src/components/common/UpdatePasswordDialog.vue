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
  <q-dialog
    :model-value="isOpen"
    :persistent="!dismissible"
    data-test="password-reset-dialog"
    @update:model-value="(open: boolean) => !open && close()"
  >
    <q-card class="tw:w-[32rem] tw:max-w-full">
      <q-card-section class="tw:flex tw:items-start tw:justify-between">
        <div>
          <div class="text-h6">{{ t("passwordReset.title") }}</div>
          <div class="text-caption text-grey-7">
            {{ t("passwordReset.signedInAs", { email: userEmail }) }}
          </div>
        </div>
        <q-btn
          v-if="dismissible"
          flat
          round
          dense
          icon="close"
          @click="close"
        />
      </q-card-section>

      <q-card-section class="tw:pt-0">
        <q-banner
          dense
          class="bg-warning text-black tw:mb-4 tw:rounded"
          data-test="password-reset-dialog-banner"
        >
          <template #avatar>
            <q-icon name="warning" size="18px" />
          </template>
          {{ bannerMessage }}
        </q-banner>

        <q-form
          ref="formRef"
          class="tw:flex tw:flex-col tw:gap-2"
          @submit="submit"
        >
          <q-input
            v-model="oldPassword"
            data-test="password-reset-dialog-current-password"
            :type="showPassword ? 'text' : 'password'"
            :label="t('passwordReset.currentPassword') + ' *'"
            autocomplete="current-password"
            stack-label
            outlined
            dense
            :rules="[
              (v: string) => !!v || t('passwordReset.currentPasswordRequired'),
            ]"
          />

          <div>
            <q-input
              v-model="newPassword"
              data-test="password-reset-dialog-new-password"
              :type="showPassword ? 'text' : 'password'"
              :label="t('passwordReset.newPassword') + ' *'"
              autocomplete="new-password"
              stack-label
              outlined
              dense
              :error="!!serverError"
              :error-message="serverError"
              :rules="[newPasswordRule]"
            >
              <template #append>
                <q-icon
                  :name="showPassword ? 'visibility_off' : 'visibility'"
                  class="cursor-pointer"
                  @click="showPassword = !showPassword"
                />
              </template>
            </q-input>

            <PasswordRequirementList
              :requirements="requirements"
              :password="newPassword"
              show-strength
              data-test="password-reset-dialog-requirements"
            />
          </div>

          <q-input
            v-model="confirmPassword"
            data-test="password-reset-dialog-confirm-password"
            :type="showPassword ? 'text' : 'password'"
            :label="t('passwordReset.confirmPassword') + ' *'"
            autocomplete="new-password"
            stack-label
            outlined
            dense
            :rules="[confirmPasswordRule]"
          />

          <div class="tw:flex tw:justify-end tw:gap-2 tw:mt-2">
            <q-btn
              v-if="dismissible"
              flat
              no-caps
              :label="t('common.cancel')"
              @click="close"
            />
            <q-btn
              v-else
              flat
              no-caps
              :label="t('passwordReset.signOut')"
              data-test="password-reset-dialog-sign-out"
              @click="signOut"
            />
            <q-btn
              type="submit"
              color="primary"
              no-caps
              :loading="submitting"
              :label="t('passwordReset.submit')"
              data-test="password-reset-dialog-submit"
            />
          </div>
        </q-form>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { usePasswordComplexity } from "@/composables/usePasswordComplexity";
import {
  remediationOrg,
  usePasswordReset,
} from "@/composables/usePasswordReset";
import userService from "@/services/users";
import {
  reuseRejection,
  type TranslateFn,
  validateAgainstComplexity,
} from "@/utils/passwordComplexity";
import {
  invalidateLoginData,
  useLocalCurrentUser,
  useLocalUserInfo,
} from "@/utils/zincutils";

import PasswordRequirementList from "./PasswordRequirementList.vue";

const { t } = useI18n();
const q = useQuasar();
const store = useStore();
const router = useRouter();

const { isOpen, reason, dismissible, close } = usePasswordReset();
const { complexity, requirements, load } = usePasswordComplexity();

const formRef = ref();
const oldPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const showPassword = ref(false);
const submitting = ref(false);
const serverError = ref("");

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
const newPasswordRule = (value: string) =>
  !value
    ? t("passwordReset.newPasswordRequired")
    : (validateAgainstComplexity(value, complexity.value, t as TranslateFn) ??
      true);

const confirmPasswordRule = (value: string) => {
  if (!value) return t("passwordReset.confirmPasswordRequired");
  return value === newPassword.value || t("passwordReset.mismatch");
};

// A server error is not re-validated on change, so it would block every later submit unless cleared.
watch(newPassword, () => (serverError.value = ""));

watch(
  isOpen,
  (open) => {
    if (!open) return;
    oldPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    serverError.value = "";
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

const submit = async () => {
  submitting.value = true;
  try {
    await userService.update(
      {
        change_password: true,
        old_password: oldPassword.value,
        new_password: newPassword.value,
      },
      remediationOrg(store),
      userEmail.value,
    );
  } catch (error: any) {
    // A reuse rejection belongs on the field, not a toast: every checklist row is ticked.
    const reused = reuseRejection(error, t as TranslateFn);
    if (reused) {
      serverError.value = reused;
      return;
    }
    q.notify({
      type: "negative",
      message:
        error?.response?.data?.message || t("passwordReset.updateFailed"),
    });
    return;
  } finally {
    submitting.value = false;
  }

  // The session cookie IS the password, so the browser's credential went stale the moment the change landed.
  q.notify({ type: "positive", message: t("passwordReset.updated") });
  signOut();
};
</script>
