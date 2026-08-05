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
  Discovery — the stateless triage list for the Annotate section: "find unhealthy
  traces/spans/sessions worth reviewing" → select → Add to queue (single or bulk).
  Frontend-first: reads llm-discovery.service.ts (mock until the API lands). Uses
  AiPageShell for the shared date-range + refresh header, like Sessions / Insights.
-->
<template>
  <AiPageShell
    data-test="ai-discovery"
    :title="t('aiObservability.nav.discovery')"
    :subtitle="t('aiObservability.subtitle.discovery')"
    icon="saved-search"
    :date-state="dateState"
    :last-run-at="lastRunAt"
    :is-loading="loading"
    @date-change="onDateChange"
    @refresh="refresh"
  >
    <template #subnav>
      <OTabs
        :model-value="scope"
        bordered
        class="px-page-edge"
        data-test="ai-discovery-scope-tabs"
        @update:model-value="onScopeChange"
      >
        <OTab
          v-for="s in scopeTabs"
          :key="s.id"
          :name="s.id"
          :label="s.label"
          :data-test="`ai-discovery-scope-${s.id}`"
        />
      </OTabs>
    </template>

    <div class="bg-card-glass-bg flex h-full min-h-0 flex-col" data-test="ai-discovery-body">
      <!-- Query / filter summary. The Discovery filter is fixed to "unhealthy";
           shown read-only for transparency. -->
      <div class="border-border-default flex flex-col gap-2 border-b px-page-edge py-2.5">
        <code
          class="border-card-glass-border bg-code-bg text-text-secondary rounded-default overflow-x-auto border px-2 py-1 font-mono text-2xs"
        >
          {{ effectiveQuery }}
        </code>
        <div class="flex flex-wrap items-center gap-2">
          <OTag variant="default-soft" shape="rounded">
            {{ t("aiObservability.discovery.unhealthyFilter") }}
          </OTag>
          <span class="text-text-secondary text-2xs">
            {{ t("aiObservability.discovery.scopeNote", { scope: scopeNoun }) }}
          </span>
          <div class="ml-auto min-w-0">
            <OSelect
              :model-value="inQueueFilter"
              :options="inQueueOptions"
              label-key="label"
              value-key="value"
              :searchable="false"
              width="sm"
              data-test="ai-discovery-in-queue-filter"
              @update:model-value="onInQueueFilterChange"
            />
          </div>
        </div>
      </div>

      <!-- Bulk action bar (selection active) -->
      <div
        v-if="selectedIds.length"
        class="border-border-default bg-surface-subtle flex shrink-0 items-center gap-3 border-b px-page-edge py-2"
        data-test="ai-discovery-bulk-bar"
      >
        <span class="text-text-body text-sm font-medium">
          {{ t("aiObservability.discovery.selectedCount", { count: selectedIds.length }) }}
        </span>
        <OButton
          variant="primary"
          size="sm"
          icon-left="add"
          class="ml-auto"
          data-test="ai-discovery-bulk-add"
          @click="openAddToQueue(selectedRows)"
        >
          {{ t("aiObservability.discovery.bulkAdd", { count: selectedIds.length }) }}
        </OButton>
      </div>

      <OTable
        data-test="ai-discovery-table"
        :data="items"
        :columns="columns"
        row-key="targetId"
        :loading="loading"
        selection="multiple"
        :selected-ids="selectedIds"
        :footer-title="t('aiObservability.discovery.footerTitle', { scope: scopeNoun })"
        :page-size="20"
        :page-size-options="[20, 50, 100]"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="ai-discovery"
        width="100%"
        class="h-full w-full"
        @update:selected-ids="selectedIds = $event"
      >
        <template #empty>
          <div class="flex flex-col items-center justify-center gap-2 py-10">
            <OIcon name="check-circle" class="text-status-success-text h-8 w-8" />
            <span class="text-text-heading text-sm font-semibold">
              {{ t("aiObservability.discovery.emptyTitle") }}
            </span>
            <span class="text-text-secondary text-xs">
              {{ t("aiObservability.discovery.emptyBody") }}
            </span>
          </div>
        </template>

        <template #cell-refTimestamp="{ row }">
          <OTimeCell :value="row.refTimestamp / 1000" unit="ms" mode="absolute" empty-label="—" />
        </template>

        <template #cell-type="{ row }">
          <span class="text-text-secondary flex items-center">
            <OIcon :name="typeIcon(row.operationName)" size="sm" />
            <OTooltip side="bottom" :content="row.operationName || row.scope" />
          </span>
        </template>

        <template #cell-serviceName="{ row }">
          <span class="font-mono text-xs">{{ row.serviceName || "—" }}</span>
        </template>

        <template #cell-input="{ row }">
          <span class="text-text-body line-clamp-1">{{ row.input || "—" }}</span>
        </template>

        <template #cell-quality="{ row }">
          <span
            class="inline-flex items-center gap-1 text-xs font-medium"
            :class="
              row.quality === 'multiple' ? 'text-status-error-text' : 'text-status-warning-text'
            "
          >
            <OIcon
              :name="row.quality === 'multiple' ? 'report-problem' : 'warning-amber'"
              size="sm"
            />
            {{ t(`aiObservability.discovery.quality.${row.quality}`) }}
            <span v-if="row.issueCount > 1" class="text-text-secondary text-2xs">
              ({{ row.issueCount }})
            </span>
          </span>
        </template>

        <template #cell-inQueue="{ row }">
          <OTag v-if="row.inQueue" variant="success-soft" shape="rounded">
            {{ t("aiObservability.discovery.inQueue.yes") }}
          </OTag>
          <span v-else class="text-text-secondary text-xs">
            {{ t("aiObservability.discovery.inQueue.no") }}
          </span>
        </template>

        <template #cell-actions="{ row }">
          <OButton
            v-if="!row.inQueue"
            variant="outline"
            size="sm"
            icon-left="add"
            :data-test="`ai-discovery-add-${row.targetId}`"
            @click.stop="openAddToQueue([row])"
          >
            {{ t("aiObservability.discovery.addToQueue") }}
          </OButton>
          <span v-else class="text-text-disabled text-xs">
            {{ t("aiObservability.discovery.inQueue.yes") }}
          </span>
        </template>
      </OTable>
    </div>

    <!-- Add-to-queue dialog -->
    <ODialog
      v-model:open="addOpen"
      :title="t('aiObservability.discovery.addDialog.title')"
      :primary-button-label="t('aiObservability.discovery.addDialog.confirm')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-disabled="!selectedQueueId"
      :primary-button-loading="adding"
      data-test="ai-discovery-add-dialog"
      @click:primary="confirmAddToQueue"
      @click:secondary="addOpen = false"
    >
      <div class="flex flex-col gap-4 p-1">
        <p class="text-text-secondary text-sm">
          {{ t("aiObservability.discovery.addDialog.body", { count: pendingRows.length }) }}
        </p>
        <div class="flex flex-col gap-1.5">
          <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
            {{ t("aiObservability.discovery.addDialog.queueLabel") }}
          </span>
          <OSelect
            :model-value="selectedQueueId"
            :options="queueOptions"
            label-key="label"
            value-key="value"
            :placeholder="t('aiObservability.discovery.addDialog.queuePlaceholder')"
            :loading="queuesLoading"
            class="w-full"
            data-test="ai-discovery-add-queue-select"
            @update:model-value="(v: unknown) => (selectedQueueId = v ? String(v) : null)"
          />
          <span v-if="!queuesLoading && !queueOptions.length" class="text-text-secondary text-2xs">
            {{ t("aiObservability.discovery.addDialog.noQueues") }}
          </span>
        </div>
      </div>
    </ODialog>
  </AiPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import llmDiscoveryService, {
  type DiscoveryScope,
  type LlmDiscoveryItem,
} from "@/services/llm-discovery.service";
import llmQueuesService, { type LlmQueue } from "@/services/llm-queues.service";

defineOptions({ name: "AIDiscoveryPage" });

const { t } = useI18n();
const store = useStore();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const { dateState, timeRange, onDateChange: onDateStateChange, mountResolve } = useAiDateController();

const scope = ref<DiscoveryScope>("trace");
const items = ref<LlmDiscoveryItem[]>([]);
const loading = ref(false);
const lastRunAt = ref<number | null>(null);
const selectedIds = ref<string[]>([]);
const inQueueFilter = ref<"all" | "enqueued" | "not_enqueued">("not_enqueued");

// The Discovery filter is fixed to "unhealthy" — surfaced read-only for
// transparency (an editable query editor is a later enhancement).
const effectiveQuery =
  "llm.observation_type IS NOT NULL AND quality_state IN ('issue','multiple') ORDER BY quality_score ASC";

const scopeTabs = computed(() => [
  { id: "span" as DiscoveryScope, label: t("aiObservability.discovery.scope.span") },
  { id: "trace" as DiscoveryScope, label: t("aiObservability.discovery.scope.trace") },
  { id: "session" as DiscoveryScope, label: t("aiObservability.discovery.scope.session") },
]);

const scopeNoun = computed(() => t(`aiObservability.discovery.scopeNoun.${scope.value}`));

const inQueueOptions = computed(() => [
  { label: t("aiObservability.discovery.inQueueFilter.notEnqueued"), value: "not_enqueued" },
  { label: t("aiObservability.discovery.inQueueFilter.enqueued"), value: "enqueued" },
  { label: t("aiObservability.discovery.inQueueFilter.all"), value: "all" },
]);

const selectedRows = computed(() => items.value.filter((it) => selectedIds.value.includes(it.targetId)));

const columns = computed(() => [
  {
    id: "refTimestamp",
    header: t("aiObservability.discovery.columns.timestamp"),
    accessorKey: "refTimestamp",
    sortable: true,
    size: COL.createdAt,
    meta: { align: "left" },
  },
  {
    id: "type",
    header: t("aiObservability.discovery.columns.type"),
    accessorKey: "operationName",
    sortable: false,
    size: 72,
    meta: { align: "center" },
  },
  {
    id: "serviceName",
    header: t("aiObservability.discovery.columns.service"),
    accessorKey: "serviceName",
    sortable: true,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "input",
    header: t("aiObservability.discovery.columns.input"),
    accessorKey: "input",
    sortable: false,
    size: COL.name,
    minSize: 220,
    meta: { align: "left", flex: true },
  },
  {
    id: "quality",
    header: t("aiObservability.discovery.columns.quality"),
    accessorKey: "quality",
    sortable: true,
    size: 130,
    meta: { align: "left" },
  },
  {
    id: "inQueue",
    header: t("aiObservability.discovery.columns.inQueue"),
    accessorKey: "inQueue",
    hideable: true,
    sortable: true,
    size: 130,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("aiObservability.discovery.columns.actions"),
    accessorKey: "actions",
    sortable: false,
    size: 150,
    pinned: "right" as const,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
  },
]);

function typeIcon(op: string): string {
  if (/agent|invoke|workflow/i.test(op)) return "smart-toy";
  if (/tool|function|call/i.test(op)) return "account-tree";
  if (/retriev|search|rag/i.test(op)) return "manage-search";
  return "auto-awesome";
}

async function fetchItems() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    const res = await llmDiscoveryService.search(orgId.value, {
      scope: scope.value,
      startTime: timeRange.value.startTime,
      endTime: timeRange.value.endTime,
      from: 0,
      size: 50,
      queueStatus: inQueueFilter.value,
    });
    items.value = res.items;
    selectedIds.value = [];
    lastRunAt.value = Date.now();
  } catch {
    toast({ variant: "error", message: t("aiObservability.discovery.loadError") });
  } finally {
    loading.value = false;
  }
}

function refresh() {
  fetchItems();
}

function onScopeChange(v: unknown) {
  scope.value = v as DiscoveryScope;
  fetchItems();
}

function onInQueueFilterChange(v: unknown) {
  inQueueFilter.value = v as "all" | "enqueued" | "not_enqueued";
  fetchItems();
}

function onDateChange(value: any) {
  onDateStateChange(value);
  // The DateTime picker fires a programmatic date-change on mount (window replay);
  // only a genuine user pick should re-fetch, else we double-load with onMounted.
  if (value?.userChangedValue === true) fetchItems();
}

// ── Add to queue (single or bulk) ──
const addOpen = ref(false);
const adding = ref(false);
const pendingRows = ref<LlmDiscoveryItem[]>([]);
const queues = ref<LlmQueue[]>([]);
const queuesLoading = ref(false);
const selectedQueueId = ref<string | null>(null);

const queueOptions = computed(() => queues.value.map((q) => ({ label: q.name, value: q.id })));

async function loadQueues() {
  if (queues.value.length || queuesLoading.value) return;
  queuesLoading.value = true;
  try {
    queues.value = await llmQueuesService.list(orgId.value);
  } catch {
    toast({ variant: "error", message: t("aiObservability.discovery.addDialog.queuesError") });
  } finally {
    queuesLoading.value = false;
  }
}

function openAddToQueue(rows: LlmDiscoveryItem[]) {
  if (!rows.length) return;
  pendingRows.value = rows;
  selectedQueueId.value = null;
  addOpen.value = true;
  loadQueues();
}

async function confirmAddToQueue() {
  if (!selectedQueueId.value || !pendingRows.value.length) return;
  adding.value = true;
  try {
    const n = await llmDiscoveryService.addToQueue(
      orgId.value,
      selectedQueueId.value,
      pendingRows.value,
    );
    toast({ variant: "success", message: t("aiObservability.discovery.addDialog.success", { count: n }) });
    addOpen.value = false;
    await fetchItems();
  } catch {
    toast({ variant: "error", message: t("aiObservability.discovery.addDialog.error") });
  } finally {
    adding.value = false;
  }
}

onMounted(() => {
  mountResolve();
  fetchItems();
});
</script>
