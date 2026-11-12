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
import { computed, ref, watch } from "vue";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { useSlackOAuthPopup } from "@/composables/slack/useSlackOAuthPopup";
import destinationService from "@/services/alert_destination";
import { destinationsQuery, saveDestinationMutation } from "@/services/alert_destination.queries";
import { oncallTeamRoomsQuery } from "@/services/oncall.queries";
import {
  connectInstallationMutation,
  installExchangeMutation,
  installStartMutation,
  slackChannelDefaultsQuery,
  slackChannelsQuery,
  slackInstallationsQuery,
} from "@/services/slack.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { Template } from "@/ts/interfaces";
import type {
  SlackChannel,
  SlackCreatedDestination,
  SlackDestinationRefusal,
  SlackInstallExchangeResponse,
} from "@/types/slack";
import type { TestResult } from "@/utils/prebuilt-templates/types";
import {
  buildSlackAppDestination,
  buildSlackAppTest,
  hasWebhookInChannel,
  oncallRoomFor,
  slackAppSaveRefusal,
  type SlackAppDestination,
  type SlackAppFormValues,
} from "@/utils/slackAppDestination";
import DestinationTestResult from "./DestinationTestResult.vue";
import {
  DEFAULT_SLACK_TEMPLATE,
  makeSlackAppDestinationSchema,
  slackAppFormDefaults,
} from "./SlackAppDestinationForm.schema";

const props = withDefaults(
  defineProps<{
    destination?: SlackAppDestination | null;
    templates?: Template[];
    confirmation?: { code: string; team?: string; destination?: string };
  }>(),
  { destination: null, templates: () => [] },
);

const emit = defineEmits<{ saved: []; cancel: [] }>();

const FORM_ID = "slack-app-destination-form";
const SLACK = raw("Slack");

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const orgName = computed(() => raw(store.state.selectedOrganization?.label ?? org.value));
const isCloud = computed(() => config.isCloud === "true");

// Set when Connect Slack created the destination, which the form then edits.
const connectedDestination = ref<SlackAppDestination | null>(null);
const current = computed(() => connectedDestination.value ?? props.destination);
const isEdit = computed(() => !!current.value);

const installations = useQuery(() =>
  Object.assign(slackInstallationsQuery(org.value, { silentForbidden: true }), {
    enabled: !!org.value,
  }),
);
const workspaces = computed(() =>
  (installations.data.value?.installations ?? []).filter(
    (i) => i.status !== "revoked" && i.status !== "pending",
  ),
);
const workspaceOptions = computed(() =>
  workspaces.value.map((i) => ({ label: raw(i.team_name), value: i.id })),
);
const noWorkspace = computed(() => installations.isSuccess.value && !workspaces.value.length);

// Server refusals that point at a tick: they force the box even when the UI saw no reason.
const serverOncall = ref<{ team: string; destination: string } | null>(
  props.confirmation?.code === "oncall_room_unconfirmed"
    ? { team: props.confirmation.team ?? "", destination: props.confirmation.destination ?? "" }
    : null,
);
const serverShared = ref(props.confirmation?.code === "shared_channel_unconfirmed");
const refusal = ref<I18nText | null>(null);

const values = ref<SlackAppFormValues>(slackAppFormDefaults(current.value));
const subteam = computed(() => {
  const mention = current.value?.mention;
  return mention && typeof mention === "object" ? mention : null;
});

const channelSearch = ref("");
const seenChannels = ref(new Map<string, SlackChannel>());
// The channel a Connect refusal filled in, so the reset below does not clear its confirm.
const seededChannel = ref<string | null>(null);
const installationId = computed(() => values.value.installation_id);
const channelId = computed(() => values.value.channel_id);
const channelChanged = computed(
  () => !isEdit.value || channelId.value !== current.value?.channel_id,
);

const channels = useInfiniteQuery(() =>
  Object.assign(slackChannelsQuery(org.value, installationId.value, channelSearch.value), {
    enabled: !!installationId.value,
  }),
);
const channelDefaults = useQuery(() =>
  Object.assign(slackChannelDefaultsQuery(org.value, installationId.value), {
    enabled: !!installationId.value,
  }),
);
const destinations = useQuery(() => destinationsQuery(org.value, "alert"));
const teamRoomsNeeded = computed(
  () => channelChanged.value && hasWebhookInChannel(channelId.value, destinations.data.value ?? []),
);
const teamRooms = useQuery(() =>
  Object.assign(oncallTeamRoomsQuery(org.value), { enabled: teamRoomsNeeded.value }),
);

watch(
  () => channels.data.value?.pages,
  (pages) => {
    for (const channel of pages?.flatMap((page) => page.channels) ?? []) {
      seenChannels.value.set(channel.id, channel);
    }
  },
  { immediate: true },
);

const selectedChannel = computed(() => seenChannels.value.get(channelId.value) ?? null);
const channelName = computed(
  () => selectedChannel.value?.name ?? values.value.channel_name ?? channelId.value,
);
const channelOptions = computed(() => {
  const options = [...seenChannels.value.values()].map((c) => ({
    label: raw(`#${c.name}`),
    value: c.id,
  }));
  if (channelId.value && !seenChannels.value.has(channelId.value)) {
    options.unshift({ label: raw(`#${channelName.value}`), value: channelId.value });
  }
  return options;
});

const workspaceName = computed(() =>
  raw(workspaces.value.find((w) => w.id === installationId.value)?.team_name ?? ""),
);

const isShared = computed(() => {
  const channel = selectedChannel.value;
  return !!channel && (channel.is_ext_shared ?? channel.is_shared);
});
const needsShared = computed(() => isShared.value || serverShared.value);

const oncallRoom = computed(() => {
  if (serverOncall.value) return serverOncall.value;
  if (!teamRoomsNeeded.value) return null;
  return oncallRoomFor(channelId.value, destinations.data.value ?? [], teamRooms.data.value ?? []);
});
const needsOncall = computed(() => !!oncallRoom.value);

const schema = makeSlackAppDestinationSchema(t, {
  needsShared: () => needsShared.value,
  needsOncall: () => needsOncall.value,
});

const save = useMutation(() => saveDestinationMutation(org.value, () => isEdit.value));

const form = useOForm({
  defaultValues: slackAppFormDefaults(current.value),
  schema,
  onSubmit: (value: SlackAppFormValues) => submit(value),
});

const formValues = form.useStore((s: { values: SlackAppFormValues }) => s.values);
watch(
  formValues,
  (next) => {
    values.value = { ...next };
  },
  { immediate: true, deep: true },
);

const fieldErrorCount = (field: keyof SlackAppFormValues) =>
  form.useStore(
    (s: { fieldMeta: Record<string, { errors?: unknown[] } | undefined> }) =>
      s.fieldMeta?.[field]?.errors?.length ?? 0,
  );
const sharedErrors = fieldErrorCount("shared_channel_confirmed");
const oncallErrors = fieldErrorCount("oncall_room_confirmed");

const firstWorkspace = computed(() => workspaces.value[0]?.id ?? "");
watch(
  firstWorkspace,
  (id) => {
    if (id && !values.value.installation_id) form.setFieldValue("installation_id", id);
  },
  { immediate: true },
);

const autoName = (name: string) => (name ? `slack-${name}` : "");

// A new channel is a new decision, so both ticks and server refusals start over.
watch(channelId, (next, previous) => {
  if (previous === undefined || next === previous) return;
  if (next && next === seededChannel.value) {
    seededChannel.value = null;
    return;
  }
  const name = seenChannels.value.get(next)?.name ?? "";
  form.setFieldValue("channel_name", name);
  if (!isEdit.value) {
    const prevName = seenChannels.value.get(previous)?.name ?? "";
    if (!values.value.name || values.value.name === autoName(prevName)) {
      form.setFieldValue("name", autoName(name));
    }
  }
  form.setFieldValue("shared_channel_confirmed", false);
  form.setFieldValue("oncall_room_confirmed", false);
  serverOncall.value = null;
  serverShared.value = false;
  refusal.value = null;
});

watch(installationId, (next, previous) => {
  if (previous === undefined || next === previous || !previous) return;
  form.setFieldValue("channel_id", "");
});

const defaultRow = computed(() =>
  (channelDefaults.data.value?.defaults ?? []).find((r) => r.channel_id === channelId.value),
);
const defaultHint = computed<{ text: I18nText; info: boolean } | null>(() => {
  if (!channelId.value || !channelDefaults.isSuccess.value) return null;
  const row = defaultRow.value;
  const channel = raw(channelName.value);
  if (!row) {
    return {
      text: t("slackApp.destination.setsDefault", { channel, org: orgName.value }),
      info: false,
    };
  }
  if (row.set_by_this_org) return null;
  const text = row.org_name
    ? t("slackApp.destination.answersFor", {
        channel,
        org: raw(row.org_name),
        thisOrg: orgName.value,
      })
    : t("slackApp.destination.answersForAnother", { channel, thisOrg: orgName.value });
  return { text, info: true };
});

const channelTag = computed<{ label: I18nText; variant: "warning-soft" } | null>(() => {
  if (needsOncall.value && channelChanged.value) {
    return { label: t("slackApp.destination.oncallTag"), variant: "warning-soft" };
  }
  if (isShared.value) {
    return {
      label: t("slackApp.destination.sharedTag", { product: SLACK }),
      variant: "warning-soft",
    };
  }
  return null;
});

const mentionOptions = computed(() => {
  const options = [
    { label: t("slackApp.destination.mentionCritical"), value: "default" },
    { label: raw("@here"), value: "here" },
    { label: raw("@channel"), value: "channel" },
    { label: t("slackApp.destination.mentionNone"), value: "none" },
  ];
  if (subteam.value) options.push({ label: raw(`@${subteam.value.handle}`), value: "subteam" });
  return options;
});

const templateOptions = computed(() => {
  const options = [
    {
      label: t("slackApp.destination.templateDefault", {
        product: SLACK,
        name: raw(DEFAULT_SLACK_TEMPLATE),
      }),
      value: DEFAULT_SLACK_TEMPLATE,
    },
  ];
  for (const template of props.templates) {
    if (template.isPrebuilt || template.type === "email") continue;
    options.push({ label: raw(template.name), value: template.name });
  }
  return options;
});

const body = (value: SlackAppFormValues) =>
  buildSlackAppDestination(
    { ...value, channel_name: value.channel_name || channelName.value },
    { subteam: subteam.value, previousWebhook: current.value?.previous_webhook ?? null },
  );

async function submit(value: SlackAppFormValues): Promise<void> {
  refusal.value = null;
  const data = body(value);
  try {
    await save.mutateAsync({ destination_name: data.name, data });
    toast({ variant: "success", message: t("alert_destinations.saved") });
    emit("saved");
  } catch (error) {
    const reason = slackAppSaveRefusal(error);
    if (reason.kind === "oncall_room") {
      serverOncall.value = { team: reason.team, destination: reason.destination };
    } else if (reason.kind === "shared") {
      serverShared.value = true;
    } else if (reason.kind === "version") {
      refusal.value = t("slackApp.destination.versionMismatch");
    } else {
      refusal.value = raw(reason.message) || t("slackApp.destination.saveFailed");
    }
  }
}

const testResult = ref<TestResult | null>(null);
const testing = ref(false);
const canTest = computed(() => !!installationId.value && !!channelId.value);

async function sendTest(): Promise<void> {
  if (!canTest.value) return;
  testing.value = true;
  try {
    const res = await destinationService.test({
      org_identifier: org.value,
      data: buildSlackAppTest(body(values.value)),
    });
    testResult.value = {
      success: !!res.data?.success,
      timestamp: Date.now(),
      error: res.data?.error,
      responseBody: res.data?.responseBody,
    };
  } catch (error) {
    const reason = slackAppSaveRefusal(error);
    testResult.value = {
      success: false,
      timestamp: Date.now(),
      error:
        reason.kind === "other" && reason.message
          ? reason.message
          : t("alerts.prebuilt.testFailedUnknownError"),
    };
  } finally {
    testing.value = false;
  }
}

watch([installationId, channelId], () => (testResult.value = null));

const installStart = useMutation(() => installStartMutation(org.value, { silentForbidden: true }));
const installExchange = useMutation(() => installExchangeMutation(org.value));
const connectInstallation = useMutation(() => connectInstallationMutation(org.value));

const openConnected = async (name: string): Promise<void> => {
  const list = await destinations.refetch();
  const row = (list.data ?? []).find((d: { name: string }) => d.name === name);
  if (!row) return;
  connectedDestination.value = row as SlackAppDestination;
  form.reset(slackAppFormDefaults(connectedDestination.value));
};

// The OAuth code is spent, so the form asks the same tick (MK-7, MK-20) and its own Save carries it.
const askConfirm = (installationId: string, r: SlackDestinationRefusal): void => {
  const shared = r.code === "shared_channel_unconfirmed";
  const name = r.channel.replace(/^#/, "");
  seenChannels.value.set(r.channel_id, {
    id: r.channel_id,
    name,
    is_private: false,
    is_member: true,
    is_shared: shared,
    is_ext_shared: shared,
  });
  seededChannel.value = r.channel_id;
  form.setFieldValue("installation_id", installationId);
  form.setFieldValue("channel_id", r.channel_id);
  form.setFieldValue("channel_name", name);
  if (!values.value.name) form.setFieldValue("name", autoName(name));
  if (r.code === "oncall_room_unconfirmed") {
    serverOncall.value = { team: r.team ?? "", destination: r.destination ?? "" };
  } else if (shared) {
    serverShared.value = true;
  } else {
    refusal.value = raw(r.message) || t("slackApp.destination.saveFailed");
  }
};

const applyConnect = (
  installationId: string,
  r: { destination: SlackCreatedDestination | null; destination_refusal?: SlackDestinationRefusal },
): void => {
  if (r.destination) {
    toast({
      variant: "success",
      message: t("slackApp.destination.connected", {
        name: raw(r.destination.name),
        channel: raw(r.destination.channel),
      }),
    });
    void openConnected(r.destination.name);
  } else if (r.destination_refusal) {
    askConfirm(installationId, r.destination_refusal);
  }
};

const onConnected = (result: SlackInstallExchangeResponse): void => {
  if ("already_installed" in result) {
    const installationId = result.already_installed.installation_id;
    connectInstallation
      .mutateAsync({ installationId, body: { connect_ticket: result.connect_ticket } })
      .then((r) => applyConnect(installationId, r))
      .catch(() => undefined);
    return;
  }
  if ("destination" in result) applyConnect(result.installation.id, result);
};

const { connecting, open: connectSlack } = useSlackOAuthPopup<SlackInstallExchangeResponse>({
  start: async () =>
    (await installStart.mutateAsync({ source: "destination_form", create_destination: true }))
      .authorization_url,
  exchange: (callback) => installExchange.mutateAsync(callback),
  onSuccess: onConnected,
});

const slackSettingsHref = computed(
  () => router.resolve({ name: "slack", query: { org_identifier: org.value } }).href,
);

const onChannelSearch = (q: string) => {
  channelSearch.value = q;
};
</script>

<template>
  <section class="flex w-full flex-col gap-4" data-test="slack-app-destination-form">
    <div v-if="installations.isPending.value" class="flex justify-center py-10">
      <OSpinner size="md" />
    </div>

    <OBanner
      v-else-if="noWorkspace && isCloud"
      variant="info"
      icon="forum"
      data-test="slack-app-dest-connect-banner"
    >
      <div class="flex flex-col gap-0.5">
        <span class="font-medium">
          {{ t("slackApp.destination.connectTitle", { product: SLACK }) }}
        </span>
        <span class="text-xs">
          {{ t("slackApp.destination.connectDetail", { product: SLACK }) }}
        </span>
      </div>
      <template #actions>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="connecting"
          data-test="slack-app-dest-connect"
          @click="connectSlack"
        >
          {{ t("alert_destinations.slackOAuth.connectSlack") }}
        </OButton>
      </template>
    </OBanner>

    <OBanner
      v-else-if="noWorkspace"
      variant="info"
      dense
      icon="forum"
      inline-actions
      data-test="slack-app-dest-self-hosted"
    >
      {{ t("alert_destinations.slackOAuth.selfHostedApp") }}
      <template #actions>
        <OButton
          as="a"
          :href="slackSettingsHref"
          target="_blank"
          rel="noopener noreferrer"
          variant="ghost-primary"
          size="xs"
          icon-right="open-in-new"
          data-test="slack-app-dest-settings-link"
        >
          {{ t("alert_destinations.slackOAuth.openSlackSettings") }}
        </OButton>
      </template>
    </OBanner>

    <OForm v-else :id="FORM_ID" :form="form" class="flex max-w-240 flex-col gap-5">
      <div class="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
        <OFormInput
          name="name"
          :label="t('alerts.name')"
          required
          :readonly="isEdit"
          :disabled="isEdit"
          data-test="slack-app-dest-name"
        />
        <OFormSelect
          name="installation_id"
          :label="t('slackApp.destination.workspace')"
          :options="workspaceOptions"
          :searchable="false"
          required
          data-test="slack-app-dest-workspace"
        />
      </div>

      <div class="flex flex-col gap-1">
        <OFormSelect
          name="channel_id"
          :label="t('slackApp.destination.channel')"
          :options="channelOptions"
          :placeholder="t('slackApp.channels.channelPlaceholder')"
          :loading="channels.isFetching.value"
          :search-debounce="300"
          required
          data-test="slack-app-dest-channel"
          @search="onChannelSearch"
        >
          <template v-if="channelTag && channelId" #trigger>
            <span class="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span class="truncate">{{ raw(`#${channelName}`) }}</span>
              <OTag
                :variant="channelTag.variant"
                size="sm"
                :label="channelTag.label"
                data-test="slack-app-dest-channel-tag"
              />
            </span>
          </template>
        </OFormSelect>
        <p
          v-if="defaultHint"
          class="text-text-secondary m-0 flex items-start gap-1 text-xs"
          data-test="slack-app-dest-default-hint"
        >
          <OIcon v-if="defaultHint.info" name="info" size="xs" class="mt-0.5 shrink-0" />
          <span>{{ defaultHint.text }}</span>
        </p>
      </div>

      <div
        v-if="needsShared"
        class="bg-status-warning-bg rounded-default flex gap-3 border p-3"
        :class="sharedErrors ? 'border-input-border-error' : 'border-transparent'"
        :data-error="String(sharedErrors > 0)"
        data-test="slack-app-dest-shared"
      >
        <OIcon name="warning" size="sm" class="text-status-warning-text mt-0.5 shrink-0" />
        <div class="flex min-w-0 flex-col gap-2 text-sm">
          <p class="text-text-body m-0">
            <span class="font-semibold">
              {{
                t("slackApp.destination.sharedTitle", {
                  channel: raw(channelName),
                  workspace: workspaceName,
                })
              }}
            </span>
            {{ t("slackApp.destination.sharedDetail") }}
          </p>
          <OFormCheckbox
            name="shared_channel_confirmed"
            :label="t('slackApp.destination.sharedConfirm')"
            data-test="slack-app-dest-shared-confirm"
          />
        </div>
      </div>

      <div
        v-if="oncallRoom"
        class="bg-status-warning-bg rounded-default flex gap-3 border p-3"
        :class="oncallErrors ? 'border-input-border-error' : 'border-transparent'"
        :data-error="String(oncallErrors > 0)"
        data-test="slack-app-dest-oncall-room"
      >
        <OIcon name="warning" size="sm" class="text-status-warning-text mt-0.5 shrink-0" />
        <div class="flex min-w-0 flex-col gap-2 text-sm">
          <p class="text-text-body m-0">
            <span class="font-semibold">
              {{
                t("slackApp.destination.oncallTitle", {
                  team: raw(oncallRoom.team),
                  channel: raw(channelName),
                  destination: raw(oncallRoom.destination),
                })
              }}
            </span>
            {{ t("slackApp.destination.oncallDetail") }}
          </p>
          <OFormCheckbox
            name="oncall_room_confirmed"
            :label="t('slackApp.destination.oncallConfirm')"
            data-test="slack-app-dest-oncall-confirm"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
        <OFormSelect
          name="mention"
          :label="t('slackApp.destination.mention')"
          :options="mentionOptions"
          :searchable="false"
          :help-text="t('slackApp.destination.mentionHelp')"
          data-test="slack-app-dest-mention"
        />
        <OFormInput
          name="refire_reuse_minutes"
          type="number"
          :label="t('slackApp.destination.refireReuse')"
          :help-text="t('slackApp.destination.refireReuseHelp')"
          data-test="slack-app-dest-refire"
        />
      </div>

      <div class="divide-border-default flex flex-col divide-y">
        <div class="flex items-center justify-between gap-4 pb-3">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-text-heading text-sm">{{ t("slackApp.destination.buttons") }}</span>
            <span class="text-text-secondary text-xs">
              {{ t("slackApp.destination.buttonsHelp") }}
            </span>
          </div>
          <OFormSwitch
            name="buttons"
            :aria-label="t('slackApp.destination.buttons')"
            data-test="slack-app-dest-buttons"
          />
        </div>
        <div class="flex items-center justify-between gap-4 pt-3">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-text-heading text-sm">
              {{ t("slackApp.destination.autoInvestigate") }}
            </span>
            <span class="text-text-secondary text-xs">
              {{ t("slackApp.destination.autoInvestigateHelp") }}
            </span>
          </div>
          <OFormSwitch
            name="auto_investigate"
            :aria-label="t('slackApp.destination.autoInvestigate')"
            data-test="slack-app-dest-auto-investigate"
          />
        </div>
      </div>

      <OFormSelect
        name="template"
        :label="t('alert_destinations.template')"
        :options="templateOptions"
        data-test="slack-app-dest-template"
      />

      <OBanner
        v-if="refusal"
        variant="error"
        dense
        icon="error"
        :content="refusal"
        data-test="slack-app-dest-refusal"
      />

      <DestinationTestResult
        v-if="testResult"
        :result="testResult"
        :is-loading="testing"
        :show-success-response-body="true"
        @retry="sendTest"
      />

      <div class="flex flex-wrap items-center justify-between gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="send"
          :loading="testing"
          :disabled="!canTest"
          data-test="slack-app-dest-test"
          @click="sendTest"
        >
          {{ t("slackApp.destination.sendTest") }}
        </OButton>
        <div class="flex gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="slack-app-dest-cancel"
            @click="emit('cancel')"
          >
            {{ t("alerts.cancel") }}
          </OButton>
          <OButton variant="primary" size="sm-action" type="submit" data-test="slack-app-dest-save">
            {{ t("alerts.save") }}
          </OButton>
        </div>
      </div>
    </OForm>
  </section>
</template>
