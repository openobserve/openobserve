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
  Discovery — the stateless triage inbox for the Annotate section: "find unhealthy
  spans/traces/sessions worth reviewing" → select → Add To Queue. Enqueuing does
  NOT remove a row; state lives in the queue, which is why the In Queue? column
  exists. The list is unhealthy-only by definition, so the only filter dimension
  is queue status. Rows and paging come from /discovery (server-paginated).
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
      <OTable
        :key="scope"
        data-test="ai-discovery-table"
        :data="visibleItems"
        :columns="columns"
        row-key="targetId"
        :loading="loading"
        selection="multiple"
        :selected-ids="selectedIds"
        pagination="server"
        sorting="none"
        :current-page="currentPage"
        :total-count="total"
        :page-size="pageSize"
        :page-size-options="pageSizeOptions"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        :table-id="`ai-discovery-${scope}`"
        width="100%"
        class="h-full w-full"
        @update:selected-ids="selectedIds = $event"
        @update:current-page="onPageChange"
        @update:page-size="onPageSizeChange"
        @row-click="openTarget"
      >
        <!-- Search stretches so the queue filter and the column toggle OTable
             injects after this slot both sit at the right edge. -->
        <template #toolbar>
          <div class="flex w-full items-center gap-2">
            <OSearchInput
              v-model="search"
              class="min-w-0 flex-1"
              :placeholder="t('aiObservability.discovery.searchPlaceholder')"
              data-test="ai-discovery-search-input"
              clearable
            />
            <OSelect
              :model-value="queueStatus"
              :options="queueStatusOptions"
              label-key="label"
              value-key="value"
              :searchable="false"
              width="sm"
              class="shrink-0"
              data-test="ai-discovery-in-queue-filter"
              @update:model-value="onQueueStatusChange"
            />
          </div>
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              preset="no-discovery-items"
              :filtered="Boolean(search) || queueStatus !== DEFAULT_QUEUE_STATUS"
              data-test="ai-discovery-empty-state"
            />
          </div>
        </template>

        <template #cell-refTimestamp="{ row }">
          <OTimeCell
            :value="row.refTimestamp / 1000"
            unit="ms"
            mode="absolute"
            :empty-label="DASH"
          />
        </template>

        <template #cell-span="{ row }">
          <div class="flex min-w-0 flex-col">
            <span class="truncate font-mono text-xs">{{ textOrDash(row.operationName) }}</span>
            <span v-if="row.traceId" class="text-text-secondary text-2xs truncate">
              {{ t("aiObservability.discovery.spanParent", { trace: row.traceId }) }}
            </span>
          </div>
        </template>

        <template #cell-session="{ row }">
          <div class="flex min-w-0 flex-col">
            <span class="truncate font-mono text-xs">{{ textOrDash(row.sessionId) }}</span>
            <span v-if="row.userEmail" class="text-text-secondary text-2xs truncate">
              {{ raw(row.userEmail) }}
            </span>
          </div>
        </template>

        <template #cell-serviceName="{ row }">
          <span class="font-mono text-xs">{{ textOrDash(row.serviceName) }}</span>
        </template>

        <!-- gen_ai.operation.name is a small closed vocabulary, so it reads as a
             badge coloured by family. The full operation name is not: it carries
             the model ("gen_ai.chat.completions deepseek-v4-pro") and would blow
             the chip out, so it stays plain text when there is no gen-ai op. -->
        <template #cell-genAiOperationName="{ row }">
          <OTag
            v-if="row.genAiOperationName"
            :variant="operationVariant(row.genAiOperationName)"
            shape="rounded"
            data-test="ai-discovery-operation-badge"
          >
            {{ raw(row.genAiOperationName) }}
          </OTag>
          <span v-else class="truncate font-mono text-xs">
            {{ textOrDash(row.operationName) }}
          </span>
        </template>

        <template #cell-input="{ row }">
          <span class="text-text-body line-clamp-1">{{ textOrDash(row.input) }}</span>
        </template>

        <template #cell-traceCount="{ row }">
          <span class="tabular-nums">{{ textOrDash(row.traceCount) }}</span>
        </template>

        <template #cell-durationUs="{ row }">
          <span class="text-text-secondary font-mono text-xs">{{ durationLabel(row) }}</span>
        </template>

        <template #cell-quality="{ row }">
          <DiscoveryQualityCell :quality="row.quality" :issue-count="row.issueCount" />
        </template>

        <template #cell-inQueue="{ row }">
          <EnqueueStatusChip :queues="row.queues" />
        </template>

        <template #cell-actions="{ row }">
          <AddToQueueMenu
            :scope="scope"
            :queues="queues"
            :loading="queuesLoading"
            :busy="addingId === row.targetId"
            :label="t('aiObservability.discovery.addToQueue')"
            :data-test="`ai-discovery-add-${row.targetId}`"
            @open="loadQueues"
            @select="(queue) => addToQueue(queue, [row])"
          />
        </template>

        <!-- Selection + bulk action live in the table footer, the same shape the
             Alerts list uses. -->
        <template #bottom>
          <div class="flex h-12 w-full items-center justify-between gap-2">
            <span class="text-xs font-normal">
              <template v-if="selectedIds.length">
                {{
                  t("aiObservability.discovery.selectedCount", {
                    selected: selectedIds.length,
                    total,
                  })
                }}
              </template>
              <!-- Search runs over the loaded page, so say so rather than let a
                   filtered count read like a whole-result-set count. -->
              <template v-else-if="search">
                {{
                  t("aiObservability.discovery.searchFooter", {
                    matched: visibleItems.length,
                    loaded: items.length,
                  })
                }}
              </template>
              <template v-else>
                {{ t("aiObservability.discovery.footerTitle", { scope: scopeNoun }) }}
              </template>
            </span>
            <AddToQueueMenu
              v-if="selectedIds.length"
              :scope="scope"
              :queues="queues"
              :loading="queuesLoading"
              :busy="addingId === BULK"
              side="top"
              variant="primary"
              :label="t('aiObservability.discovery.bulkAdd', { count: selectedIds.length })"
              data-test="ai-discovery-bulk-add"
              @open="loadQueues"
              @select="(queue) => addToQueue(queue, selectedRows)"
            />
          </div>
        </template>
      </OTable>
    </div>
  </AiPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import AddToQueueMenu from "@/enterprise/components/AIObservability/AddToQueueMenu.vue";
import DiscoveryQualityCell from "@/enterprise/components/AIObservability/DiscoveryQualityCell.vue";
import EnqueueStatusChip from "@/enterprise/components/AIObservability/EnqueueStatusChip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import llmDiscoveryService, {
  DISCOVERY_MAX_PAGE_SIZE,
  type DiscoveryQueueStatus,
  type DiscoveryScope,
  type LlmDiscoveryItem,
} from "@/services/llm-discovery.service";
import llmQueuesService, { type LlmQueue } from "@/services/llm-queues.service";
import { formatTimeWithSuffix } from "@/utils/formatters";

defineOptions({ name: "AIDiscoveryPage" });

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const orgQuery = computed(() => ({ org_identifier: orgId.value }));

const {
  dateState,
  timeRange,
  onDateChange: onDateStateChange,
  mountResolve,
} = useAiDateController();

// The scope tab survives a revisit — same shape the trace detail view uses for
// its own tab strip (localStorage + a known-value guard, so a scope removed in a
// later release can't poison the restore). Read at ref INITIALISATION, before
// the mount fetch, or the page would load one scope and render another.
const LS_DISCOVERY_SCOPE_KEY = "o2_ai_discovery_scope";
const DEFAULT_DISCOVERY_SCOPE: DiscoveryScope = "trace";
const DISCOVERY_SCOPES = ["span", "trace", "session"] as const;

const isKnownScope = (value: string): value is DiscoveryScope =>
  DISCOVERY_SCOPES.some((s) => s === value);

function loadDiscoveryScope(): DiscoveryScope {
  try {
    const saved = localStorage.getItem(LS_DISCOVERY_SCOPE_KEY);
    if (saved && isKnownScope(saved)) return saved;
  } catch {
    // Storage unavailable — fall through to the default scope.
  }
  return DEFAULT_DISCOVERY_SCOPE;
}

/** The list opens unfiltered: enqueuing doesn't remove a row, so "All" is the
 *  honest view of what the window holds. */
const DEFAULT_QUEUE_STATUS: DiscoveryQueueStatus = "all";

const scope = ref<DiscoveryScope>(loadDiscoveryScope());
const items = ref<LlmDiscoveryItem[]>([]);
const loading = ref(false);
const lastRunAt = ref<number | null>(null);
const selectedIds = ref<string[]>([]);
const queueStatus = ref<DiscoveryQueueStatus>(DEFAULT_QUEUE_STATUS);
const search = ref("");

// Server pagination: /discovery pages with from/size and reports the true total.
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);
const pageSizeOptions = [20, 50, DISCOVERY_MAX_PAGE_SIZE];

const scopeTabs = computed(() => [
  { id: "span" as DiscoveryScope, label: t("aiObservability.discovery.scope.span") },
  { id: "trace" as DiscoveryScope, label: t("aiObservability.discovery.scope.trace") },
  { id: "session" as DiscoveryScope, label: t("aiObservability.discovery.scope.session") },
]);

const scopeNoun = computed(() => t(`aiObservability.discovery.scopeNoun.${scope.value}`));

const queueStatusOptions = computed(() => [
  { label: t("aiObservability.discovery.inQueueFilter.notEnqueued"), value: "not_enqueued" },
  { label: t("aiObservability.discovery.inQueueFilter.enqueued"), value: "enqueued" },
  { label: t("aiObservability.discovery.inQueueFilter.pending"), value: "pending" },
  { label: t("aiObservability.discovery.inQueueFilter.reviewed"), value: "reviewed" },
  { label: t("aiObservability.discovery.inQueueFilter.all"), value: "all" },
]);

const selectedRows = computed(() =>
  items.value.filter((item) => selectedIds.value.includes(item.targetId)),
);

// Search narrows the LOADED PAGE only — /discovery takes no query parameter, so
// there is nothing to push server-side (TODO(BE): a `q` param would make this
// search the whole result set). The footer states the scope so the count can't
// be misread.
const visibleItems = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return items.value;
  return items.value.filter((item) =>
    [
      item.input,
      item.serviceName,
      item.operationName,
      item.genAiOperationName,
      item.sessionId,
      item.userEmail,
      item.quality,
      t(`aiObservability.discovery.quality.${item.quality}`),
    ].some((field) =>
      String(field ?? "")
        .toLowerCase()
        .includes(term),
    ),
  );
});

// Shared tail columns — identical across the three scopes.
const qualityColumns = computed(() => [
  {
    id: "quality",
    header: t("aiObservability.discovery.columns.quality"),
    accessorKey: "quality",
    sortable: false,
    size: 130,
    meta: { align: "left" },
  },
  {
    id: "inQueue",
    header: t("aiObservability.discovery.columns.inQueue"),
    accessorKey: "inQueue",
    hideable: true,
    sortable: false,
    size: 170,
    meta: { align: "left" },
  },
  {
    // Actions columns are RIGID (min = size = max), and this one holds a LABELLED
    // button rather than the usual icon buttons: "Add To Queue" at size="sm" is
    // ~140px of content plus ~20px of cell inset, so anything at 160 clips the
    // button's right border. Sized with headroom for longer translations.
    id: "actions",
    header: t("aiObservability.discovery.columns.actions"),
    accessorKey: "actions",
    sortable: false,
    size: 200,
    pinned: "right" as const,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
  },
]);

const inputColumn = computed(() => ({
  id: "input",
  header: t("aiObservability.discovery.columns.input"),
  accessorKey: "input",
  sortable: false,
  size: COL.name,
  minSize: 220,
  meta: { align: "left", flex: true },
}));

// Each scope carries different context, so each gets its own column set — the
// API hydrates kind/duration for spans, service for traces, user/traces for
// sessions. `sortable` is off everywhere: /discovery takes no sort parameter and
// orders unhealthy-first, so a client sort would only reorder one page.
const columns = computed(() => {
  const timestamp = {
    id: "refTimestamp",
    header:
      scope.value === "session"
        ? t("aiObservability.discovery.columns.started")
        : t("aiObservability.discovery.columns.timestamp"),
    accessorKey: "refTimestamp",
    sortable: false,
    size: COL.createdAt,
    meta: { align: "left" },
  };

  if (scope.value === "span") {
    return [
      timestamp,
      {
        // Kind is the gen-ai operation, NOT OTel's numeric span_kind — "3" told a
        // reader nothing, "chat" / "execute_tool" is the thing being annotated.
        id: "genAiOperationName",
        header: t("aiObservability.discovery.columns.kind"),
        accessorKey: "genAiOperationName",
        hideable: true,
        sortable: false,
        size: 140,
        meta: { align: "left" },
      },
      {
        id: "span",
        header: t("aiObservability.discovery.columns.span"),
        accessorKey: "operationName",
        sortable: false,
        size: 240,
        meta: { align: "left" },
      },
      inputColumn.value,
      {
        id: "durationUs",
        header: t("aiObservability.discovery.columns.duration"),
        accessorKey: "durationUs",
        hideable: true,
        sortable: false,
        size: 110,
        meta: { align: "left" },
      },
      ...qualityColumns.value,
    ];
  }

  if (scope.value === "session") {
    return [
      timestamp,
      {
        id: "session",
        header: t("aiObservability.discovery.columns.session"),
        accessorKey: "sessionId",
        sortable: false,
        size: 240,
        meta: { align: "left" },
      },
      { ...inputColumn.value, header: t("aiObservability.discovery.columns.topic") },
      {
        id: "traceCount",
        header: t("aiObservability.discovery.columns.traces"),
        accessorKey: "traceCount",
        hideable: true,
        sortable: false,
        size: 90,
        meta: { align: "left" },
      },
      {
        id: "durationUs",
        header: t("aiObservability.discovery.columns.duration"),
        accessorKey: "durationUs",
        hideable: true,
        sortable: false,
        size: 110,
        meta: { align: "left" },
      },
      ...qualityColumns.value,
    ];
  }

  return [
    timestamp,
    {
      id: "genAiOperationName",
      header: t("aiObservability.discovery.columns.type"),
      accessorKey: "genAiOperationName",
      hideable: true,
      sortable: false,
      size: 180,
      meta: { align: "left" },
    },
    {
      id: "serviceName",
      header: t("aiObservability.discovery.columns.service"),
      accessorKey: "serviceName",
      sortable: false,
      size: 180,
      meta: { align: "left" },
    },
    inputColumn.value,
    ...qualityColumns.value,
  ];
});

// Cell values are server data, so they go through raw(); an absent value reads
// as the same em dash everywhere.
const DASH = raw("—");

function textOrDash(value: string | number | null | undefined) {
  return value == null || value === "" ? DASH : raw(String(value));
}

/** Colour by gen-ai operation FAMILY, using the same grouping the trace thread
 *  view classifies spans with (`threadView.utils.ts` → `classify`): model calls,
 *  tool calls and agent calls are the three things a reviewer scans for. An
 *  unrecognised operation stays neutral rather than borrowing a family's colour. */
const OPERATION_VARIANTS: Record<string, BadgeVariant> = {
  chat: "blue-soft",
  text_completion: "blue-soft",
  generate_content: "blue-soft",
  embeddings: "teal-soft",
  execute_tool: "amber-soft",
  invoke_agent: "purple-soft",
  create_agent: "purple-soft",
};

function operationVariant(operation: string): BadgeVariant {
  return OPERATION_VARIANTS[operation.toLowerCase()] ?? "default-soft";
}

/** Durations arrive in microseconds — same formatter the Traces views use. */
function durationLabel(row: LlmDiscoveryItem) {
  return row.durationUs == null ? DASH : raw(formatTimeWithSuffix(row.durationUs));
}

async function fetchItems() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    const res = await llmDiscoveryService.search(orgId.value, {
      scope: scope.value,
      startTime: timeRange.value.startTime,
      endTime: timeRange.value.endTime,
      from: (currentPage.value - 1) * pageSize.value,
      size: pageSize.value,
      queueStatus: queueStatus.value,
    });
    items.value = res.items;
    total.value = res.total;
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

/** Any change of what's being listed resets paging — page 4 of the old result
 *  set is meaningless in the new one. */
function reload() {
  currentPage.value = 1;
  fetchItems();
}

function onScopeChange(value: unknown) {
  scope.value = value as DiscoveryScope;
  try {
    localStorage.setItem(LS_DISCOVERY_SCOPE_KEY, scope.value);
  } catch {
    // Storage unavailable — the selection still applies for this session.
  }
  // Each scope shows different fields, so a term typed against the old columns
  // shouldn't silently hide rows in the new ones.
  search.value = "";
  reload();
}

function onQueueStatusChange(value: unknown) {
  queueStatus.value = value as DiscoveryQueueStatus;
  reload();
}

function onPageChange(page: number) {
  currentPage.value = page;
  fetchItems();
}

function onPageSizeChange(size: number) {
  pageSize.value = size;
  reload();
}

function onDateChange(value: any) {
  onDateStateChange(value);
  // The DateTime picker fires a programmatic date-change on mount (window replay);
  // only a genuine user pick should re-fetch, else we double-load with onMounted.
  if (value?.userChangedValue === true) reload();
}

/** Row click drills into the object itself, reusing the Traces views. */
/** One hour either side of the target, in microseconds. The detail views search
 *  a window, and a trace's other spans can sit outside the row's own timestamp;
 *  this mirrors the padding the Traces list uses when it opens a span. */
const TRACE_WINDOW_US = 3_600_000_000;

function openTarget(row: LlmDiscoveryItem) {
  // The detail views read stream + from/to straight off the URL — without them
  // the search has no stream and a NaN window, which renders as "trace not
  // found". `sourceStream` is the stream the row was discovered in.
  const query: Record<string, string | number> = {
    ...orgQuery.value,
    from: row.refTimestamp - TRACE_WINDOW_US,
    to: row.refTimestamp + TRACE_WINDOW_US,
  };
  if (row.sourceStream) query.stream = row.sourceStream;

  if (row.scope === "session") {
    if (row.sessionId) {
      router.push({ name: "sessionDetails", query: { ...query, session_id: row.sessionId } });
    }
    return;
  }
  const traceId = row.scope === "trace" ? row.targetId : row.traceId;
  if (traceId) {
    router.push({
      name: "traceDetails",
      query: {
        ...query,
        trace_id: traceId,
        // A span row lands on its parent trace with that span selected.
        ...(row.scope === "span" ? { span_id: row.targetId } : {}),
      },
    });
  }
}

// ── Add to queue (row action and bulk share this path) ──
const BULK = "__bulk__";
const queues = ref<LlmQueue[]>([]);
const queuesLoading = ref(false);
const addingId = ref<string | null>(null);

async function loadQueues() {
  if (queues.value.length || queuesLoading.value || !orgId.value) return;
  queuesLoading.value = true;
  try {
    queues.value = await llmQueuesService.list(orgId.value);
  } catch {
    toast({ variant: "error", message: t("aiObservability.discovery.queuesError") });
  } finally {
    queuesLoading.value = false;
  }
}

async function addToQueue(queue: LlmQueue, rows: LlmDiscoveryItem[]) {
  if (!rows.length || !orgId.value) return;
  addingId.value = rows.length === 1 ? rows[0].targetId : BULK;
  try {
    await llmDiscoveryService.addToQueue(orgId.value, queue.id, rows);
    toast({
      variant: "success",
      message: t("aiObservability.discovery.addSuccess", { queue: queue.name }),
      action: {
        label: t("aiObservability.discovery.openQueue"),
        handler: () =>
          router.push({
            name: "aiQueueWorkbench",
            params: { id: queue.id },
            query: orgQuery.value,
          }),
      },
    });
    await fetchItems();
  } catch {
    toast({ variant: "error", message: t("aiObservability.discovery.addError") });
  } finally {
    addingId.value = null;
  }
}

onMounted(() => {
  mountResolve();
  fetchItems();
});
</script>
