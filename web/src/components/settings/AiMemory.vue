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
  <div class="flex h-full flex-col p-0">
    <OPageLayout
      :title="t('aiMemory.header')"
      icon="psychology"
      :subtitle="t('aiMemory.subtitle')"
      data-test="ai-memory-page"
      bleed
    >
      <template #actions>
        <OButton
          v-if="groups.length || pendingLoading || pendingError"
          variant="outline"
          size="sm"
          data-test="ai-memory-review-pending-btn"
          @click="openPending()"
        >
          <span class="inline-flex items-center gap-2">
            {{ t("aiMemory.reviewPending") }}
            <OBadge
              v-if="groups.length"
              variant="warning-soft"
              size="sm"
              data-test="ai-memory-pending-count"
            >
              {{ groups.length }}
            </OBadge>
          </span>
        </OButton>
      </template>

      <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
        <OTable
          :frame="false"
          show-index
          sorting="client"
          pagination="client"
          :enable-column-resize="true"
          :persist-columns="true"
          :data="shownMemoryRows"
          :columns="memoryColumns"
          :row-actions="memoryActions"
          row-key="id"
          :loading="memoriesLoading"
          :error="memoriesError"
          :default-columns="false"
          :show-global-filter="false"
          table-id="settings-ai-memory-notes"
          data-test="ai-memory-notes"
          @retry="refresh"
          @row-click="(row: MemoryRow) => openMemory(row)"
        >
          <template #toolbar>
            <OSearchInput
              v-model="notesFilter"
              class="flex-1"
              :placeholder="t('aiMemory.searchMemories')"
              data-test="ai-memory-notes-search"
            />
          </template>
          <template #toolbar-trailing>
            <ORefreshButton
              layout="inline"
              variant="outline"
              :last-run-at="memoriesUpdatedAt"
              :loading="memoriesLoading"
              data-test="ai-memory-refresh"
              @click="refresh"
            />
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              :title="t('aiMemory.noMemories')"
              :description="t('aiMemory.noMemoriesHint')"
            />
          </template>
          <template #cell-name="{ row }">
            <ONameLinkCell :to="() => openMemory(row)" data-test="ai-memory-name-link">{{
              row.name
            }}</ONameLinkCell>
          </template>
          <template #subheader>
            <p class="text-text-secondary px-3 py-2 text-xs" data-test="ai-memory-notes-hint">
              {{ t("aiMemory.notesHint") }}
            </p>
          </template>
          <template #cell-rev="{ row }">
            <span :class="row.rev ? '' : 'text-text-secondary'">{{
              row.rev || t("aiMemory.none")
            }}</span>
          </template>
          <template #cell-pending="{ row }">
            <span :class="row.pending ? '' : 'text-text-secondary'">{{
              row.pending || t("aiMemory.none")
            }}</span>
          </template>
          <template #cell-updated="{ row }">
            <OTimeCell :value="row.updated" unit="us" />
          </template>
        </OTable>
      </div>
    </OPageLayout>
  </div>

  <ODrawer
    :open="pendingOpen"
    :title="t('aiMemory.pendingTitle')"
    :secondary-button-label="t('common.close')"
    data-test="ai-memory-pending-drawer"
    @update:open="(open: boolean) => !open && (pendingOpen = false)"
    @click:secondary="pendingOpen = false"
  >
    <div class="flex h-full min-h-0 flex-col" data-test="ai-memory-pending-body">
      <OTable
        :frame="false"
        show-index
        sorting="client"
        pagination="client"
        :enable-column-resize="true"
        :persist-columns="true"
        :data="shownPendingRows"
        :columns="pendingColumns"
        :row-actions="pendingActions"
        row-key="id"
        :loading="pendingLoading"
        :error="pendingError"
        :selection="isAdmin ? 'multiple' : 'none'"
        :selected-ids="selectedIds"
        :default-columns="false"
        :show-global-filter="false"
        table-id="settings-ai-memory-pending"
        data-test="ai-memory-pending"
        @update:selected-ids="selectedIds = $event"
        @retry="loadPending"
        @row-click="(row: PendingRow) => (reviewKey = row.id)"
      >
        <template #toolbar>
          <OSearchInput
            v-model="pendingFilter"
            class="flex-1"
            :placeholder="t('aiMemory.searchPending')"
            data-test="ai-memory-pending-search"
          />
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="pendingUpdatedAt"
            :loading="pendingLoading"
            data-test="ai-memory-pending-refresh"
            @click="loadPending"
          />
        </template>
        <template #empty>
          <OEmptyState
            size="hero"
            :title="t('aiMemory.noPending')"
            :description="t('aiMemory.noPendingHint')"
          />
        </template>
        <template #cell-change="{ row }">
          <OTruncatedText>{{ row.change }}</OTruncatedText>
        </template>
        <template #cell-when="{ row }">
          <OTimeCell :value="row.when" unit="us" />
        </template>
        <template #cell-flags="{ row }">
          <div class="flex flex-wrap gap-1">
            <OTag
              v-for="flag in row.flags"
              :key="flag"
              variant="warning-outline"
              size="sm"
              :label="t(`aiMemory.flag.${flag}`)"
              :data-test="`ai-memory-flag-${flag}`"
            />
          </div>
        </template>
        <template #cell-reason="{ row }">
          <OTruncatedText
            :class="row.failure ? 'text-status-error-text' : ''"
            :data-test="row.failure ? 'ai-memory-pending-failure' : undefined"
            >{{ row.failure || row.reason }}</OTruncatedText
          >
        </template>
        <template #selection-actions>
          <OButton
            variant="outline"
            size="sm"
            icon-left="check"
            data-test="ai-memory-accept-selected"
            @click="decide('accept', selectedIds)"
          >
            {{ t("aiMemory.accept") }}
          </OButton>
          <OButton
            variant="outline-destructive"
            size="sm"
            icon-left="close"
            data-test="ai-memory-discard-selected"
            @click="askDiscard(selectedIds)"
          >
            {{ t("aiMemory.discard") }}
          </OButton>
        </template>
      </OTable>
    </div>
  </ODrawer>

  <ODrawer
    :open="!!historyKey"
    :title="historyKey ? t('aiMemory.historyTitle', { name: memoryName(historyKey) }) : undefined"
    size="lg"
    data-test="ai-memory-history-drawer"
    @update:open="(open: boolean) => !open && (historyKey = null)"
  >
    <div class="flex h-full min-h-0 flex-col gap-3" data-test="ai-memory-history">
      <div v-if="historyLoading" class="flex flex-col gap-3" data-test="ai-memory-history-loading">
        <OSkeleton type="rect" class="h-8 w-40" />
        <OSkeleton type="text" />
        <OSkeleton type="rect" class="h-32 w-full" />
      </div>
      <div v-else-if="historyError" data-test="ai-memory-history-error">
        <OInlineNotice
          variant="error"
          :text="raw(historyError)"
          :action-label="t('common.retry')"
          data-test="ai-memory-history-notice"
          action-data-test="ai-memory-history-retry"
          @action="loadRevisions"
        />
      </div>
      <template v-else-if="selected">
        <div class="flex flex-col gap-1" data-test="ai-memory-history-meta">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">{{
              t("aiMemory.revisionTitle", { rev: selected.rev })
            }}</span>
            <OTag
              v-if="isCurrent"
              variant="default-soft"
              size="sm"
              :label="t('aiMemory.current')"
              data-test="ai-memory-history-current"
            />
          </div>
          <div class="text-text-secondary flex min-w-0 items-center gap-1 text-xs">
            <OTruncatedText>{{ authorLabel(selected.updated_by) }}</OTruncatedText>
            <span>·</span>
            <OTimeCell :value="selected.created_at" unit="us" class="shrink-0" />
          </div>
          <span v-if="selected.reason" class="text-text-secondary text-xs">{{
            t("aiMemory.historyReason", { reason: selected.reason })
          }}</span>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
          <div class="text-text-secondary flex items-center justify-between text-xs">
            <span data-test="ai-memory-history-compare">{{
              selected.rev && selected.rev > 1
                ? t("aiMemory.historyChanges", { rev: selected.rev - 1 })
                : t("aiMemory.firstVersion")
            }}</span>
            <span data-test="ai-memory-history-counts">{{
              t("aiMemory.diffCounts", { added: diffCounts.added, removed: diffCounts.removed })
            }}</span>
          </div>
          <DiffViewer
            :original="diff.original"
            :modified="diff.modified"
            mode="unified"
            data-test="ai-memory-diff"
            @stats="(v) => (diffCounts = v)"
          />
        </div>
      </template>
      <OEmptyState
        v-else
        size="hero"
        :title="t('aiMemory.noHistory')"
        :description="t('aiMemory.noHistoryHint')"
      />
    </div>
    <template v-if="selected && !historyLoading && !historyError" #header-right>
      <div class="flex items-center gap-2">
        <OButton
          v-if="canRevert"
          variant="outline"
          size="sm-action"
          data-test="ai-memory-revert"
          @click="confirmRevert = true"
        >
          {{ t("aiMemory.revertTo", { rev: selected?.rev }) }}
        </OButton>
        <ODropdown align="end">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm-action"
              icon-left="history"
              icon-right="keyboard-arrow-down"
              type="button"
              data-test="ai-memory-history-selector"
            >
              {{ t("aiMemory.revisionTitle", { rev: selected.rev }) }}
            </OButton>
          </template>
          <ODropdownItem
            v-for="r in appliedRevisions"
            :key="r.id"
            :data-test="`ai-memory-history-option-${r.rev}`"
            @select="selectRevision(r.id)"
          >
            <span class="flex w-72 min-w-0 flex-col gap-0.5">
              <span class="flex items-center justify-between gap-3">
                <span class="flex items-center gap-2 font-semibold">
                  {{ t("aiMemory.revisionTitle", { rev: r.rev }) }}
                  <OTag
                    v-if="r.id === appliedRevisions[0].id"
                    variant="default-soft"
                    size="sm"
                    :label="t('aiMemory.current')"
                  />
                </span>
                <OTimeCell :value="r.created_at" unit="us" class="text-text-secondary text-xs" />
              </span>
              <OTruncatedText class="text-text-secondary text-xs">{{
                authorLabel(r.updated_by)
              }}</OTruncatedText>
            </span>
          </ODropdownItem>
        </ODropdown>
      </div>
    </template>
  </ODrawer>

  <ODrawer
    :open="!!editing"
    :title="raw(editing?.name)"
    :primary-button-label="editorRef?.saveLabel || t('common.save')"
    :secondary-button-label="t('common.cancel')"
    :form-id="EDITOR_FORM_ID"
    data-test="ai-memory-drawer"
    @update:open="(open: boolean) => !open && (editing = null)"
    @click:secondary="editing = null"
  >
    <AiMemoryEditor
      v-if="editing"
      ref="editorRef"
      embedded
      :form-id="EDITOR_FORM_ID"
      :target="editing.target"
      :title="editing.name"
      @saved="onEditorSaved"
    />
  </ODrawer>

  <ODialog
    :open="!!reviewing"
    :title="reviewing ? t('aiMemory.reviewTitle', { name: reviewing.name }) : undefined"
    size="lg"
    :primary-button-label="isAdmin ? t('aiMemory.accept') : undefined"
    :secondary-button-label="isAdmin ? t('aiMemory.discard') : undefined"
    primary-button-data-test="ai-memory-review-accept"
    data-test="ai-memory-review-dialog"
    @update:open="(open: boolean) => !open && (reviewKey = null)"
    @click:primary="reviewing && decide('accept', [reviewing.id])"
    @click:secondary="reviewing && askDiscard([reviewing.id])"
  >
    <div v-if="reviewing" class="flex flex-col gap-2 text-sm">
      <div class="text-text-secondary text-xs">
        {{ reviewing.proposedBy }}<span v-if="reviewing.reason"> · {{ reviewing.reason }}</span>
      </div>
      <DiffViewer
        :original="reviewing.diff.original"
        :modified="reviewing.diff.modified"
        mode="unified"
        data-test="ai-memory-diff"
      />
    </div>
  </ODialog>

  <ConfirmDialog
    v-model="confirmDiscard"
    :title="t('aiMemory.discardTitle')"
    :message="t('aiMemory.discardMessage', { count: discardIds.length })"
    ok-variant="destructive"
    @update:ok="decide('discard', discardIds)"
    @update:cancel="confirmDiscard = false"
  />
  <ConfirmDialog
    v-model="confirmRevert"
    :title="t('aiMemory.revertTitle')"
    :message="t('aiMemory.revertMessage', { rev: selected?.rev ?? 0 })"
    ok-variant="destructive"
    @update:ok="revert"
    @update:cancel="confirmRevert = false"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ONameLinkCell from "@/lib/core/Table/cells/ONameLinkCell.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { COL, type OTableColumnDef, type OTableRowAction } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import aiMemory, {
  type Memory,
  type MemoryEdit,
  type MemoryTarget,
  type Revision,
  type PendingEdit,
} from "@/services/ai_memory";
import aiToolsets from "@/services/ai_toolsets";
import AiMemoryEditor from "@/components/ai_memory/AiMemoryEditor.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DiffViewer from "@/components/AIObservability/DiffViewer.vue";
import {
  authorLabel,
  editsDiff,
  formatBytes,
  groupPending,
  type PendingGroup,
} from "@/components/ai_memory/memory";

// The editor puts this id on its form, so the drawer's primary button submits it.
const EDITOR_FORM_ID = "ai-memory-drawer-form";
const editorRef = ref<InstanceType<typeof AiMemoryEditor> | null>(null);

interface MemoryRow {
  id: string;
  name: string;
  target: MemoryTarget;
  size: string;
  rev: number;
  writes: string;
  pending: number;
  updated: number | null;
}
interface PendingRow {
  id: string;
  name: string;
  change: string;
  proposedBy: string;
  when: number;
  flags: PendingGroup["flags"];
  reason: string;
  failure: string;
  diff: { original: string; modified: string };
}

const { t } = useI18nTyped();
const store = useStore();
const org = () => store.state.selectedOrganization.identifier;
const errorText = (err: any) =>
  err?.response?.data?.message || err?.message || t("aiMemory.loadFailed");

const pendingOpen = ref(false);
const toolsets = ref<{ id: string; name: string; kind: string }[]>([]);
const memories = ref<Record<string, Memory>>({});
const memoriesLoading = ref(true);
const memoriesError = ref<string | null>(null);
const memoriesUpdatedAt = ref<number | null>(null);
const pending = ref<PendingEdit[]>([]);
const pendingLoading = ref(true);
const pendingError = ref<string | null>(null);
const pendingUpdatedAt = ref<number | null>(null);
const selectedIds = ref<string[]>([]);
const isAdmin = ref(false);
const historyKey = ref<string | null>(null);
const revisions = ref<Revision[]>([]);
const historyLoading = ref(false);
const historyError = ref<string | null>(null);
const selectedId = ref<string | null>(null);
const selected = ref<Revision | null>(null);
const diff = ref({ original: "", modified: "" });
const diffCounts = ref({ added: 0, removed: 0 });
const failures = ref<Record<string, string>>({});
const editing = ref<{ name: string; target: MemoryTarget } | null>(null);
const reviewKey = ref<string | null>(null);
const confirmDiscard = ref(false);
const discardIds = ref<string[]>([]);
const confirmRevert = ref(false);

const mcpToolsets = computed(() => toolsets.value.filter((ts) => ts.kind === "mcp"));
const groups = computed(() => groupPending(pending.value));
const targetOf = (key: string): MemoryTarget =>
  key === "org" ? { scope: "org" } : { scope: "toolset", toolsetId: key };
const appliedRevisions = computed(() =>
  revisions.value
    .filter((r) => r.state === "applied" && r.rev != null)
    .sort((a, b) => b.rev! - a.rev!),
);
const isCurrent = computed(() => selected.value?.id === appliedRevisions.value[0]?.id);
const canRevert = computed(() => isAdmin.value && !!selected.value && !isCurrent.value);

const memoryName = (key: string) =>
  key === "org"
    ? t("aiMemory.orgMemory")
    : (toolsets.value.find((ts) => ts.id === key)?.name ?? key);

const memoryRows = computed<MemoryRow[]>(() => {
  const entries: [string, string, MemoryTarget][] = [
    ["org", t("aiMemory.orgMemory"), { scope: "org" }],
    ...mcpToolsets.value.map((ts): [string, string, MemoryTarget] => [
      ts.id,
      ts.name,
      { scope: "toolset", toolsetId: ts.id },
    ]),
  ];
  return entries.flatMap(([id, name, target]) => {
    const m = memories.value[id];
    if (!m) return [];
    return [
      {
        id,
        name,
        target,
        size: `${formatBytes(m.size_bytes)} / ${formatBytes(m.max_bytes)}`,
        rev: m.rev,
        writes: t(`aiMemory.${m.agent_memory_writes_effective}`),
        pending: m.pending_count,
        updated: m.rev ? m.updated_at : null,
      },
    ];
  });
});

const summarize = (edit: MemoryEdit) =>
  edit.op === "add"
    ? t("aiMemory.changeAdd", { section: edit.section, text: edit.text })
    : edit.op === "replace"
      ? t("aiMemory.changeReplace", { old: edit.old, new: edit.new })
      : t("aiMemory.changeRemove", { old: edit.old });

const changeSummary = (g: PendingGroup) => {
  const first = g.content !== undefined ? t("aiMemory.changeRewrite") : summarize(g.edits[0]);
  const more =
    g.edits.length > 1 ? ` ${t("aiMemory.changeMore", { count: g.edits.length - 1 })}` : "";
  const times =
    g.items.length > 1 ? ` (${t("aiMemory.proposedTimes", { count: g.items.length })})` : "";
  return first + more + times;
};

const notesFilter = ref("");
const pendingFilter = ref("");
const matches = (q: string, ...parts: string[]) =>
  !q.trim() || parts.some((p) => p.toLowerCase().includes(q.trim().toLowerCase()));
const shownMemoryRows = computed(() =>
  memoryRows.value.filter((r) => matches(notesFilter.value, r.name)),
);
// Set by "Review pending": while the search still holds that name, match it exactly so "datadog" skips "datadogddd".
const pendingOnly = ref("");
const shownPendingRows = computed(() =>
  pendingRows.value.filter((r) =>
    pendingOnly.value && pendingFilter.value === pendingOnly.value
      ? r.name === pendingOnly.value
      : matches(pendingFilter.value, r.name, r.change, r.proposedBy, r.reason),
  ),
);
const pendingRows = computed<PendingRow[]>(() =>
  groups.value.map((g) => {
    const failure = g.items.map((i) => failures.value[i.id]).find(Boolean) ?? "";
    const current = g.scope === "org" ? memories.value.org : memories.value[g.scope_key];
    return {
      id: g.key,
      name: memoryName(g.scope === "org" ? "org" : g.scope_key),
      change: changeSummary(g),
      proposedBy: [...new Set(g.items.map((i) => authorLabel(i.updated_by)))].join(", "),
      when: Math.max(...g.items.map((i) => i.created_at)),
      flags: g.flags,
      reason: g.items.find((i) => i.reason)?.reason ?? "",
      failure,
      diff:
        g.content !== undefined
          ? { original: current?.content ?? "", modified: g.content }
          : editsDiff(g.edits),
    };
  }),
);
const reviewing = computed(() => pendingRows.value.find((r) => r.id === reviewKey.value) ?? null);

const memoryColumns: OTableColumnDef[] = [
  {
    id: "name",
    header: t("aiMemory.colMemory"),
    accessorKey: "name",
    size: COL.name,
    meta: { align: "left", flex: true },
  },
  {
    id: "size",
    header: t("aiMemory.colSize"),
    accessorKey: "size",
    size: COL.sizeBytes,
    meta: { align: "left" },
  },
  {
    id: "rev",
    header: t("aiMemory.colRevision"),
    accessorKey: "rev",
    size: COL.count,
    meta: { align: "left" },
  },
  {
    id: "writes",
    header: t("aiMemory.agentWrites"),
    accessorKey: "writes",
    size: COL.status,
    meta: { align: "left" },
  },
  {
    id: "pending",
    header: t("aiMemory.colPending"),
    accessorKey: "pending",
    size: COL.count,
    meta: { align: "left" },
  },
  {
    id: "updated",
    header: t("aiMemory.colUpdated"),
    accessorKey: "updated",
    size: COL.updatedAt,
    meta: { align: "left" },
  },
  { id: "actions", header: t("common.actions"), isAction: true, pinned: "right" },
];
const pendingColumns: OTableColumnDef[] = [
  {
    id: "name",
    header: t("aiMemory.colMemory"),
    accessorKey: "name",
    size: COL.name,
    meta: { align: "left" },
  },
  {
    id: "change",
    header: t("aiMemory.colChange"),
    accessorKey: "change",
    size: COL.description,
    meta: { align: "left", flex: true },
  },
  {
    id: "proposedBy",
    header: t("aiMemory.colProposedBy"),
    accessorKey: "proposedBy",
    size: COL.owner,
    meta: { align: "left" },
  },
  {
    id: "when",
    header: t("aiMemory.colWhen"),
    accessorKey: "when",
    size: COL.updatedAt,
    meta: { align: "left" },
  },
  {
    id: "flags",
    header: t("aiMemory.colFlags"),
    accessorKey: "flags",
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "reason",
    header: t("aiMemory.colReason"),
    accessorKey: "reason",
    size: COL.description,
    meta: { align: "left" },
  },
  { id: "actions", header: t("common.actions"), isAction: true, pinned: "right" },
];
const pendingActions: OTableRowAction<PendingRow>[] = [
  {
    id: "accept",
    label: t("aiMemory.accept"),
    icon: "check",
    inline: true,
    visible: () => isAdmin.value,
    onSelect: (row) => decide("accept", [row.id]),
    dataTest: (row) => `ai-memory-accept-${row.id}`,
  },
  {
    id: "discard",
    label: t("aiMemory.discard"),
    icon: "close",
    inline: true,
    visible: () => isAdmin.value,
    onSelect: (row) => askDiscard([row.id]),
    dataTest: (row) => `ai-memory-discard-${row.id}`,
  },
];

const openMemory = (row: MemoryRow) => (editing.value = { name: row.name, target: row.target });

const memoryActions: OTableRowAction<MemoryRow>[] = [
  {
    id: "edit",
    label: t("common.edit"),
    icon: "edit",
    onSelect: (row) => openMemory(row),
    dataTest: (row) => `ai-memory-${row.id}-edit`,
  },
  {
    id: "history",
    label: t("aiMemory.viewHistory"),
    icon: "history",
    onSelect: (row) => {
      historyKey.value = row.id;
      revisions.value = [];
      selected.value = null;
      selectedId.value = null;
      historyError.value = null;
      loadRevisions();
    },
    dataTest: (row) => `ai-memory-${row.id}-history`,
  },
  {
    id: "review-pending",
    label: t("aiMemory.reviewPending"),
    icon: "rule",
    visible: (row) => row.pending > 0,
    onSelect: (row) => {
      pendingFilter.value = row.name;
      pendingOnly.value = row.name;
      pendingOpen.value = true;
    },
    dataTest: (row) => `ai-memory-${row.id}-review-pending`,
  },
];

// `can_apply` on org memory is the caller's `ai_memory` write grant, which every admin control needs.
const loadMemories = async () => {
  memoriesLoading.value = true;
  try {
    const list = (await aiToolsets.list(org(), { kind: "mcp" })).data?.toolsets ?? [];
    toolsets.value = list;
    const keys = ["org", ...list.map((ts: { id: string }) => ts.id)];
    const results = await Promise.all(
      keys.map((k) =>
        aiMemory.get(org(), k === "org" ? { scope: "org" } : { scope: "toolset", toolsetId: k }),
      ),
    );
    memories.value = Object.fromEntries(keys.map((k, i) => [k, results[i].data]));
    isAdmin.value = !!results[0].data.can_apply;
    memoriesError.value = null;
    memoriesUpdatedAt.value = Date.now();
  } catch (err) {
    memoriesError.value = errorText(err);
  } finally {
    memoriesLoading.value = false;
  }
};

const loadPending = async () => {
  pendingLoading.value = true;
  try {
    pending.value = (await aiMemory.pending(org())).data.pending ?? [];
    pendingError.value = null;
    pendingUpdatedAt.value = Date.now();
  } catch (err) {
    pendingError.value = errorText(err);
  } finally {
    pendingLoading.value = false;
  }
  selectedIds.value = [];
};

// A response for a selection the user has since left is dropped.
const loadRevisions = async () => {
  const key = historyKey.value;
  if (!key) return;
  historyLoading.value = true;
  try {
    const list = (await aiMemory.revisions(org(), targetOf(key))).data.revisions ?? [];
    if (key !== historyKey.value) return;
    revisions.value = list;
    const newest = appliedRevisions.value[0];
    selected.value = null;
    if (newest) await selectRevision(newest.id);
    if (key === historyKey.value) historyError.value = null;
  } catch (err) {
    if (key === historyKey.value) historyError.value = errorText(err);
  } finally {
    if (key === historyKey.value) historyLoading.value = false;
  }
};

const refresh = async () => {
  await Promise.all([loadMemories(), loadPending()]);
};

const onEditorSaved = () => {
  editing.value = null;
  refresh();
};

const openPending = () => {
  pendingFilter.value = "";
  pendingOnly.value = "";
  pendingOpen.value = true;
};

const askDiscard = (list: string[]) => {
  discardIds.value = list;
  confirmDiscard.value = true;
};

// Each group's ids get their own result; a failed one stays in the list with its reason.
const decide = async (action: "accept" | "discard", keys: string[]) => {
  const list = groups.value
    .filter((g) => keys.includes(g.key))
    .flatMap((g) => g.items.map((i) => i.id));
  if (!list.length) return;
  const next: Record<string, string> = {};
  try {
    const results = (await aiMemory[action](org(), list)).data?.results ?? [];
    for (const r of results.filter((r) => r.status >= 300)) {
      next[r.id] = r.message || r.code || String(r.status);
    }
    const failed = Object.keys(next).length;
    const done = list.length - failed;
    toast({
      variant: failed ? "warning" : "success",
      message: raw(
        t(`aiMemory.${action}ed`, { count: done }) +
          (failed ? `. ${t("aiMemory.failedCount", { count: failed })}` : ""),
      ),
    });
  } catch (err: any) {
    toast({ variant: "error", message: err?.response?.data?.message || t("aiMemory.saveFailed") });
  }
  reviewKey.value = null;
  confirmDiscard.value = false;
  await Promise.all([loadPending(), loadMemories()]);
  failures.value = next;
};

// A snapshot is diffed against the applied text it replaced (`base_rev` for a proposal).
const textBefore = async (target: MemoryTarget, r: Revision) => {
  if (r.edits) return "";
  const limit = r.state === "applied" && r.rev != null ? r.rev - 1 : r.base_rev;
  const prev = revisions.value
    .filter((p) => p.state === "applied" && p.rev != null && p.rev <= limit)
    .sort((a, b) => b.rev! - a.rev!)[0];
  if (!prev) return "";
  return (await aiMemory.revision(org(), target, prev.id)).data.content ?? "";
};

const selectRevision = async (id: string) => {
  const key = historyKey.value;
  if (!key) return;
  const target = targetOf(key);
  selectedId.value = id;
  const r = (await aiMemory.revision(org(), target, id)).data;
  const before = r.edits?.length ? "" : await textBefore(target, r);
  if (key !== historyKey.value || id !== selectedId.value) return;
  diff.value = r.edits?.length
    ? editsDiff(r.edits)
    : { original: before, modified: r.content ?? "" };
  selected.value = r;
};

const revert = async () => {
  const rev = selected.value?.rev;
  const key = historyKey.value;
  confirmRevert.value = false;
  if (!rev || !key) return;
  try {
    await aiMemory.revert(org(), targetOf(key), rev);
    toast({ variant: "success", message: t("aiMemory.reverted", { rev }) });
    await Promise.all([loadRevisions(), loadMemories()]);
  } catch (err: any) {
    toast({ variant: "error", message: err?.response?.data?.message || t("aiMemory.saveFailed") });
  }
};

onMounted(refresh);
</script>
