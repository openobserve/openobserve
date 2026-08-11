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
  Queue Detail — what is in one queue before you commit to reviewing it: the
  pinned Score Config versions, the target Dataset, and the item pool split by
  status. "Start Reviewing" hands over to the Workbench (`queues/:id/review`),
  and a row opens the Workbench ON that item.

  Queue Items are POINTERS (refType/refId/refTraceId/status/timestamps) — there
  is no title, observed quality or annotation count on the row, so this table
  shows what the API actually carries rather than inventing it.
-->
<template>
  <OPageLayout
    data-test="ai-queue-detail-page"
    :back="backTarget"
    :title="queue?.name ? raw(queue.name) : t('aiObservability.queues.detail.fallbackTitle')"
    :subtitle="raw(queue?.description)"
    icon="fact-check"
    bleed
    :scroll="false"
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        :disabled="!items.length"
        data-test="ai-queue-detail-start-review"
        @click="startReviewing()"
      >
        {{ t("aiObservability.queues.detail.startReviewing") }}
      </OButton>
    </template>

    <!-- What the reviewer will be scoring against, before they start: the pinned
         Score Config versions and where accepted goldens land. -->
    <template #subnav>
      <div
        class="px-page-edge flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2"
        data-test="ai-queue-detail-meta"
      >
        <span class="text-text-secondary text-xs">
          {{
            t("aiObservability.queues.detail.scoreConfigs", {
              count: queue?.scoreConfigs.length ?? 0,
            })
          }}
        </span>
        <div v-if="queue?.scoreConfigs.length" class="flex flex-wrap items-center gap-1">
          <OTag
            v-for="cfg in queue.scoreConfigs"
            :key="cfg.scoreConfigId"
            :variant="isStale(cfg) ? 'orange-soft' : 'default-soft'"
            shape="rounded"
          >
            {{ raw(`${cfg.name} v${cfg.version}`) }}
          </OTag>
        </div>
        <span v-else class="text-text-secondary text-xs">{{ DASH }}</span>

        <OSeparator vertical class="h-4" />

        <OButton
          v-if="queue?.targetDatasetId"
          variant="ghost"
          size="sm"
          icon-left="table-chart"
          data-test="ai-queue-detail-dataset"
          @click="openDataset"
        >
          {{ raw(queue.targetDatasetName) || t("aiObservability.queues.detail.targetDataset") }}
        </OButton>
        <span v-else class="text-text-secondary text-xs">
          {{ t("aiObservability.queues.detail.noTargetDataset") }}
        </span>
      </div>
    </template>

    <div class="bg-card-glass-bg flex h-full min-h-0 flex-col" data-test="ai-queue-detail-body">
      <OTable
        data-test="ai-queue-detail-items-table"
        :data="visibleItems"
        :columns="columns"
        row-key="id"
        :loading="loading"
        show-index
        :footer-title="t('aiObservability.queues.detail.footerTitle')"
        :global-filter="search"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="ai-queue-items"
        width="100%"
        class="h-full w-full"
        @row-click="startReviewing"
      >
        <!-- Status split as filter tiles: the counts are what tells a reviewer
             whether this queue is worth opening. -->
        <template #subheader>
          <div
            class="px-page-edge border-table-row-divider border-b py-1.5"
            data-test="ai-queue-detail-summary"
          >
            <OStatStrip
              :items="summaryStats"
              :loading="loading"
              selectable
              :selected-key="statusFilter"
              @select="onStatSelect"
            />
          </div>
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="ai-queue-detail-refresh-btn"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" />
          </OButton>
        </template>

        <template #toolbar>
          <OSearchInput
            v-model="search"
            class="min-w-0 flex-1"
            :placeholder="t('aiObservability.queues.detail.searchPlaceholder')"
            data-test="ai-queue-detail-search-input"
            clearable
          />
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              illustration="check"
              :title="t('aiObservability.queues.detail.emptyTitle')"
              :description="t('aiObservability.queues.detail.emptyBody')"
              :filtered="Boolean(search) || statusFilter !== 'all'"
              data-test="ai-queue-detail-empty-state"
              @action="clearFilters"
            />
          </div>
        </template>

        <template #cell-refType="{ row }">
          <OTag :variant="refTypeVariant(row.refType)" shape="rounded">
            {{ raw(row.refType) }}
          </OTag>
        </template>

        <template #cell-refId="{ row }">
          <div class="flex min-w-0 flex-col">
            <span class="truncate font-mono text-xs">{{ raw(row.refId) }}</span>
            <span
              v-if="row.refTraceId && row.refType !== 'trace'"
              class="text-text-secondary text-2xs truncate font-mono"
            >
              {{ t("aiObservability.queues.detail.inTrace", { traceId: raw(row.refTraceId) }) }}
            </span>
          </div>
        </template>

        <template #cell-createdAt="{ row }">
          <OTimeCell :value="row.createdAt" unit="ms" mode="relative" :empty-label="DASH" />
        </template>

        <template #cell-status="{ row }">
          <OTag
            :variant="row.status === 'reviewed' ? 'success-soft' : 'default-soft'"
            shape="rounded"
          >
            {{ t(`aiObservability.queues.detail.status.${row.status}`) }}
          </OTag>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex justify-end">
            <OButton
              :variant="row.status === 'reviewed' ? 'outline' : 'primary'"
              size="sm"
              icon-right="arrow-forward"
              :data-test="`ai-queue-detail-review-${row.id}`"
              @click.stop="startReviewing(row)"
            >
              {{
                row.status === "reviewed"
                  ? t("aiObservability.queues.detail.reviewAgain")
                  : t("aiObservability.queues.review")
              }}
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
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmQueuesService, {
  type LlmQueue,
  type LlmQueueBinding,
  type LlmQueueItem,
  type LlmQueueItemStatus,
  type QueueRefType,
} from "@/services/llm-queues.service";

defineOptions({ name: "AIQueueDetailPage" });

const DASH = raw("—");

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const orgQuery = computed(() => ({ org_identifier: orgId.value }));
const queueId = computed<string>(() => String(route.params.id ?? ""));

const queue = ref<LlmQueue | null>(null);
const items = ref<LlmQueueItem[]>([]);
const loading = ref(false);
const search = ref("");
const statusFilter = ref<LlmQueueItemStatus | "all">("all");

const backTarget = computed(() => ({
  label: t("aiObservability.nav.queues"),
  to: { name: "aiQueues", query: orgQuery.value },
}));

const pendingCount = computed(() => items.value.filter((i) => i.status === "pending").length);
const reviewedCount = computed(() => items.value.filter((i) => i.status === "reviewed").length);

const visibleItems = computed(() =>
  statusFilter.value === "all"
    ? items.value
    : items.value.filter((item) => item.status === statusFilter.value),
);

const summaryStats = computed<StatItem[]>(() => {
  const total = items.value.length;
  const value = (n: number): string | number => (total ? n : DASH);
  return [
    {
      key: "pending",
      label: t("aiObservability.queues.detail.status.pending"),
      value: value(pendingCount.value),
      icon: "fiber-manual-record",
      tone: "warning",
      max: total || undefined,
      dataTest: "ai-queue-detail-summary-pending",
    },
    {
      key: "reviewed",
      label: t("aiObservability.queues.detail.status.reviewed"),
      value: value(reviewedCount.value),
      icon: "check-circle",
      tone: "success",
      max: total || undefined,
      dataTest: "ai-queue-detail-summary-reviewed",
    },
    {
      key: "all",
      label: t("aiObservability.queues.detail.allItems"),
      value: value(total),
      icon: "format-list-bulleted",
      tone: "primary",
      dataTest: "ai-queue-detail-summary-all",
    },
  ];
});

// Re-clicking the active tile clears the filter, matching the Alerts strip.
function onStatSelect(key: string) {
  statusFilter.value =
    key === "all" || statusFilter.value === key ? "all" : (key as LlmQueueItemStatus);
}

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
}

function isStale(cfg: LlmQueueBinding): boolean {
  return cfg.latestVersion !== undefined && cfg.latestVersion > cfg.version;
}

function refTypeVariant(refType: QueueRefType): BadgeVariant {
  if (refType === "span") return "purple-soft";
  if (refType === "session") return "teal-soft";
  return "blue-soft";
}

const columns = computed<OTableColumnDef<LlmQueueItem>[]>(() => [
  {
    id: "refType",
    header: t("aiObservability.queues.detail.columns.refType"),
    accessorKey: "refType",
    sortable: true,
    size: 110,
    meta: { align: "left" },
  },
  {
    id: "refId",
    header: t("aiObservability.queues.detail.columns.refId"),
    accessorKey: "refId",
    sortable: true,
    size: COL.name,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "createdAt",
    header: t("aiObservability.queues.detail.columns.added"),
    accessorKey: "createdAt",
    hideable: true,
    sortable: true,
    size: COL.createdAt,
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("aiObservability.queues.detail.columns.status"),
    accessorKey: "status",
    sortable: true,
    size: 130,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: raw(""),
    accessorKey: "actions",
    sortable: false,
    isAction: true,
    size: 140,
    meta: { align: "right" },
  },
]);

// Two requests: the queue row (name, description, bindings, target dataset) and
// its active items. Neither carries per-item content, so nothing is fetched per
// row — the Workbench hydrates an item when it is opened.
async function refresh() {
  if (!orgId.value || !queueId.value) return;
  loading.value = true;
  try {
    const [queueRow, queueItems] = await Promise.all([
      llmQueuesService.get(orgId.value, queueId.value),
      llmQueuesService.listItems(orgId.value, queueId.value),
    ]);
    queue.value = queueRow;
    items.value = queueItems;
  } catch {
    toast({ variant: "error", message: t("aiObservability.queues.detail.loadError") });
  } finally {
    loading.value = false;
  }
}

// The Workbench owns the review itself; a row opens it ON that item so the
// reviewer lands where they clicked instead of at the first pending one.
function startReviewing(row?: LlmQueueItem) {
  router.push({
    name: "aiQueueWorkbench",
    params: { id: queueId.value },
    query: row?.id ? { ...orgQuery.value, item: row.id } : orgQuery.value,
  });
}

function openDataset() {
  const datasetId = queue.value?.targetDatasetId;
  if (!datasetId) return;
  router.push({ name: "aiDatasetDetail", params: { id: datasetId }, query: orgQuery.value });
}

onMounted(refresh);
</script>
