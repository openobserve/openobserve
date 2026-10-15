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
  <OPageLayout
    :title="t('oncallSlack.title')"
    :subtitle="t('oncallSlack.subtitle')"
    icon="slack"
    title-data-test="slack-settings-title"
    scroll
  >
    <div class="flex flex-col gap-4 py-3">
      <OBanner v-if="banner" variant="error" data-test="slack-settings-banner">
        {{ banner }}
      </OBanner>

      <div v-if="view.body === 'loading'" class="flex justify-center py-10">
        <OSpinner size="md" data-test="slack-settings-loading" />
      </div>

      <OBanner v-else-if="view.body === 'failed'" variant="error" data-test="slack-settings-failed">
        {{ t("oncallSlack.loadFailed") }}
      </OBanner>

      <div v-else-if="view.body === 'empty'" data-test="slack-settings-hero">
        <OEmptyState
          size="hero"
          illustration="connect"
          variant="create"
          :title="t('oncallSlack.emptyTitle')"
          :description="view.block ? undefined : t('oncallSlack.emptyDescription')"
        >
          <template #actions>
            <EmptyStateActionCard
              icon="slack"
              :label="t('oncallSlack.connect')"
              :sublabel="view.block ? undefined : t('oncallSlack.connectDesc')"
              :unavailable="!!view.block"
              data-test="slack-settings-connect"
              @click="connect"
            />
          </template>
          <template v-if="blockText" #extra>
            <OText variant="meta" data-test="slack-settings-block">{{ blockText }}</OText>
          </template>
        </OEmptyState>
      </div>

      <OCard
        v-else-if="view.install"
        class="rounded-surface bg-surface-base max-w-160"
        :data-test="`slack-settings-${view.body}`"
      >
        <OCardSection role="header">
          <span class="flex flex-1 flex-wrap items-center gap-2">
            <OText variant="card-title">{{ t("oncallSlack.title") }}</OText>
            <OTag v-if="view.body === 'connected'" variant="success-soft" size="sm">
              {{ t("oncallSlack.connected") }}
            </OTag>
            <OTag v-else variant="error-soft" size="sm">{{ t("oncallSlack.revoked") }}</OTag>
          </span>
          <OButton
            v-if="view.body === 'connected'"
            variant="outline-destructive"
            size="sm-action"
            :disabled="!!view.block"
            data-test="slack-settings-disconnect"
            @click="confirmingDisconnect = true"
          >
            {{ t("oncallSlack.disconnect") }}
          </OButton>
          <OButton
            v-else
            variant="primary"
            size="sm-action"
            :disabled="!!view.block"
            :loading="connecting"
            data-test="slack-settings-reconnect"
            @click="connect"
          >
            {{ t("oncallSlack.reconnect") }}
          </OButton>
        </OCardSection>
        <OCardSection role="body" class="flex flex-col gap-3">
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt class="text-text-secondary">{{ t("oncallSlack.workspace") }}</dt>
            <dd class="text-text-body" data-test="slack-settings-workspace">
              {{ raw(view.install.workspace_name) }}
            </dd>
          </dl>
          <OText v-if="blockText" variant="meta" data-test="slack-settings-block">
            {{ blockText }}
          </OText>
          <OText v-else-if="view.body === 'connected'" variant="meta">
            <i18n-t
              keypath="oncallSlack.nextSteps"
              tag="span"
              data-test="slack-settings-next-steps"
            >
              <template #command>
                <OCode>{{ HERE_COMMAND }}</OCode>
              </template>
            </i18n-t>
          </OText>
        </OCardSection>
      </OCard>
    </div>

    <ConfirmDialog
      v-model="confirmingDisconnect"
      :title="t('oncallSlack.disconnectTitle')"
      :message="t('oncallSlack.disconnectMessage')"
      :ok-label="t('oncallSlack.disconnect')"
      ok-color="destructive"
      @update:ok="disconnect"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  chatInstallsQuery,
  deleteChatInstallMutation,
  exchangeSlackInstallMutation,
  startSlackInstallMutation,
} from "@/services/oncall.queries";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { serverMessageOf, slackBlockText, slackCallbackOf, slackPageView } from "./slack";
import { isForbidden } from "./telephony";

// The command each team types in its Slack channel; code the user types, so never translated.
const HERE_COMMAND = raw("/oncall here <team>");
// One named window, so a second click reuses the popup instead of stacking another.
const POPUP_NAME = "openobserve-oncall-slack-install";
// Same size the alert destination's Slack popup uses.
const POPUP_FEATURES = "popup,width=720,height=760,resizable=yes,scrollbars=yes";

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

const read = useQuery(() => chatInstallsQuery(orgId.value));
const start = useMutation(() => startSlackInstallMutation(orgId.value));
const exchange = useMutation(() => exchangeSlackInstallMutation(orgId.value));
const remove = useMutation(() => deleteChatInstallMutation(orgId.value));

// RB-12: the server is the only gate, so a 403 is remembered rather than guessed from the role.
const connectDenied = ref(false);
const disconnectDenied = ref(false);
const banner = ref<I18nText | null>(null);
const popup = shallowRef<Window | null>(null);
const confirmingDisconnect = ref(false);

const view = computed(() =>
  slackPageView({
    installs: read.data.value,
    loadError: read.error.value,
    availability: store.state.zoConfig?.oncall_slack,
    connectDenied: connectDenied.value,
    disconnectDenied: disconnectDenied.value,
  }),
);
const blockText = computed(() => (view.value.block ? slackBlockText(t, view.value.block) : null));
const connecting = computed(() => start.isPending.value || exchange.isPending.value);

watch(orgId, () => {
  connectDenied.value = false;
  disconnectDenied.value = false;
  banner.value = null;
  popup.value = null;
});

// RB-12: install/start answers before any popup opens, so a refusal never shows one.
async function connect() {
  if (connecting.value) return;
  // An older popup's state is stale once a new start is asked for.
  popup.value = null;
  banner.value = null;
  let url: string;
  try {
    url = (await start.mutateAsync()).data.url;
  } catch (err) {
    refuseConnect(err);
    return;
  }
  const opened = window.open(url, POPUP_NAME, POPUP_FEATURES);
  if (!opened) {
    banner.value = t("alert_destinations.slackOAuth.popupBlocked", { product: raw("OpenObserve") });
    return;
  }
  popup.value = opened;
}

// IN-5: redeems what this page's popup relayed; every other message is ignored.
async function onCallbackMessage(event: MessageEvent<unknown>) {
  const message = slackCallbackOf(event, popup.value, window.location.origin);
  if (!message) return;
  popup.value = null;
  if ("error" in message) {
    banner.value = t("alert_destinations.slackOAuth.authorizationDenied");
    return;
  }
  try {
    await exchange.mutateAsync({ code: message.code, state: message.state });
  } catch (err) {
    refuseConnect(err);
  }
}

// Latches a 403 as the disabled action; any other refusal shows the server's sentence.
function refuseConnect(err: unknown) {
  if (isForbidden(err)) {
    connectDenied.value = true;
    return;
  }
  banner.value = raw(serverMessageOf(err)) || t("oncallSlack.connectFailed");
}

// Disconnects the shown workspace; a 403 disables Disconnect, any other failure is a toast.
async function disconnect() {
  const install = view.value.install;
  if (!install) return;
  try {
    await remove.mutateAsync(install.workspace_id);
  } catch (err) {
    if (isForbidden(err)) {
      disconnectDenied.value = true;
      return;
    }
    toast({
      variant: "error",
      message: raw(serverMessageOf(err)) || t("oncallSlack.disconnectFailed"),
    });
  }
}

onMounted(() => window.addEventListener("message", onCallbackMessage));
onBeforeUnmount(() => window.removeEventListener("message", onCallbackMessage));
</script>
