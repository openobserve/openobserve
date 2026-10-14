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
  <div
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
    data-test="oncall-slack-card"
  >
    <span class="flex flex-wrap items-center gap-2">
      <OIcon name="slack" size="sm" class="text-text-secondary" />
      <OText variant="panel-title">{{ t("oncallSlack.title") }}</OText>
      <OTag
        v-if="view.body === 'linked'"
        variant="success-soft"
        size="sm"
        data-test="oncall-slack-state"
      >
        {{ t("oncallSlack.linkLinked") }}
      </OTag>
      <OTag
        v-else-if="view.body === 'dmSent'"
        variant="default-soft"
        size="sm"
        data-test="oncall-slack-state"
      >
        {{ t("oncallSlack.linkNotLinkedYet") }}
      </OTag>
      <OText v-else-if="showIntro" variant="meta">{{ t("oncallSlack.linkIntro") }}</OText>
    </span>

    <OText v-if="view.body === 'failed'" variant="meta" data-test="oncall-slack-load-failed">
      {{ t("oncallSlack.linkLoadFailed") }}
    </OText>

    <template v-else-if="view.body === 'linked' && view.link">
      <span class="flex flex-wrap items-center gap-2">
        <OText variant="body-strong" as="span" data-test="oncall-slack-linked-as">
          {{ t("oncallSlack.linkLinkedAs", { email: raw(view.link.email) }) }}
        </OText>
        <OButton
          variant="ghost-primary"
          size="xs"
          :loading="unlink.isPending.value"
          data-test="oncall-slack-unlink"
          @click="unlinkSlack"
        >
          {{ t("oncallSlack.linkUnlink") }}
        </OButton>
      </span>
      <OText variant="meta">{{ t("oncallSlack.linkWorks", { command: ONCALL_COMMAND }) }}</OText>
    </template>

    <template v-else-if="view.body === 'dmSent'">
      <OText data-test="oncall-slack-check-slack">{{ t("oncallSlack.linkCheckSlack") }}</OText>
      <span class="flex flex-wrap items-center gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :loading="start.isPending.value"
          data-test="oncall-slack-send-again"
          @click="startLink"
        >
          {{ t("oncallSlack.linkSendAgain") }}
        </OButton>
        <OText variant="meta">{{ t("oncallSlack.linkExpiry") }}</OText>
      </span>
    </template>

    <span v-else-if="view.body === 'unlinked'" class="flex flex-wrap items-center gap-2">
      <OButton
        variant="primary"
        size="sm-action"
        :disabled="view.notConnected"
        :loading="start.isPending.value"
        data-test="oncall-slack-link"
        @click="startLink"
      >
        {{ t("oncallSlack.linkButton") }}
      </OButton>
      <OText v-if="showIntro" variant="meta" data-test="oncall-slack-hint">
        {{ t("oncallSlack.linkHint", { email: raw(email) }) }}
      </OText>
    </span>

    <p
      v-if="error"
      class="text-status-error-text text-sm"
      role="alert"
      data-test="oncall-slack-error"
    >
      {{ error }}
    </p>

    <OBanner v-if="view.notConnected" variant="info" data-test="oncall-slack-not-connected">
      {{ t("oncallSlack.teamChannelNotConnected") }}
    </OBanner>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { serverMessageOf } from "@/components/settings/slack";
import {
  mySlackLinkQuery,
  startSlackLinkMutation,
  unlinkSlackMutation,
} from "@/services/oncall.queries";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { isBadRequest, slackCardView } from "./slackLink";

// The Slack command the linked person can now use; a command, so never translated.
const ONCALL_COMMAND = raw("/oncall");

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed<string>(() => store.state.selectedOrganization.identifier);
const email = computed(() => String(store.state.userInfo?.email ?? ""));

const read = useQuery(() =>
  Object.assign(mySlackLinkQuery(orgId.value), { enabled: !!orgId.value }),
);
const start = useMutation(() => startSlackLinkMutation(orgId.value));
const unlink = useMutation(() => unlinkSlackMutation(orgId.value));

const dmSent = ref(false);
const startNotConnected = ref(false);
const error = ref<I18nText | null>(null);

const view = computed(() =>
  slackCardView({
    link: read.data.value,
    loadError: read.error.value,
    dmSent: dmSent.value,
    startNotConnected: startNotConnected.value,
  }),
);
// The intro and hint describe what Link Slack will do, so they go once it cannot.
const showIntro = computed(
  () => view.value.body === "unlinked" && !view.value.notConnected && !error.value,
);

watch(orgId, () => {
  dmSent.value = false;
  startNotConnected.value = false;
  error.value = null;
});

// LN-5: one DM per click; a 400 is the org having no Slack, every other refusal is the server's sentence.
async function startLink() {
  error.value = null;
  try {
    await start.mutateAsync();
    dmSent.value = true;
  } catch (err) {
    dmSent.value = false;
    if (isBadRequest(err)) {
      startNotConnected.value = true;
      return;
    }
    error.value = raw(serverMessageOf(err)) || t("oncallSlack.linkStartFailed");
  }
}

// Mockup decision 6: Unlink is undone by one Link Slack, so it asks for no confirmation.
async function unlinkSlack() {
  error.value = null;
  try {
    await unlink.mutateAsync();
    dmSent.value = false;
  } catch (err) {
    error.value = raw(serverMessageOf(err)) || t("oncallSlack.linkUnlinkFailed");
  }
}

/// Forced by the page's refresh, so the card never shows a stale link.
async function refresh() {
  await read.refetch();
}

defineExpose({ refresh });
</script>
