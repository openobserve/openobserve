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

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import SlackLinkCard from "@/components/slack/SlackLinkCard.vue";
import { useSlackLinkOrg } from "@/composables/slack/useSlackLinkOrg";
import { ensureBrowserRum } from "@/utils/rum/ensureBrowserRum";
import OButton from "@/lib/core/Button/OButton.vue";
import type { IllustrationName } from "@/lib/core/EmptyState/illustrations";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { confirmConnectionMutation } from "@/services/slack.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { SlackConnectionConfirmResponse } from "@/types/slack";
import { queryString, statusOf } from "@/utils/slackLink";
import { SLACK_OAUTH_MESSAGE_TYPE, type SlackOAuthCallbackMessage } from "@/utils/slackOAuth";

interface Refused {
  title: I18nText;
  detail: I18nText;
}

interface Outcome extends Refused {
  illustration: IllustrationName;
  dataTest: string;
  refused: boolean;
}

const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

const { org, whenResolved } = useSlackLinkOrg();
const result = ref<SlackConnectionConfirmResponse | null>(null);
const refused = ref<Refused | null>(null);
const handedOff = ref(false);

const confirm = useMutation(() => confirmConnectionMutation(org.value));

const stripCallbackQuery = (): void => {
  window.history.replaceState({}, document.title, window.location.pathname);
};

const refusalOf = (error: unknown): Refused => {
  const status = statusOf(error);
  if (status === 400 || status === 410) {
    return {
      title: t("slackApp.connectCallback.expiredTitle"),
      detail: t("slackApp.connectCallback.restart"),
    };
  }
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = typeof data?.message === "string" && data.message ? raw(data.message) : null;
  return {
    title: t("slackApp.connectCallback.failedTitle"),
    detail: status === 403 && message ? message : t("slackApp.connectCallback.restart"),
  };
};

// Connect existing (A1) and the Step 4 test open this page in a popup; their opener confirms.
const handOff = (opener: Window, code: string, state: string, error: string): void => {
  const message: SlackOAuthCallbackMessage = error
    ? { type: SLACK_OAUTH_MESSAGE_TYPE, error }
    : { type: SLACK_OAUTH_MESSAGE_TYPE, code, state };
  opener.postMessage(message, window.location.origin);
  handedOff.value = true;
  window.close();
};

const confirmHere = async (code: string, state: string): Promise<void> => {
  try {
    result.value = await confirm.mutateAsync({ oidc_code: code, oidc_state: state });
    stripCallbackQuery();
  } catch (error) {
    // The 401 handler signs in again and reloads this URL, which must still carry the code.
    if (statusOf(error) === 401) return;
    stripCallbackQuery();
    refused.value = refusalOf(error);
  }
};

const outcome = computed<Outcome | null>(() => {
  if (result.value && "test" in result.value) {
    return {
      illustration: "check",
      title: t("slackApp.connectCallback.testTitle"),
      detail: t("slackApp.connectCallback.testDetail"),
      dataTest: "slack-connect-callback-test",
      refused: false,
    };
  }
  if (result.value) {
    return {
      illustration: "check",
      title: t("slackApp.connectCallback.connectedTitle"),
      detail: t("slackApp.connectCallback.connectedDetail"),
      dataTest: "slack-connect-callback-connected",
      refused: false,
    };
  }
  if (refused.value) {
    return {
      illustration: "broken-panel",
      ...refused.value,
      dataTest: "slack-connect-callback-refused",
      refused: true,
    };
  }
  return null;
});

const openSettings = (): void => {
  void router.push({ name: "slack", query: { org_identifier: org.value } });
};

onMounted(() => {
  whenResolved(() => void ensureBrowserRum(org.value));
  const error = queryString(route.query.error);
  const code = queryString(route.query.code);
  const state = queryString(route.query.state);
  const opener: Window | null = window.opener;
  if (opener && (error || (code && state))) {
    stripCallbackQuery();
    handOff(opener, code, state, error);
    return;
  }
  if (error || !code || !state) {
    stripCallbackQuery();
    refused.value = {
      title: t("slackApp.connectCallback.failedTitle"),
      detail: t("slackApp.connectCallback.restart"),
    };
    return;
  }
  whenResolved(() => {
    if (org.value) {
      void confirmHere(code, state);
      return;
    }
    stripCallbackQuery();
    refused.value = {
      title: t("slackApp.link.noAccessTitle"),
      detail: t("slackApp.link.helpContactDefault"),
    };
  });
});
</script>

<template>
  <OPageLayout
    :title="t('slackApp.connectCallback.pageTitle')"
    constrained
    content-size="sm"
    data-test="slack-connect-callback-page"
  >
    <div class="py-6">
      <SlackLinkCard
        v-if="outcome"
        :illustration="outcome.illustration"
        :title="outcome.title"
        :description="outcome.detail"
        :data-test="outcome.dataTest"
      >
        <template #actions>
          <OButton
            :variant="outcome.refused ? 'outline' : 'primary'"
            size="sm-action"
            data-test="slack-connect-callback-settings"
            @click="openSettings"
          >
            {{ t("slackApp.connectCallback.openSettings") }}
          </OButton>
        </template>
      </SlackLinkCard>
      <SlackLinkCard
        v-else
        working
        :title="
          handedOff
            ? t('alert_destinations.slackOAuth.callbackWorking', { product: raw('OpenObserve') })
            : t('slackApp.connectCallback.working')
        "
      />
    </div>
  </OPageLayout>
</template>
