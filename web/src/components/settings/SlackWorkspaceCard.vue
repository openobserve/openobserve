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
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OAvatar from "@/lib/core/Avatar/OAvatar.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useSlackOAuthPopup } from "@/composables/slack/useSlackOAuthPopup";
import {
  installExchangeMutation,
  installStartMutation,
  installUrlMutation,
  putHelpContactMutation,
  slackHelpContactQuery,
  testInstallationMutation,
  updateCredentialsMutation,
} from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type {
  InstallationView,
  SlackInstallExchangeResponse,
  SlackTestResponse,
} from "@/types/slack";
import { formatTimestamp } from "@/utils/date";
import { formatDuration } from "@/utils/downtimes/schedule";
import { isSlackUrl } from "@/utils/slackLink";
import SlackCheckList, { type SlackCheckItem } from "./SlackCheckList.vue";
import SlackCredentialsDialog from "./SlackCredentialsDialog.vue";
import {
  HELP_CONTACT_MAX_LENGTH,
  makeHelpContactSchema,
  type HelpContactForm,
} from "./SlackSettings.schema";

interface ConnectedOrgRow {
  org: string;
  connected: string;
  destinations: number;
}

const props = defineProps<{
  installation: InstallationView;
  isCloud: boolean;
}>();

const emit = defineEmits<{ disconnect: []; uninstall: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const id = computed(() => props.installation.id);

const testMutation = useMutation(() => testInstallationMutation(org.value, id.value));
const credentialsMutation = useMutation(() => updateCredentialsMutation(org.value, id.value));
const helpContactMutation = useMutation(() => putHelpContactMutation(org.value, id.value));
const installUrl = useMutation(() => installUrlMutation(org.value));
const installStart = useMutation(() => installStartMutation(org.value));
const installExchange = useMutation(() => installExchangeMutation(org.value));
const helpContact = useQuery(() => slackHelpContactQuery(org.value, id.value));

const credentialsOpen = ref(false);
const forgetOpen = ref(false);
const testResult = ref<SlackTestResponse | null>(null);
const reinstalledTeam = ref<string | null>(null);

const reinstall = useSlackOAuthPopup<SlackInstallExchangeResponse>({
  start: async () => {
    reinstalledTeam.value = null;
    return props.isCloud
      ? (await installStart.mutateAsync("reinstall")).authorization_url
      : (await installUrl.mutateAsync(id.value)).authorize_url;
  },
  exchange: ({ code, state }) => installExchange.mutateAsync({ code, state }),
  onSuccess: (result) => {
    reinstalledTeam.value =
      "already_installed" in result
        ? result.already_installed.team_name
        : result.installation.team_name;
  },
});

const selfHosted = computed(() => !props.isCloud);
// An instance workspace seen outside _meta: installation-wide controls belong to the instance admin.
const managed = computed(() => props.installation.managed);
const isInstance = computed(() => props.installation.scope === "instance");
const ownsInstallation = computed(() => selfHosted.value && !managed.value);
// Row 17 refuses an instance workspace; _meta removes orgs through org access instead.
const showDisconnect = computed(() => !isInstance.value);
const modeLabel = computed(() =>
  props.installation.mode === "socket"
    ? t("slackApp.card.modeSocket")
    : t("slackApp.card.modeHttp"),
);
const connectedDate = computed(() =>
  formatTimestamp(props.installation.this_org.created_at, "MMM d, yyyy"),
);
const showSockets = computed(() => props.installation.mode === "socket" && selfHosted.value);
// Ten minutes is the age the default `_meta` self-alert pages on.
const OUTBOUND_SLOW_SECS = 600;
const outbound = computed(() => {
  const { outbound_depth: depth, outbound_oldest_age_secs: age } = props.installation.health;
  if (depth === undefined) return null;
  if (depth === 0) return { text: t("slackApp.card.outboundEmpty"), slow: false };
  const secs = Math.max(0, Math.round(age ?? 0));
  return {
    text: t(
      "slackApp.card.outboundQueue",
      {
        count: depth,
        age: secs < 60 ? t("slackApp.card.ageSeconds", { count: secs }) : formatDuration(secs, t),
      },
      depth,
    ),
    slow: secs > OUTBOUND_SLOW_SECS,
  };
});
const socketsAsOf = computed(() =>
  props.installation.health.as_of
    ? formatTimestamp(props.installation.health.as_of, "MMM d, HH:mm")
    : "—",
);
const appTokenWarning = computed(() => {
  if (!showSockets.value) return null;
  if (props.installation.app_token_state === "missing") return t("slackApp.card.appTokenMissing");
  if (props.installation.app_token_state === "revoked") return t("slackApp.card.appTokenRevoked");
  return null;
});
const collaboratorsUrl = computed(
  () => `https://api.slack.com/apps/${encodeURIComponent(props.installation.app_id)}/collaborators`,
);

const testItems = computed<SlackCheckItem[]>(() => {
  const result = testResult.value;
  if (!result) return [];
  const items: SlackCheckItem[] = result.checks.map((check) => ({
    key: check.id,
    label: t(`slackApp.card.checks.${check.id}`),
    status: check.status,
    detail: check.detail,
  }));
  if (result.test_post) {
    items.push({
      key: "test_post",
      label: t("slackApp.card.checks.test_post"),
      status: result.test_post.status,
      detail: result.test_post.detail,
    });
  }
  return items;
});

// The mutation toasts its own failure; the click only keeps the last result.
const verifyUrl = computed(() => {
  const url = testResult.value?.verify_url;
  return isSlackUrl(url, "api.slack.com") ? url : null;
});

const runTest = async (): Promise<void> => {
  try {
    testResult.value = await testMutation.mutateAsync({});
  } catch {
    testResult.value = null;
  }
};

const forget = (): void => {
  credentialsMutation.mutate({ config_refresh_token: null });
};

const orgColumns = computed<OTableColumnDef<ConnectedOrgRow>[]>(() => [
  { id: "org", header: t("slackApp.card.columnOrg"), accessorKey: "org", meta: { flex: true } },
  {
    id: "connected",
    header: t("slackApp.card.columnConnected"),
    accessorKey: "connected",
    size: 260,
  },
  {
    id: "destinations",
    header: t("slackApp.card.columnDestinations"),
    accessorKey: "destinations",
    size: 180,
  },
]);
const orgRows = computed<ConnectedOrgRow[]>(() => [
  {
    org: t("slackApp.card.thisOrg", { org: org.value }),
    connected: t("slackApp.card.connectedOn", {
      date: connectedDate.value,
      user: props.installation.this_org.connected_by,
    }),
    destinations: props.installation.this_org.destination_count,
  },
]);

const helpContactSchema = makeHelpContactSchema();
const helpContactDefaults = computed<HelpContactForm>(() => ({
  help_contact: helpContact.data.value?.help_contact ?? "",
}));
const saveHelpContact = async (value: HelpContactForm): Promise<void> => {
  await helpContactMutation.mutateAsync(value.help_contact);
  toast({ variant: "success", message: t("slackApp.card.helpContactSaved") });
};
</script>

<template>
  <div class="flex flex-col gap-6" data-test="slack-workspace">
    <OCard variant="outlined" class="gap-4 p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <OAvatar :value="installation.team_name" size="lg" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <h2
              class="text-text-heading m-0 text-lg font-semibold"
              data-test="slack-workspace-name"
            >
              {{ raw(installation.team_name) }}
            </h2>
            <span class="text-text-secondary text-sm" data-test="slack-workspace-meta">
              <template v-if="managed">
                {{ modeLabel }} {{ raw("·") }} {{ t("slackApp.card.managedBy") }}
              </template>
              <template v-else>
                {{
                  t("slackApp.card.connectedBy", {
                    mode: modeLabel,
                    user: installation.this_org.connected_by,
                    date: connectedDate,
                  })
                }}
              </template>
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <OTag
            v-if="isInstance"
            variant="primary-soft"
            shape="pill"
            size="sm"
            :label="t('slackApp.card.instanceTag')"
            data-test="slack-workspace-instance-tag"
          />
          <OTag
            type="slackInstallStatus"
            :value="installation.status"
            data-test="slack-workspace-status"
          />
        </div>
      </div>

      <OBanner v-if="managed" variant="info" icon="info" data-test="slack-managed-banner">
        <span class="font-semibold">{{ t("slackApp.card.managedTitle") }}</span>
        {{ t("slackApp.card.managedDetail", { team: installation.team_name }) }}
        <template v-if="installation.instance_help_contact">
          {{ t("slackApp.card.managedQuestions", { contact: installation.instance_help_contact }) }}
        </template>
      </OBanner>

      <OBanner
        v-if="!installation.credentials_readable"
        variant="error-soft"
        icon="error-outline"
        data-test="slack-credentials-unreadable"
      >
        {{
          selfHosted
            ? t("slackApp.card.credentialsUnreadable")
            : t("slackApp.card.credentialsUnreadableCloud")
        }}
        <template v-if="!managed" #actions>
          <OButton
            v-if="selfHosted"
            variant="outline"
            size="sm-action"
            @click="credentialsOpen = true"
          >
            {{ t("slackApp.card.updateCredentials") }}
          </OButton>
          <OButton
            v-else
            variant="outline"
            size="sm-action"
            :loading="reinstall.connecting.value"
            data-test="slack-credentials-reinstall"
            @click="reinstall.open()"
          >
            {{ t("slackApp.card.reinstall") }}
          </OButton>
        </template>
      </OBanner>

      <OBanner
        v-if="reinstalledTeam"
        variant="success"
        dense
        icon="check-circle"
        data-test="slack-reinstall-result"
      >
        {{ t("slackApp.card.reinstalled", { team: reinstalledTeam }) }}
      </OBanner>

      <div class="border-border-default grid grid-cols-1 gap-2 border-t pt-4 md:grid-cols-2">
        <span class="flex items-center gap-2 text-sm" data-test="slack-workspace-events">
          <OIcon
            :name="installation.health.last_event_at ? 'check-circle' : 'schedule'"
            size="sm"
            :class="
              installation.health.last_event_at ? 'text-status-positive' : 'text-text-secondary'
            "
          />
          <template v-if="installation.health.last_event_at">
            {{ t("slackApp.card.eventsReceived") }}
            <OTimeCell :value="installation.health.last_event_at" />
          </template>
          <template v-else>{{ t("slackApp.card.noEvents") }}</template>
        </span>
        <span
          v-if="showSockets"
          class="flex items-center gap-2 text-sm"
          data-test="slack-workspace-sockets"
        >
          <OIcon
            :name="
              installation.health.sockets_up >= installation.health.sockets_want &&
              installation.health.sockets_want > 0
                ? 'check-circle'
                : 'warning-amber'
            "
            size="sm"
            :class="
              installation.health.sockets_up >= installation.health.sockets_want &&
              installation.health.sockets_want > 0
                ? 'text-status-positive'
                : 'text-status-warning-text'
            "
          />
          {{
            t("slackApp.card.sockets", {
              up: installation.health.sockets_up,
              want: installation.health.sockets_want,
              time: socketsAsOf,
            })
          }}
        </span>
        <span
          v-if="outbound"
          class="flex items-center gap-2 text-sm"
          :data-state="outbound.slow ? 'warning' : 'ok'"
          data-test="slack-workspace-outbound"
        >
          <OIcon
            :name="outbound.slow ? 'warning-amber' : 'check-circle'"
            size="sm"
            :class="outbound.slow ? 'text-status-warning-text' : 'text-status-positive'"
          />
          {{ outbound.text }}
        </span>
        <span
          v-if="appTokenWarning"
          class="text-status-warning-text flex items-center gap-2 text-sm md:col-span-2"
          data-test="slack-workspace-app-token"
        >
          <OIcon name="warning-amber" size="sm" />
          {{ appTokenWarning }}
        </span>
        <span
          v-if="ownsInstallation"
          class="flex flex-wrap items-center justify-between gap-2 text-sm md:col-span-2"
        >
          <span class="text-text-secondary flex items-center gap-2">
            <OIcon name="info" size="sm" />
            {{ t("slackApp.card.collaborator") }}
          </span>
          <OButton
            as="a"
            :href="collaboratorsUrl"
            target="_blank"
            rel="noopener noreferrer"
            variant="ghost-primary"
            size="xs"
            icon-right="open-in-new"
            data-test="slack-collaborators"
          >
            {{ t("slackApp.card.openCollaborators") }}
          </OButton>
        </span>
        <span
          v-if="ownsInstallation && installation.has_config_refresh_token"
          class="flex flex-wrap items-center gap-2 text-sm md:col-span-2"
          data-test="slack-refresh-token"
        >
          <OIcon name="key" size="sm" class="text-text-secondary" />
          <span class="text-text-secondary">{{ t("slackApp.card.refreshTokenKept") }}</span>
          <OButton
            variant="ghost-destructive"
            size="xs"
            :loading="credentialsMutation.isPending.value"
            data-test="slack-forget-token"
            @click="forgetOpen = true"
          >
            {{ t("slackApp.card.forget") }}
          </OButton>
        </span>
      </div>

      <div class="flex flex-wrap justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :loading="testMutation.isPending.value"
          data-test="slack-test-connection"
          @click="runTest"
        >
          {{ t("slackApp.card.test") }}
        </OButton>
        <OButton
          v-if="!managed"
          variant="outline"
          size="sm-action"
          :loading="reinstall.connecting.value"
          data-test="slack-reinstall"
          @click="reinstall.open()"
        >
          {{ t("slackApp.card.reinstall") }}
        </OButton>
        <OButton
          v-if="ownsInstallation"
          variant="outline"
          size="sm-action"
          data-test="slack-update-credentials"
          @click="credentialsOpen = true"
        >
          {{ t("slackApp.card.updateCredentials") }}
        </OButton>
      </div>

      <div
        v-if="testItems.length"
        class="border-border-default flex flex-col gap-3 border-t pt-4"
        data-test="slack-test-results"
      >
        <span class="text-text-heading text-sm font-medium">
          {{ t("slackApp.card.testResults") }}
        </span>
        <SlackCheckList :items="testItems" />
        <div v-if="verifyUrl" class="flex flex-col gap-1">
          <OButton
            as="a"
            :href="verifyUrl"
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm-action"
            icon-right="open-in-new"
            class="w-fit"
            data-test="slack-test-verify"
          >
            {{ t("slackApp.wizard.install.verifyTitle") }}
          </OButton>
          <span class="text-text-secondary text-xs">
            {{ t("slackApp.wizard.install.verifyHelp") }}
          </span>
        </div>
      </div>
    </OCard>

    <section v-if="!isInstance" class="flex flex-col gap-3" data-test="slack-connected-orgs">
      <div class="flex flex-col gap-0.5">
        <h2 class="text-text-heading m-0 text-lg font-semibold">
          {{ t("slackApp.card.connectedOrgs") }}
        </h2>
        <p class="text-text-secondary m-0 text-sm">
          {{ t("slackApp.card.connectedOrgsDescription", { team: installation.team_name }) }}
        </p>
      </div>
      <OTable
        :data="orgRows"
        :columns="orgColumns"
        row-key="org"
        pagination="none"
        :show-global-filter="false"
        :cell-overflow-tooltip="false"
        dense
      />
      <span class="text-text-secondary text-sm">
        {{
          t(
            "slackApp.card.otherOrgs",
            { count: installation.other_connected_orgs },
            installation.other_connected_orgs,
          )
        }}
      </span>
    </section>

    <slot />

    <section class="flex flex-col gap-2">
      <OForm
        v-if="!helpContact.isPending.value"
        :key="helpContactDefaults.help_contact"
        :schema="helpContactSchema"
        :default-values="helpContactDefaults"
        class="flex flex-wrap items-end gap-3"
        data-test="slack-help-contact-form"
        @submit="saveHelpContact"
      >
        <OFormInput
          name="help_contact"
          class="min-w-0 flex-1 md:max-w-120"
          :label="t('slackApp.card.helpContact')"
          :placeholder="t('slackApp.card.helpContactPlaceholder')"
          :help-text="t('slackApp.card.helpContactHelp')"
          :maxlength="HELP_CONTACT_MAX_LENGTH"
          data-test="slack-help-contact"
        />
        <OButton variant="outline" size="sm-action" type="submit">
          {{ t("common.save") }}
        </OButton>
      </OForm>
    </section>

    <section v-if="showDisconnect || ownsInstallation" class="flex flex-col gap-3">
      <h2 class="text-text-heading m-0 text-lg font-semibold">
        {{ t("slackApp.card.disconnectSection") }}
      </h2>
      <OCard variant="outlined" class="p-5">
        <div v-if="showDisconnect" class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-text-heading text-sm font-medium">
              {{ t("slackApp.card.disconnectThisOrg") }}
            </span>
            <span class="text-text-secondary text-sm">
              {{ t("slackApp.card.disconnectDescription", { org }) }}
            </span>
          </div>
          <OButton
            variant="outline-destructive"
            size="sm-action"
            data-test="slack-disconnect-org"
            @click="emit('disconnect')"
          >
            {{ t("slackApp.card.disconnectThisOrg") }}
          </OButton>
        </div>
        <div
          v-if="ownsInstallation"
          class="flex flex-wrap items-center justify-between gap-3"
          :class="showDisconnect && 'border-border-default mt-4 border-t pt-4'"
        >
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-text-heading text-sm font-medium">
              {{ t("slackApp.card.uninstall") }}
            </span>
            <span class="text-text-secondary text-sm">
              {{ t("slackApp.card.uninstallDescription") }}
            </span>
          </div>
          <OButton
            variant="destructive"
            size="sm-action"
            data-test="slack-uninstall"
            @click="emit('uninstall')"
          >
            {{ t("slackApp.card.uninstall") }}
          </OButton>
        </div>
      </OCard>
    </section>

    <SlackCredentialsDialog v-model:open="credentialsOpen" :installation="installation" />
    <ConfirmDialog
      v-model="forgetOpen"
      :title="t('slackApp.card.forgetTitle')"
      message-keypath="slackApp.card.forgetMessage"
      :message-name="installation.team_name"
      :ok-label="t('slackApp.card.forget')"
      ok-variant="destructive"
      focus-cancel
      @update:ok="forget"
    />
  </div>
</template>
