<template>
  <EvalListShell data-test="eval-job" :show-empty="false">
    <template #table>
      <OTable
        v-model:selected-ids="selectedIds"
        selection="multiple"
        data-test="eval-job-list-table"
        :data="numberedRows"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :forbidden="forbidden"
        :global-filter="search"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="eval-job-list"
        width="100%"
        class="h-full w-full"
        :get-row-style="evalJobRowStyle"
        :row-class="evalJobRowClass"
        @row-click="(row: any) => $emit('view', row)"
      >
        <template #toolbar>
          <OSearchInput
            :model-value="search"
            class="min-w-0 flex-1"
            :placeholder="t('onlineEvals.job.searchPlaceholder')"
            data-test="eval-job-list-search-input"
            clearable
            @update:model-value="$emit('update:search', $event as string)"
          />
        </template>

        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastRunAt"
            :loading="refreshing || loading"
            shortcut-id="evalJobsRefresh"
            data-test="eval-job-list-refresh-btn"
            @click="emit('refresh')"
          />
        </template>

        <template #subheader>
          <div
            class="px-page-edge border-table-row-divider border-b py-1.5"
            data-test="eval-job-list-summary"
          >
            <OStatStrip
              :items="summaryStats"
              :loading="loading"
              selectable
              :selected-key="selectedStatKey"
              default-key="all"
              @select="onStatSelect"
            />
          </div>
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              preset="no-eval-jobs"
              :filtered="hasFilters"
              data-test="eval-job-empty-state"
              @action="onEmptyAction"
            />
          </div>
        </template>

        <template #selection-actions>
          <OButton
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            data-test="eval-job-bulk-delete-btn"
            :loading="actionLoading"
            @click="handleBulkDelete"
          >
            {{ t("common.delete") }}
          </OButton>
        </template>

        <template #cell-status="{ row }">
          <OTag type="evalStatus" :value="statusOf(row)" :label="statusLabel(statusOf(row))" />
        </template>

        <template #cell-health="{ row }">
          <span v-if="!healthOf(row)" class="text-text-secondary">—</span>
          <span v-else class="inline-flex">
            <OTag type="evalJobHealth" :value="healthOf(row)?.state" :label="healthLabel(row)" />
            <OTooltip>
              <template #content>
                <div v-if="healthOf(row)?.recentRuns">{{ healthSummary(row) }}</div>
                <div>{{ healthSince(row) }}</div>
                <div>{{ healthChecked(row) }}</div>
              </template>
            </OTooltip>
          </span>
        </template>

        <template #cell-lastError="{ row }">
          <span v-if="!lastErrorOf(row)" class="text-text-secondary">—</span>
          <span v-else class="inline-flex min-w-0 items-center gap-1.5">
            <span class="truncate">{{ lastErrorKind(row) }}</span>
            <span class="text-text-secondary shrink-0">{{ lastErrorAgo(row) }}</span>
            <OTooltip :content="lastErrorMessage(row)" max-width="480px" hoverable />
          </span>
        </template>

        <template #cell-stream="{ row }">
          {{ row.stream }}
        </template>

        <template #cell-targetScope="{ row }">
          <OTag type="fieldTag" :value="targetScopeOf(row)">{{ targetScopeLabel(row) }}</OTag>
        </template>

        <template #cell-scorers="{ row }">
          <span class="tabular-nums">{{ scorerCountText(row) }}</span>
        </template>

        <template #cell-created="{ row }">
          {{ formatDateShort(rowCreated(row)) }}
        </template>

        <template #cell-actions="{ row }">
          <div class="actions-container flex items-center">
            <OButton
              v-if="canActivate(row.status)"
              :data-test="`eval-job-list-${row.name}-activate-btn`"
              variant="ghost-success"
              size="icon-sm"
              :title="t('onlineEvals.actions.activate')"
              icon-left="play-arrow"
              :loading="pendingStatusId === row.id"
              :disabled="pendingStatusId !== null && pendingStatusId !== row.id"
              class="max-md:hidden"
              @click.stop="$emit('activate', row)"
            />
            <OButton
              v-if="canPause(row.status)"
              :data-test="`eval-job-list-${row.name}-pause-btn`"
              variant="ghost-destructive"
              size="icon-sm"
              :title="t('onlineEvals.actions.pause')"
              icon-left="pause"
              :loading="pendingStatusId === row.id"
              :disabled="pendingStatusId !== null && pendingStatusId !== row.id"
              class="max-md:hidden"
              @click.stop="$emit('pause', row)"
            />
            <OButton
              :data-test="`eval-job-list-${row.name}-edit-btn`"
              variant="ghost"
              size="icon-sm"
              :title="t('onlineEvals.actions.edit')"
              icon-left="edit"
              class="max-md:hidden"
              @click.stop="$emit('edit', row)"
            />
            <OButton
              :data-test="`eval-job-list-${row.name}-delete-btn`"
              variant="ghost-destructive"
              size="icon-sm"
              :title="t('onlineEvals.actions.delete')"
              icon-left="delete"
              class="max-md:hidden"
              @click.stop="$emit('delete', row)"
            />
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  icon-left="more-vert"
                  variant="ghost"
                  size="icon-xs-sq"
                  class="md:hidden"
                  data-test="eval-job-list-row-more-actions"
                  @click.stop
                />
              </template>
              <ODropdownItem
                v-if="canActivate(row.status)"
                icon-left="play-arrow"
                class="md:hidden"
                :disabled="pendingStatusId !== null && pendingStatusId !== row.id"
                :data-test="`eval-job-list-${row.name}-activate-btn-menu`"
                @select="$emit('activate', row)"
              >
                <span>{{ t("onlineEvals.actions.activate") }}</span>
              </ODropdownItem>
              <ODropdownItem
                v-if="canPause(row.status)"
                icon-left="pause"
                variant="destructive"
                class="md:hidden"
                :disabled="pendingStatusId !== null && pendingStatusId !== row.id"
                :data-test="`eval-job-list-${row.name}-pause-btn-menu`"
                @select="$emit('pause', row)"
              >
                <span>{{ t("onlineEvals.actions.pause") }}</span>
              </ODropdownItem>
              <ODropdownItem
                icon-left="edit"
                class="md:hidden"
                :data-test="`eval-job-list-${row.name}-edit-btn-menu`"
                @select="$emit('edit', row)"
              >
                <span>{{ t("onlineEvals.actions.edit") }}</span>
              </ODropdownItem>
              <ODropdownItem
                icon-left="delete"
                variant="destructive"
                class="md:hidden"
                :data-test="`eval-job-list-${row.name}-delete-btn-menu`"
                @select="$emit('delete', row)"
              >
                <span>{{ t("onlineEvals.actions.delete") }}</span>
              </ODropdownItem>
            </ODropdown>
          </div>
        </template>
      </OTable>
    </template>
  </EvalListShell>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18nTyped, raw, type I18nKey, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { COL } from "@/lib/core/Table/OTable.types";
import type {
  EvalJob,
  EvalJobHealth,
  EvalJobHealthState,
  EvalJobLastError,
  EvalJobStatus,
} from "@/services/online-evals.service";
import { statusOf, targetScopeOf, valueOf } from "./utils/evalEntity";
import { relativeTime } from "./utils/evalFormat";
import { formatDate } from "@/utils/date";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EvalListShell from "./EvalListShell.vue";
import { useNumberedRows } from "./composables/useNumberedRows";

const props = defineProps<{
  rows: EvalJob[];
  search: string;
  loading?: boolean;
  forbidden?: boolean;
  /** A bulk action (e.g. delete-selected) is in flight — shows the table overlay. */
  actionLoading?: boolean;
  /** ID of the job whose activate/pause request is currently in flight. */
  pendingStatusId?: string | null;
  /** Epoch-ms of the last list read, for the refresh button's age label. */
  lastRunAt?: number | null;
  /** A reload is in flight — spins the refresh button and blocks a second click. */
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:search", value: string): void;
  (e: "create"): void;
  (e: "edit", row: EvalJob): void;
  (e: "view", row: EvalJob): void;
  (e: "delete", row: EvalJob): void;
  (e: "activate", row: EvalJob): void;
  (e: "pause", row: EvalJob): void;
  (e: "delete-bulk", ids: string[]): void;
  (e: "refresh"): void;
}>();

function canActivate(status: EvalJobStatus): boolean {
  return status === "draft" || status === "paused";
}

function canPause(status: EvalJobStatus): boolean {
  return status === "active";
}

const { t } = useI18nTyped();
const statusFilter = ref<EvalJobStatus | null>(null);
const selectedIds = ref<string[]>([]);

function handleBulkDelete() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  emit("delete-bulk", ids);
}

// After the list reloads (e.g. following a bulk delete), drop any selected ids
// whose rows no longer exist so the bulk-action button count stays accurate.
// Pruning (rather than clearing on emit) keeps the selection intact if the user
// cancels the confirm dialog.
watch(
  () => props.rows,
  (rows) => {
    const valid = new Set(rows.map((r) => r.id));
    const pruned = selectedIds.value.filter((id) => valid.has(id));
    if (pruned.length !== selectedIds.value.length) selectedIds.value = pruned;
  },
);

const columns = computed(() =>
  [
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
      header: t("onlineEvals.job.columns.name"),
      accessorKey: "name",
      sortable: true,
      size: COL.name,
      // `flex` (not `autoWidth`): fills leftover width on load AND stays
      // resizable — matches Dashboards/AlertList; `autoWidth` has no resize grip.
      meta: { align: "left", flex: true },
    },
    {
      id: "status",
      header: t("onlineEvals.job.columns.status"),
      accessorFn: (row: EvalJob) => statusOf(row),
      sortable: true,
      size: COL.status,
      meta: { align: "left" },
    },
    {
      id: "stream",
      header: t("onlineEvals.job.columns.stream"),
      accessorKey: "stream",
      sortable: true,
      size: COL.streamName,
      meta: { align: "left" },
    },
    {
      id: "targetScope",
      header: t("onlineEvals.job.columns.targetScope"),
      accessorFn: (row: EvalJob) => targetScopeOf(row),
      sortable: true,
      size: 120,
      meta: { align: "left" },
    },
    {
      id: "scorers",
      header: t("onlineEvals.job.columns.scorers"),
      accessorFn: (row: EvalJob) => (row.scorers || []).length,
      sortable: true,
      size: COL.count,
      meta: { align: "right" },
    },
    {
      id: "health",
      header: t("onlineEvals.job.columns.health"),
      // Sorts worst-first when descending: waiting > degraded > healthy > idle.
      accessorFn: (row: EvalJob) => HEALTH_SEVERITY[healthOf(row)?.state ?? "none"],
      sortable: true,
      size: 190,
      meta: { align: "left" },
    },
    {
      id: "lastError",
      header: t("onlineEvals.job.columns.lastError"),
      accessorFn: (row: EvalJob) => healthOf(row)?.lastError?.at ?? 0,
      sortable: true,
      size: 200,
      meta: { align: "left" },
    },
    {
      id: "created",
      header: t("onlineEvals.job.columns.created"),
      accessorFn: (row: EvalJob) => rowCreated(row),
      sortable: true,
      size: COL.createdAt,
      meta: { align: "left" },
    },
    {
      id: "actions",
      header: t("onlineEvals.job.columns.actions"),
      sortable: false,
      isAction: true,
      size: 120,
      // Three buttons are always visible: (activate XOR pause) + edit + delete.
      // actionCount drives the computed column width and the loading skeleton;
      // it must match the real button count or the actions crowd together.
      meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
    },
  ].map((c: any) => ({
    ...c,
    // Every column except the row index, the name (row identity) and the
    // actions column is offered in OTable's "Manage columns" chooser.
    hideable: c.id !== "#" && c.id !== "name" && !c.isAction,
  })),
);

const filteredRows = computed(() =>
  statusFilter.value
    ? props.rows.filter((row) => statusOf(row) === statusFilter.value)
    : props.rows,
);

const numberedRows = useNumberedRows(filteredRows);

// Summary strip — colour-coded status counts that double as quick filters
// (syncs with the status dropdown via `statusFilter`).
const statusCounts = computed(() => {
  const rows = props.rows || [];
  let active = 0;
  let paused = 0;
  let draft = 0;
  for (const r of rows) {
    const s = statusOf(r);
    if (s === "active") active += 1;
    else if (s === "paused") paused += 1;
    else if (s === "draft") draft += 1;
  }
  return { active, paused, draft, total: rows.length };
});
// "archived" has no tile: nothing in the UI archives a job, so it would always read zero.
const summaryStats = computed<StatItem[]>(() => {
  const c = statusCounts.value;
  const has = c.total > 0;
  const v = (n: number): string | number => (has ? n : "—");
  const share = has ? c.total : undefined;
  return [
    {
      key: "paused",
      label: t("onlineEvals.jobStatus.paused"),
      value: v(c.paused),
      icon: "pause",
      tone: "warning",
      max: share,
      dataTest: "eval-job-summary-paused",
    },
    {
      key: "active",
      label: t("onlineEvals.jobStatus.active"),
      value: v(c.active),
      icon: "play-arrow",
      tone: "success",
      max: share,
      dataTest: "eval-job-summary-active",
    },
    {
      key: "draft",
      label: t("onlineEvals.jobStatus.draft"),
      value: v(c.draft),
      icon: "draft",
      tone: "neutral",
      max: share,
      dataTest: "eval-job-summary-draft",
    },
    {
      key: "all",
      label: t("onlineEvals.summaryAll"),
      value: v(c.total),
      icon: "format-list-bulleted",
      tone: "primary",
      dataTest: "eval-job-summary-all",
    },
  ];
});
// Nothing is highlighted while viewing all rows (like the Incidents/Alerts strip);
// the "All" tile clears the facet but is never itself the active tile.
const selectedStatKey = computed(() => statusFilter.value);
function onStatSelect(key: string) {
  // Re-clicking the active tile clears the filter (toggle), matching the Alerts strip.
  statusFilter.value = key === "all" || statusFilter.value === key ? null : (key as EvalJobStatus);
}

// Health drives the rail only for active jobs; it never changes the persisted status.
function needsAttention(row: EvalJob): boolean {
  const health = healthOf(row)?.state;
  return (
    statusOf(row) === "active" && (health === "degraded" || health === "waiting_for_credentials")
  );
}

function evalJobRowStyle(row: EvalJob): Record<string, string> {
  const s = statusOf(row);
  const color = needsAttention(row)
    ? "var(--color-orange-500)"
    : s === "active"
      ? "var(--color-success-500)"
      : s === "paused"
        ? "var(--color-warning-500)"
        : "var(--color-grey-400)";
  return { boxShadow: `var(--shadow-rail-geom) ${color}` };
}

// Light exception wash (matches the Alerts list) — jobs needing attention get a
// warm wash, paused a muted grey; healthy/active/draft/archived stay clean so
// attention goes to what's off, not the norm.
function evalJobRowClass(row: EvalJob): string {
  if (needsAttention(row)) return "!bg-status-warning-bg";
  if (statusOf(row) === "paused") return "!bg-surface-panel";
  return "";
}

// Whether the user has narrowed the list with the search box or the status
// dropdown. Drives OEmptyState's `:filtered` so the body switches between
// the first-run preset ("Create your first eval job") and the auto
// "No evaluation jobs match these filters" + Clear-filters card.
const hasFilters = computed(() => !!props.search?.trim() || !!statusFilter.value);

// Wire OEmptyState's action ids back into the existing emit contract.
// `create` mirrors a click on the OPageHeader's "New job" button;
// `clear-filters` resets the search + status filter inline.
function onEmptyAction(id?: string) {
  if (id === "create") emit("create");
  else if (id === "clear-filters") {
    emit("update:search", "");
    statusFilter.value = null;
  }
}

function statusLabel(status: EvalJobStatus) {
  return t(`onlineEvals.jobStatus.${status}`);
}

function scorerCountText(row: EvalJob) {
  const count = (row.scorers || []).length;
  return t("onlineEvals.job.scorerCount", { count });
}

function targetScopeLabel(row: EvalJob) {
  return t(`onlineEvals.job.targetScopes.${targetScopeOf(row)}`);
}

function rowCreated(row: EvalJob) {
  return Number(
    valueOf(row, "createdAt", "created_at") || valueOf(row, "updatedAt", "updated_at") || 0,
  );
}

const HEALTH_SEVERITY: Record<EvalJobHealthState | "none", number> = {
  none: 0,
  no_recent_runs: 1,
  healthy: 2,
  degraded: 3,
  waiting_for_credentials: 4,
};

const HEALTH_LABELS: Record<EvalJobHealthState, I18nKey> = {
  healthy: "onlineEvals.job.health.healthy",
  degraded: "onlineEvals.job.health.degraded",
  waiting_for_credentials: "onlineEvals.job.health.waitingForCredentials",
  no_recent_runs: "onlineEvals.job.health.noRecentRuns",
};

const ERROR_KIND_LABELS: Record<string, I18nKey> = {
  provider_auth: "onlineEvals.job.errorKinds.providerAuth",
  rate_limited: "onlineEvals.job.errorKinds.rateLimited",
  timeout: "onlineEvals.job.errorKinds.timeout",
  provider_5xx: "onlineEvals.job.errorKinds.provider5xx",
  parse_error: "onlineEvals.job.errorKinds.parseError",
  mapping_error: "onlineEvals.job.errorKinds.mappingError",
  scorer_missing: "onlineEvals.job.errorKinds.scorerMissing",
  execution_error: "onlineEvals.job.errorKinds.executionError",
};

function healthOf(row: EvalJob): EvalJobHealth | undefined {
  return row.health ?? undefined;
}

function lastErrorOf(row: EvalJob): EvalJobLastError | undefined {
  return healthOf(row)?.lastError ?? undefined;
}

function healthLabel(row: EvalJob): I18nText {
  const health = healthOf(row);
  return health ? t(HEALTH_LABELS[health.state]) : raw("—");
}

function healthSummary(row: EvalJob): I18nText {
  const health = healthOf(row);
  return t("onlineEvals.job.health.summary", {
    errors: health?.recentErrors ?? 0,
    runs: health?.recentRuns ?? 0,
  });
}

function healthSince(row: EvalJob): I18nText {
  return t("onlineEvals.job.health.since", { time: microsAgo(healthOf(row)?.since) });
}

function healthChecked(row: EvalJob): I18nText {
  return t("onlineEvals.job.health.checked", { time: microsAgo(healthOf(row)?.evaluatedAt) });
}

function microsAgo(micros: number | null | undefined): string {
  return micros ? relativeTime(micros / 1000, t) : "—";
}

/** Known kinds get a translated label; a kind from a newer server shows as-is. */
function lastErrorKind(row: EvalJob): I18nText {
  const kind = lastErrorOf(row)?.kind ?? "";
  const key = ERROR_KIND_LABELS[kind];
  return key ? t(key) : raw(kind);
}

function lastErrorAgo(row: EvalJob): string {
  const at = lastErrorOf(row)?.at;
  // `at` is the span's `_timestamp`, in microseconds.
  return at ? relativeTime(at / 1000, t) : "—";
}

function lastErrorMessage(row: EvalJob): I18nText {
  const error = lastErrorOf(row);
  return raw(error?.message || error?.kind || "");
}

function formatDateShort(value: number) {
  if (!value) return "—";
  return formatDate(value, "YYYY-MM-DD HH:mm:ss");
}

useShortcuts([
  {
    id: "evalJobsRefresh",
    handler: () => {
      if (!isInputFocused()) emit("refresh");
    },
  },
]);
</script>
