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
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OForm from "@/lib/forms/Form/OForm.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import {
  deleteChannelDefaultMutation,
  putChannelDefaultMutation,
  slackChannelDefaultsQuery,
  slackChannelsQuery,
} from "@/services/slack.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SlackChannelDefaultRow } from "@/types/slack";
import { makeChannelDefaultSchema, type ChannelDefaultForm } from "./SlackSettings.schema";

const props = defineProps<{ installationId: string }>();

const FORM_ID = "slack-channel-default-form";

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const defaults = useQuery(() => slackChannelDefaultsQuery(org.value, props.installationId));
const put = useMutation(() => putChannelDefaultMutation(org.value, props.installationId));
const remove = useMutation(() => deleteChannelDefaultMutation(org.value, props.installationId));

const drawerOpen = ref(false);
const editing = ref<SlackChannelDefaultRow | null>(null);
const removing = ref<SlackChannelDefaultRow | null>(null);
const removeOpen = ref(false);

const channels = useInfiniteQuery(() =>
  Object.assign(slackChannelsQuery(org.value, props.installationId, ""), {
    enabled: drawerOpen.value,
  }),
);
const channelOptions = computed(() => {
  const listed = channels.data.value?.pages.flatMap((page) => page.channels) ?? [];
  const options = listed.map((c) => ({ label: raw(`#${c.name}`), value: c.id }));
  const current = editing.value;
  if (current && !options.some((o) => o.value === current.channel_id)) {
    options.unshift({ label: raw(`#${current.channel_name}`), value: current.channel_id });
  }
  return options;
});

const rows = computed<SlackChannelDefaultRow[]>(() => defaults.data.value?.defaults ?? []);
const schema = makeChannelDefaultSchema(t);
const formDefaults = computed<ChannelDefaultForm>(() => ({
  channel_id: editing.value?.channel_id ?? "",
  answer_mode: editing.value?.answer_mode ?? "thread",
}));

const columns = computed<OTableColumnDef<SlackChannelDefaultRow>[]>(() => [
  { id: "channel", header: t("slackApp.channels.columnChannel"), size: 200, meta: { flex: true } },
  { id: "default_org", header: t("slackApp.channels.columnDefaultOrg"), size: 140 },
  { id: "answers", header: t("slackApp.channels.columnAnswers"), size: 130 },
  { id: "alert_routes", header: t("slackApp.channels.columnAlertRoutes"), size: 120 },
  { id: "set_by", header: t("slackApp.channels.columnSetBy"), size: 220 },
  { id: "actions", header: raw(""), size: 100, isAction: true },
]);

const openDrawer = (row: SlackChannelDefaultRow | null): void => {
  editing.value = row;
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

const save = async (value: ChannelDefaultForm): Promise<void> => {
  await put.mutateAsync({
    channelId: value.channel_id,
    body: { org_id: org.value, answer_mode: value.answer_mode },
  });
  drawerOpen.value = false;
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
      :cell-overflow-tooltip="false"
      dense
    >
      <template #cell-channel="{ row }">{{ raw(`#${row.channel_name}`) }}</template>
      <template #cell-default_org="{ row }">
        {{
          row.set_by_this_org ? t("slackApp.channels.thisOrg") : t("slackApp.channels.anotherOrg")
        }}
      </template>
      <template #cell-answers="{ row }">
        {{
          row.answer_mode === "thread"
            ? t("slackApp.channels.thread")
            : t("slackApp.channels.private")
        }}
      </template>
      <template #cell-alert_routes>
        <span class="text-text-muted">{{ raw("—") }}</span>
      </template>
      <template #cell-set_by="{ row }">
        <span class="flex flex-col">
          <span>
            {{
              row.set_by_this_org
                ? t("slackApp.channels.thisOrg")
                : t("slackApp.channels.anotherOrg")
            }}
          </span>
          <span class="text-text-secondary text-xs">
            {{ t(`slackApp.channels.setFrom.${row.set_from}`) }}
          </span>
        </span>
      </template>
      <template #cell-actions="{ row }">
        <span v-if="row.set_by_this_org" class="flex justify-end gap-1">
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
        <OFormSelect
          name="channel_id"
          :label="t('slackApp.channels.channel')"
          :placeholder="t('slackApp.channels.channelPlaceholder')"
          :options="channelOptions"
          :loading="channels.isPending.value"
          :disabled="!!editing"
          :help-text="t('slackApp.channels.privateHint')"
          required
          data-test="slack-channel-select"
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
      :message="t('slackApp.channels.removeMessage', { channel: removing?.channel_name ?? '' })"
      :ok-label="t('slackApp.channels.remove')"
      ok-variant="destructive"
      focus-cancel
      @update:ok="confirmRemove"
    />
  </section>
</template>
