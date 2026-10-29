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
import { useRoute } from "vue-router";
import SlackLinkCard from "@/components/slack/SlackLinkCard.vue";
import SlackLinkRefusal from "@/components/slack/SlackLinkRefusal.vue";
import { useSlackLinkOrg } from "@/composables/slack/useSlackLinkOrg";
import { ensureBrowserRum } from "@/utils/rum/ensureBrowserRum";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { resendLinkRequestMutation, startLinkRequestMutation } from "@/services/slack.queries";
import { useI18nTyped } from "@/types/i18n";
import {
  classifySlackLinkError,
  forgetLinkRequest,
  isSlackUrl,
  leaveFor,
  parseLinkRequestParam,
  queryString,
  rememberLinkRequest,
  type SlackLinkRefusal as Refusal,
} from "@/utils/slackLink";

const route = useRoute();
const { t } = useI18nTyped();

const { org, whenResolved } = useSlackLinkOrg();
const rawRequest = computed(() => queryString(route.query.r).trim());
const request = computed(() => parseLinkRequestParam(rawRequest.value));

const refusal = ref<Refusal | null>(null);
const resent = ref(false);

const start = useMutation(() => startLinkRequestMutation(org.value));
const resend = useMutation(() => resendLinkRequestMutation(org.value));
const busy = computed(() => start.isPending.value || resend.isPending.value);

const failed: Refusal = { kind: "failed", message: null, helpContact: null };

const begin = async (): Promise<void> => {
  const target = request.value;
  refusal.value = null;
  if (!target) {
    refusal.value = { kind: "unknown", message: null, helpContact: null };
    return;
  }
  if (!org.value) {
    refusal.value = { kind: "noAccess", message: null, helpContact: null };
    return;
  }
  try {
    const data = await start.mutateAsync(target);
    if (!isSlackUrl(data.url)) {
      forgetLinkRequest();
      refusal.value = failed;
      return;
    }
    rememberLinkRequest(rawRequest.value, data.help_contact);
    leaveFor(data.url);
  } catch (error) {
    forgetLinkRequest();
    refusal.value = classifySlackLinkError(error, "noAccess");
  }
};

const sendNewLink = async (): Promise<void> => {
  const target = request.value;
  if (!target) return;
  try {
    await resend.mutateAsync(target);
    refusal.value = null;
    resent.value = true;
  } catch (error) {
    refusal.value = classifySlackLinkError(error, "noAccess");
  }
};

onMounted(() => {
  whenResolved(() => void ensureBrowserRum(org.value));
  whenResolved(begin);
});
</script>

<template>
  <OPageLayout
    :title="t('slackApp.link.pageTitle')"
    constrained
    content-size="sm"
    data-test="slack-link-page"
  >
    <div class="py-6">
      <SlackLinkCard
        v-if="resent"
        illustration="check"
        :title="t('slackApp.link.resentTitle')"
        :description="t('slackApp.link.resentDetail')"
        data-test="slack-link-resent"
      />
      <SlackLinkRefusal
        v-else-if="refusal"
        :refusal="refusal"
        :can-resend="!!request"
        can-retry
        :busy="busy"
        @resend="sendNewLink"
        @retry="begin"
      />
      <SlackLinkCard
        v-else
        working
        :title="t('slackApp.link.working')"
        :description="t('slackApp.link.workingDetail')"
      />
    </div>
  </OPageLayout>
</template>
