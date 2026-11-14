<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { SLACK_OAUTH_MESSAGE_TYPE, type SlackOAuthCallbackMessage } from "@/utils/slackOAuth";

const route = useRoute();
const { t } = useI18nTyped();
const failed = ref(false);

const queryString = (value: unknown): string => {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
};

onMounted(() => {
  const error = queryString(route.query.error);
  const code = queryString(route.query.code);
  const state = queryString(route.query.state);
  window.history.replaceState({}, document.title, window.location.pathname);

  const opener = window.opener;
  if (!opener || (!error && (!code || !state))) {
    failed.value = true;
    return;
  }

  const message: SlackOAuthCallbackMessage = error
    ? { type: SLACK_OAUTH_MESSAGE_TYPE, error }
    : { type: SLACK_OAUTH_MESSAGE_TYPE, code, state };
  opener.postMessage(message, window.location.origin);
  window.close();
});
</script>

<template>
  <OPageLayout
    :title="t('alert_destinations.slackOAuth.callbackTitle')"
    constrained
    data-test="slack-oauth-callback-page"
  >
    <div class="flex min-h-48 items-center justify-center">
      <OInlineNotice v-if="failed" tone="err" data-test="slack-oauth-callback-error">
        {{ t("alert_destinations.slackOAuth.callbackError") }}
      </OInlineNotice>
      <div v-else class="text-text-secondary flex items-center gap-3 text-sm">
        <OSpinner size="lg" />
        <span>{{
          t("alert_destinations.slackOAuth.callbackWorking", { product: raw("OpenObserve") })
        }}</span>
      </div>
    </div>
  </OPageLayout>
</template>
