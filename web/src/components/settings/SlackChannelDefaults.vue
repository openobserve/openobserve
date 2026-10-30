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
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { alertRoutesByChannel } from "@/utils/slackAppDestination";
import {
  deleteChannelDefaultMutation,
  putChannelDefaultMutation,
  slackChannelDefaultsQuery,
  slackChannelsQuery,
  slackInstallationsQuery,
  slackOrgAccessQuery,
} from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SlackChannel, SlackChannelDefaultRow } from "@/types/slack";
import { serverMessageOf, statusOf } from "@/utils/slackLink";
import { makeChannelDefaultSchema, type ChannelDefaultForm } from "./SlackSettings.schema";

/** `org_id` is read only for a `_meta` viewer of an instance workspace, who picks the owning org. */
type DefaultForm = ChannelDefaultForm & { org_id: string };

const props = defineProps<{ installationId: string }>();

const FORM_ID = "slack-channel-default-form";
const SEARCH_DEBOUNCE_MS = 300;

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const { isMetaOrg } = useIsMetaOrg();

const installations = useQuery(() => slackInstallationsQuery(org.value));
const onInstance = computed(
  () =>
    installations.data.value?.installations.find((i) => i.id === props.installationId)?.scope ===
    "instance",
);
// R-80: on an instance workspace a channel another org owns changes only through _meta.
const instanceAdmin = computed(() => onInstance.value && isMetaOrg.value);
const ownOrgOnly = computed(() => onInstance.value && !isMetaOrg.value);
const canChange = (row: SlackChannelDefaultRow): boolean =>
  row.set_by_this_org || instanceAdmin.value;
const ownerName = (row: SlackChannelDefaultRow) =>
  instanceAdmin.value && row.org_id ? raw(row.org_name || row.org_id) : null;

const defaults = useQuery(() => slackChannelDefaultsQuery(org.value, props.installationId));
const destinations = useQuery(() => destinationsQuery(org.value, "alert"));
const alertRoutes = computed(() =>
  alertRoutesByChannel(destinations.data.value ?? [], props.installationId),
);
const put = useMutation(() => putChannelDefaultMutation(org.value, props.installationId));
const remove = useMutation(() => deleteChannelDefaultMutation(org.value, props.installationId));

const drawerOpen = ref(false);
const editing = ref<SlackChannelDefaultRow | null>(null);
const removing = ref<SlackChannelDefaultRow | null>(null);
const removeOpen = ref(false);
const saveError = ref<string | null>(null);
const channelSearch = ref("");
// Every channel a search or page has shown, so a picked one keeps its name when the next search drops it.
const seenChannels = ref(new Map<string, SlackChannel>());

const channels = useInfiniteQuery(() =>
  Object.assign(slackChannelsQuery(org.value, props.installationId, channelSearch.value), {
    enabled: drawerOpen.value,
  }),
);

// Row 24 lists the served orgs: under `all` every org on the server, else the listed ones.
const orgAccess = useQuery(() =>
  Object.assign(slackOrgAccessQuery(org.value, props.installationId), {
    enabled: instanceAdmin.value && drawerOpen.value,
  }),
);
const orgOptions = computed(() => {
  const view = orgAccess.data.value;
  const served = view ? (view.all ? view.organizations : view.orgs) : [];
  return served.map((o) => ({ label: raw(o.org_name || o.org_id), value: o.org_id }));
});

const rows = computed<SlackChannelDefaultRow[]>(() => defaults.data.value?.defaults ?? []);
const otherOrgChannels = computed(
  () => new Set(rows.value.filter((r) => !canChange(r)).map((r) => r.channel_id)),
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

const channelOptions = computed(() => {
  const listed = channels.data.value?.pages.flatMap((page) => page.channels) ?? [];
  const ordered = new Map(listed.map((c) => [c.id, c]));
  for (const [id, channel] of seenChannels.value) if (!ordered.has(id)) ordered.set(id, channel);
  const options = [...ordered.values()].map((c) => ({
    label: raw(`#${c.name}`),
    value: c.id,
    disabled: otherOrgChannels.value.has(c.id),
  }));
  const current = editing.value;
  if (current && !options.some((o) => o.value === current.channel_id)) {
    options.unshift({
      label: raw(`#${current.channel_name}`),
      value: current.channel_id,
      disabled: false,
    });
  }
  return options;
});
const forbidden = computed(() => statusOf(defaults.error.value) === 403);
const loadError = computed(() =>
  defaults.isError.value && !forbidden.value ? t("emptyState.loadError.title") : null,
);
const schema = makeChannelDefaultSchema(t);
const formDefaults = computed<DefaultForm>(() => ({
  channel_id: editing.value?.channel_id ?? "",
  answer_mode: editing.value?.answer_mode ?? "thread",
  org_id: editing.value?.org_id ?? org.value,
}));

const columns = computed<OTableColumnDef<SlackChannelDefaultRow>[]>(() => [
  { id: "channel", header: t("slackApp.channels.columnChannel"), size: 200, meta: { flex: true } },
  { id: "default_org", header: t("slackApp.channels.columnDefaultOrg"), size: 140 },
  { id: "answers", header: t("slackApp.channels.columnAnswers"), size: 130 },
  { id: "alert_routes", header: t("slackApp.channels.columnAlertRoutes"), size: 120 },
  { id: "set_by", header: t("slackApp.channels.columnSetBy"), size: 220 },
  { id: "actions", header: raw(""), size: ownOrgOnly.value ? 170 : 100, isAction: true },
]);

const openDrawer = (row: SlackChannelDefaultRow | null): void => {
  editing.value = row;
  saveError.value = null;
  channelSearch.value = "";
  drawerOpen.value = true;
};

const askRemove = (row: SlackChannelDefaultRow): void => {
  removing.value = row;
  removeOpen.value = true;
};

const confirmRemove = (): void => {
  const target = removing.value;
  if (target) remove.mutate(target.channel_id);
};

const save = async (value: DefaultForm): Promise<void> => {
  saveError.value = null;
  const target = instanceAdmin.value && value.org_id ? value.org_id : org.value;
  try {
    await put.mutateAsync({
      channelId: value.channel_id,
      body: { org_id: target, answer_mode: value.answer_mode },
    });
    drawerOpen.value = false;
  } catch (error) {
    saveError.value = serverMessageOf(error) ?? t("slackApp.channels.saveFailed");
  }
};
</script>

<template>
  <section class="flex flex-col gap-3" data-test="slack-channel-defaults">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-col gap-0.5">
        <h2 class="text-text-heading m-0 text-lg font-semibold">
          {{ t("slackApp.channels.title") }}
        </h2>
        <p class="text-text-secondary m-0 text-sm">{{ t("slackApp.channels.description") }}</p>
      </div>
      <OButton
        variant="primary"
        size="sm-action"
        data-test="slack-channel-set-default"
        @click="openDrawer(null)"
      >
        {{ t("slackApp.channels.setDefault") }}
      </OButton>
    </div>

    <OTable
      :data="rows"
      :columns="columns"
      row-key="channel_id"
      pagination="none"
      :show-global-filter="false"
      :loading="defaults.isPending.value"
      :error="loadError"
      :forbidden="forbidden"
      :cell-overflow-tooltip="false"
      dense
    >
      <template #cell-channel="{ row }">{{ raw(`#${row.channel_name}`) }}</template>
      <template #cell-default_org="{ row }">
        {{
          ownerName(row) ??
          (row.set_by_this_org ? t("slackApp.channels.thisOrg") : t("slackApp.channels.anotherOrg"))
        }}
      </template>
      <template #cell-answers="{ row }">
        <span v-if="!canChange(row) && ownOrgOnly" class="text-text-muted">{{ raw("—") }}</span>
        <template v-else>
          {{
            row.answer_mode === "thread"
              ? t("slackApp.channels.thread")
              : t("slackApp.channels.private")
          }}
        </template>
      </template>
      <template #cell-alert_routes="{ row }">
        <template v-if="alertRoutes[row.channel_id]">
          {{
            t(
              "slackApp.channels.alertRoutes",
              { count: alertRoutes[row.channel_id] },
              alertRoutes[row.channel_id],
            )
          }}
        </template>
        <span v-else class="text-text-muted">{{ raw("—") }}</span>
      </template>
      <template #cell-set_by="{ row }">
        <span v-if="!canChange(row) && ownOrgOnly" class="text-text-muted">{{ raw("—") }}</span>
        <template v-else>{{ t(`slackApp.channels.setFrom.${row.set_from}`) }}</template>
      </template>
      <template #cell-actions="{ row }">
        <span v-if="canChange(row)" class="flex justify-end gap-1">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="edit"
            :title="t('slackApp.channels.edit')"
            :data-test="`slack-channel-edit-${row.channel_id}`"
            @click="openDrawer(row)"
          />
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete"
            :title="t('slackApp.channels.remove')"
            :data-test="`slack-channel-remove-${row.channel_id}`"
            @click="askRemove(row)"
          />
        </span>
        <span
          v-else-if="ownOrgOnly"
          class="text-text-secondary flex items-center justify-end gap-1 text-xs"
          data-test="slack-channel-instance-only"
        >
          <OIcon name="lock" size="xs" />
          {{ t("slackApp.channels.instanceAdminOnly") }}
        </span>
      </template>
      <template #error>
        <OEmptyState
          size="compact"
          preset="load-error"
          :backdrop="false"
          data-test="slack-channel-defaults-error"
          @action="defaults.refetch()"
        />
      </template>
      <template #empty>
        <OEmptyState
          size="compact"
          illustration="board"
          :title="t('slackApp.channels.empty')"
          :description="t('slackApp.channels.emptyDescription')"
          :backdrop="false"
        />
      </template>
    </OTable>

    <ODrawer
      v-model:open="drawerOpen"
      size="md"
      :title="t('slackApp.channels.setDefault')"
      :form-id="FORM_ID"
      :primary-button-label="t('common.save')"
      :secondary-button-label="t('common.cancel')"
      @click:secondary="drawerOpen = false"
    >
      <OForm
        v-if="drawerOpen"
        :id="FORM_ID"
        :key="editing?.channel_id ?? 'new'"
        :schema="schema"
        :default-values="formDefaults"
        class="flex flex-col gap-5"
        @submit="save"
      >
        <OBanner
          v-if="saveError"
          variant="error-soft"
          dense
          icon="error-outline"
          data-test="slack-channel-save-error"
          >{{ raw(saveError) }}</OBanner
        >
        <div class="flex flex-col gap-1">
          <OFormSelect
            name="channel_id"
            :label="t('slackApp.channels.channel')"
            :placeholder="t('slackApp.channels.channelPlaceholder')"
            :options="channelOptions"
            :loading="channels.isFetching.value"
            :disabled="!!editing"
            :search-debounce="SEARCH_DEBOUNCE_MS"
            :help-text="
              ownOrgOnly
                ? t('slackApp.channels.claimableHint', { org })
                : t('slackApp.channels.privateHint')
            "
            required
            data-test="slack-channel-select"
            @search="channelSearch = $event.trim()"
          />
          <OButton
            v-if="!editing && channels.hasNextPage.value"
            variant="ghost-primary"
            size="xs"
            class="w-fit"
            :loading="channels.isFetchingNextPage.value"
            data-test="slack-channel-more"
            @click="channels.fetchNextPage()"
          >
            {{ t("slackApp.channels.loadMore") }}
          </OButton>
        </div>
        <OFormSelect
          v-if="instanceAdmin"
          name="org_id"
          :label="t('slackApp.channels.columnDefaultOrg')"
          :options="orgOptions"
          :loading="orgAccess.isFetching.value"
          :help-text="t('slackApp.channels.servedOrgsHint')"
          data-test="slack-channel-org-select"
        />
        <OInput
          v-else-if="onInstance"
          :model-value="t('slackApp.card.thisOrg', { org })"
          :label="t('slackApp.channels.columnDefaultOrg')"
          :help-text="t('slackApp.channels.ownOrgOnlyHint')"
          readonly
          disabled
          data-test="slack-channel-default-org"
        />
        <div class="flex flex-col gap-2">
          <span class="text-text-label text-compact font-medium">
            {{ t("slackApp.channels.answers") }}
          </span>
          <OFormRadioGroup name="answer_mode" :label="t('slackApp.channels.answers')">
            <ORadio
              value="thread"
              :label="t('slackApp.channels.thread')"
              data-test="slack-channel-answer-thread"
            />
            <ORadio
              value="private"
              :label="t('slackApp.channels.private')"
              data-test="slack-channel-answer-private"
            />
          </OFormRadioGroup>
        </div>
      </OForm>
    </ODrawer>

    <ConfirmDialog
      v-model="removeOpen"
      :title="t('slackApp.channels.removeTitle', { channel: removing?.channel_name ?? '' })"
      message-keypath="slackApp.channels.removeMessage"
      :message-name="removing ? `#${removing.channel_name}` : ''"
      :ok-label="t('slackApp.channels.remove')"
      ok-variant="destructive"
      focus-cancel
      @update:ok="confirmRemove"
    />
  </section>
</template>
