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
  Top queries — one row per kind of query, ranked by the time it costs.

  This is the screen the product is judged on, and its layout is governed by one
  budget: the DATA IS THE HERO. At 1440×900 with the full app shell present,
  everything above the first row costs 250px — page header 60, tabs 40, toolbar
  50, coverage 26, insight strip 34 — which leaves room for 14 dense rows. Every
  band on this page is sized against that budget, and anything that wants to
  grow has to take the space from something else rather than from the table.

  The three structural rules that keep it there:

    • A fact appears ONCE. If it is about a single row it is a chip on that row
      (NEW TO THIS LIST, RUNS 15× PER REQUEST); if it spans rows it is one entry
      in the 34px strip. The old build had two tall cards restating row 1.

    • Filters are one horizontal row: search, one "Filters (N)" trigger, and the
      set dimensions as removable chips. Five stacked selects read as a form
      standing in front of the table.

    • Coverage is one quiet line that expands INLINE. No drawer anywhere — a
      drawer covers the rows it is describing.

  Correctness choices that predate this layout and are kept:
    • `stmt_class=query` by default, so COMMIT and connection probes do not
      crowd out real statements. The toggle exposes the rest rather than hiding
      that a filter is applied.
    • The remainder bucket renders as a pinned footer row, so "one query is hot"
      stays distinguishable from "everything is".
    • Server-side sort is offered ONLY on the endpoint's whitelisted keys: an
      unknown key silently falls back server-side, so a column that claimed to
      sort and didn't would be a lie the UI tells by omission.
-->
<template>
  <OPageLayout
    :title="t('dbm.queries.title')"
    :subtitle="t('dbm.queries.subtitle')"
    icon="database"
    title-data-test="dbm-queries-title"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <DbmSectionTabs
        :database-count="databaseCount"
        :query-count="rows.length"
        :activity-count="activityCount"
        :deadlock-count="deadlockCount"
        :blocked-count="blockedCount"
      />
    </template>

    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="range.type"
        :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
        :default-relative-time="range.relativeTimePeriod ?? undefined"
        data-test-name="dbm-queries-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <!-- Blocked queries emit no span until they finish, so a lock storm makes
           QPS FALL — and a falling line reads as recovery at the worst possible
           moment. When volume collapses while failures climb, say so before the
           reader draws the opposite conclusion from the table below. -->
      <OBanner
        v-if="completionBias"
        variant="warning"
        class="shrink-0"
        data-test="dbm-queries-completion-bias"
      >
        <span class="font-medium">
          {{ t("dbm.queries.completionBias.title", { drop: completionBias.dropPercent }) }}
        </span>
        {{ t("dbm.queries.completionBias.body") }}
      </OBanner>

      <OTable
        ref="tableRef"
        :data="tableRows"
        :columns="columns"
        row-key="rowKey"
        :loading="loading"
        :frame="false"
        :error="error"
        sorting="server"
        :sort-by="sortBy"
        sort-order="desc"
        pagination="none"
        :show-global-filter="false"
        :column-visibility="defaultColumnVisibility"
        :persist-columns="true"
        table-id="dbm-queries"
        :enable-column-resize="true"
        :row-class="rowClass"
        custom-pagination-bar
        data-test="dbm-queries-table"
        @update:sort-by="onSortChange"
        @row-click="onRowClick"
      >
        <!-- ONE toolbar row: search, the filter popover, its chips, the
             statement toggle, then the time range pinned right. -->
        <template #toolbar>
          <!-- `min-w-0` + `flex-1` so the chip run absorbs the slack and the
               trailing controls keep their intrinsic width; without it the
               chips push the time range off the row. -->
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <div class="w-64 shrink-0">
              <OSearchInput
                ref="searchRef"
                v-model="search"
                :placeholder="t('dbm.queries.searchPlaceholder')"
                clearable
                :debounce="400"
                data-test="dbm-queries-search"
                @update:model-value="load"
              />
            </div>

            <OToggleGroup
              :model-value="stmtClass"
              class="shrink-0"
              data-test="dbm-queries-stmt-class"
              @update:model-value="onStmtClassChange"
            >
              <!-- Both halves used to read as "everything" ("Queries" / "All
                   statements"), so the distinction was invisible. The second
                   option now names what it ADDS rather than restating the
                   whole, and the tooltips list the actual statements. -->
              <OToggleGroupItem value="query" size="sm">
                {{ t("dbm.queries.stmtClass.query") }}
                <OTooltip side="bottom" :content="t('dbm.queries.stmtClass.queryHint')" />
              </OToggleGroupItem>
              <OToggleGroupItem value="all" size="sm">
                {{ t("dbm.queries.stmtClass.all") }}
                <OTooltip side="bottom" :content="t('dbm.queries.stmtClass.allHint')" />
              </OToggleGroupItem>
            </OToggleGroup>

            <!-- What every Δ and every insight is measured AGAINST (W5). The
                 comparison used to be welded to the preceding window, which
                 made "did this get slower since the deploy?" unanswerable:
                 widening the picker moved the baseline along with it. Each
                 rule line names the choice, so a number can always be traced
                 to the comparison that produced it. -->
            <OToggleGroup
              :model-value="baseline"
              class="shrink-0"
              data-test="dbm-queries-baseline"
              @update:model-value="onBaselineChange"
            >
              <OToggleGroupItem value="previous" size="sm">
                {{ t("dbm.insights.baseline.previousShort") }}
                <OTooltip side="bottom" :content="t('dbm.insights.baseline.previousHint')" />
              </OToggleGroupItem>
              <OToggleGroupItem value="yesterday" size="sm">
                {{ t("dbm.insights.baseline.yesterdayShort") }}
                <OTooltip side="bottom" :content="t('dbm.insights.baseline.yesterdayHint')" />
              </OToggleGroupItem>
            </OToggleGroup>

            <DbmScopeFilters
              class="min-w-0 flex-1"
              :filters="dimensionFilters"
              :insight-chip="activeInsightChip"
              @clear="clearScope"
              @clear-insight="activeInsightId = null"
            />
          </div>
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            class="shrink-0"
            data-test="dbm-queries-refresh"
            @click="load"
          >
            <OTooltip side="bottom" :content="t('dbm.common.reload')" />
          </OButton>
        </template>

        <!-- Coverage, then the cross-row framing. Both inside the table frame
             because both are claims about exactly these rows. -->
        <template #subheader>
          <!-- The totals that used to be crammed into the page subtitle. They
               summarise exactly the rows below, so they belong inside the table
               frame rather than in the header. -->
          <div
            class="px-page-edge border-table-row-divider border-b py-1.5"
            data-test="dbm-queries-summary"
          >
            <OStatStrip :items="summaryStats" :loading="loading" />
          </div>
          <DbmCoverageLine
            :freshness="freshness"
            :hits="rows"
            :other="other"
            :top-n-subset="topNSubset"
            :error-count="errorCount"
            :filter-label="narrowingFilterLabel"
            data-test="dbm-queries-coverage"
          />
          <DbmInsightStrip
            v-if="!insightsHidden && stripInsights.length"
            :insights="stripInsights"
            :active-id="activeInsightId"
            :baseline="baseline"
            data-test="dbm-queries-insights"
            @filter="toggleInsightFilter"
            @dismiss-all="insightsHidden = true"
          />
        </template>

        <!-- The statement, what ran it, and the facts that are about THIS row. -->
        <template #cell-query="{ row }">
          <!-- The fold: a control, worded so it cannot be mistaken for the
               remainder row below it. This one says how many queries it holds
               and opens them in place; the remainder says it has no per-query
               detail to open. -->
          <div
            v-if="row.isFold"
            class="flex min-w-0 items-center gap-1.5"
            data-test="dbm-queries-fold-row"
          >
            <OIcon
              :name="tailExpanded ? 'expand-less' : 'expand-more'"
              class="text-text-secondary size-4 shrink-0"
            />
            <span class="text-text-body text-xs font-medium">
              {{ t("dbm.queries.foldRowText", { count: row.foldCount ?? 0 }) }}
            </span>
            <span class="text-text-label text-3xs truncate">
              {{
                tailExpanded
                  ? t("dbm.queries.foldRowDetailOpen", { share: formatPercent(row.share, 0) })
                  : t("dbm.queries.foldRowDetail", { share: formatPercent(row.share, 0) })
              }}
            </span>
          </div>
          <div v-else class="flex min-w-0 flex-col gap-px">
            <span
              class="truncate font-mono text-xs"
              :class="[
                row.isOther ? 'text-text-secondary italic' : 'text-text-code',
                row.isTail ? 'pl-4' : '',
              ]"
              :title="row.queryText"
            >
              {{ row.queryPreview }}
            </span>
            <div
              v-if="!row.isOther"
              class="text-text-label text-3xs flex min-w-0 items-center gap-1 truncate"
              :class="row.isTail ? 'pl-4' : ''"
            >
              <OTag type="dbSystem" :value="row.db_system" size="xs" />
              <span class="opacity-45">·</span>
              <span class="text-text-secondary font-medium">{{ row.serviceLabel }}</span>
              <template v-if="row.db_instance">
                <span class="opacity-45">·</span>
                <span>{{ row.db_instance }}</span>
              </template>
              <DbmRowChips :chips="chipsByFingerprint.get(row.fingerprint) ?? []" />
            </div>
            <!-- Every remainder states its own call count; only the first
                 explains what a remainder is, because three copies of the same
                 sentence is what made this block unreadable. -->
            <span v-else class="text-text-label text-3xs">
              {{
                row.otherRowExplained
                  ? t("dbm.queries.otherRowDetail", { calls: formatCount(row.calls) })
                  : t("dbm.queries.otherRowDetailShort", { calls: formatCount(row.calls) })
              }}
            </span>
          </div>
        </template>

        <!-- Calls, with how that moved. Two facts about the same quantity, so
             they stack rather than occupying two columns. -->
        <template #cell-calls="{ row }">
          <div class="flex flex-col items-end leading-tight">
            <!-- The fold's own numbers are muted: it is a control, and a bold
                 call count on it competes with the queries either side for the
                 same "how big is this?" read. The share it carries is stated in
                 words on the row itself. -->
            <span
              class="font-mono text-xs tabular-nums"
              :class="row.isFold ? 'text-text-muted' : 'text-text-body'"
            >
              {{ formatCount(row.calls) }}
            </span>
            <DbmDeltaCell
              v-if="!row.isOther && !row.isFold"
              :delta="row.callsDelta"
              variant="words"
              data-test="dbm-queries-calls-delta"
            />
          </div>
        </template>

        <!-- The slow tail, and what it was before. p95 is NOT the typical
             call: it is the 1-in-20 worst, which is the number a user feels
             when they say the app is slow. -->
        <template #cell-p95_ns="{ row }">
          <div v-if="!row.isOther && !row.isFold" class="flex flex-col items-end leading-tight">
            <span class="text-text-heading text-compact font-mono font-medium tabular-nums">
              {{ formatNs(row.p95_ns) }}
            </span>
            <DbmDeltaCell
              :delta="row.latencyDelta"
              variant="was"
              :previous-label="formatNs(row.latencyDelta.previous)"
              data-test="dbm-queries-latency-delta"
            />
          </div>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <!-- p99 and "worst seen" are hidden by default, which is exactly why
             they shipped unformatted: without a cell template OTable prints the
             raw accessor value, so these read as bare nanosecond integers
             (6008549895) until someone turned the columns on. Any ns column
             needs its own template — the formatter is not automatic. -->
        <template #cell-p99_ns="{ row }">
          <span
            v-if="!row.isOther && !row.isFold"
            class="text-text-heading text-compact font-mono font-medium tabular-nums"
          >
            {{ formatNs(row.p99_ns) }}
          </span>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <template #cell-max_ns="{ row }">
          <span
            v-if="!row.isOther && !row.isFold"
            class="text-text-heading text-compact font-mono font-medium tabular-nums"
          >
            {{ formatNs(row.max_ns) }}
          </span>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <!-- A count, never a category word. "all" read as a label rather than a
             quantity, and on the row it appeared on the chip was ALREADY
             shouting ALL 769 FAILED — so the column restated the chip's
             claim in worse words while dropping the number. The column now
             carries the fact (769) and the chip carries the reason; "none"
             stays, because there the reader's question really is yes/no. -->
        <template #cell-errors="{ row }">
          <!-- The fold aggregates rows that each have their own failure count,
               so a single "none" across all 28 would be a claim we cannot make
               from the collapsed row. It shows nothing until expanded. -->
          <span v-if="!row.isFold" class="font-mono text-xs tabular-nums" :class="errorClass(row)">
            {{ errorLabel(row) }}
          </span>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <!-- Suppressed at 1×, which is eleven rows in sixteen on real data. A
             column of identical values is a column that costs width and answers
             nothing; the reader is scanning for the row that ISN'T 1×, and a
             dash makes that row the only ink in the column. -->
        <template #cell-perTrace="{ row }">
          <span
            v-if="showsPerRequest(row.callsPerTrace)"
            class="font-mono text-xs tabular-nums"
            :class="row.looping ? 'text-status-warning-text font-semibold' : 'text-text-body'"
          >
            {{ formatMultiplier(row.callsPerTrace) }}
          </span>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <!-- Time, share and trend in ONE cell: three facts about the same
             quantity, so the comparison is pre-made rather than reassembled
             per row by the reader. -->
        <template #cell-total_time_ns="{ row }">
          <DbmLoadCell
            :total-time-ns="row.total_time_ns"
            :share="row.share"
            :flagged="row.flagged"
            :critical="row.critical"
            data-test="dbm-queries-load"
          />
        </template>

        <template #cell-actions="{ row }">
          <DbmRowActions
            v-if="!row.isOther && !row.isFold"
            :actions="rowActions"
            data-test="dbm-queries-row-actions"
            @action="(id) => onRowAction(id, row)"
          />
        </template>

        <template #cell-services="{ row }">
          <DbmServiceList :services="row.services" data-test="dbm-queries-service" />
        </template>

        <!-- The status bar replaces the pagination controls: with every row
             loaded there are no pages, and the space is better spent on the
             keyboard paths. The totals live in the stat strip above. -->
        <template #bottom>
          <div
            class="border-border-default bg-surface-panel text-text-secondary text-2xs px-page-edge flex h-7.5 items-center gap-2.5 border-t"
            data-test="dbm-queries-status-bar"
          >
            <div class="flex-1"></div>
            <div class="flex flex-wrap items-center gap-3">
              <span
                v-for="hint in keyboardHints"
                :key="hint.key"
                class="inline-flex items-center gap-1"
              >
                <kbd
                  class="border-border-default bg-surface-base text-text-label rounded-default min-w-4 border px-1 text-center font-mono"
                  >{{ hint.key }}</kbd
                >
                {{ hint.label }}
              </span>
            </div>
          </div>
        </template>

        <template #empty>
          <DbmEmptyState
            v-if="!loading"
            :permission-ok="permissionOk"
            :enabled="dbmEnabled"
            :never-aggregated="neverAggregated"
            :org="org"
            :filtered="isFiltered"
            @action="onEmptyAction"
          />
        </template>
      </OTable>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmCoverageLine from "@/components/dbm/DbmCoverageLine.vue";
import DbmDeltaCell from "@/components/dbm/DbmDeltaCell.vue";
import DbmEmptyState, { type DbmEmptyCauseId } from "@/components/dbm/DbmEmptyState.vue";
import { dbmEmptyAction, DBM_SETUP_ROUTE } from "@/utils/dbm/emptyAction";
import { copyToClipboard } from "@/utils/clipboard";
import DbmInsightStrip from "@/components/dbm/DbmInsightStrip.vue";
import DbmLoadCell from "@/components/dbm/DbmLoadCell.vue";
import DbmRowActions, { type DbmRowAction } from "@/components/dbm/DbmRowActions.vue";
import DbmRowChips, { type DbmRowChip } from "@/components/dbm/DbmRowChips.vue";
import DbmServiceList from "@/components/dbm/DbmServiceList.vue";
import DbmScopeFilters, { type DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import DbmSectionTabs from "@/components/dbm/DbmSectionTabs.vue";
import DateTime from "@/components/DateTime.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, {
  type ActivityStateBucket,
  type Freshness,
  type QueryStatsRow,
  type QuerySortKey,
} from "@/services/db_monitoring";
import config from "@/aws-exports";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDbmRequestSeq } from "@/composables/dbm/useDbmRequestSeq";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import {
  contextRegistry,
  createDbmContextProvider,
  DBM_CONTEXT_KEY,
} from "@/composables/contextProviders";
import { buildQueryFixPrompt } from "@/utils/dbm/aiPrompts";
import { buildDbmPrefill } from "@/utils/alerts/prefill/fromDbm";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import {
  discriminatingPart,
  failedCellKind,
  formatCount,
  formatMultiplier,
  formatNs,
  formatPercent,
  oneLine,
  showsPerRequest,
} from "@/utils/dbm/format";
import { activitySampleTotal } from "@/utils/dbm/activity";
import {
  callsDropPercent,
  detectCompletionBias,
  detectInsights,
  indexByKey,
  insightRuleText,
  latencyDelta,
  rowKey,
  splitLongTail,
  sumTotalTime,
  totalTimeDelta,
  callsDelta as computeCallsDelta,
  DBM_INSIGHT_RULES,
  type DbmDelta,
  type DbmInsight,
  type DbmInsightId,
} from "@/utils/dbm/insights";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

// This page is a route root, so MainLayout's `@sendToAiChat` binding is on it
// directly — no re-emit chain needed.
const emit = defineEmits<{
  (e: "sendToAiChat", value: { query: string; autoSend: boolean }): void;
}>();

const aiEnabled = computed(
  () => config.isEnterprise == "true" && Boolean(store.state.zoConfig?.ai_enabled),
);

// The window arrives from the URL, so a tab switch, a back button and a shared
// link all land on the SAME scope rather than resetting to the default.
const { range, current, baseline, baselineWindow, setBaseline, refresh, setRange, queryParams } =
  useDbmScope(route.query);

// Search, five filters, sort, the picker and refresh can all be in flight at
// once; this is what keeps the last one the reader asked for the one that wins.
const requestSeq = useDbmRequestSeq();

const rows = ref<QueryRow[]>([]);
const other = ref<QueryStatsRow[]>([]);
const freshness = ref<Freshness | null>(null);
const topNSubset = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const permissionOk = ref(true);
const neverAggregated = ref(false);
/**
 * Set when this window's calls collapsed while its failures rose — the shape a
 * lock storm makes in data that can only count queries that FINISHED. `null`
 * when the pattern is absent, so the banner is `v-if`-gated on the detector
 * rather than on a page state that merely looks quiet.
 */
const completionBias = ref<{ dropPercent: number } | null>(null);
const databaseCount = ref<number | null>(null);
const deadlockCount = ref<number | null>(null);
const blockedCount = ref<number | null>(null);
/** `null` until read, and again if the read fails — so the badge stays bare. */
const activityStates = ref<ActivityStateBucket[] | null>(null);
/** Sessions in the window. See `activitySampleTotal` for why not `hits.length`. */
const activityCount = computed(() => activitySampleTotal(activityStates.value));

const search = ref("");
const searchRef = ref<InstanceType<typeof OSearchInput> | null>(null);
/**
 * Only the two things this page asks of the table. `InstanceType<typeof OTable>`
 * does not type-check — OTable is a generic component, so its instance type has
 * no construct signature to instantiate.
 */
const tableRef = ref<{ scrollToTop?: () => void; $el?: HTMLElement } | null>(null);
const stmtClass = ref<string>("query");
const sortBy = ref<QuerySortKey>("total_time_ns");

/** Scope carried in from the Databases tab, when the user drilled in. */
const systemFilter = ref<string | null>((route.query.system as string) ?? null);
const instanceFilter = ref<string | null>((route.query.instance as string) ?? null);
const namespaceFilter = ref<string | null>((route.query.namespace as string) ?? null);
const envFilter = ref<string | null>((route.query.env as string) ?? null);
const serviceFilter = ref<string | null>((route.query.service as string) ?? null);

const insights = ref<DbmInsight[]>([]);
const insightsHidden = ref(false);
const activeInsightId = ref<DbmInsightId | null>(null);

const org = computed(() => store.state.selectedOrganization?.identifier as string);
const dbmEnabled = computed(() => Boolean(store.state.zoConfig?.database_monitoring_enabled));

interface QueryRow extends QueryStatsRow {
  rowKey: string;
  queryText: string;
  /** FROM-anchored preview — what actually tells two statements apart. */
  queryPreview: string;
  serviceLabel: string;
  share: number;
  /** Window-over-window change in the time this query costs. */
  delta: DbmDelta;
  /** ...in how often it ran. */
  callsDelta: DbmDelta;
  /** ...in how slow its slow tail is. */
  latencyDelta: DbmDelta;
  callsPerTrace: number | null;
  looping: boolean;
  /** An insight named this row, so its trend line takes a tone. */
  flagged: boolean;
  /** Every call failed — the row earns a red rail. */
  critical: boolean;
  isOther: boolean;
  /** The remainder row that carries the "what is this?" sentence — the first. */
  otherRowExplained?: boolean;
  /** The expandable stand-in for the folded long tail. */
  isFold?: boolean;
  /** How many queries that fold row holds. */
  foldCount?: number;
  /** A tail row revealed by expanding the fold — indented to show it belongs. */
  isTail?: boolean;
}

/** Calls across the ranked rows AND the remainder bucket, so it matches the time. */
const totalCalls = computed(() =>
  [...rows.value, ...other.value].reduce((acc, row) => acc + (row.calls ?? 0), 0),
);

/**
 * The window's totals, over the rows below. Read-only: none of these four is a
 * facet the table can filter to, so making them clickable would promise a
 * behaviour the page does not have.
 */
const summaryStats = computed<StatItem[]>(() => [
  {
    key: "queries",
    label: t("dbm.queries.summary.queries"),
    value: rows.value.length,
    icon: "database",
    tone: "primary",
    dataTest: "dbm-queries-summary-queries",
  },
  {
    key: "calls",
    label: t("dbm.queries.summary.calls"),
    value: formatCount(totalCalls.value),
    icon: "bar-chart",
    tone: "info",
    dataTest: "dbm-queries-summary-calls",
  },
  {
    key: "time",
    label: t("dbm.queries.summary.time"),
    value: formatNs(scopeTotalTime.value),
    icon: "timer",
    tone: "teal",
    dataTest: "dbm-queries-summary-time",
  },
  {
    key: "failed",
    label: t("dbm.queries.summary.failed"),
    value: errorCount.value ? formatCount(errorCount.value) : raw("—"),
    icon: "error-outline",
    tone: errorCount.value ? "error" : "neutral",
    dataTest: "dbm-queries-summary-failed",
  },
]);

/**
 * The keyboard paths, stated on screen rather than hidden in a help dialog.
 * A shortcut nobody knows about is a shortcut nobody uses, and this row costs
 * 30px it shares with the totals.
 */
const keyboardHints = computed(() => [
  { key: raw("/"), label: t("dbm.keys.search") },
  { key: raw("esc"), label: t("dbm.keys.clear") },
]);

const isFiltered = computed(
  () =>
    !!search.value ||
    !!systemFilter.value ||
    !!instanceFilter.value ||
    !!namespaceFilter.value ||
    !!envFilter.value ||
    !!serviceFilter.value ||
    activeInsightId.value !== null,
);

/**
 * A filter that makes the shares describe a SUBSET rather than the database.
 * Only the dimensions that actually narrow below the reconciling grain count:
 * filtering to one service means "31% of database time" is now 31% of that
 * service's slice, which the reader has to be told.
 */
const narrowingFilterLabel = computed<string | null>(
  () => serviceFilter.value ?? envFilter.value ?? null,
);

const optionsFrom = (values: (string | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].map((value) => ({
    value,
    label: raw(value),
  }));

/**
 * Filter dropdowns, built from the values present in the current response, and
 * each carrying the plain-language name of its dimension so a set filter reads
 * as `database: orders-db` rather than a bare value with no subject.
 */
const dimensionFilters = computed<DbmScopeFilter[]>(() => [
  {
    key: "instance",
    dimension: t("dbm.filters.dimension.instance"),
    value: instanceFilter.value,
    placeholder: t("dbm.filters.allInstances"),
    options: optionsFrom(rows.value.map((r) => r.db_instance)),
    onChange: (value) => {
      instanceFilter.value = (value as string) || null;
      load();
    },
  },
  {
    key: "env",
    dimension: t("dbm.filters.dimension.env"),
    value: envFilter.value,
    placeholder: t("dbm.filters.allEnvs"),
    options: optionsFrom(rows.value.flatMap((r) => r.envs ?? [r.env])),
    onChange: (value) => {
      envFilter.value = (value as string) || null;
      load();
    },
  },
  {
    key: "system",
    dimension: t("dbm.filters.dimension.system"),
    value: systemFilter.value,
    placeholder: t("dbm.filters.allEngines"),
    options: optionsFrom(rows.value.map((r) => r.db_system)),
    onChange: (value) => {
      systemFilter.value = (value as string) || null;
      load();
    },
  },
  {
    key: "service",
    dimension: t("dbm.filters.dimension.service"),
    value: serviceFilter.value,
    placeholder: t("dbm.filters.allServices"),
    options: optionsFrom(rows.value.flatMap((r) => r.services ?? [r.service_name])),
    onChange: (value) => {
      serviceFilter.value = (value as string) || null;
      load();
    },
  },
  {
    key: "namespace",
    dimension: t("dbm.filters.dimension.namespace"),
    value: namespaceFilter.value,
    placeholder: t("dbm.filters.allNamespaces"),
    options: optionsFrom(rows.value.flatMap((r) => r.namespaces ?? [r.db_namespace])),
    onChange: (value) => {
      namespaceFilter.value = (value as string) || null;
      load();
    },
  },
]);

/**
 * The active insight, as a toolbar chip. Clicking an insight filters the table
 * IN PLACE, and this chip is what keeps that scope visible and removable — an
 * insight filter that left no trace would be a mode the user cannot see or
 * escape.
 */
const activeInsightChip = computed(() => {
  if (!activeInsightId.value) return null;
  const insight = insights.value.find((i) => i.id === activeInsightId.value);
  if (!insight) return null;
  return {
    dimension: t("dbm.filters.dimension.insight"),
    label: t(`dbm.insights.${insight.id}.title`, insightTitleParams(insight)),
  };
});

const insightTitleParams = (insight: DbmInsight) => ({
  ratio: (insight.evidence.ratio ?? 0).toFixed(0),
  multiplier: Math.round(insight.evidence.callsPerTrace ?? 0),
});

const requestParams = () => ({
  system: systemFilter.value ?? undefined,
  instance: instanceFilter.value ?? undefined,
  namespace: namespaceFilter.value ?? undefined,
  env: envFilter.value ?? undefined,
  service: serviceFilter.value ?? undefined,
  stmtClass: stmtClass.value,
  search: search.value.trim() || undefined,
});

const scopeTotalTime = computed(() => sumTotalTime(rows.value) + sumTotalTime(other.value));

const errorCount = computed(() =>
  [...rows.value, ...other.value].reduce((acc, row) => acc + (row.errors ?? 0), 0),
);

const load = async () => {
  if (!org.value) return;
  const token = requestSeq.begin();
  loading.value = true;
  error.value = null;
  refresh();

  try {
    // The baseline window is fetched with the SAME filters and sort so the two
    // sets are comparable row-for-row; anything else makes the delta a
    // comparison between two different questions. WHICH window it is depends on
    // the reader's baseline choice, and every insight names the one it used.
    const [currentResponse, previousResponse] = await Promise.all([
      dbMonitoringService.getQueries(org.value, {
        ...requestParams(),
        startTime: current.value.startTime,
        endTime: current.value.endTime,
        sort: sortBy.value,
      }),
      dbMonitoringService.getQueries(org.value, {
        ...requestParams(),
        startTime: baselineWindow.value.startTime,
        endTime: baselineWindow.value.endTime,
        sort: sortBy.value,
      }),
    ]);

    // A newer load already owns the page; painting these rows would put the
    // previous window's data under the current window's toolbar.
    if (requestSeq.isStale(token)) return;

    const hits = currentResponse.data.hits ?? [];
    const previousHits = previousResponse.data.hits ?? [];
    other.value = currentResponse.data.other ?? [];
    freshness.value = currentResponse.data.freshness;
    topNSubset.value = currentResponse.data.top_n_subset;
    neverAggregated.value = currentResponse.data.freshness?.data_through === 0;
    databaseCount.value = new Set(hits.map((r) => r.db_instance)).size;

    // Shares are measured against the WHOLE scope (shown + remainder), not just
    // what is on screen — otherwise every row's share inflates as the ranking
    // cut bites, and the number silently changes meaning with the filter.
    const scopeTotal = sumTotalTime(hits) + sumTotalTime(other.value);
    const previousScopeTotal =
      sumTotalTime(previousHits) + sumTotalTime(previousResponse.data.other ?? []);

    insights.value = detectInsights({
      rows: hits,
      previousRows: previousHits,
      scopeTotalTimeNs: scopeTotal,
      previousScopeTotalTimeNs: previousScopeTotal,
    });

    // The remainder rows carry real traffic, so both windows include them —
    // measuring the collapse over the ranked rows alone would read a shift in
    // the ranking cut as a drop in volume.
    const currentCalls = [...hits, ...other.value];
    const previousCalls = [...previousHits, ...(previousResponse.data.other ?? [])];
    completionBias.value = detectCompletionBias(currentCalls, previousCalls)
      ? { dropPercent: callsDropPercent(currentCalls, previousCalls) }
      : null;

    const flagged = new Set(insights.value.flatMap((insight) => insight.fingerprints));
    const previousIndex = indexByKey(previousHits);

    rows.value = hits.map((row) => {
      const traces = row.traces ?? 0;
      const calls = row.calls ?? 0;
      const text = oneLine(row.query_norm) || row.fingerprint;
      const perTrace = traces > 0 ? calls / traces : null;
      const previousRow = previousIndex.get(rowKey(row));
      return {
        ...row,
        rowKey: rowKey(row),
        queryText: text,
        queryPreview: discriminatingPart(text) || text,
        serviceLabel: row.service_name ?? row.services?.[0] ?? "",
        share: scopeTotal > 0 ? (row.total_time_ns ?? 0) / scopeTotal : 0,
        delta: totalTimeDelta(row, previousRow),
        callsDelta: computeCallsDelta(row, previousRow),
        latencyDelta: latencyDelta(row, previousRow),
        callsPerTrace: perTrace,
        // Same rule the N+1 insight uses, so the row tint and the chip that
        // explains it can never disagree.
        looping: (perTrace ?? 0) >= DBM_INSIGHT_RULES.nPlusOne.minCallsPerTrace,
        flagged: flagged.has(row.fingerprint),
        critical: calls > 0 && (row.errors ?? 0) >= calls,
        isOther: false,
      };
    });
  } catch (err: unknown) {
    // A superseded request's failure is not this page's failure — surfacing it
    // would blank a table the newer load is about to fill.
    if (requestSeq.isStale(token)) return;
    const status = (err as { response?: { status?: number } })?.response?.status;
    permissionOk.value = status !== 403;
    if (permissionOk.value) {
      error.value =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        t("dbm.common.loadFailed");
    }
    rows.value = [];
    other.value = [];
    // A failed load says nothing about completion bias; leaving the banner up
    // would attach the last window's claim to a table that is now empty.
    completionBias.value = null;
  } finally {
    // Only the load that still owns the page may clear the spinner; an older
    // one doing it would report "done" while the current fetch is in flight.
    if (!requestSeq.isStale(token)) {
      loading.value = false;
      // A reload replaces the ranking, so the offset the user was parked at now
      // points at a different query. Worse, the insight strip is a claim about
      // rank ("moved to #1") that the reader cannot check while #1 is scrolled
      // off — so every load lands on row 1 and the strip's subject is on screen.
      await nextTick();
      tableRef.value?.scrollToTop?.();
    }
  }
  if (requestSeq.isStale(token)) return;
  void loadLockCounts();
};

/**
 * Counts for the other tabs' badges. Every DBM page fills in all of them so the
 * tab bar reads the same everywhere — a badge that appears on one tab and
 * vanishes on the next reads as "no data", not "not fetched here".
 */
const loadLockCounts = async () => {
  if (!org.value) return;
  const window = {
    startTime: current.value.startTime,
    endTime: current.value.endTime,
  };
  try {
    const { data } = await dbMonitoringService.getDeadlocks(org.value, window);
    deadlockCount.value = data.total ?? data.hits?.length ?? 0;
  } catch {
    // A blank badge is the honest rendering when we could not count.
    deadlockCount.value = null;
  }
  try {
    const { data } = await dbMonitoringService.getBlocking(org.value, window);
    blockedCount.value = data.total ?? data.hits?.length ?? 0;
  } catch {
    blockedCount.value = null;
  }
  try {
    const { data } = await dbMonitoringService.getActivity(org.value, window);
    // The STATE BREAKDOWN, never `total`/`hits.length`: those are a row-limited
    // sample of sessions and would render a constant cap as the population.
    activityStates.value = data.by_state ?? [];
  } catch {
    activityStates.value = null;
  }
};

/**
 * The row an insight was just traced to, held only long enough to find it.
 *
 * An insight that names a row the reader cannot see is a dead end, and on a
 * ranked table "the heaviest query" can genuinely be off-screen — sorted first
 * but scrolled past. So a strip entry is a JUMP: it scrolls its row into view
 * and marks it for a beat, which answers "which one?" without changing what the
 * table is showing. Filtering would have answered a different question (show me
 * only this) and cost the reader the ranking they were reading.
 */
const revealedFingerprint = ref<string | null>(null);
let revealTimer: ReturnType<typeof setTimeout> | null = null;

const REVEAL_MS = 2400;

const revealRow = async (fingerprint: string) => {
  // The row may be behind the fold; opening it first is what makes the jump
  // land rather than silently scrolling to nothing.
  if (tailSplit.value.tail.some((row) => row.fingerprint === fingerprint)) {
    tailExpanded.value = true;
  }
  revealedFingerprint.value = fingerprint;
  await nextTick();

  const index = tableRows.value.findIndex((row) => row.fingerprint === fingerprint);
  if (index >= 0) {
    const el = tableRef.value?.$el?.querySelector?.(`[data-test="o2-table-row-${index}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }

  if (revealTimer) clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    revealedFingerprint.value = null;
  }, REVEAL_MS);
};

/**
 * The no-duplication rule, as a PARTITION rather than a filter.
 *
 * Every insight is rendered exactly once, and which surface it lands on is
 * decided by whether the reader can act on it from where they already are:
 *
 *   • A row inside the visible window can carry its own chip — the claim sits
 *     on the thing it is about and costs the table no vertical space.
 *   • An insight about a row BELOW the fold, or about several rows at once,
 *     cannot be seen by scanning. That one earns the strip, because the strip
 *     is the only way the reader learns it exists without scrolling.
 *
 * The first cut of this sent every single-row insight to a chip, which was
 * correct about duplication and wrong about discovery: on real data every rule
 * fired on exactly one row, so the strip never rendered at all and a finding
 * about row 28 was invisible until the user happened to scroll past it.
 *
 * `stripFingerprints` is what the chip builder consults, so the two surfaces
 * are guaranteed to be disjoint by construction rather than by two predicates
 * that could drift apart.
 *
 * "Visible" asks the FOLD, not a row-count constant. It used to be a fixed
 * fourteen, which was a second copy of an assumption the fold already owns — so
 * once the fold started cutting at six, a single-row insight about row 9 was
 * being called visible and demoted to a chip on a row nobody could see.
 */
const headFingerprints = computed(
  () => new Set(tailSplit.value.head.map((row) => row.fingerprint)),
);

const stripInsights = computed(() =>
  insights.value.filter((insight) => {
    if (insight.evidence.count > 1) return true;
    const fingerprint = insight.fingerprints[0];
    // Behind the fold (or not found at all): the strip is the only way in.
    return !fingerprint || !headFingerprints.value.has(fingerprint);
  }),
);

const stripFingerprints = computed(
  () => new Set(stripInsights.value.flatMap((insight) => insight.fingerprints)),
);

const CHIP_TONES: Record<DbmInsightId, DbmRowChip["tone"]> = {
  "all-failing": "error",
  regression: "warning",
  "n-plus-one": "warning",
  "new-expensive": "new",
  "volume-shift": "info",
  "rank-churn": "new",
};

/**
 * Chips, keyed by query. Derived rather than baked into the row at load time,
 * because the partition depends on where a row LANDS once sorted — which is not
 * known while the rows are still being built. Anything the strip took is
 * excluded here, so no fact is stated twice.
 */
const chipsByFingerprint = computed(() => {
  const map = new Map<string, DbmRowChip[]>();
  for (const insight of insights.value) {
    if (insight.evidence.count !== 1) continue;
    const fingerprint = insight.fingerprints[0];
    if (!fingerprint || stripFingerprints.value.has(fingerprint)) continue;
    const chip: DbmRowChip = {
      id: insight.id,
      label: chipLabel(insight),
      tone: CHIP_TONES[insight.id],
      // Through the shared resolver so the chip's rule names the SAME baseline
      // the strip's does — two copies of this step is how one of them loses it.
      rule: raw(
        insightRuleText(insight.id, baseline.value, (key, params) =>
          t(key as Parameters<typeof t>[0], params ?? {}),
        ),
      ),
    };
    map.set(fingerprint, [...(map.get(fingerprint) ?? []), chip]);
  }
  return map;
});

/** The row chip's shouted phrase, each carrying its own arithmetic. */
const chipLabel = (insight: DbmInsight): I18nText => {
  const e = insight.evidence;
  switch (insight.id) {
    case "all-failing":
      return t("dbm.rowChips.allFailed", { count: formatCount(e.current) });
    case "regression":
      return t("dbm.rowChips.slower", { ratio: (e.ratio ?? 0).toFixed(0) });
    case "n-plus-one":
      return t("dbm.rowChips.loop", { multiplier: Math.round(e.callsPerTrace ?? 0) });
    case "new-expensive":
      return t("dbm.rowChips.new");
    case "volume-shift":
      return t("dbm.rowChips.busier");
    case "rank-churn":
      return t("dbm.rowChips.climbed");
  }
};

/**
 * Whether the tail is expanded. Collapsed on load, and deliberately NOT
 * persisted: the fold is a property of the current data shape, and a user who
 * expanded it once on a quiet fleet should not have it pre-expanded during an
 * incident when the head is what matters.
 */
const tailExpanded = ref(false);

/**
 * The fold, computed over the ranked rows.
 *
 * Only applies when the table is actually ranked by time — the cut is a
 * cumulative-share test, which means nothing once the user has sorted by calls
 * or by the slow tail. Sorting by anything else shows every row, which is the
 * honest answer: the user asked for a different ranking, so "the tail" is no
 * longer the bottom of the list.
 *
 * Rows an insight named are protected, so a 0.2% query that is failing every
 * call keeps its own line and its chip. The split also reads each row's own
 * failures, per-request count and trend, so a small row carrying any of those
 * signals stays listed even when no insight rule fired on it.
 */
const tailSplit = computed(() => {
  if (sortBy.value !== "total_time_ns") {
    return { head: rows.value, tail: [] as QueryRow[], tailShare: 0 };
  }
  const protectedFingerprints = new Set(insights.value.flatMap((insight) => insight.fingerprints));
  const candidates = rows.value.map((row) => ({ ...row, deltaRatio: row.delta.ratio }));
  return splitLongTail(candidates, protectedFingerprints);
});

/**
 * The head, the fold row, and — when expanded — the tail behind it.
 *
 * The fold row is a CONTROL, not a bucket, and that is the distinction the copy
 * has to carry. It stands for queries we have full per-query numbers for and
 * chose not to spend a line on; "All other queries" below it stands for traffic
 * we have no per-query numbers for at all. Those are different kinds of
 * not-shown, and a reader who conflates them will think expanding the fold
 * should reveal the remainder too. So the fold row is expandable and says how
 * many queries it holds, while the remainder row stays flat and says it is
 * spread across queries too light to list — one is a drawer, the other is a
 * total.
 */
const foldedRows = computed<QueryRow[]>(() => {
  const { head, tail, tailShare } = tailSplit.value;
  if (!tail.length) return head;

  const foldRow: QueryRow = {
    ...tail[0],
    rowKey: "dbm-tail-fold",
    queryText: "",
    queryPreview: "",
    serviceLabel: "",
    calls: tail.reduce((acc, row) => acc + (row.calls ?? 0), 0),
    errors: tail.reduce((acc, row) => acc + (row.errors ?? 0), 0),
    total_time_ns: tail.reduce((acc, row) => acc + (row.total_time_ns ?? 0), 0),
    share: tailShare,
    delta: { state: "new" },
    callsDelta: { state: "new" },
    latencyDelta: { state: "new" },
    callsPerTrace: null,
    looping: false,
    flagged: false,
    critical: false,
    isOther: false,
    isFold: true,
    foldCount: tail.length,
  };

  // Revealed rows are indented under the fold, so an expanded tail reads as
  // belonging to the row that opened it rather than as ten new peers of row 1.
  return tailExpanded.value
    ? [...head, foldRow, ...tail.map((row) => ({ ...row, isTail: true }))]
    : [...head, foldRow];
});

/**
 * Rows as rendered: insight filter applied, the long tail folded, then the
 * remainder pinned to the end. The remainder is what makes the totals
 * reconcile, so it belongs in the table rather than in a footnote — but it is
 * never sorted among real rows, because it is a bucket, not a query.
 *
 * The backend emits ONE remainder per (engine, instance), so a fleet of three
 * databases produces three of them. They shipped all labelled "All other
 * queries", which stacked three identical rows carrying different counts and
 * left no way to tell which database each belonged to. Each now names its own
 * database, and the sentence explaining what a remainder IS appears on the
 * first one only — repeating it three times is what made the block unreadable.
 */
/** Names the database a remainder belongs to, so three of them stay tellable apart. */
const otherRowLabel = (row: QueryStatsRow): string =>
  t("dbm.queries.otherRowTextFor", { database: row.db_instance || row.db_system });

const tableRows = computed<QueryRow[]>(() => {
  const active = activeInsightId.value
    ? insights.value.find((i) => i.id === activeInsightId.value)
    : null;
  // An insight filter is already a narrowing, so nothing folds inside it: the
  // user asked for exactly these rows and hiding some would answer a different
  // question than the one they clicked.
  const base = active
    ? rows.value.filter((row) => active.fingerprints.includes(row.fingerprint))
    : foldedRows.value;

  // The remainder is suppressed while filtering: it does not reconcile a subset.
  if (active || !other.value.length) return base;

  const scopeTotal = scopeTotalTime.value;
  const remainder = other.value.map<QueryRow>((row, index) => ({
    ...row,
    rowKey: `other-${row.db_system}-${row.db_instance}`,
    queryText: otherRowLabel(row),
    queryPreview: otherRowLabel(row),
    // Only the first carries the explanation; the rest are the same fact about
    // a different database and do not need it restated.
    otherRowExplained: index === 0,
    serviceLabel: "",
    share: scopeTotal > 0 ? (row.total_time_ns ?? 0) / scopeTotal : 0,
    delta: { state: "new" },
    callsDelta: { state: "new" },
    latencyDelta: { state: "new" },
    callsPerTrace: null,
    looping: false,
    flagged: false,
    critical: false,
    isOther: true,
  }));
  return [...base, ...remainder];
});

/**
 * Only two row tints, and neither washes the row: a left rail. Amber marks a
 * row an insight named; red marks one where every call is failing. The old
 * build tinted every flagged row, and an insight routinely names the four
 * heaviest queries — so most of the visible table came up coloured, which is
 * the "every row coloured signals nothing" failure.
 */
const rowClass = (row: QueryRow) => {
  // The row an insight was just traced to, held for a beat. A tint rather than a
  // third rail colour: the rails mean severity, and "you are looking at this
  // one" is not a severity.
  if (row.fingerprint && row.fingerprint === revealedFingerprint.value) {
    return "!bg-surface-accent-active";
  }
  // The fold sits on the panel tint so it reads as furniture between the ranked
  // rows and the remainder, rather than as another query.
  if (row.isFold) return "!bg-surface-panel";
  if (row.isOther) return "!bg-surface-panel";
  if (row.critical) return "shadow-[inset_0.1875rem_0_0_var(--color-status-error-text)]";
  if (row.flagged) return "shadow-[inset_0.1875rem_0_0_var(--color-status-warning-text)]";
  return "";
};

/**
 * The Failed cell.
 *
 * The total-failure row used to read `all`, which is a category word sitting in
 * a column of numbers — and on the row it fired on, the row chip was already
 * shouting ALL 769 FAILED two inches to the left. So the column stated the
 * chip's claim in vaguer words and threw the count away in the process.
 *
 * Now the column carries the QUANTITY and the chip carries the REASON, which is
 * the split each surface is actually good at: a number is scannable down a
 * column and comparable between rows; "failed" is not. The row keeps its
 * red rail and bold weight, so the total-failure case is still legible without
 * the word.
 *
 * `none` survives because zero is the one value where the reader's question
 * genuinely is yes/no rather than how-many, and "0" in a column of counts reads
 * as a measurement where "none" reads as an all-clear.
 */
const errorLabel = (row: QueryRow): I18nText =>
  failedCellKind(row.errors) === "none"
    ? t("dbm.queries.errorsNone")
    : raw(formatCount(row.errors));

const errorClass = (row: QueryRow) => {
  if ((row.errors ?? 0) <= 0) return "text-text-muted";
  return row.critical ? "text-status-error-text font-bold" : "text-status-error-text";
};

/**
 * A click on the fold toggles it; a click on a real row opens it. The fold is a
 * control that happens to be shaped like a row, so it must not navigate.
 */
const onRowClick = (row: QueryRow) => {
  if (row.isFold) {
    tailExpanded.value = !tailExpanded.value;
    return;
  }
  openQueryDetail(row);
};

/**
 * Clicking an insight: JUMP when it names one row, FILTER when it names several.
 *
 * The two gestures answer different questions and the evidence decides which one
 * the reader is asking. "Which row is this about?" has an exact answer when the
 * count is one, and taking them there is strictly cheaper than narrowing the
 * table to a single row and making them undo it. Past one row there is no single
 * destination, so filtering is the only honest response.
 */
const toggleInsightFilter = (insight: DbmInsight) => {
  if (insight.evidence.count === 1 && insight.fingerprints[0]) {
    revealRow(insight.fingerprints[0]);
    return;
  }
  activeInsightId.value = activeInsightId.value === insight.id ? null : insight.id;
};

/** The four things a reader does next, on the row they are already looking at. */
const rowActions = computed<DbmRowAction[]>(() => [
  { id: "open", icon: "chevron-right", label: t("dbm.queries.actions.open") },
  { id: "traces", icon: "account-tree", label: t("dbm.queries.actions.traces") },
  { id: "copy", icon: "content-copy", label: t("dbm.queries.actions.copy") },
  { id: "alert", icon: "shield", label: t("dbm.queries.actions.alert") },
  // Absent, not disabled, when AI is off — a row of buttons must not carry a
  // permanent dead one.
  ...(aiEnabled.value
    ? [{ id: "ai", icon: "brain-circuit", label: t("dbm.ai.rowSuggestFix") } as DbmRowAction]
    : []),
]);

const onRowAction = async (id: string, row: QueryRow) => {
  if (id === "open" || id === "traces") {
    openQueryDetail(row, id === "traces" ? "samples" : undefined);
    return;
  }
  if (id === "ai") {
    askAiForFix(row);
    return;
  }
  if (id === "copy") {
    // The shared helper both confirms the copy and falls back to execCommand on
    // non-secure origins, where navigator.clipboard is unavailable — the old
    // direct call failed silently there, so the user pasted stale content with
    // nothing to suggest the copy had not happened.
    await copyToClipboard(row.queryText, t, {
      successMessage: t("dbm.queries.actions.copied"),
      errorMessage: t("dbm.queries.actions.copyFailed"),
    });
    return;
  }
  if (id === "alert") {
    // Carry the row across instead of dropping the user on an empty alert list:
    // the action says "alert me if THIS slows", so the query, its database and
    // its observed p95 all have to survive the trip. The confirm dialog then
    // shows the resolved SQL before anything is created.
    requestAlertCreation(
      buildDbmPrefill({
        scope: "query",
        kind: "latency",
        fingerprint: row.fingerprint,
        queryNorm: row.queryText,
        fpVersion: row.fp_version,
        dbSystem: row.db_system,
        dbInstance: row.db_instance,
        p95Ns: row.p95_ns,
      }),
    );
  }
};

/**
 * Columns.
 *
 * `sortable` is set ONLY where the column id is one of the endpoint's
 * whitelisted sort keys. The server falls back to `total_time_ns` on anything
 * else without erroring, so a sortable chevron on a non-whitelisted column
 * would re-order the rows by something other than what the header claims — the
 * exact silent lie the table rules call out.
 *
 * Headers say what the number MEANS: "Slow calls" rather than p95, because a
 * DBA reading p95 has to translate, and everyone else has to guess.
 */
const columns = computed<OTableColumnDef<QueryRow>[]>(() => [
  {
    id: "query",
    header: t("dbm.queries.columns.query"),
    accessorKey: "queryText",
    // The widest column on the page: the statement is what the user is
    // identifying, and at 380 every row truncated inside its SELECT list.
    size: 520,
    sortable: false,
    meta: { isName: true },
  },
  {
    id: "calls",
    header: t("dbm.queries.columns.calls"),
    accessorKey: "calls",
    size: 96,
    sortable: true,
    meta: { align: "right", headerTooltip: t("dbm.queries.columnHints.calls") },
  },
  {
    id: "p95_ns",
    header: t("dbm.queries.columns.p95"),
    accessorKey: "p95_ns",
    size: 104,
    sortable: true,
    meta: {
      align: "right",
      headerSubLabel: raw("p95"),
      headerTooltip: t("dbm.queries.columnHints.p95"),
    },
  },
  {
    id: "errors",
    header: t("dbm.queries.columns.errors"),
    accessorKey: "errors",
    size: 80,
    sortable: true,
    meta: { align: "right", headerTooltip: t("dbm.queries.columnHints.errors") },
  },
  {
    id: "perTrace",
    header: t("dbm.queries.columns.perTrace"),
    size: 88,
    // A derived ratio (calls/requests) — not a stored column, so not sortable.
    sortable: false,
    meta: { align: "right", headerTooltip: t("dbm.queries.columnHints.perTrace") },
  },
  {
    // The id IS the backend sort key, so the cell slot is `#cell-total_time_ns`.
    id: "total_time_ns",
    header: t("dbm.queries.columns.load"),
    accessorKey: "total_time_ns",
    size: 190,
    sortable: true,
    meta: { align: "right", headerTooltip: t("dbm.queries.columnHints.load") },
  },
  {
    id: "actions",
    header: raw(""),
    size: 104,
    sortable: false,
    meta: { align: "right" },
  },
  {
    id: "p99_ns",
    header: t("dbm.queries.columns.p99"),
    accessorKey: "p99_ns",
    size: 95,
    sortable: true,
    hideable: true,
    meta: {
      align: "right",
      headerSubLabel: raw("p99"),
      headerTooltip: t("dbm.queries.columnHints.p99"),
    },
  },
  {
    id: "max_ns",
    header: t("dbm.queries.columns.max"),
    accessorKey: "max_ns",
    size: 95,
    sortable: true,
    hideable: true,
    meta: {
      align: "right",
      headerSubLabel: raw("max"),
      headerTooltip: t("dbm.queries.columnHints.max"),
    },
  },
  {
    id: "services",
    header: t("dbm.queries.columns.services"),
    size: 180,
    // An array column with no server-side ordering.
    sortable: false,
    hideable: true,
  },
]);

/** The extra percentiles are available but off: the mockup's column set is
 *  what fits without horizontal scrolling at 1440. */
const defaultColumnVisibility = { p99_ns: false, max_ns: false, services: false };

/**
 * The table emits the column id; the ids of sortable columns are deliberately
 * spelled as the backend keys, so no mapping table can drift. Anything not on
 * the whitelist is ignored rather than sent.
 */
const SORT_KEYS: QuerySortKey[] = [
  "calls",
  "errors",
  "total_time_ns",
  "p50_ns",
  "p95_ns",
  "p99_ns",
  "max_ns",
  "traces",
  "statements",
];

const onSortChange = (columnId: string) => {
  if (!SORT_KEYS.includes(columnId as QuerySortKey)) return;
  sortBy.value = columnId as QuerySortKey;
  load();
};

/**
 * Drill into one query. The remainder row is a bucket rather than a query, so
 * it has no detail page to open — clicking it does nothing instead of
 * navigating to a page that would render the bucket as a statement.
 *
 * The row's `trace_stream_name` travels along because the detail page's
 * endpoints call 400s without a stream, and its history call silently degrades
 * every unranked window without one. The rest of the scope travels too, so
 * "back" returns to the same filtered table.
 */
const openQueryDetail = (row: QueryRow, tab?: string) => {
  if (row.isOther) return;
  router
    .push({
      name: "dbmQueryDetail",
      query: {
        ...route.query,
        org_identifier: route.query.org_identifier ?? org.value,
        ...queryParams.value,
        fingerprint: row.fingerprint,
        stream: row.trace_stream_name,
        system: row.db_system,
        instance: row.db_instance,
        namespace: row.db_namespace,
        ...(tab ? { tab } : {}),
      },
    })
    .catch(() => {});
};

const onDateChange = (value: DbmDateChange) => {
  setRange(value);
  syncUrl();
  load();
};

/**
 * Change what the window is compared against (W5).
 *
 * A reload is mandatory, not cosmetic: the baseline window IS one of the two
 * fetches, so leaving the old response in place would print deltas and insights
 * against a window the toolbar no longer names.
 */
const onBaselineChange = (value: unknown) => {
  if (value !== "previous" && value !== "yesterday") return;
  setBaseline(value);
  load();
};

const onStmtClassChange = (value: unknown) => {
  if (!value) return;
  stmtClass.value = String(value);
  syncUrl();
  load();
};

/**
 * Drop every refinement at once, from the toolbar's clear affordance.
 *
 * "Clear all" means all: the search box and the active insight are refinements
 * too, and leaving them set while the scope chips disappear left the table
 * looking filtered with nothing on screen explaining why.
 */
const clearScope = () => {
  systemFilter.value = null;
  instanceFilter.value = null;
  namespaceFilter.value = null;
  envFilter.value = null;
  serviceFilter.value = null;
  search.value = "";
  activeInsightId.value = null;
  syncUrl();
  load();
};

/**
 * Mirror the scope into the URL so it survives a tab switch, a reload and a
 * paste into someone else's chat window. Replace rather than push: a filter
 * change is not a navigation the back button should have to walk through.
 */
const syncUrl = () => {
  router
    .replace({
      name: route.name as string,
      query: {
        ...route.query,
        ...queryParams.value,
        system: systemFilter.value ?? undefined,
        instance: instanceFilter.value ?? undefined,
        namespace: namespaceFilter.value ?? undefined,
        env: envFilter.value ?? undefined,
        service: serviceFilter.value ?? undefined,
        // Search, statement class and sort are refinements too: a link that
        // restores the scope chips but drops the search term reopens a
        // different table than the one that was shared.
        search: search.value || undefined,
        stmt_class: stmtClass.value,
        sort: sortBy.value,
      },
    })
    .catch(() => {});
};

/**
 * Every cause resolves to an action — `not-instrumented` is the default on a
 * fresh install, and it used to fall through here and do nothing, which made
 * the most prominent button on an empty page a dead click.
 */
const onEmptyAction = (cause: DbmEmptyCauseId) => {
  switch (dbmEmptyAction(cause)) {
    case "open-setup":
      router.push({
        name: DBM_SETUP_ROUTE,
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      return;
    case "clear-filters":
      // clearScope() drops search and the active insight too.
      clearScope();
      return;
    case "reload":
      load();
      return;
    case "none":
  }
};

/**
 * Keyboard paths for the frequent moves. `/` focuses search from anywhere on
 * the page, which is the one shortcut a dense table cannot do without — the
 * alternative is a mouse trip to the toolbar for every refinement.
 */
const onKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  const typing =
    target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
  if (typing) return;
  if (event.key === "/") {
    event.preventDefault();
    const el = searchRef.value?.$el?.querySelector?.("input") as HTMLInputElement | undefined;
    el?.focus();
    return;
  }
  // Advertised in the hints row, so it has to work. Only acts when something is
  // actually filtered — a hint that appears to do nothing on an unfiltered page
  // reads as broken.
  if (event.key === "Escape" && isFiltered.value) {
    event.preventDefault();
    clearScope();
  }
};

// ─── AI ──────────────────────────────────────────────────────────────────────

/**
 * The row action. Callers are not loaded on this page — the prompt says nothing
 * about them rather than sending an empty list, which a model reads as "nobody
 * calls it".
 */
const askAiForFix = (row: QueryRow) => {
  emit("sendToAiChat", {
    query: buildQueryFixPrompt({
      queryNorm: row.query_norm || row.queryText,
      dbSystem: row.db_system,
      dbInstance: row.db_instance,
      p50Ns: row.p50_ns,
      p95Ns: row.p95_ns,
      p99Ns: row.p99_ns,
      maxNs: row.max_ns,
      totalTimeNs: row.total_time_ns,
      calls: row.calls,
      errors: row.errors,
      callsPerTrace: row.callsPerTrace,
    }),
    autoSend: true,
  });
};

const dbmContext = createDbmContextProvider(
  () => ({
    currentPage: "queries" as const,
    scope: {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      period: range.value.relativeTimePeriod,
      system: systemFilter.value,
      instance: instanceFilter.value,
      namespace: namespaceFilter.value,
      env: envFilter.value,
      service: serviceFilter.value,
    },
  }),
  store,
);

/**
 * Read the scope back out of the URL.
 *
 * The write half alone is not enough: mirroring filters into the query string
 * while ignoring them on arrival means a shared or reloaded link restores the
 * time range but silently drops every other refinement, so the recipient sees
 * a different table than the sender did.
 */
const restoreFromUrl = () => {
  const q = route.query;
  const str = (key: string): string | null => {
    const raw = Array.isArray(q[key]) ? q[key][0] : q[key];
    return typeof raw === "string" && raw !== "" ? raw : null;
  };
  systemFilter.value = str("system");
  instanceFilter.value = str("instance");
  namespaceFilter.value = str("namespace");
  envFilter.value = str("env");
  serviceFilter.value = str("service");
  search.value = str("search") ?? "";
  const cls = str("stmt_class");
  if (cls) stmtClass.value = cls;
  const sort = str("sort");
  if (sort && SORT_KEYS.includes(sort as QuerySortKey)) sortBy.value = sort as QuerySortKey;
};

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  contextRegistry.register(DBM_CONTEXT_KEY, dbmContext);
  contextRegistry.setActive(DBM_CONTEXT_KEY);
  restoreFromUrl();
  load();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  contextRegistry.unregister(DBM_CONTEXT_KEY);
  contextRegistry.setActive("");
  if (revealTimer) clearTimeout(revealTimer);
});
</script>
