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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import SlackLinkCard from "@/components/slack/SlackLinkCard.vue";
import SlackLinkRefusal from "@/components/slack/SlackLinkRefusal.vue";
import { useSlackLinkOrg } from "@/composables/slack/useSlackLinkOrg";
import { ensureBrowserRum } from "@/utils/rum/ensureBrowserRum";
import OButton from "@/lib/core/Button/OButton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { confirmLinkRequestMutation, resendLinkRequestMutation } from "@/services/slack.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { SlackLinkRequestConfirmResponse } from "@/types/slack";
import {
  classifySlackLinkError,
  forgetLinkRequest,
  isSafeReturnUrl,
  leaveFor,
  parseLinkRequestParam,
  queryString,
  recallLinkRequest,
  statusOf,
  type SlackLinkRefusal as Refusal,
} from "@/utils/slackLink";

const RETURN_DELAY_MS = 1500;

const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

const { org, whenResolved, labelOf } = useSlackLinkOrg();
// Kept by /slack/link before it left for Slack; the only source of id and signature here.
const remembered = recallLinkRequest();
const rememberedRef = remembered ? parseLinkRequestParam(remembered.r) : null;

const linked = ref<SlackLinkRequestConfirmResponse | null>(null);
const refusal = ref<Refusal | null>(null);
const cancelled = ref(false);
const resent = ref(false);
let returnTimer: ReturnType<typeof setTimeout> | undefined;

const confirm = useMutation(() => confirmLinkRequestMutation(org.value));
const resend = useMutation(() => resendLinkRequestMutation(org.value));

const returnUrl = computed(() =>
  linked.value && isSafeReturnUrl(linked.value.return_url) ? linked.value.return_url : null,
);

const linkedDetail = computed<I18nText>(() => {
  const data = linked.value;
  if (!data) return raw("");
  const org = raw(labelOf(data.org_id));
  return data.orgs.length > 1
    ? t("slackApp.link.linkedOrgChange", { org })
    : t("slackApp.link.linkedOrg", { org });
});

// Every outcome but a 401 ends this request here: the code is spent and the kept copy of `r` is no longer needed.
const settle = (): void => {
  window.history.replaceState({}, document.title, window.location.pathname);
  forgetLinkRequest();
};

const backToSlack = (): void => {
  if (returnUrl.value) leaveFor(returnUrl.value);
};

const finish = async (code: string, state: string): Promise<void> => {
  try {
    linked.value = await confirm.mutateAsync({ oidc_code: code, oidc_state: state });
    settle();
    if (returnUrl.value) returnTimer = setTimeout(backToSlack, RETURN_DELAY_MS);
  } catch (error) {
    // The 401 handler signs in again and reloads this URL, which must still carry the code.
    if (statusOf(error) === 401) return;
    settle();
    const reading = classifySlackLinkError(error, "wrongAccount");
    refusal.value = {
      ...reading,
      helpContact: reading.helpContact ?? remembered?.helpContact ?? null,
    };
  }
};

const retry = (): void => {
  if (remembered) void router.replace({ path: "/slack/link", query: { r: remembered.r } });
};

const sendNewLink = async (): Promise<void> => {
  if (!rememberedRef) return;
  try {
    await resend.mutateAsync(rememberedRef);
    refusal.value = null;
    resent.value = true;
  } catch (error) {
    refusal.value = classifySlackLinkError(error, "noAccess");
  }
};

onMounted(() => {
  whenResolved(() => void ensureBrowserRum(org.value));
  const code = queryString(route.query.code);
  const state = queryString(route.query.state);
  if (queryString(route.query.error)) {
    settle();
    cancelled.value = true;
    return;
  }
  if (!code || !state) {
    settle();
    refusal.value = { kind: "failed", message: null, helpContact: null };
    return;
  }
  whenResolved(() => {
    if (org.value) {
      void finish(code, state);
      return;
    }
    settle();
    refusal.value = {
      kind: "noAccess",
      message: null,
      helpContact: remembered?.helpContact ?? null,
    };
  });
});

onBeforeUnmount(() => clearTimeout(returnTimer));
</script>

<template>
  <OPageLayout
    :title="t('slackApp.link.pageTitle')"
    constrained
    content-size="sm"
    data-test="slack-link-callback-page"
  >
    <div class="py-6">
      <SlackLinkCard
        v-if="linked"
        illustration="check"
        :title="t('slackApp.link.linkedTitle', { user: raw(linked.linked_as) })"
        :description="linkedDetail"
        data-test="slack-link-linked"
      >
        <template #actions>
          <OButton
            v-if="returnUrl"
            variant="primary"
            size="sm-action"
            data-test="slack-link-back-to-slack"
            @click="backToSlack"
          >
            {{ t("slackApp.link.backToSlack") }}
          </OButton>
        </template>
        <template #extra>
          <p class="text-text-secondary text-sm">
            {{ returnUrl ? t("slackApp.link.returning") : t("slackApp.link.closeTab") }}
          </p>
        </template>
      </SlackLinkCard>
      <SlackLinkCard
        v-else-if="resent"
        illustration="check"
        :title="t('slackApp.link.resentTitle')"
        :description="t('slackApp.link.resentDetail')"
        data-test="slack-link-resent"
      />
      <SlackLinkCard
        v-else-if="cancelled"
        illustration="connect"
        :title="t('slackApp.link.cancelledTitle')"
        :description="t('slackApp.link.cancelledDetail')"
        data-test="slack-link-cancelled"
      >
        <template v-if="remembered" #actions>
          <OButton variant="primary" size="sm-action" data-test="slack-link-retry" @click="retry">
            {{ t("slackApp.link.tryAgain") }}
          </OButton>
        </template>
      </SlackLinkCard>
      <SlackLinkRefusal
        v-else-if="refusal"
        :refusal="refusal"
        :can-resend="!!rememberedRef"
        :can-retry="!!remembered"
        :busy="resend.isPending.value"
        @resend="sendNewLink"
        @retry="retry"
      />
      <SlackLinkCard v-else working :title="t('slackApp.link.finishing')" />
    </div>
  </OPageLayout>
</template>
