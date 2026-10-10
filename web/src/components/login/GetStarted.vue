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
  <!-- Header and footer live here, not in the dialog, because the form state drives both buttons. -->
  <div
    class="-mx-dialog-content-px -my-dialog-content-py flex flex-col"
    data-test="onboarding-get-started"
  >
    <div
      class="bg-dialog-header-bg border-dialog-header-border px-dialog-header-px py-dialog-header-py border-b"
    >
      <div
        class="text-dialog-header-text text-base font-semibold"
        data-test="onboarding-get-started-title"
      >
        {{ t("login.getStarted.title") }}
      </div>
      <div class="text-text-secondary mt-0.5 text-sm" data-test="onboarding-get-started-subtitle">
        {{ t("login.getStarted.subtitle") }}
      </div>
    </div>
    <OForm :form="form" class="flex flex-col">
      <div class="px-dialog-content-px py-dialog-content-py flex flex-col gap-4">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <OFormInput
            name="hearAboutUs"
            data-test="onboarding-get-started-hear-about-us"
            class="w-full"
            :label="t('login.hearAboutUsLabel')"
            required
            :disabled="busy"
            :placeholder="t('login.getStarted.hearAboutUsPlaceholder')"
          />
          <OFormInput
            name="whereDoYouWork"
            data-test="onboarding-get-started-where-do-you-work"
            class="w-full"
            :label="t('login.whereDoYouWorkLabel')"
            required
            :disabled="busy"
            :placeholder="t('login.getStarted.whereDoYouWorkPlaceholder')"
          />
        </div>
        <div class="flex flex-col gap-2">
          <span class="text-input-label-text text-sm font-medium">
            {{ t("login.getStarted.sourceLabel") }}
            <span class="text-text-secondary font-normal">{{
              t("login.getStarted.optional")
            }}</span>
          </span>
          <OFormRadioGroup
            name="firstSource"
            :label="t('login.getStarted.sourceLabel')"
            :disabled="busy"
            data-test="onboarding-get-started-source-grid"
          >
            <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
              <ORadio
                v-for="option in FIRST_SOURCE_OPTIONS"
                :key="option.id"
                :value="option.id"
                variant="card"
                :disabled="busy"
                :data-test="`onboarding-get-started-source-${option.id}`"
              >
                <template #label>
                  <span class="flex items-center gap-2">
                    <img
                      v-if="option.logo"
                      :src="getImageURL(option.logo)"
                      alt=""
                      class="size-4 shrink-0"
                      :class="{ 'dark:invert': option.logoInvertDark }"
                    />
                    <OIcon v-else-if="option.icon" :name="option.icon" size="sm" class="shrink-0" />
                    <span>{{ t(option.labelKey) }}</span>
                  </span>
                </template>
              </ORadio>
            </div>
          </OFormRadioGroup>
        </div>
        <div class="flex flex-col gap-1">
          <OFormCheckbox
            name="isAgree"
            data-test="onboarding-get-started-agree-checkbox"
            :disabled="busy"
          >
            <template #label>
              <span class="text-sm">
                {{ t("login.agreeToTermsPrefix") }}
                <a
                  href="https://openobserve.ai/legal/terms-of-service/"
                  target="_blank"
                  rel="noopener"
                  class="text-text-link hover:underline"
                  data-test="onboarding-get-started-terms-link"
                  >{{ t("login.getStarted.termsOfService") }}</a
                >
                {{ t("login.and") }}
                <a
                  href="https://openobserve.ai/legal/privacy-policy/"
                  target="_blank"
                  rel="noopener"
                  class="text-text-link hover:underline"
                  data-test="onboarding-get-started-privacy-link"
                  >{{ t("login.getStarted.privacyPolicy") }}</a
                >
              </span>
            </template>
          </OFormCheckbox>
          <p
            class="text-text-secondary m-0 ps-6 text-xs"
            data-test="onboarding-get-started-agree-hint"
          >
            {{ t("login.getStarted.agreeHint") }}
          </p>
        </div>
      </div>
      <div
        class="bg-dialog-footer-bg border-dialog-footer-border px-dialog-footer-px py-dialog-footer-py flex items-center justify-end gap-2 border-t"
      >
        <OButton
          data-test="onboarding-get-started-skip-btn"
          variant="ghost"
          size="sm-action"
          type="button"
          :disabled="!isAgree || busy"
          :loading="skipping"
          @click="skip"
        >
          {{ t("login.getStarted.skip") }}
        </OButton>
        <OButton
          data-test="onboarding-get-started-submit-btn"
          variant="primary"
          size="sm-action"
          type="submit"
          :disabled="!isAgree || busy"
          :loading="isSubmitting"
        >
          {{ t("login.getStarted.continue") }}
        </OButton>
      </div>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import { makeGetStartedSchema, getStartedDefaults, type GetStartedForm } from "./GetStarted.schema";
import {
  FIRST_SOURCE_OPTIONS,
  clearPrefill,
  firstSourceOption,
  prefillFirstSource,
  readPrefill,
  writeFirstSource,
  type FirstSourceId,
} from "./firstSourceOptions";
import billings from "@/services/billings";
import analytics from "@/services/product_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import { connectDataPromptSessionKey } from "@/utils/slackCommunityInvite";

interface GetStartedAnswers {
  from: string;
  company: string;
  firstSource?: FirstSourceId;
  skipped: boolean;
}

const CONNECT_PROMPT_PENDING_KEY = "connectDataSourcePromptPending";

const store = useStore();
const router = useRouter();
const route = useRoute();
const { t } = useI18nTyped();
const emit = defineEmits(["removeFirstTimeLogin"]);

const orgId = (): string => store.state.selectedOrganization?.identifier ?? "";

// Login has already followed a redirectURI or marketplace link by now, so landing anywhere but Home means one was pending.
const redirectPending = (): boolean => {
  if (route?.name !== "home") return true;
  try {
    const session = window.sessionStorage;
    if (session.getItem("redirectURI") || session.getItem("azure_marketplace_token")) return true;
  } catch {
    // Unreadable storage holds no pending redirect.
  }
  return document.cookie.split("; ").some((c) => c.startsWith("aws_marketplace_token="));
};

// The guide replaces the connect-data-source popup this session, the way the popup marks itself shown.
const suppressConnectPrompt = () => {
  try {
    window.sessionStorage.setItem(
      connectDataPromptSessionKey(store.state.userInfo?.email ?? "anonymous"),
      "true",
    );
    window.localStorage.removeItem(CONNECT_PROMPT_PENDING_KEY);
  } catch {
    // Without storage the popup may still open over the guide; routing goes ahead.
  }
};

const finish = (answers: GetStartedAnswers) => {
  const org = orgId();
  if (answers.firstSource) writeFirstSource(org, answers.firstSource);
  clearPrefill();
  localStorage.removeItem("isFirstTimeLogin");
  emit("removeFirstTimeLogin", false);
  const guideRoute = redirectPending() ? undefined : firstSourceOption(answers.firstSource)?.route;
  if (guideRoute) suppressConnectPrompt();
  // Notify first-login follow-ups (e.g. the community Slack invite) that the onboarding form is done.
  window.dispatchEvent(new CustomEvent("o2:onboarding-complete"));
  const firstSource = answers.firstSource ?? null;
  analytics.track("onboarding_get_started_submitted", {
    first_source: firstSource,
    skipped: answers.skipped,
  });
  if (answers.skipped) {
    analytics.track("onboarding_questions_skipped", { first_source: firstSource });
  } else {
    toast({ message: t("toastMessages.login.thankYouForYourFeedback"), variant: "success" });
  }
  if (guideRoute) router.push({ name: guideRoute, query: { org_identifier: org } });
};

const sendAnswers = async (answers: GetStartedAnswers): Promise<boolean> => {
  try {
    const res = await billings.submit_new_user_info(orgId(), {
      from: answers.from,
      company: answers.company,
      first_source: answers.firstSource,
      skipped: answers.skipped,
    });
    if (res.status === 200) {
      finish(answers);
      return true;
    }
  } catch {
    // A rejected call gets the same toast as a non-200 answer; the dialog keeps every answer.
  }
  toast({ message: t("toastMessages.login.somethingWentWrong"), variant: "error" });
  return false;
};

const doSubmit = (value: GetStartedForm) =>
  sendAnswers({
    from: value.hearAboutUs,
    company: value.whereDoYouWork,
    firstSource: firstSourceOption(value.firstSource)?.id,
    skipped: false,
  });

const form = useOForm<GetStartedForm>({
  defaultValues: getStartedDefaults(prefillFirstSource(readPrefill())),
  schema: makeGetStartedSchema(t),
  onSubmit: doSubmit,
});
const isAgree = form.useStore((s) => s.values.isAgree);
const isSubmitting = form.useStore((s) => s.isSubmitting);
const skipping = ref(false);
const busy = computed(() => !!isSubmitting.value || skipping.value);

const skip = async () => {
  if (busy.value || !isAgree.value) return;
  skipping.value = true;
  try {
    await sendAnswers({
      from: "",
      company: "",
      firstSource: firstSourceOption(form.state.values.firstSource)?.id,
      skipped: true,
    });
  } finally {
    skipping.value = false;
  }
};
</script>
