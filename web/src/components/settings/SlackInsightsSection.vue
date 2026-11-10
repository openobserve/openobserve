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
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormTime from "@/lib/forms/Time/OFormTime.vue";
import { destinationsQuery } from "@/services/alert_destination.queries";
import {
  autoobserveIncidentsPageQuery,
  autoobserveSuggestionsPageQuery,
} from "@/services/autoobserve.queries";
import {
  putInsightsSettingsMutation,
  slackChannelsQuery,
  slackInsightsSettingsQuery,
} from "@/services/slack.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { InstallationView, SlackChannel } from "@/types/slack";
import { resolvableTimezones } from "@/utils/oncall";
import { alertRoutesByChannel } from "@/utils/slackAppDestination";
import { isSlackUrl } from "@/utils/slackLink";
import SlackInsightsRow from "./SlackInsightsRow.vue";
import { makeInsightsSchema } from "./SlackSettings.schema";
import {
  channelLabel,
  editSummary,
  lastDigestInLine,
  lastDigestLine,
  moveLine,
  readOnlyHelp,
  removedLine,
  saveFailure,
  todayCountsSentence,
  type InsightsFormValues,
  type InsightsSaveFailure,
  type InsightsTodayCounts,
} from "./slackInsightsCopy";

type LineAction = "digest" | "pick" | "reinstall" | null;

interface ChannelLine {
  tone: "info" | "warning";
  texts: I18nText[];
  action: LineAction;
}

const props = defineProps<{ installations: InstallationView[] }>();
const emit = defineEmits<{ reinstall: [installationId: string] }>();

// Design §5: the digest posts at 09:00 until an admin picks another time.
const DEFAULT_DIGEST_TIME = "09:00";
// One page of open outages answers "how many need attention"; past it the line says "N+".
const ATTENTION_CAP = 50;
const SEARCH_DEBOUNCE_MS = 300;
const FIELDS = [
  "installation_id",
  "channel_id",
  "digest_time",
  "digest_time_zone",
  "post_trial_findings",
  "allow_changes_from_slack",
] as const;

const { t, locale } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const orgName = computed<string>(() => store.state.selectedOrganization?.label || org.value);
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const settings = useQuery(() => slackInsightsSettingsQuery(org.value));
const data = computed(() => settings.data.value ?? null);
const canEdit = computed(() => data.value?.can_edit !== false);
const savedChannel = computed(() => data.value?.channel ?? null);
const several = computed(() => props.installations.length > 1);

const defaults = computed<InsightsFormValues>(() => {
  const s = data.value;
  return {
    installation_id: s?.channel?.installation_id ?? props.installations[0]?.id ?? "",
    channel_id: s?.channel?.channel_id ?? null,
    digest_time: s?.digest_time || DEFAULT_DIGEST_TIME,
    digest_time_zone: s?.digest_time_zone || browserZone,
    post_trial_findings: s?.post_trial_findings ?? false,
    allow_changes_from_slack: s?.allow_changes_from_slack ?? false,
  };
});

const installationOf = (id: string) => props.installations.find((i) => i.id === id) ?? null;
const savedInstallation = computed(
  () => installationOf(defaults.value.installation_id) ?? props.installations[0] ?? null,
);
const removed = computed(() => savedInstallation.value?.status === "revoked");
const readOnly = computed(() => !canEdit.value || removed.value);

const failure = ref<InsightsSaveFailure | null>(null);
const refreshFailed = ref(false);
const put = useMutation(() => putInsightsSettingsMutation(org.value));
const form = useOForm<InsightsFormValues>({
  defaultValues: defaults.value,
  schema: makeInsightsSchema(t),
  onSubmit: (value) => save(value),
});
const values = form.useStore((s) => s.values);
// What the in-flight save sent; a field edited since then keeps its edit when the answer arrives.
const submitted = ref<InsightsFormValues | null>(null);
// What the form showed before Refresh, so a refused save's edits survive the re-read.
const kept = ref<InsightsFormValues | null>(null);
// A new answer (a save, Refresh, another org) replaces what the form shows.
watch(
  () => [JSON.stringify(defaults.value), data.value?.revision],
  () => {
    const sent = submitted.value ?? kept.value;
    const shown = { ...values.value };
    submitted.value = null;
    kept.value = null;
    form.reset(defaults.value);
    if (!sent) return;
    const edited = new Set(FIELDS.filter((field) => shown[field] !== sent[field]));
    // Workspace and channel are one destination: keeping either keeps both, workspace first.
    if (edited.has("installation_id") || edited.has("channel_id")) {
      edited.add("installation_id").add("channel_id");
    }
    for (const field of FIELDS) {
      if (edited.has(field)) form.setFieldValue(field, shown[field]);
    }
  },
);
const dirty = computed(() => FIELDS.some((f) => values.value[f] !== defaults.value[f]));

const pickerOpened = ref(false);
const channelSearch = ref("");
// Every channel a search or page has shown, so a picked one keeps its name when the next search drops it.
const seenChannels = ref(new Map<string, SlackChannel>());
const channelField = ref<HTMLElement | null>(null);
const pickerEnabled = computed(
  () => pickerOpened.value && !readOnly.value && !!values.value.installation_id,
);
const channels = useInfiniteQuery(() =>
  Object.assign(slackChannelsQuery(org.value, values.value.installation_id, channelSearch.value), {
    enabled: pickerEnabled.value,
  }),
);
const destinations = useQuery(() =>
  Object.assign(destinationsQuery(org.value, "alert"), { enabled: pickerEnabled.value }),
);
const alertRoutes = computed(() =>
  alertRoutesByChannel(destinations.data.value ?? [], values.value.installation_id),
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

watch(
  () => values.value.installation_id,
  (id, previous) => {
    if (previous === undefined || id === previous) return;
    channelSearch.value = "";
    seenChannels.value = new Map();
    const back = id === defaults.value.installation_id;
    form.setFieldValue("channel_id", back ? defaults.value.channel_id : null);
  },
);

const isSaved = (channelId: string) =>
  savedChannel.value?.channel_id === channelId &&
  savedChannel.value.installation_id === values.value.installation_id;

const channelName = (channelId: string): string =>
  seenChannels.value.get(channelId)?.name ??
  (savedChannel.value?.channel_id === channelId ? savedChannel.value.channel_name : "");

const suffixOf = (channel: { id: string; is_private: boolean }): I18nText | undefined => {
  if (isSaved(channel.id)) return t("slackApp.insights.picked");
  const routes = alertRoutes.value[channel.id];
  if (routes) return t("slackApp.insights.alertRoutes", { count: routes }, routes);
  return channel.is_private ? t("slackApp.insights.privateChannel") : undefined;
};

const channelOptions = computed(() => {
  const listed = channels.data.value?.pages.flatMap((page) => page.channels) ?? [];
  const ordered = new Map(listed.map((c) => [c.id, c]));
  for (const [id, channel] of seenChannels.value) if (!ordered.has(id)) ordered.set(id, channel);
  const options: { label: I18nText; value: string | null; suffix?: I18nText }[] = [
    ...ordered.values(),
  ].map((c) => ({
    label: raw(channelLabel(c.name)),
    value: c.id,
    suffix: suffixOf(c),
  }));
  const saved = savedChannel.value;
  if (saved && isSaved(saved.channel_id) && !ordered.has(saved.channel_id)) {
    options.unshift({
      label: raw(channelLabel(saved.channel_name)),
      value: saved.channel_id,
      suffix: t("slackApp.insights.picked"),
    });
  }
  // Offered only once there is a channel to clear, so an unpicked picker keeps its placeholder.
  if (saved || values.value.channel_id) {
    options.unshift({
      label: t("slackApp.insights.noChannelValue"),
      value: null,
      suffix: undefined,
    });
  }
  return options;
});

const workspaceOptions = computed(() =>
  props.installations.map((i) => ({ label: raw(i.team_name), value: i.id })),
);
const zoneOptions = computed(() =>
  resolvableTimezones(values.value.digest_time_zone).map((zone) => ({
    label: raw(zone),
    value: zone,
  })),
);

// Today's counts only matter where no channel gets them: no channel yet, or the app removed (D2).
const countsWanted = computed(() => !!data.value && (!savedChannel.value || removed.value));
const attention = useQuery(() =>
  Object.assign(autoobserveIncidentsPageQuery(org.value, ATTENTION_CAP, 0), {
    enabled: countsWanted.value,
  }),
);
const suggestionTotal = useQuery(() =>
  Object.assign(autoobserveSuggestionsPageQuery(org.value, 1, 0), {
    enabled: countsWanted.value,
  }),
);
const todayCounts = computed<InsightsTodayCounts | null>(() => {
  const open = attention.data.value;
  const proposed = suggestionTotal.data.value;
  if (!open || !proposed) return null;
  return {
    attention: open.items.filter((item) => item.incident.status !== "resolved").length,
    attentionAtLeast: open.has_more,
    suggestions: proposed.total,
  };
});

// The link comes from the server, so only a Slack https link is followed.
const digestUrl = computed(() => {
  const link = data.value?.last_digest?.link;
  return isSlackUrl(link) ? link : null;
});
const digestZone = computed(() => data.value?.digest_time_zone || browserZone);

const line = computed<ChannelLine | null>(() => {
  const s = data.value;
  if (!s) return null;
  if (removed.value) {
    const workspace = savedInstallation.value?.team_name ?? "";
    return {
      tone: "warning",
      texts: [removedLine(t, workspace, todayCounts.value)],
      action: savedInstallation.value?.managed ? null : "reinstall",
    };
  }
  if (!s.channel) {
    const counts = todayCountsSentence(t, todayCounts.value, orgName.value);
    return {
      tone: "info",
      texts: [
        t("slackApp.insights.noChannel"),
        ...(counts ? [counts] : []),
        t("slackApp.insights.pickHint"),
      ],
      action: readOnly.value ? null : "pick",
    };
  }
  const digest = s.last_digest ?? null;
  const now = Date.now();
  if (several.value) {
    const channelInstallation = s.channel.installation_id;
    const others = props.installations
      .filter((i) => i.id !== channelInstallation)
      .map((i) => i.team_name);
    return {
      tone: "info",
      texts: [
        moveLine(t, others),
        ...(digest
          ? [
              lastDigestInLine(
                t,
                locale.value,
                digest,
                digestZone.value,
                now,
                s.channel.channel_name,
              ),
            ]
          : []),
      ],
      action: digest ? "digest" : null,
    };
  }
  if (!digest) return null;
  return {
    tone: "info",
    texts: [lastDigestLine(t, locale.value, digest, digestZone.value, now)],
    action: "digest",
  };
});

const help = computed(() => ({
  channel: readOnly.value
    ? t("slackApp.insights.channelHelpShort")
    : t("slackApp.insights.channelHelp"),
  digest: readOnly.value
    ? t("slackApp.insights.digestHelpShort")
    : t("slackApp.insights.digestHelp"),
  trial: readOnly.value
    ? readOnlyHelp(t, "trial", values.value.post_trial_findings)
    : t("slackApp.insights.trialHelp"),
  allow: readOnly.value
    ? readOnlyHelp(t, "allow", values.value.allow_changes_from_slack)
    : t("slackApp.insights.allowHelp"),
}));

const onOff = (on: boolean) => (on ? t("slackApp.insights.on") : t("slackApp.insights.off"));

const openPicker = (): void => {
  channelField.value?.querySelector<HTMLElement>('button, [role="combobox"]')?.click();
};

const refresh = async (): Promise<void> => {
  refreshFailed.value = false;
  kept.value = { ...defaults.value };
  const result = await settings.refetch();
  if (result.isError) {
    refreshFailed.value = true;
    return;
  }
  failure.value = null;
};

async function save(value: InsightsFormValues): Promise<void> {
  failure.value = null;
  refreshFailed.value = false;
  submitted.value = { ...value };
  const name = channelName(value.channel_id ?? "");
  const edits = editSummary(t, defaults.value, value, name);
  try {
    await put.mutateAsync({
      channel: value.channel_id
        ? {
            installation_id: value.installation_id,
            channel_id: value.channel_id,
            channel_name: name,
          }
        : null,
      digest_time: value.digest_time,
      digest_time_zone: value.digest_time_zone,
      post_trial_findings: value.post_trial_findings,
      allow_changes_from_slack: value.allow_changes_from_slack,
      revision: data.value?.revision ?? 0,
    });
    toast({ variant: "success", message: t("slackApp.insights.saved") });
  } catch (error) {
    submitted.value = null;
    failure.value = saveFailure(t, locale.value, error, edits, name);
  }
}
</script>

<template>
  <div data-test="slack-insights">
    <OEmptyState
      v-if="!data && settings.isError.value"
      size="compact"
      preset="load-error"
      data-test="slack-insights-load-error"
      @action="settings.refetch()"
    />
    <OForm v-else-if="data" :form="form" novalidate>
      <OCard variant="outlined" class="overflow-hidden">
        <div
          v-if="!canEdit"
          class="bg-surface-panel border-border-default text-text-heading flex items-start gap-2 border-b px-4 py-3 text-sm"
          data-test="slack-insights-lock"
        >
          <OIcon name="lock" size="sm" class="text-text-secondary mt-0.5 shrink-0" />
          <span>
            <strong>{{ t("slackApp.insights.locked") }}</strong>
            {{ t("slackApp.insights.lockedDetail") }}
            <span class="text-text-secondary">{{ t("slackApp.insights.askAdmin") }}</span>
          </span>
        </div>

        <SlackInsightsRow :label="t('slackApp.insights.channel')" :help="help.channel">
          <template #line>
            <div
              class="text-compact mt-2 flex min-h-10 items-start gap-2"
              :class="line?.tone === 'warning' ? 'text-status-warning-text' : 'text-text-body'"
              :data-state="line?.tone ?? 'none'"
              data-test="slack-insights-channel-line"
            >
              <template v-if="line">
                <OIcon
                  :name="line.tone === 'warning' ? 'warning-amber' : 'info-outline'"
                  size="sm"
                  class="mt-0.5 shrink-0"
                  :class="line.tone === 'warning' ? '' : 'text-text-secondary'"
                />
                <span>
                  <template v-for="(text, index) in line.texts" :key="index">
                    {{ text }}{{ " " }}
                  </template>
                  <OButton
                    v-if="line.action === 'digest' && digestUrl"
                    as="a"
                    variant="ghost-primary"
                    size="xs"
                    icon-right="open-in-new"
                    :href="digestUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-test="slack-insights-open-digest"
                  >
                    {{ t("slackApp.insights.openLastDigest") }}
                  </OButton>
                  <OButton
                    v-else-if="line.action === 'pick'"
                    variant="ghost-primary"
                    size="xs"
                    data-test="slack-insights-pick-channel"
                    @click="openPicker"
                  >
                    {{ t("slackApp.insights.pickChannel") }}
                  </OButton>
                  <OButton
                    v-else-if="line.action === 'reinstall'"
                    variant="ghost-primary"
                    size="xs"
                    data-test="slack-insights-go-reinstall"
                    @click="emit('reinstall', savedInstallation?.id ?? '')"
                  >
                    {{ t("slackApp.insights.goToReinstall") }}
                  </OButton>
                </span>
              </template>
            </div>
          </template>
          <OFormSelect
            v-if="several"
            name="installation_id"
            class="w-full"
            :label="t('slackApp.insights.workspace')"
            :options="workspaceOptions"
            :disabled="readOnly"
            data-test="slack-insights-workspace-select"
          />
          <div ref="channelField" class="w-full">
            <OFormSelect
              name="channel_id"
              :label="t('slackApp.insights.channel')"
              :placeholder="t('slackApp.channels.channelPlaceholder')"
              :search-placeholder="t('slackApp.channels.channelPlaceholder')"
              :options="channelOptions"
              :loading="channels.isFetching.value"
              :disabled="readOnly"
              :search-debounce="SEARCH_DEBOUNCE_MS"
              :help-text="readOnly ? undefined : t('slackApp.channels.privateHint')"
              data-test="slack-insights-channel-select"
              @open="pickerOpened = true"
              @search="channelSearch = $event.trim()"
            >
              <template #empty>
                <div
                  class="text-text-secondary text-compact flex w-78 max-w-full flex-col gap-1 px-3 py-3 whitespace-normal"
                >
                  <strong class="text-text-heading">
                    {{
                      channelSearch
                        ? t("slackApp.insights.channelNoMatch")
                        : t("slackApp.insights.channelEmpty")
                    }}
                  </strong>
                  <span>{{ t("slackApp.insights.channelEmptyHint") }}</span>
                </div>
              </template>
              <template v-if="channels.hasNextPage.value" #after-options>
                <div class="border-border-default border-t px-2 py-1.5">
                  <OButton
                    variant="ghost-primary"
                    size="xs"
                    :loading="channels.isFetchingNextPage.value"
                    data-test="slack-insights-channel-more"
                    @click="channels.fetchNextPage()"
                  >
                    {{ t("slackApp.channels.loadMore") }}
                  </OButton>
                </div>
              </template>
            </OFormSelect>
          </div>
        </SlackInsightsRow>

        <SlackInsightsRow :label="t('slackApp.insights.digestTime')" :help="help.digest">
          <span class="text-input-label-text text-compact font-medium">{{
            t("slackApp.insights.timeAndZone")
          }}</span>
          <div class="flex w-full items-start gap-2">
            <!-- The message line is reserved and kept to one line, so a typed-time error never grows the row. -->
            <div class="min-h-14 w-30 shrink-0 [&_[role=alert]]:whitespace-nowrap">
              <OFormTime
                name="digest_time"
                format24
                :disabled="readOnly"
                :aria-label="t('slackApp.insights.time')"
                data-test="slack-insights-time"
              />
            </div>
            <div class="min-w-0 flex-1">
              <OFormSelect
                name="digest_time_zone"
                :options="zoneOptions"
                :disabled="readOnly"
                :aria-label="t('slackApp.insights.zone')"
                data-test="slack-insights-zone"
              />
            </div>
          </div>
        </SlackInsightsRow>

        <SlackInsightsRow :label="t('slackApp.insights.trial')" :help="help.trial">
          <div class="flex items-center gap-2" data-test="slack-insights-trial">
            <OFormSwitch
              name="post_trial_findings"
              :disabled="readOnly"
              :aria-label="t('slackApp.insights.trial')"
            />
            <span
              class="text-sm"
              :class="readOnly ? 'text-text-disabled' : 'text-text-heading'"
              aria-hidden="true"
            >
              {{ onOff(values.post_trial_findings) }}
            </span>
          </div>
        </SlackInsightsRow>

        <SlackInsightsRow :label="t('slackApp.insights.allow')" :help="help.allow">
          <div class="flex items-center gap-2" data-test="slack-insights-allow">
            <OFormSwitch
              name="allow_changes_from_slack"
              :disabled="readOnly"
              :aria-label="t('slackApp.insights.allow')"
            />
            <span
              class="text-sm"
              :class="readOnly ? 'text-text-disabled' : 'text-text-heading'"
              aria-hidden="true"
            >
              {{ onOff(values.allow_changes_from_slack) }}
            </span>
          </div>
        </SlackInsightsRow>

        <div
          v-if="canEdit"
          class="flex min-h-16 items-center justify-between gap-4 px-4 py-3 max-md:flex-wrap"
        >
          <div
            class="text-text-secondary text-compact flex min-h-10 flex-1 items-center max-md:basis-full"
            aria-live="polite"
            data-test="slack-insights-status"
          >
            <OBanner
              v-if="failure"
              variant="error-soft"
              dense
              inline-actions
              icon="error-outline"
              role="alert"
              class="w-full"
              data-test="slack-insights-save-error"
            >
              <strong>{{ t("slackApp.insights.failed.title") }}</strong>
              {{ failure.message }}
              <template v-if="failure.detail">{{ failure.detail }}</template>
              <template v-if="refreshFailed"
                >{{ " " }}{{ t("slackApp.insights.failed.refreshFailed") }}</template
              >
              <template v-if="failure.kind === 'stale'" #actions>
                <OButton
                  variant="outline-destructive"
                  size="sm"
                  data-test="slack-insights-refresh"
                  @click="refresh"
                >
                  {{ t("slackApp.insights.failed.refresh") }}
                </OButton>
              </template>
            </OBanner>
            <template v-else-if="removed">{{ t("slackApp.insights.removedFooter") }}</template>
            <template v-else-if="dirty">{{ t("slackApp.insights.unsaved") }}</template>
          </div>
          <OButton
            type="submit"
            variant="outline"
            size="sm-action"
            :disabled="!dirty || removed"
            :loading="put.isPending.value"
            class="max-md:ms-auto"
            data-test="slack-insights-save"
          >
            {{ t("common.save") }}
          </OButton>
        </div>
      </OCard>
    </OForm>
  </div>
</template>
