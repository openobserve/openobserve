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
  Activity — what the monitored databases are doing right now.

  Three things about this page are honesty requirements rather than polish, and
  each one is a claim the reader would otherwise get wrong:

    • It is SAMPLED, not continuous. The disclosure line states the interval the
      server inferred, and says plainly that a query shorter than the gap
      between two samples can run and finish unseen. Our shipped default is 10s,
      not Datadog's 1 Hz, so no interval is ever assumed — an uninferable one
      degrades to non-numeric copy instead.
    • The sample is already FILTERED by the collector: idle sessions older than
      the newest running query are dropped unless they block someone. So this is
      not a faithful `pg_stat_activity` snapshot and must not read as one.
    • The `hits` are a SAMPLE; the breakdowns are the population. The strip
      counts the SQL aggregate, the table counts what it could read, and a
      capped read says "the N we have" rather than claiming a total.

  Two rendering facts come straight off the live capture. An empty wait event on
  an active backend means it is ON CPU — 36% of active Postgres sessions — so
  that bucket is named rather than left blank. And a duration means opposite
  things by state: still-running for a live session, last-completed for an idle
  one, which is why they occupy two columns and never one.
-->
<template>
  <OPageLayout
    :title="t('dbm.activity.title')"
    :subtitle="t(isLiveWindow ? 'dbm.activity.subtitle' : 'dbm.activity.subtitlePast')"
    icon="database"
    title-data-test="dbm-activity-title"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <!-- The sibling badges come from the shell's one shared fan-out; this
           page's own is counted from the breakdown it already loaded. -->
      <DbmSectionTabs v-bind="tabCounts" />
    </template>

    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="range.type"
        :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
        :default-relative-time="range.relativeTimePeriod ?? undefined"
        data-test-name="dbm-activity-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="rowKey"
        :loading="loading"
        :frame="false"
        :error="error"
        sorting="client"
        :show-global-filter="false"
        table-id="dbm-activity"
        persist-columns
        :column-visibility="defaultColumnVisibility"
        :total-count-exact="!truncated"
        data-test="dbm-activity-table"
        @row-click="onRowClick"
      >
        <template #toolbar>
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <div class="w-64 shrink-0">
              <OSearchInput
                v-model="search"
                :placeholder="t('dbm.activity.searchPlaceholder')"
                clearable
                :debounce="400"
                data-test="dbm-activity-search"
              />
            </div>
          </div>
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            class="shrink-0"
            data-test="dbm-activity-refresh"
            @click="onRefresh"
          >
            <OTooltip side="bottom" :content="t('dbm.common.reload')" />
          </OButton>
        </template>

        <template #subheader>
          <!-- ONE discretionary band above the rows: the state summary doubles
               as the wait-event breakdown's home, so the two summaries cost the
               page a single strip rather than two stacked ones. Always
               rendered — `:loading` draws the skeleton — so arriving data never
               shifts the rows below it. -->
          <div
            class="px-page-edge border-table-row-divider border-b py-1.5"
            data-test="dbm-activity-summary"
          >
            <OStatStrip :items="summaryStats" :loading="loading" />
          </div>

          <!-- The wait-event breakdown, grouped by the ENGINE'S OWN vocabulary.
               A unified cross-engine taxonomy was considered and withdrawn:
               Postgres reports sampled states while MySQL reports timed
               durations, so one shared bucket sums two incomparable things. -->
          <div
            class="px-page-edge border-table-row-divider flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5"
            data-test="dbm-activity-wait-breakdown"
          >
            <span
              v-if="waitStrip.shown.length"
              class="text-text-label text-3xs shrink-0 font-semibold tracking-wide uppercase"
            >
              {{ t("dbm.activity.columns.waitEvent") }}
            </span>
            <span
              v-for="bucket in waitStrip.shown"
              :key="bucket.key"
              class="flex min-w-0 shrink-0 items-center gap-1.5"
              :data-test="`dbm-activity-wait-${bucket.key}`"
            >
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="bucket.onCpu ? 'bg-accent' : 'bg-status-warning-text'"
              ></span>
              <span class="text-text-body text-2xs truncate">{{ bucket.label }}</span>
              <span class="text-text-secondary text-2xs font-mono tabular-nums">
                {{ formatCount(bucket.sessions) }}
              </span>
              <span v-if="bucket.share !== null" class="text-text-label text-3xs font-mono">
                {{ formatPercent(bucket.share, 0) }}
              </span>
            </span>

            <!-- What the strip could not fit. Without it the visible shares
                 simply fail to add up and the reader assumes a broken chart. -->
            <span
              v-if="waitStrip.remainder"
              class="text-text-secondary text-2xs shrink-0"
              data-test="dbm-activity-wait-remainder"
            >
              {{ waitRemainderLabel }}
            </span>

            <div class="flex-1"></div>

            <!-- The honesty requirement, on this band rather than a fourth one:
                 the short form is always visible so the caveat cannot be
                 missed, and the full three sentences ride in the tooltip so
                 they cost the table no rows. -->
            <span
              class="text-text-label text-2xs flex shrink-0 items-center gap-1"
              data-test="dbm-activity-disclosure"
            >
              <OIcon name="info-outline" class="size-3 shrink-0" />
              {{ disclosureSummary }}
              <OTooltip side="bottom" :content="disclosureDetail" />
            </span>
          </div>
        </template>

        <!-- The statement, with the identity of the session under it. -->
        <template #cell-query="{ row }">
          <div class="flex min-w-0 flex-col gap-px">
            <span
              class="text-text-code min-w-0 truncate font-mono text-xs"
              :title="row.query ?? ''"
            >
              {{ raw(row.query ?? "—") }}
            </span>
            <div class="text-text-label text-3xs flex min-w-0 items-center gap-1 truncate">
              <OTag type="dbSystem" :value="row.db_system" size="xs" />
              <template v-if="row.db_instance">
                <span class="opacity-45">·</span>
                <span>{{ raw(row.db_instance) }}</span>
              </template>
              <template v-if="row.transactionAge">
                <span class="opacity-45">·</span>
                <span class="text-status-warning-text">{{ row.transactionAge }}</span>
              </template>
            </div>
          </div>
        </template>

        <template #cell-session="{ row }">
          <span
            class="bg-surface-subtle text-text-heading rounded-default text-2xs px-1.5 py-px font-mono font-semibold"
            data-test="dbm-activity-pid"
          >
            {{ row.session_pid ?? raw("—") }}
          </span>
        </template>

        <template #cell-state="{ row }">
          <span
            class="rounded-default text-2xs px-1.5 py-px font-medium"
            :class="stateTone(row.state)"
            data-test="dbm-activity-state"
          >
            {{ row.stateLabel }}
          </span>
        </template>

        <!-- Never blank: an empty wait event on a live session means the
             backend is on CPU, which is an answer rather than a gap. -->
        <template #cell-waitEvent="{ row }">
          <span
            class="text-xs"
            :class="row.onCpu ? 'text-text-secondary' : 'text-text-body font-mono'"
            data-test="dbm-activity-wait-event"
          >
            {{ row.waitLabel }}
          </span>
        </template>

        <!-- Only rendered when some engine in scope reports locks at all. -->
        <template #cell-blockedBy="{ row }">
          <span
            v-if="row.blockedByLabel"
            class="bg-status-error-bg text-status-error-text rounded-default text-2xs px-1.5 py-px font-mono font-semibold"
            data-test="dbm-activity-blocked-by"
          >
            {{ row.blockedByLabel }}
          </span>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <!-- Two columns, deliberately. "Running 40s and still going" and "the
             last query took 40s" demand opposite responses. -->
        <template #cell-running="{ row }">
          <span
            v-if="row.runningMs !== null"
            class="text-text-heading text-compact font-mono font-semibold tabular-nums"
          >
            {{ formatDurationMs(row.runningMs) }}
          </span>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <template #cell-lastQuery="{ row }">
          <span
            v-if="row.lastQueryMs !== null"
            class="text-text-secondary text-compact font-mono tabular-nums"
          >
            {{ formatDurationMs(row.lastQueryMs) }}
          </span>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <template #cell-user="{ row }">
          <span class="text-text-body block truncate text-xs">{{
            raw(row.session_user ?? "—")
          }}</span>
        </template>

        <template #cell-application="{ row }">
          <span class="text-text-body block truncate font-mono text-xs">
            {{ raw(row.session_app ?? "—") }}
          </span>
        </template>

        <template #bottom>
          <div
            class="text-text-secondary flex w-full items-center gap-2.5"
            data-test="dbm-activity-status-bar"
          >
            <span>{{ countLine }}</span>
          </div>
        </template>

        <template #empty>
          <!-- A search that matched nothing is NOT a healthy idle database.
               Rendering the reassuring state here would tell the reader
               everything is quiet while 100 sampled sessions sit behind their
               own filter. -->
          <OEmptyState
            v-if="!loading && searchHidEverything"
            preset="no-search-results"
            data-test="dbm-activity-no-matches"
            @action="search = ''"
          />
          <!-- "Nothing is running" is good news, but only if something looked.
               The proof is the SQL breakdown: with no buckets at all, nothing
               has ever sampled a session and the reassuring state would be a
               lie. -->
          <DbmLockEmptyState
            v-else-if="!loading && emptyCause === 'not-collecting'"
            :healthy="false"
            :title="t('dbm.activity.notCollecting.title')"
            :description="t('dbm.activity.notCollecting.description')"
            :checklist-title="t('dbm.activity.notCollecting.checklistTitle')"
            :checks="notCollectingChecks"
            data-test="dbm-activity-not-collecting"
          />
          <DbmLockEmptyState
            v-else-if="!loading"
            :healthy="true"
            :title="t('dbm.activity.healthy.title')"
            :description="
              t(
                isLiveWindow
                  ? 'dbm.activity.healthy.description'
                  : 'dbm.activity.healthy.descriptionPast',
              )
            "
            :checklist-title="t('dbm.activity.healthy.checklistTitle')"
            :checks="healthyChecks"
            :collection-healthy-label="t('dbm.activity.healthy.collectionHealthy')"
            data-test="dbm-activity-healthy"
          />
        </template>
      </OTable>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
// Explicit name so <keep-alive :include> in DbmShell.vue matches this view.
// Without it the name is inferred from the FILENAME, so a rename would
// silently drop the page from the cache and bring back the refetch-on-return.
defineOptions({ name: "DbmActivityPage" });

import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmLockEmptyState, { type DbmLockCheck } from "@/components/dbm/DbmLockEmptyState.vue";
import DbmSectionTabs from "@/components/dbm/DbmSectionTabs.vue";
import DateTime from "@/components/DateTime.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, {
  type ActivitySession,
  type ActivityStateBucket,
  type ActivityWaitBucket,
} from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDbmRequestSeq } from "@/composables/dbm/useDbmRequestSeq";
import { setDbmQueryDetailSeed } from "@/composables/dbm/dbmQueryDetailSeed";
import { useDbmTabCountsContext } from "@/composables/dbm/dbmTabCounts";
import { tabCountProps, withOwnCount } from "@/composables/dbm/useDbmTabCounts";
import { useDbmScopeSync } from "@/composables/dbm/useDbmScopeSync";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import {
  activityCountClaim,
  activityDisclosureLines,
  activityEmptyCause,
  activityQueryDetailTarget,
  activitySampleTotal,
  buildActivityRows,
  buildStateSummary,
  buildWaitBreakdown,
  formatDurationMs,
  hasLockData,
  isNotableTransactionAge,
  sampleDisclosure,
  topWaitRows,
  transactionAgeSeconds,
  waitBucketLabel,
  waitBucketLabelParts,
  waitTotals,
} from "@/utils/dbm/activity";
import { claimedCount, formatCount, formatPercent } from "@/utils/dbm/format";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const { range, current, refresh, setRange, queryParams } = useDbmScope(route.query);

// Search, the picker and refresh can all be in flight at once; this keeps the
// last request the reader made the one that paints.
const requestSeq = useDbmRequestSeq();

// The sibling-tab badges are the same numbers on every tab, so DbmShell fetches
// them ONCE per window for every route and this page reads the snapshot.
// See useDbmTabCounts.
const tabCountsContext = useDbmTabCountsContext();

/**
 * Whether the page is describing NOW or a stretch of the past. A relative range
 * always ends at now; an absolute one is a historical window the reader chose,
 * and the present-tense copy would be a lie over it.
 */
const isLiveWindow = computed(() => range.value.type === "relative");

const sessions = ref<ActivitySession[]>([]);
const waitBuckets = ref<ActivityWaitBucket[]>([]);
const stateBuckets = ref<ActivityStateBucket[]>([]);
const truncated = ref(false);
const notCollecting = ref(false);
const logLinesSeen = ref<number | null>(null);
const sampledAt = ref<number | null>(null);
const sampleInterval = ref<number | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const search = ref("");

/**
 * The sibling badges, from the shell's shared fan-out, plus THIS tab's own
 * count in place of the shared one.
 *
 * The override is not cosmetic. `sampleTotal` is derived from the breakdown
 * this page loaded under its own filters and refresh, so it is both fresher
 * than the shared snapshot and the number the rows below actually correspond
 * to.
 */
const tabCounts = computed(() =>
  tabCountProps(withOwnCount(tabCountsContext.counts.value, "activityCount", sampleTotal.value)),
);

/** Read by `notCollectingChecks` to say what else in DBM is answering. */
const queryCount = computed(() => claimedCount(tabCountsContext.counts.value.queryCount));
const databaseCount = computed(() => tabCountsContext.counts.value.databaseCount);

const org = computed(() => store.state.selectedOrganization?.identifier as string);
const dbmEnabled = computed(() => Boolean(store.state.zoConfig?.database_monitoring_enabled));

/**
 * SESSION SAMPLES in the window, from the SQL aggregate. Not a distinct-session
 * count: the aggregate counts one row per session per poll, so this is ~360x a
 * session count on an hour of 10s polling. Every surface that shows it says
 * "samples".
 */
const sampleTotal = computed(() => activitySampleTotal(stateBuckets.value));

const stateRows = computed(() => buildStateSummary(stateBuckets.value));

const waitRows = computed(() =>
  buildWaitBreakdown(waitBuckets.value).map((bucket) => ({
    ...bucket,
    label: waitBucketLabel(bucket, t),
  })),
);

/**
 * The breakdown is a strip, not a table: 40 buckets would be 40 slivers. The
 * tail is collapsed into a stated remainder rather than dropped, because the
 * shares are server-computed over ALL buckets and would otherwise visibly fail
 * to add up.
 */
const TOP_WAIT_BUCKETS = 6;
const waitStrip = computed(() => topWaitRows(waitRows.value, TOP_WAIT_BUCKETS));

const waitRemainderLabel = computed<I18nText | null>(() => {
  const remainder = waitStrip.value.remainder;
  if (!remainder) return null;
  return remainder.share !== null
    ? t("dbm.activity.wait.remainder", {
        count: remainder.buckets,
        share: formatPercent(remainder.share, 0),
      })
    : t("dbm.activity.wait.remainderNoShare", { count: remainder.buckets });
});

const disclosure = computed(() => sampleDisclosure(sampleInterval.value));
const disclosureLines = computed(() => activityDisclosureLines(disclosure.value, t));

/** Always visible, so the caveat cannot be missed at a glance. */
const disclosureSummary = computed<I18nText>(() =>
  disclosure.value.intervalKnown
    ? t("dbm.activity.disclosure.short", { interval: disclosure.value.intervalSeconds ?? 0 })
    : t("dbm.activity.disclosure.shortUnknown"),
);

/** The full three sentences, on hover — they cost the table no rows here. */
const disclosureDetail = computed<I18nText>(() => raw(disclosureLines.value.join(" ")));

const allRows = computed(() =>
  buildActivityRows(sessions.value).map((row) => {
    const age = transactionAgeSeconds(row);
    return {
      ...row,
      waitLabel: waitBucketLabel(waitBucketLabelParts(row.wait_event_type, row.wait_event), t),
      stateLabel: row.state ? raw(row.state) : t("dbm.activity.state.unknown"),
      // `blocking_pids` is the SOLE blocked-ness predicate (E2/E3) — the `{}`
      // sentinel means unblocked, and the server already parsed it to an array.
      blockedByLabel: row.blocked ? raw(row.blocking_pids?.join(", ") ?? "") : null,
      // Only when it is long enough to act on. Every active session is inside
      // some transaction, so flagging them all says nothing.
      transactionAge: isNotableTransactionAge(age)
        ? t("dbm.activity.transactionOpen", { age: formatDurationMs((age as number) * 1000) })
        : null,
    };
  }),
);

/**
 * Filtering is client-side: the endpoint takes no `search` param, so sending
 * one would silently do nothing.
 */
const rows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return allRows.value;
  return allRows.value.filter((row) =>
    [row.query, row.session_user, row.session_app, row.state, row.wait_event]
      .filter((field): field is string => typeof field === "string")
      .some((field) => field.toLowerCase().includes(needle)),
  );
});

/**
 * MySQL's query_sample carries NO blocking or lock attributes at all, so on a
 * MySQL-only result the lock column would be an em dash on every row. The
 * column is dropped rather than rendered empty.
 */
const showsLocks = computed(() => hasLockData(sessions.value));

/** The reader's own filter emptied the table — not the database being quiet. */
const searchHidEverything = computed(
  () => !!search.value.trim() && allRows.value.length > 0 && rows.value.length === 0,
);

type ActivityTableRow = (typeof allRows.value)[number];

const columns = computed<OTableColumnDef<ActivityTableRow>[]>(() => [
  {
    id: "query",
    accessorKey: "query",
    header: t("dbm.activity.columns.query"),
    sortable: false,
  },
  {
    id: "session",
    accessorKey: "session_pid",
    header: t("dbm.activity.columns.session"),
    size: 88,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "user",
    accessorKey: "session_user",
    header: t("dbm.activity.columns.user"),
    size: 112,
    sortable: true,
    hideable: true,
  },
  {
    id: "application",
    accessorKey: "session_app",
    header: t("dbm.activity.columns.application"),
    size: 144,
    sortable: true,
    hideable: true,
  },
  {
    id: "state",
    accessorKey: "state",
    header: t("dbm.activity.columns.state"),
    size: 128,
    sortable: true,
  },
  {
    id: "waitEvent",
    accessorKey: "wait_event",
    header: t("dbm.activity.columns.waitEvent"),
    size: 160,
    minSize: 144,
    sortable: true,
  },
  ...(showsLocks.value
    ? [
        {
          id: "blockedBy",
          accessorKey: "blockedByLabel",
          header: t("dbm.activity.columns.blockedBy"),
          size: 120,
          sortable: true,
          meta: { align: "right" as const },
        },
      ]
    : []),
  {
    id: "running",
    accessorKey: "runningMs",
    header: t("dbm.activity.columns.running"),
    size: 120,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "lastQuery",
    accessorKey: "lastQueryMs",
    header: t("dbm.activity.columns.lastQuery"),
    size: 120,
    sortable: true,
    meta: { align: "right" },
  },
]);

/** The identity columns are secondary to what the session is DOING. */
const defaultColumnVisibility = { user: false, application: false };

const stateTone = (state: string | null | undefined): string => {
  const s = (state ?? "").toLowerCase();
  if (s.startsWith("idle in transaction")) return "bg-status-warning-bg text-status-warning-text";
  if (s === "active" || s === "running") return "bg-status-success-bg text-status-success-text";
  return "bg-surface-subtle text-text-secondary";
};

/**
 * EVERY tile is the population, from the SQL aggregates.
 *
 * Mixing grains here would be the page's own version of the failure it warns
 * about: an on-CPU count taken off the row-limited sample, sitting beside a
 * population total, reads as a comparable pair and is not one.
 */
const summaryStats = computed<StatItem[]>(() => {
  const waits = waitTotals(waitBuckets.value);
  const idleInTransaction = stateRows.value
    .filter((row) => row.tone === "warning")
    .reduce((sum, row) => sum + row.sessions, 0);
  return [
    {
      key: "sessions",
      label: t("dbm.activity.summary.sessions"),
      // No `??` fallback to the row count: that would silently swap a capped
      // sample in under an aggregate label, next to aggregate-grain tiles.
      value: sampleTotal.value ?? raw("—"),
      icon: "database",
      tone: "neutral",
      dataTest: "dbm-activity-summary-sessions",
    },
    {
      key: "onCpu",
      label: t("dbm.activity.summary.onCpu"),
      value: waits.onCpu,
      icon: "speed",
      tone: "neutral",
      dataTest: "dbm-activity-summary-on-cpu",
    },
    {
      key: "waiting",
      label: t("dbm.activity.summary.waiting"),
      value: waits.waiting,
      icon: "timer",
      tone: "neutral",
      dataTest: "dbm-activity-summary-waiting",
    },
    {
      key: "idleInTransaction",
      label: t("dbm.activity.summary.idleInTransaction"),
      value: idleInTransaction,
      icon: "lock",
      tone: idleInTransaction > 0 ? "warning" : "neutral",
      dataTest: "dbm-activity-summary-idle-in-transaction",
    },
  ];
});

/**
 * A capped read is a floor, so the sentence says "the N we have".
 *
 * The truncation claim is about the SERVER's read, so it is stated over the
 * unfiltered row count. Saying "these are the 3 we have" after the search box
 * narrowed 100 rows to 3 would blame the server for the reader's own filter.
 */
const countLine = computed<I18nText>(() => {
  const claim = activityCountClaim(allRows.value.length, truncated.value);
  if (!claim.complete) return t("dbm.activity.counts.capped", { count: claim.count });
  return search.value.trim()
    ? t("dbm.activity.counts.filtered", { count: rows.value.length, total: claim.count })
    : t("dbm.activity.counts.complete", { count: claim.count });
});

const emptyCause = computed(() =>
  activityEmptyCause({
    notCollecting: notCollecting.value,
    hasBreakdown: stateBuckets.value.length > 0 || waitBuckets.value.length > 0,
  }),
);

const formatAge = (micros: number): I18nText => {
  const seconds = Math.max(0, Math.round((Date.now() - micros / 1000) / 1000));
  return raw(seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`);
};

const healthyChecks = computed<DbmLockCheck[]>(() => [
  {
    id: "sampling",
    status: "ok",
    title: t("dbm.activity.healthy.checks.sampling.title"),
    detail:
      disclosure.value.intervalKnown && sampledAt.value
        ? t("dbm.activity.healthy.checks.sampling.detail", {
            interval: disclosure.value.intervalSeconds ?? 0,
            age: formatAge(sampledAt.value),
          })
        : t("dbm.activity.healthy.checks.sampling.detailUnknown"),
  },
  {
    id: "pipeline",
    status: "ok",
    title: t("dbm.activity.healthy.checks.pipeline.title"),
    // `0` means the stream was read and every record in it was a DBM event —
    // the strongest health signal there is. Only `null` is "we could not look".
    detail:
      logLinesSeen.value !== null
        ? t("dbm.activity.healthy.checks.pipeline.detail", {
            lines: formatCount(logLinesSeen.value),
          })
        : t("dbm.activity.healthy.checks.pipeline.detailUnknown"),
  },
  {
    id: "meaning",
    status: "note",
    title: t("dbm.activity.healthy.checks.meaning.title"),
    detail: t("dbm.activity.healthy.checks.meaning.detail"),
  },
]);

const notCollectingChecks = computed<DbmLockCheck[]>(() => {
  const hasQueries = (queryCount.value ?? 0) > 0;
  return [
    {
      id: "queries",
      status: hasQueries ? "ok" : "fail",
      title: hasQueries
        ? t("dbm.activity.notCollecting.checks.queries.ok")
        : t("dbm.activity.notCollecting.checks.queries.no"),
      detail: hasQueries
        ? t("dbm.activity.notCollecting.checks.queries.okDetail", {
            queries: t("dbm.queries.queryCount", queryCount.value ?? 0),
            databases: t("dbm.databases.databaseCount", databaseCount.value ?? 0),
          })
        : t("dbm.activity.notCollecting.checks.queries.noDetail"),
    },
    {
      id: "enabled",
      status: dbmEnabled.value ? "ok" : "fail",
      title: dbmEnabled.value
        ? t("dbm.activity.notCollecting.checks.enabled.ok")
        : t("dbm.activity.notCollecting.checks.enabled.no"),
      detail: dbmEnabled.value
        ? t("dbm.activity.notCollecting.checks.enabled.okDetail")
        : t("dbm.activity.notCollecting.checks.enabled.noDetail"),
    },
    {
      id: "sampling",
      status: "fail",
      title: t("dbm.activity.notCollecting.checks.sampling.no"),
      detail: t("dbm.activity.notCollecting.checks.sampling.noDetail"),
    },
  ];
});

// Named handler, not `@click="load"`: a refresh must ALSO force the shell's
// badge cache alongside the page's own load — the URL does not change on a
// refresh, so the shell cannot see one on its own.
const onRefresh = () => {
  void load();
  tabCountsContext.refresh({ force: true });
};

const onDateChange = (value: DbmDateChange) => {
  setRange(value);
  router.replace({ query: { ...route.query, ...queryParams.value } }).catch(() => {});
  // Fetch only on a genuine pick — `onMounted` already loads, and the picker's
  // mount replay would otherwise double every request. See
  // `DbmDateChange.userChangedValue`.
  if (value?.userChangedValue !== false) load();
};

/**
 * A row opens the query it is running (W4/B13).
 *
 * The table used to be inert, so an operator who found the session saturating
 * an instance had no way through to what that statement costs over the window
 * — they retyped the fingerprint into the Queries search. The `fingerprint` is
 * exactly what joins a live session to a Top-queries row, so it is the hop.
 *
 * The helper owns the destination, including the refusal: a session running no
 * statement carries no fingerprint, and pushing on one would open a detail page
 * keyed on nothing. It also deliberately sends no `stream` — a server-vantage
 * sample knows its database, not which trace stream the client spans landed in
 * — which is the same omission the deadlocks page makes on this same hop.
 */
const onRowClick = (row: ActivityTableRow) => {
  const target = activityQueryDetailTarget(row);
  if (!target) return;
  // The session's statement travels as a seed: without it the detail header
  // paints the bare fingerprint hash, because on a server-vantage-only fleet
  // the /queries lookup finds no client row to take the text from. Only the
  // fields this page truly knows go in — no stats, no stream — so the detail
  // page paints the statement and dimensions and stays silent on the rest.
  if (row.query) {
    setDbmQueryDetailSeed({
      row: {
        fingerprint: target.fingerprint,
        query_norm: row.query,
        db_system: row.db_system ?? "",
        db_instance: row.db_instance ?? "",
        db_namespace: row.db_namespace ?? undefined,
      },
      org: org.value,
      range: { ...range.value },
    });
  }
  router
    .push({
      name: "dbmQueryDetail",
      query: {
        ...route.query,
        org_identifier: route.query.org_identifier ?? org.value,
        ...queryParams.value,
        ...target,
        // The back affordance and the tab strip both honor the origin — an
        // Activity reader must not be handed back to Top queries.
        from: "activity",
      },
    })
    .catch(() => {});
};

const load = async () => {
  if (!org.value) return;
  const token = requestSeq.begin();
  loading.value = true;
  error.value = null;
  refresh();

  try {
    const { data } = await dbMonitoringService.getActivity(org.value, {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
    });

    // A newer window or refresh already owns the page.
    if (requestSeq.isStale(token)) return;

    sessions.value = data.hits ?? [];
    waitBuckets.value = data.by_wait_event ?? [];
    stateBuckets.value = data.by_state ?? [];
    truncated.value = Boolean(data.truncated);
    notCollecting.value = Boolean(data.not_collecting);
    logLinesSeen.value = data.log_lines_seen ?? null;
    sampledAt.value = data.sampled_at ?? null;
    sampleInterval.value = data.sample_interval_seconds ?? null;
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    // Whatever went wrong, the previous window's rows are no longer an answer
    // to the question on screen. Leaving them would put stale sessions under an
    // error banner — and would let `emptyCause` read the old window's
    // breakdown as proof that this one was sampled.
    sessions.value = [];
    waitBuckets.value = [];
    stateBuckets.value = [];
    truncated.value = false;

    // The endpoint is not on this build yet, or nothing has ever sampled a
    // session: "not collecting", not a failure the reader can act on.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 501) {
      notCollecting.value = true;
    } else {
      error.value =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        String(err);
    }
  } finally {
    if (!requestSeq.isStale(token)) loading.value = false;
  }
};

// Only this page's OWN read. The badges are DbmShell's, fetched once for
// every tab — a call here would put the fan-out back on every mount.
onMounted(() => {
  load();
});

// Kept alive by DbmShell.vue, so `onMounted` above runs once for the whole
// session on this tab. The URL is how the tabs agree on a window, so re-read it
// on return and reload ONLY if it actually moved.
useDbmScopeSync({
  route,
  current: () => range.value,
  adopt: (next) =>
    setRange({
      startTime: next.startTime,
      endTime: next.endTime,
      relativeTimePeriod: next.relativeTimePeriod,
    }),
  reload: () => load(),
});
</script>
