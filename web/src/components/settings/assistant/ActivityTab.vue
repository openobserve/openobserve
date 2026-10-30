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
  <section class="flex flex-col gap-3" data-test="settings-assistant-activity-tab">
    <h2 class="sr-only">{{ t("assistant.settings.tabs.activity") }}</h2>
    <OEmptyState
      v-if="state === 'ready' && activity.data.value === null"
      size="block"
      illustration="box"
      :title="t('assistant.activity.unsupported')"
      :secondary-action-label="page.isMetaOrg.value ? t('assistant.activity.openAudit') : undefined"
      data-test="settings-assistant-activity-unsupported"
      @secondary-action="openAudit"
    />
    <OTable
      v-else
      :data="rows"
      :columns="columns"
      row-key="id"
      :loading="activity.isPending.value"
      :forbidden="state === 'forbidden'"
      :error="state === 'error' ? t('assistant.activity.loadFailed') : null"
      pagination="none"
      :default-columns="false"
      :show-global-filter="false"
      data-test="settings-assistant-activity-table"
    >
      <template #toolbar>
        <div class="flex flex-wrap items-center gap-2">
          <OSelect
            v-model="range"
            :options="rangeOptions"
            label-key="label"
            value-key="value"
            class="w-40"
            :aria-label="t('assistant.activity.rangeLabel')"
            data-test="settings-assistant-activity-range"
          />
          <OSearchInput
            v-if="page.isAdmin.value"
            v-model="actor"
            class="w-48 max-md:flex-1"
            :placeholder="t('assistant.activity.actor')"
            data-test="settings-assistant-activity-actor"
          />
          <OSearchInput
            v-model="search"
            class="w-56 max-md:flex-1"
            :placeholder="t('assistant.activity.search')"
            data-test="settings-assistant-activity-search"
          />
        </div>
      </template>
      <template #error>
        <div class="flex flex-col items-center gap-3 p-6">
          <p class="text-text-body text-sm">{{ t("assistant.activity.loadFailed") }}</p>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="settings-assistant-activity-retry"
            @click="refresh"
          >
            {{ t("common.retry") }}
          </OButton>
        </div>
      </template>
      <template #empty>
        <OEmptyState size="compact" :title="t('assistant.activity.empty')" hide-action />
      </template>
      <template #cell-at="{ row }">
        <OTimeCell :value="row.at" mode="relative" />
      </template>
      <template #cell-action="{ row }">
        <OTruncatedText class="block">{{ raw(row.action) }}</OTruncatedText>
      </template>
      <template #cell-target="{ row }">
        <template v-if="row.target?.name">
          <s v-if="row.target.deleted" class="text-text-body">{{ row.target.name }}</s>
          <router-link
            v-else-if="safeLink(row.target.link)"
            class="text-text-link-hover underline hover:no-underline"
            :to="safeLink(row.target.link)!"
            >{{ row.target.name }}</router-link
          >
          <span v-else>{{ row.target.name }}</span>
        </template>
        <span v-else class="text-text-secondary">{{ raw("—") }}</span>
      </template>
      <template #cell-actor="{ row }">
        <OUserCell :value="row.on_behalf_of" />
      </template>
      <template #cell-approval="{ row }">
        <OTag v-if="row.approval" variant="default-soft" :label="approvalLabel(row)" />
      </template>
      <template #cell-result="{ row }">
        <div class="flex flex-wrap items-center gap-1">
          <OTag
            v-if="row.result"
            :variant="row.result.state === 'failed' ? 'warning-soft' : 'default-soft'"
            :label="resultLabel(row)"
            :data-test="`settings-assistant-activity-${row.id}-result`"
          />
        </div>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-1">
          <OButton
            v-if="row.undo.available && row.result?.state !== 'undone'"
            variant="ghost"
            size="sm"
            class="max-md:min-h-11"
            :loading="undoing === row.id"
            :disabled="!!undoing"
            :aria-label="t('assistant.activity.undoNamed', { action: row.action })"
            :data-test="`settings-assistant-activity-${row.id}-undo`"
            @click="undo(row)"
            >{{ t("assistant.activity.undo") }}</OButton
          >
          <router-link
            v-if="row.chat_id"
            class="text-text-link-hover text-sm underline hover:no-underline max-md:inline-flex max-md:min-h-11 max-md:items-center"
            :to="{ name: 'assistant', params: { chatId: row.chat_id } }"
            :data-test="`settings-assistant-activity-${row.id}-chat`"
            >{{ t("assistant.activity.openChat") }}</router-link
          >
        </div>
      </template>
      <template #pagination-bar>
        <div class="flex flex-wrap items-center justify-end gap-2 p-2">
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11"
            :disabled="!cursors.length"
            data-test="settings-assistant-activity-prev"
            @click="cursors.pop()"
            >{{ t("assistant.activity.previous") }}</OButton
          >
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11"
            :disabled="!activity.data.value?.next_cursor"
            data-test="settings-assistant-activity-next"
            @click="cursors.push(activity.data.value!.next_cursor!)"
            >{{ t("assistant.activity.next") }}</OButton
          >
        </div>
      </template>
    </OTable>
  </section>
</template>

<script setup lang="ts">
import { refDebounced } from "@vueuse/core";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, nextTick, ref, watch } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";

import { useConfirmDialog } from "@/composables/useConfirmDialog";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { AssistantActivityEntry } from "@/services/assistant_settings";
import {
  assistantActivityQuery,
  undoActivityMutation,
} from "@/services/assistant_settings.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/formatters";

import { readStateOf, useAssistantSettingsPage } from "./useAssistantSettingsPage";

const DAY_US = 86_400_000_000;

const { t } = useI18nTyped();
const router = useRouter();
const page = useAssistantSettingsPage();
const { confirm } = useConfirmDialog();

const rangeOptions = [
  { label: t("assistant.activity.ranges.day"), value: 1 },
  { label: t("assistant.activity.ranges.week"), value: 7 },
  { label: t("assistant.activity.ranges.month"), value: 30 },
];
const range = ref(7);
const actor = ref("");
const search = ref("");
const cursors = ref<string[]>([]);
const actorQuery = refDebounced(actor, 300);
const searchQuery = refDebounced(search, 300);
// Fixed while paging so the cursor walks one window; a filter change or Refresh on page one moves it.
const windowEnd = ref(Date.now() * 1000);

const filter = computed(() => ({
  from: windowEnd.value - range.value * DAY_US,
  to: windowEnd.value,
  ...(actorQuery.value.trim() ? { actor: actorQuery.value.trim() } : {}),
  ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {}),
  ...(cursors.value.length ? { cursor: cursors.value[cursors.value.length - 1] } : {}),
}));

const activity = useQuery(computed(() => assistantActivityQuery(page.org.value, filter.value)));
const undoMutation = useMutation(() => undoActivityMutation(page.org.value));
const undoing = ref<string | null>(null);

const state = computed(() => readStateOf(activity));
const rows = computed(() => activity.data.value?.rows ?? []);

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "at",
    header: t("assistant.activity.columns.when"),
    size: COL.lastCheck + 40,
    meta: { align: "left" },
  },
  {
    id: "action",
    header: t("assistant.activity.columns.action"),
    size: COL.name,
    meta: { align: "left", flex: true },
  },
  {
    id: "target",
    header: t("assistant.activity.columns.target"),
    size: COL.name,
    meta: { align: "left" },
  },
  {
    id: "actor",
    header: t("assistant.activity.columns.actor"),
    size: COL.owner,
    meta: { align: "left" },
  },
  {
    id: "approval",
    header: t("assistant.activity.columns.approval"),
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "result",
    header: t("assistant.activity.columns.result"),
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("assistant.activity.columns.actions"),
    isAction: true,
    pinned: "right",
    size: 150,
    meta: { align: "right" },
  },
]);

watch([range, actorQuery, searchQuery, () => page.org.value], () => {
  windowEnd.value = Date.now() * 1000;
  cursors.value = [];
});

/** Only in-app paths become links; a server-sent absolute URL is shown as text. */
function safeLink(link: string | undefined): RouteLocationRaw | null {
  return link && link.startsWith("/") && !link.startsWith("//") ? link : null;
}

function approvalLabel(row: AssistantActivityEntry) {
  const approval = row.approval!;
  if (approval.kind === "approved")
    return approval.by
      ? t("assistant.activity.approvedBy", { user: approval.by })
      : t("assistant.activity.approved");
  if (approval.kind === "standing") return t("assistant.activity.standing");
  return t("assistant.activity.noApproval");
}

function resultLabel(row: AssistantActivityEntry) {
  const result = row.result!;
  if (result.state === "done") return t("assistant.activity.done");
  if (result.state === "undone") return t("assistant.activity.undoneState");
  return result.message
    ? t("assistant.activity.failed", { cause: result.message })
    : t("assistant.activity.failedPlain");
}

async function refresh() {
  if (!cursors.value.length) {
    windowEnd.value = Date.now() * 1000;
    await nextTick();
  }
  return activity.refetch({ cancelRefetch: false });
}

/** Assistant writes reach the audit stream through the AI and MCP endpoints. */
function auditSql(org: string): string {
  const quoted = org.replace(/'/g, "''");
  return `SELECT * FROM "audit" WHERE org_id = '${quoted}' AND (http_path LIKE '%/ai/%' OR http_path LIKE '%/mcp%')`;
}

function openAudit() {
  const to = Date.now() * 1000;
  void router.push({
    name: "logs",
    query: {
      org_identifier: page.org.value,
      stream: "audit",
      stream_type: "logs",
      from: String(to - range.value * DAY_US),
      to: String(to),
      refresh: "0",
      sql_mode: "true",
      query: b64EncodeUnicode(auditSql(page.org.value)),
      type: "logs",
    },
  });
}

async function undo(row: AssistantActivityEntry) {
  if (undoing.value) return;
  const ok = await confirm({
    title: t("assistant.activity.undoTitle"),
    message: t("assistant.activity.undoMessage", {
      action: row.action,
      target: row.target?.name ?? "",
    }),
    confirmLabel: t("assistant.activity.undo"),
    focusCancel: true,
  });
  if (!ok) return;
  undoing.value = row.id;
  try {
    await undoMutation.mutateAsync(row.id);
    toast({
      variant: "success",
      message: t("assistant.activity.undoDone", { action: row.action }),
    });
  } catch {
    // The mutation layer already toasted the server's reason.
  } finally {
    undoing.value = null;
  }
}

defineExpose({ refresh });
</script>
