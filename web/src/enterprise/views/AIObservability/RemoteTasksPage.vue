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

<!--
  The Remote Task registry: HTTP services an Experiment can call to produce
  outputs. Each row is a head shown at its newest version.

  The signal this page exists to surface is "can an Experiment pin this?", which
  is not the same as the raw verification status — a draft, a failed test, and a
  retired head all read as unusable for different reasons. That question owns the
  only coloured column; everything else stays quiet.
-->
<template>
  <OPageLayout
    data-test="ai-remote-tasks-page"
    :title="t('aiObservability.nav.remoteTasks')"
    :subtitle="t('aiObservability.subtitle.remoteTasks')"
    icon="cloud-upload"
    bleed
    :scroll="false"
  >
    <template #actions>
      <OButton variant="primary" size="sm" data-test="ai-remote-tasks-new-btn" @click="openCreate">
        {{ t("aiObservability.remoteTasks.newButton") }}
      </OButton>
    </template>

    <div class="bg-card-glass-bg flex h-full min-h-0 flex-col" data-test="ai-remote-tasks-list">
      <OTable
        data-test="ai-remote-tasks-list-table"
        :data="numberedRows"
        :columns="columns"
        row-key="entityId"
        :loading="loading"
        :footer-title="t('aiObservability.remoteTasks.listTitle')"
        :global-filter="search"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        :default-columns="false"
        :column-visibility="DEFAULT_COLUMN_VISIBILITY"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="ai-remote-tasks-list"
        width="100%"
        class="h-full w-full"
        @row-click="openDetail"
      >
        <template #toolbar>
          <OSearchInput
            v-model="search"
            class="min-w-0 flex-1"
            :placeholder="t('aiObservability.remoteTasks.searchPlaceholder')"
            data-test="ai-remote-tasks-search-input"
            clearable
          />
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="ai-remote-tasks-refresh-btn"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" />
          </OButton>
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              preset="no-remote-tasks"
              :filtered="Boolean(search)"
              data-test="ai-remote-tasks-empty-state"
              @action="onEmptyAction"
            />
          </div>
        </template>

        <template #cell-name="{ row }">
          <span class="text-text-heading font-medium">{{ row.name }}</span>
        </template>

        <!-- A draft has no version to pin, so it never shows `v0` — that number
             is storage bookkeeping, not something a reader can reference. -->
        <template #cell-version="{ row }">
          <span v-if="versionLabel(row)" class="tabular-nums">{{ versionLabel(row) }}</span>
          <span v-else class="text-text-secondary">{{ DASH }}</span>
        </template>

        <template #cell-endpoint="{ row }">
          <OTooltip side="bottom" :content="raw(row.endpoint)">
            <span class="text-text-secondary line-clamp-1 font-mono text-xs">
              {{ row.endpoint }}
            </span>
          </OTooltip>
        </template>

        <template #cell-httpMethod="{ row }">
          <OTag type="httpMethod" :value="row.httpMethod" />
        </template>

        <template #cell-auth="{ row }">
          <OTag type="remoteTaskAuth" :value="row.auth.type" />
        </template>

        <template #cell-signing="{ row }">
          <OTag v-if="row.signing.enabled" variant="success-soft" icon="lock">
            {{ t("aiObservability.remoteTasks.signingOn") }}
          </OTag>
          <span v-else class="text-text-secondary">{{ DASH }}</span>
        </template>

        <template #cell-state="{ row }">
          <OTooltip side="bottom" :content="stateHint(row)" :disabled="!stateHint(row)">
            <OTag
              type="remoteTaskStatus"
              :value="state(row)"
              :data-test="`ai-remote-tasks-state-${row.entityId}`"
            />
          </OTooltip>
        </template>

        <template #cell-referencedBy="{ row }">
          <span v-if="referenceCount(row)" class="tabular-nums">
            {{ referenceLabel(row) }}
          </span>
          <span v-else class="text-text-secondary">{{ DASH }}</span>
        </template>

        <template #cell-updatedAt="{ row }">
          <OTimeCell :value="row.updatedAt" unit="ms" mode="relative" :empty-label="DASH" />
        </template>

        <template #cell-actions="{ row }">
          <div class="actions-container flex items-center">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              :disabled="!canEdit(row)"
              :data-test="`ai-remote-tasks-edit-${row.entityId}`"
              @click.stop="openEdit(row)"
            >
              <OTooltip
                side="bottom"
                :content="
                  canEdit(row)
                    ? t('aiObservability.remoteTasks.edit')
                    : t('aiObservability.remoteTasks.editSecretLocked')
                "
              />
            </OButton>
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              :data-test="`ai-remote-tasks-delete-${row.entityId}`"
              @click.stop="removeTask(row)"
            >
              <OTooltip side="bottom" :content="t('common.delete')" />
            </OButton>
          </div>
        </template>
      </OTable>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useNumberedRows } from "@/enterprise/components/onlineEvals/composables/useNumberedRows";
import remoteTasksService, { type RemoteTask } from "@/services/remote-tasks.service";
import llmExperimentsService from "@/services/llm-experiments.service";
import {
  canEditRemoteTask,
  remoteTaskState,
  remoteTaskVersionLabel,
} from "@/enterprise/components/AIObservability/remoteTaskContent";
import {
  aiRemoteTaskCreateRoute,
  aiRemoteTaskDetailRoute,
  aiRemoteTaskEditRoute,
} from "./remoteTaskRoutes";

defineOptions({ name: "AIRemoteTasksPage" });

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { confirm } = useConfirmDialog();

const DASH = raw("—");

/** Method is POST for all but a handful of services, so it starts hidden and the
 *  column toggle brings it back. */
const DEFAULT_COLUMN_VISIBILITY = { httpMethod: false };

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const tasks = ref<RemoteTask[]>([]);
const loading = ref(false);
const search = ref("");

/**
 * How many Experiments pin each task, keyed by task name.
 *
 * The list endpoint carries no reference count, so it is derived from the
 * Experiments already in the org — the same shape ScoreConfigList uses for its
 * "used by" column. Keyed by NAME rather than entity id because `task_ref` is
 * `name` plus a version and carries no id.
 */
const referenceCounts = ref<Record<string, number>>({});

const numberedRows = useNumberedRows(tasks);

const state = (row: RemoteTask) => remoteTaskState(row);
const versionLabel = (row: RemoteTask) => remoteTaskVersionLabel(row);
const canEdit = (row: RemoteTask) => canEditRemoteTask(row);

function stateHint(row: RemoteTask): I18nText | undefined {
  const current = state(row);
  if (current === "failed") return raw(row.verificationError) || undefined;
  if (current === "published") return t("aiObservability.remoteTasks.statusHint.published");
  if (current === "draft") return t("aiObservability.remoteTasks.statusHint.draft");
  return t("aiObservability.remoteTasks.statusHint.retired");
}

const referenceCount = (row: RemoteTask) => referenceCounts.value[row.name] ?? 0;

const referenceLabel = (row: RemoteTask) => {
  const count = referenceCount(row);
  return t("aiObservability.remoteTasks.referencedBy", { count }, count);
};

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "#",
    header: raw("#"),
    accessorKey: "#",
    sortable: false,
    size: 56,
    meta: { align: "left" },
  },
  {
    id: "name",
    header: t("aiObservability.remoteTasks.columns.name"),
    accessorKey: "name",
    sortable: true,
    size: COL.name,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "version",
    header: t("aiObservability.remoteTasks.columns.version"),
    accessorKey: "version",
    sortable: true,
    size: 96,
    meta: { align: "left" },
  },
  {
    id: "endpoint",
    header: t("aiObservability.remoteTasks.columns.endpoint"),
    accessorKey: "endpoint",
    sortable: false,
    size: 300,
    meta: { align: "left" },
  },
  {
    id: "httpMethod",
    header: t("aiObservability.remoteTasks.columns.method"),
    accessorKey: "httpMethod",
    hideable: true,
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "auth",
    header: t("aiObservability.remoteTasks.columns.auth"),
    accessorKey: "auth",
    hideable: true,
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "signing",
    header: t("aiObservability.remoteTasks.columns.signing"),
    accessorKey: "signing",
    hideable: true,
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "state",
    header: t("aiObservability.remoteTasks.columns.status"),
    accessorFn: (row: RemoteTask) => remoteTaskState(row),
    sortable: true,
    size: 140,
    meta: { align: "left" },
  },
  {
    id: "referencedBy",
    header: t("aiObservability.remoteTasks.columns.referencedBy"),
    accessorFn: (row: RemoteTask) => referenceCounts.value[row.name] ?? 0,
    hideable: true,
    sortable: true,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "updatedAt",
    header: t("aiObservability.remoteTasks.columns.updated"),
    accessorKey: "updatedAt",
    hideable: true,
    sortable: true,
    size: COL.createdAt,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("aiObservability.remoteTasks.columns.actions"),
    accessorKey: "actions",
    sortable: false,
    size: 96,
    pinned: "right" as const,
    meta: { align: "left", cellClass: "actions-column", actionCount: 2 },
  },
]);

function openCreate() {
  void router.push(aiRemoteTaskCreateRoute(orgId.value));
}

function openDetail(row: RemoteTask) {
  void router.push(aiRemoteTaskDetailRoute(orgId.value, row.entityId));
}

function openEdit(row: RemoteTask) {
  if (!canEdit(row)) return;
  void router.push(aiRemoteTaskEditRoute(orgId.value, row.entityId));
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    return;
  }
  openCreate();
}

/** Best-effort: a task list that renders without its reference counts is far
 *  better than one that fails because a second, unrelated request did. */
async function loadReferenceCounts() {
  try {
    const experiments = await llmExperimentsService.list(orgId.value);
    const counts: Record<string, number> = {};
    for (const experiment of experiments) {
      if (experiment.task?.type !== "remote") continue;
      const name = String(experiment.task.taskRef ?? "").split("@")[0];
      if (!name) continue;
      counts[name] = (counts[name] ?? 0) + 1;
    }
    referenceCounts.value = counts;
  } catch {
    referenceCounts.value = {};
  }
}

async function refresh() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    tasks.value = await remoteTasksService.list(orgId.value);
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.loadError"),
    });
  } finally {
    loading.value = false;
  }
  await loadReferenceCounts();
}

async function removeTask(row: RemoteTask) {
  const ok = await confirm({
    title: t("aiObservability.remoteTasks.delete.title"),
    message: t("aiObservability.remoteTasks.delete.message", { name: row.name }),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return;
  try {
    await remoteTasksService.delete(orgId.value, row.entityId);
    toast({ variant: "success", message: t("aiObservability.remoteTasks.delete.success") });
    await refresh();
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.delete.error"),
    });
  }
}

onMounted(refresh);
</script>
