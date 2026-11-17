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
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useFormCounts } from "@/lib/forms/SaveBar/formCounts";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useSlackOAuthPopup } from "@/composables/slack/useSlackOAuthPopup";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
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
import { useSavedBaseline, useSlackSavePart } from "./slackSaveBar";
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
  /** The reader lacks Manage Slack, so removing the app is offered but off. */
  readOnly?: boolean;
}>();

const emit = defineEmits<{ disconnect: []; uninstall: [] }>();

const { t } = useI18nTyped();
const { nameOf, tooltipOf } = useOrgUserNames();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const orgName = computed<string>(() => store.state.selectedOrganization?.label || org.value);
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
const socketsUp = computed(
  () =>
    props.installation.health.sockets_want > 0 &&
    props.installation.health.sockets_up >= props.installation.health.sockets_want,
);
const connectionInfoOpen = ref(false);
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
const refused = computed(() => {
  const posts = props.installation.health.refused_posts;
  if (!posts) return null;
  return {
    text: t(
      "slackApp.card.refusedPosts",
      { count: posts.count, reason: posts.last_reason, destination: posts.last_destination },
      posts.count,
    ),
    at: posts.last_at,
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
    org: t("slackApp.card.thisOrg", { org: orgName.value }),
    connected: t("slackApp.card.connectedOn", {
      date: connectedDate.value,
      user: nameOf(props.installation.this_org.connected_by),
    }),
    destinations: props.installation.this_org.destination_count,
  },
]);

const metaLine = computed(() =>
  managed.value
    ? t("slackApp.card.managedBy")
    : t("slackApp.card.connectedBy", {
        user: nameOf(props.installation.this_org.connected_by),
        date: connectedDate.value,
      }),
);
// The name alone cannot tell two namesakes apart, so the email stays one hover away.
const connectedByHint = computed(() => {
  const email = props.installation.this_org.connected_by;
  return !managed.value && nameOf(email) !== email ? tooltipOf(email) : undefined;
});
const otherOrgsLine = computed(() =>
  t(
    "slackApp.card.otherOrgs",
    { count: props.installation.other_connected_orgs },
    props.installation.other_connected_orgs,
  ),
);

const helpContactDefaults = computed<HelpContactForm>(() => ({
  help_contact: helpContact.data.value?.help_contact ?? "",
}));
const saveHelpContact = async (value: HelpContactForm): Promise<void> => {
  await helpContactBaseline.save(() => helpContactMutation.mutateAsync(value.help_contact));
  toast({ variant: "success", message: t("slackApp.card.helpContactSaved") });
};
const helpContactForm = useOForm<HelpContactForm>({
  defaultValues: helpContactDefaults.value,
  schema: makeHelpContactSchema(),
  validateOn: "leave",
  onSubmit: saveHelpContact,
});
const helpContactValues = helpContactForm.useStore((s) => s.values);
const helpContactBaseline = useSavedBaseline(
  helpContactForm,
  helpContactValues,
  () => helpContactDefaults.value,
  (value) => ({ help_contact: value.help_contact.trim() }),
);
const { errors: helpContactErrors } = useFormCounts(helpContactForm);
const helpContactChanged = computed(
  () => !helpContact.isPending.value && helpContactBaseline.changed.value.length > 0,
);

useSlackSavePart({
  changes: () => Number(helpContactChanged.value),
  errors: () => helpContactErrors.value,
  save: async () => {
    try {
      await helpContactForm.handleSubmit();
    } catch {
      return false;
    }
    return helpContactForm.state.isValid && !helpContactChanged.value;
  },
  discard: helpContactBaseline.discard,
});
</script>

<template>
  <div class="flex flex-col gap-6" data-test="slack-workspace">
    <OFormSection
      variant="plain"
      :title="raw(installation.team_name)"
      data-test="slack-workspace-card"
    >
      <template #description>
        <span>
          {{ metaLine }}
          <OTooltip v-if="connectedByHint" :content="connectedByHint" />
        </span>
      </template>
      <template #actions>
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
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="network-check"
          :loading="testMutation.isPending.value"
          :disabled="readOnly"
          data-test="slack-test-connection"
          @click="runTest"
        >
          {{ t("slackApp.card.test") }}
          <OTooltip v-if="readOnly" side="bottom" :content="t('slackApp.connect.permissionHint')" />
        </OButton>
        <OButton
          v-if="!managed"
          variant="outline"
          size="sm-action"
          icon-left="refresh"
          :loading="reinstall.connecting.value"
          :disabled="readOnly"
          data-test="slack-reinstall"
          @click="reinstall.open()"
        >
          {{ t("slackApp.card.reinstall") }}
          <OTooltip v-if="readOnly" side="bottom" :content="t('slackApp.connect.permissionHint')" />
        </OButton>
        <OButton
          v-if="ownsInstallation"
          variant="outline"
          size="sm-action"
          icon-left="key"
          :disabled="readOnly"
          data-test="slack-update-credentials"
          @click="credentialsOpen = true"
        >
          {{ t("slackApp.card.updateCredentials") }}
          <OTooltip v-if="readOnly" side="bottom" :content="t('slackApp.connect.permissionHint')" />
        </OButton>
      </template>

      <div
        v-if="
          managed ||
          !installation.credentials_readable ||
          reinstalledTeam ||
          refused ||
          appTokenWarning
        "
        class="border-border-default flex flex-col gap-3 border-b px-4 py-3"
      >
        <OBanner v-if="managed" variant="info" icon="info" data-test="slack-managed-banner">
          <span class="font-semibold">{{ t("slackApp.card.managedTitle") }}</span>
          {{ t("slackApp.card.managedDetail", { team: installation.team_name }) }}
          <template v-if="installation.instance_help_contact">
            {{
              t("slackApp.card.managedQuestions", { contact: installation.instance_help_contact })
            }}
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
              icon-left="key"
              :disabled="readOnly"
              data-test="slack-credentials-update"
              @click="credentialsOpen = true"
            >
              {{ t("slackApp.card.updateCredentials") }}
              <OTooltip
                v-if="readOnly"
                side="bottom"
                :content="t('slackApp.connect.permissionHint')"
              />
            </OButton>
            <OButton
              v-else
              variant="outline"
              size="sm-action"
              icon-left="refresh"
              :loading="reinstall.connecting.value"
              :disabled="readOnly"
              data-test="slack-credentials-reinstall"
              @click="reinstall.open()"
            >
              {{ t("slackApp.card.reinstall") }}
              <OTooltip
                v-if="readOnly"
                side="bottom"
                :content="t('slackApp.connect.permissionHint')"
              />
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

        <OBanner
          v-if="refused"
          variant="warning"
          dense
          icon="warning"
          data-test="slack-workspace-refused"
        >
          {{ refused.text }}
          <OTimeCell :value="refused.at" unit="us" />
        </OBanner>
        <OBanner
          v-if="appTokenWarning"
          variant="warning"
          dense
          icon="warning"
          data-test="slack-workspace-app-token"
        >
          {{ appTokenWarning }}
        </OBanner>
      </div>

      <OSettingRow control-at="end" :label="t('slackApp.card.eventsLabel')">
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
      </OSettingRow>
      <OSettingRow v-if="showSockets" control-at="end" :label="t('slackApp.card.connectionLabel')">
        <span class="flex items-center gap-2 text-sm" data-test="slack-workspace-sockets">
          <OIcon
            :name="socketsUp ? 'check-circle' : 'warning-amber'"
            size="sm"
            :class="socketsUp ? 'text-status-positive' : 'text-status-warning-text'"
          />
          {{ socketsUp ? t("slackApp.card.connectionUp") : t("slackApp.card.connectionDown") }}
          <OPopover
            v-model:open="connectionInfoOpen"
            side="bottom"
            align="start"
            :aria-label="t('slackApp.card.aboutConnection')"
          >
            <template #trigger>
              <OButton
                variant="ghost"
                size="xs"
                icon-left="info-outline"
                data-test="slack-workspace-connection-info"
              >
                <span class="sr-only">{{ t("slackApp.card.aboutConnection") }}</span>
              </OButton>
            </template>
            <p class="w-96 max-w-[calc(100vw-1.5rem)] p-3 leading-5">
              <OText variant="meta" data-test="slack-workspace-connection-detail">
                {{ modeLabel }} {{ raw("·") }}
                {{
                  t("slackApp.card.sockets", {
                    up: installation.health.sockets_up,
                    want: installation.health.sockets_want,
                    time: socketsAsOf,
                  })
                }}
              </OText>
            </p>
          </OPopover>
        </span>
      </OSettingRow>
      <OSettingRow v-if="outbound" control-at="end" :label="t('slackApp.card.outboundLabel')">
        <span
          class="flex items-center gap-2 text-sm"
          :data-state="outbound.slow ? 'warning' : 'ok'"
          data-test="slack-workspace-outbound"
        >
          <OIcon
            :name="outbound.slow ? 'warning-amber' : 'check-circle'"
            size="sm"
            class="shrink-0"
            :class="outbound.slow ? 'text-status-warning-text' : 'text-status-positive'"
          />
          {{ outbound.text }}
        </span>
      </OSettingRow>
      <OSettingRow
        v-if="ownsInstallation"
        control-at="end"
        :label="t('slackApp.card.collaboratorsLabel')"
        :description="t('slackApp.card.collaborator')"
      >
        <OButton
          as="a"
          :href="collaboratorsUrl"
          target="_blank"
          rel="noopener noreferrer"
          variant="outline"
          size="sm-action"
          icon-right="open-in-new"
          data-test="slack-collaborators"
        >
          {{ t("slackApp.card.openCollaborators") }}
        </OButton>
      </OSettingRow>
      <OSettingRow
        v-if="ownsInstallation && installation.has_config_refresh_token"
        control-at="end"
        :label="t('slackApp.card.refreshTokenKept')"
        data-test="slack-refresh-token"
      >
        <OButton
          variant="outline-destructive"
          size="sm-action"
          icon-left="delete"
          :loading="credentialsMutation.isPending.value"
          :disabled="readOnly"
          data-test="slack-forget-token"
          @click="forgetOpen = true"
        >
          {{ t("slackApp.card.forget") }}
          <OTooltip v-if="readOnly" side="bottom" :content="t('slackApp.connect.permissionHint')" />
        </OButton>
      </OSettingRow>
      <OForm :form="helpContactForm" novalidate data-test="slack-help-contact-form">
        <OSettingRow
          control-at="end"
          name="help_contact"
          :loading="helpContact.isPending.value"
          :label="t('slackApp.card.helpContact')"
          :description="t('slackApp.card.helpContactHelp')"
        >
          <OFormInput
            name="help_contact"
            class="w-full"
            :aria-label="t('slackApp.card.helpContact')"
            :placeholder="t('slackApp.card.helpContactPlaceholder')"
            :maxlength="HELP_CONTACT_MAX_LENGTH"
            :disabled="readOnly"
            data-test="slack-help-contact"
          />
        </OSettingRow>
      </OForm>

      <div
        v-if="testItems.length"
        class="border-border-default flex flex-col gap-3 border-t px-4 py-3"
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
    </OFormSection>

    <slot name="oncall" />

    <OFormSection
      v-if="!isInstance"
      variant="plain"
      :title="t('slackApp.card.connectedOrgs')"
      :description="otherOrgsLine"
      data-test="slack-connected-orgs"
    >
      <div class="rounded-b-surface -mx-4 -my-3 overflow-hidden">
        <OTable
          :data="orgRows"
          :columns="orgColumns"
          row-key="org"
          pagination="none"
          :show-global-filter="false"
          :cell-overflow-tooltip="false"
          :frame="false"
          dense
        />
      </div>
    </OFormSection>

    <slot />

    <OFormSection
      v-if="showDisconnect || ownsInstallation"
      variant="plain"
      tone="danger"
      :title="t('slackApp.card.disconnectSection')"
    >
      <p
        v-if="readOnly"
        class="text-text-secondary border-border-default flex items-start gap-2 border-b px-4 py-3 text-sm"
        data-test="slack-danger-locked"
      >
        <OIcon name="lock" size="sm" class="mt-0.5 shrink-0" />
        <span>{{ t("slackApp.insights.locked") }} {{ t("slackApp.insights.lockedDetail") }}</span>
      </p>
      <OSettingRow
        v-if="showDisconnect"
        control-at="end"
        :label="t('slackApp.card.disconnectThisOrg')"
        :description="t('slackApp.card.disconnectDescription', { org: orgName })"
      >
        <OButton
          variant="outline-destructive"
          size="sm-action"
          icon-left="link-off"
          :disabled="readOnly"
          data-test="slack-disconnect-org"
          @click="emit('disconnect')"
        >
          {{ t("slackApp.card.disconnectThisOrg") }}
        </OButton>
      </OSettingRow>
      <OSettingRow
        v-if="ownsInstallation"
        control-at="end"
        :label="t('slackApp.card.uninstall')"
        :description="t('slackApp.card.uninstallDescription')"
      >
        <OButton
          variant="destructive"
          size="sm-action"
          icon-left="delete"
          :disabled="readOnly"
          data-test="slack-uninstall"
          @click="emit('uninstall')"
        >
          {{ t("slackApp.card.uninstall") }}
        </OButton>
      </OSettingRow>
    </OFormSection>

    <SlackCredentialsDialog v-model:open="credentialsOpen" :installation="installation" />
    <ConfirmDialog
      v-model="forgetOpen"
      :title="t('slackApp.card.forgetTitle')"
      message-keypath="slackApp.card.forgetMessage"
      :message-name="installation.team_name"
      :ok-label="t('slackApp.card.forgetConfirm')"
      ok-variant="destructive"
      focus-cancel
      @update:ok="forget"
    />
  </div>
</template>
