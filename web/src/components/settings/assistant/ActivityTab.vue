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
  <section class="flex flex-col" data-test="settings-assistant-activity-tab">
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
      class="min-h-0 flex-1"
      :data="rows"
      :columns="columns"
      row-key="id"
      :loading="activity.isPending.value"
      :forbidden="state === 'forbidden'"
      :error="state === 'error' ? t('assistant.activity.loadFailed') : null"
      pagination="server"
      :current-page="cursors.length + 1"
      :page-size="pageSize"
      :page-size-options="PAGE_SIZES"
      :total-count="knownTotal"
      :total-count-exact="!hasNext"
      :default-columns="false"
      :show-global-filter="false"
      data-test="settings-assistant-activity-table"
      @pagination-change="turnPage"
    >
      <template #toolbar>
        <div class="contents">
          <OSelect
            v-model="range"
            :options="rangeOptions"
            label-key="label"
            value-key="value"
            width="sm"
            :aria-label="t('assistant.activity.rangeLabel')"
            data-test="settings-assistant-activity-range"
          />
          <OSearchInput
            v-if="page.isAdmin.value"
            v-model="actor"
            class="min-w-0 flex-1 max-md:min-w-40 md:min-w-48"
            :placeholder="t('assistant.activity.actor')"
            data-test="settings-assistant-activity-actor"
          />
          <OSearchInput
            v-model="search"
            class="min-w-0 flex-1 max-md:min-w-40 md:min-w-48"
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
        <template v-if="targetName(row)">
          <s v-if="row.target?.deleted" class="text-text-body">{{ targetName(row) }}</s>
          <router-link
            v-else-if="safeLink(row.target?.link)"
            class="text-text-link-hover underline hover:no-underline"
            :to="safeLink(row.target?.link)!"
            >{{ targetName(row) }}</router-link
          >
          <span v-else>{{ targetName(row) }}</span>
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
            :variant="resultState(row) === 'failed' ? 'warning-soft' : 'default-soft'"
            :label="resultLabel(row)"
            :data-test="`settings-assistant-activity-${row.id}-result`"
          />
        </div>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-1">
          <OButton
            v-if="row.undo.available && resultState(row) !== 'undone'"
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
import {
  COL,
  type OTableColumnDef,
  type OTablePaginationParams,
} from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { MAX_ACTIVITY_PAGE, type AssistantActivityEntry } from "@/services/assistant_settings";
import {
  assistantActivityQuery,
  undoActivityMutation,
} from "@/services/assistant_settings.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/formatters";

import { readStateOf, useAssistantSettingsPage } from "./useAssistantSettingsPage";

const DAY_US = 86_400_000_000;

const PAGE_SIZES = [20, 50, 100, MAX_ACTIVITY_PAGE];

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
const pageSize = ref(50);
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
  limit: pageSize.value,
}));

const activity = useQuery(computed(() => assistantActivityQuery(page.org.value, filter.value)));
const undoMutation = useMutation(() => undoActivityMutation(page.org.value));
const undoing = ref<string | null>(null);
// The server may answer the refetch before it marks the row, so an Undo made here reads as done at once.
const undone = ref(new Set<string>());

const state = computed(() => readStateOf(activity));
const rows = computed(() => activity.data.value?.rows ?? []);
// A page that is exactly full still carries a cursor, so a next page that came back empty marks it dead.
const deadCursors = ref(new Set<string>());
const nextCursor = computed(() => activity.data.value?.next_cursor);
const hasNext = computed(() => !!nextCursor.value && !deadCursors.value.has(nextCursor.value));
// The cursor API returns no total, so while a next page exists the pager counts one row past this page.
const knownTotal = computed(() =>
  hasNext.value
    ? (cursors.value.length + 1) * pageSize.value + 1
    : cursors.value.length * pageSize.value + rows.value.length,
);

// Sized so every column fits beside the pinned actions at 1280 wide; the action column takes what is left.
const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "at",
    header: t("assistant.activity.columns.when"),
    size: COL.lastCheck + 20,
    meta: { align: "left" },
  },
  {
    id: "action",
    header: t("assistant.activity.columns.action"),
    size: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "target",
    header: t("assistant.activity.columns.target"),
    size: 150,
    meta: { align: "left" },
  },
  {
    id: "actor",
    header: t("assistant.activity.columns.actor"),
    size: 150,
    meta: { align: "left" },
  },
  {
    id: "approval",
    header: t("assistant.activity.columns.approval"),
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "result",
    header: t("assistant.activity.columns.result"),
    size: 100,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("assistant.activity.columns.actions"),
    isAction: true,
    pinned: "right",
    size: 140,
    meta: { align: "right" },
  },
]);

/** The pager steps one page at a time over a cursor chain; a new page size starts it again. */
function turnPage({ page: target, size }: OTablePaginationParams) {
  if (size !== pageSize.value) {
    pageSize.value = size;
    cursors.value = [];
    return;
  }
  if (target === 1) cursors.value = [];
  else if (target === cursors.value.length + 2 && hasNext.value)
    cursors.value.push(nextCursor.value!);
  else if (target === cursors.value.length) cursors.value.pop();
}

watch([range, actorQuery, searchQuery, () => page.org.value], () => {
  windowEnd.value = Date.now() * 1000;
  cursors.value = [];
  deadCursors.value = new Set();
});

// Landing on an empty page steps back to the last page that had rows, which now ends the chain.
watch(
  () => activity.data.value,
  (data) => {
    const last = cursors.value.at(-1);
    if (!data || data.rows.length || last === undefined) return;
    deadCursors.value = new Set(deadCursors.value).add(last);
    cursors.value = cursors.value.slice(0, -1);
  },
);

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

// A row whose server name is missing still names its object by id rather than a dash.
function targetName(row: AssistantActivityEntry): string {
  return row.target?.name || row.target?.id || "";
}

function resultState(row: AssistantActivityEntry) {
  return undone.value.has(row.id) ? "undone" : row.result?.state;
}

function resultLabel(row: AssistantActivityEntry) {
  const result = row.result!;
  const state = resultState(row);
  if (state === "done") return t("assistant.activity.done");
  if (state === "undone") return t("assistant.activity.undoneState");
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
    undone.value = new Set(undone.value).add(row.id);
    void refresh();
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
