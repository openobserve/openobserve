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
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import addToSlackImage from "@/assets/images/common/add_to_slack.png";
import addToSlackImage2x from "@/assets/images/common/add_to_slack@2x.png";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useSlackOAuthPopup } from "@/composables/slack/useSlackOAuthPopup";
import useBreakpoint from "@/composables/useBreakpoint";
import {
  confirmConnectionMutation,
  connectInstallationMutation,
  installExchangeMutation,
  installStartMutation,
  slackInstallationsQuery,
  startConnectionMutation,
} from "@/services/slack.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type {
  SlackAlreadyInstalledResponse,
  SlackAvailableInstallation,
  SlackConnectionConfirmResponse,
  SlackInstallConfirmation,
  SlackInstallExchangeResponse,
  SlackInstallSource,
  SlackUpgradeCandidate,
} from "@/types/slack";
import { copyToClipboard } from "@/utils/clipboard";
import { statusOf } from "@/utils/slackLink";

type PopupAction =
  { kind: "install"; source: SlackInstallSource } | { kind: "connect"; installationId: string };

const props = defineProps<{
  isCloud: boolean;
  available: SlackAvailableInstallation[];
  upgradeCandidates: SlackUpgradeCandidate[];
}>();

const emit = defineEmits<{ setup: []; installed: [confirmation: SlackInstallConfirmation] }>();

const { t } = useI18nTyped();
const store = useStore();
const { isMobile } = useBreakpoint();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const orgName = computed<string>(() => store.state.selectedOrganization?.label || org.value);

// Row 9's `instance`: an instance workspace on this server that does not serve this org (M4).
const installations = useQuery(() => slackInstallationsQuery(org.value));
const instance = computed(() => installations.data.value?.instance ?? null);
const offered = computed(() =>
  props.available.filter((item) => item.installation_id !== instance.value?.installation_id),
);
const copyRequest = (): void => {
  const notice = instance.value;
  if (!notice) return;
  void copyToClipboard(
    t("slackApp.connect.requestText", {
      name: orgName.value,
      org: org.value,
      team: notice.team_name,
    }),
    t,
    { successMessage: t("slackApp.connect.requestCopied") },
  );
};

const installStart = useMutation(() => installStartMutation(org.value));
const installExchange = useMutation(() => installExchangeMutation(org.value));
const startConnection = useMutation(() => startConnectionMutation(org.value));
const confirmConnection = useMutation(() => confirmConnectionMutation(org.value));
const connectInstallation = useMutation(() => connectInstallationMutation(org.value));

const action = ref<PopupAction>({ kind: "install", source: "settings" });
const alreadyInstalled = ref<SlackAlreadyInstalledResponse | null>(null);
const connectingId = ref<string | null>(null);

const popup = useSlackOAuthPopup<SlackInstallExchangeResponse | SlackConnectionConfirmResponse>({
  start: async () => {
    const current = action.value;
    if (current.kind === "install") {
      return (await installStart.mutateAsync(current.source)).authorization_url;
    }
    return (
      await startConnection.mutateAsync({
        installationId: current.installationId,
        purpose: "connect",
      })
    ).url;
  },
  exchange: async ({ code, state }) =>
    action.value.kind === "install"
      ? installExchange.mutateAsync({ code, state })
      : confirmConnection.mutateAsync({ oidc_code: code, oidc_state: state }),
  onSuccess: (result) => {
    if ("already_installed" in result) {
      alreadyInstalled.value = result;
    } else if ("connected" in result) {
      const team = props.available.find((a) => a.installation_id === connectingId.value);
      emit("installed", {
        team: team?.team_name ?? "",
        destination: null,
        linking: null,
        linkAll: null,
      });
    } else if ("linking" in result && "destination" in result) {
      emit("installed", {
        team: result.installation.team_name,
        destination: result.destination,
        linking: result.linking,
        linkAll: result.link_all,
      });
    }
  },
});

const runPopup = (next: PopupAction): void => {
  action.value = next;
  alreadyInstalled.value = null;
  connectingId.value = next.kind === "connect" ? next.installationId : null;
  void popup.open();
};

const connectWithTicket = async (): Promise<void> => {
  const pending = alreadyInstalled.value;
  if (!pending) return;
  try {
    const result = await connectInstallation.mutateAsync({
      installationId: pending.already_installed.installation_id,
      body: { connect_ticket: pending.connect_ticket },
    });
    emit("installed", {
      team: pending.already_installed.team_name,
      destination: result.destination,
      linking: null,
      linkAll: null,
    });
  } catch (error) {
    // The mutation toasts the refusal; a used or expired ticket (410) needs a fresh Add to Slack.
    if (statusOf(error) === 410) alreadyInstalled.value = null;
  }
};

const candidate = computed(() => props.upgradeCandidates[0] ?? null);
const addToSlackSrcset = `${addToSlackImage2x} 2x`;

const nextSteps = computed<{ title: I18nText; detail: I18nText }[]>(() =>
  props.isCloud
    ? [
        { title: t("slackApp.connect.stepAddTitle"), detail: t("slackApp.connect.popupHint") },
        {
          title: t("slackApp.connect.stepLinkTitle"),
          detail: t("slackApp.connect.stepLinkDetail"),
        },
      ]
    : isMobile.value
      ? [
          {
            title: t("slackApp.connect.stepCheckTitle"),
            detail: t("slackApp.connect.stepCheckDetailShort"),
          },
          {
            title: t("slackApp.connect.stepCreateTitle"),
            detail: t("slackApp.connect.stepCreateDetailShort"),
          },
          {
            title: t("slackApp.connect.stepInstallTitle"),
            detail: t("slackApp.connect.stepInstallDetailShort"),
          },
        ]
      : [
          {
            title: t("slackApp.connect.stepCheckTitle"),
            detail: t("slackApp.connect.stepCheckDetail"),
          },
          {
            title: t("slackApp.connect.stepCreateTitle"),
            detail: t("slackApp.connect.stepCreateDetail"),
          },
          {
            title: t("slackApp.connect.stepInstallTitle"),
            detail: t("slackApp.connect.stepInstallDetail"),
          },
        ],
);
</script>

<template>
  <div class="flex flex-col gap-4" data-test="slack-connect-empty">
    <OBanner
      v-if="instance"
      variant="info"
      icon="info"
      inline-actions
      data-test="slack-not-included"
    >
      <div class="flex flex-col gap-0.5">
        <span class="font-semibold">
          {{ t("slackApp.connect.notIncludedTitle", { team: instance.team_name, org }) }}
        </span>
        <span>
          {{
            instance.help_contact
              ? t("slackApp.connect.notIncludedDetail", { contact: instance.help_contact, org })
              : t("slackApp.connect.notIncludedNoContact", { org })
          }}
        </span>
      </div>
      <template #actions>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="content-copy"
          data-test="slack-copy-request"
          @click="copyRequest"
        >
          {{ t("slackApp.connect.copyRequest") }}
        </OButton>
      </template>
    </OBanner>

    <OBanner
      v-if="isCloud && candidate"
      variant="info"
      icon="sync"
      data-test="slack-upgrade-banner"
    >
      <div class="flex flex-col gap-0.5">
        <span class="font-medium">{{ t("slackApp.connect.upgradeTitle") }}</span>
        <span class="text-xs">
          {{
            t(
              "slackApp.connect.upgradeDetail",
              { team: candidate.team_name, count: candidate.destinations.length },
              candidate.destinations.length,
            )
          }}
        </span>
      </div>
      <template #actions>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="
            popup.connecting.value &&
            action.kind === 'install' &&
            action.source === 'upgrade_banner'
          "
          data-test="slack-upgrade-button"
          @click="runPopup({ kind: 'install', source: 'upgrade_banner' })"
        >
          {{ t("slackApp.connect.upgradeButton") }}
        </OButton>
      </template>
    </OBanner>

    <OBanner
      v-if="alreadyInstalled"
      variant="warning"
      icon="info"
      data-test="slack-already-installed"
    >
      {{
        t("slackApp.connect.alreadyInstalled", {
          team: alreadyInstalled.already_installed.team_name,
        })
      }}
      <template #actions>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="connectInstallation.isPending.value"
          data-test="slack-connect-ticket"
          @click="connectWithTicket"
        >
          {{ t("slackApp.connect.connectExisting") }}
        </OButton>
      </template>
    </OBanner>

    <OCard variant="outlined">
      <OEmptyState
        size="block"
        illustration="connect"
        :title="t('slackApp.connect.title')"
        :description="
          isCloud ? t('slackApp.connect.description') : t('slackApp.connect.descriptionSelfHosted')
        "
        :backdrop="false"
      >
        <template #actions>
          <OButton
            v-if="isCloud"
            variant="ghost"
            size="md"
            :loading="
              popup.connecting.value && action.kind === 'install' && action.source === 'settings'
            "
            data-test="slack-add-to-slack"
            @click="runPopup({ kind: 'install', source: 'settings' })"
          >
            <img
              :src="addToSlackImage"
              :srcset="addToSlackSrcset"
              :alt="t('slackApp.connect.addToSlack')"
              class="h-10 w-auto"
            />
          </OButton>
          <OButton
            v-else
            variant="primary"
            size="md"
            data-test="slack-setup-app"
            @click="emit('setup')"
          >
            {{ t("slackApp.connect.setupApp") }}
          </OButton>
        </template>
        <template #extra>
          <span class="text-text-label text-2xs font-semibold">
            {{ t("slackApp.connect.nextTitle", { minutes: isCloud ? 2 : 5 }) }}
          </span>
          <ol
            class="m-0 grid w-full max-w-2xl list-none grid-cols-1 gap-3 p-0 text-start"
            :class="nextSteps.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'"
            role="list"
            data-test="slack-connect-steps"
          >
            <li
              v-for="(item, index) in nextSteps"
              :key="index"
              class="border-border-subtle bg-surface-panel rounded-default flex items-start gap-2.5 border p-3"
              data-test="slack-connect-step"
            >
              <span
                class="bg-surface-subtle text-text-secondary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              >
                {{ index + 1 }}
              </span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-text-heading text-compact font-medium">{{ item.title }}</span>
                <span class="text-text-secondary text-xs">{{ item.detail }}</span>
              </span>
            </li>
          </ol>
          <span v-if="!isCloud && instance" class="text-text-secondary text-xs">
            {{ t("slackApp.connect.setupAppOtherTeam", { team: instance.team_name }) }}
          </span>
          <span class="text-text-secondary text-xs">
            {{ t("slackApp.connect.permissionHint") }}
          </span>
          <OBanner
            variant="info"
            dense
            icon="verified-user"
            class="w-full max-w-2xl text-start"
            data-test="slack-connect-consent"
          >
            {{ t("slackApp.connect.consent") }}
          </OBanner>
        </template>
      </OEmptyState>
    </OCard>

    <OCard
      v-if="!isCloud && offered.length"
      variant="outlined"
      class="gap-3 p-5"
      data-test="slack-available"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-text-heading m-0 text-lg font-semibold">
          {{ t("slackApp.connect.existingTitle") }}
        </h2>
        <p class="text-text-secondary m-0 text-sm">
          {{ t("slackApp.connect.existingDescription") }}
        </p>
      </div>
      <div
        v-for="item in offered"
        :key="item.installation_id"
        class="border-border-default flex items-center justify-between gap-3 border-t pt-3"
        :data-test="`slack-available-${item.installation_id}`"
      >
        <span class="text-text-body text-sm font-medium">{{ raw(item.team_name) }}</span>
        <OButton
          variant="outline"
          size="sm-action"
          :loading="popup.connecting.value && connectingId === item.installation_id"
          @click="runPopup({ kind: 'connect', installationId: item.installation_id })"
        >
          {{ t("slackApp.connect.connectExisting") }}
        </OButton>
      </div>
    </OCard>
  </div>
</template>
