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
  Blocked queries — two perspectives on one set of lock waits.

  It DEFAULTS to "who's stuck" because that is how the incident arrives: my
  query is hanging. That view is a flat list sorted by wait time, so the
  worst-hit query is row 1, and two columns do the work: `Session` carries the
  raw pid the operator needs, and `Held up by` names the DIRECT blocker plus a
  "N deep" chip when that blocker is itself waiting — the hint that the real
  culprit is further up.

  "Who's blocking" re-roots the same data at the session holding the lock,
  because that is where the fix is. It renders as indented table ROWS rather
  than a drawer or a modal: a 3-deep chain is 3 rows, wait time stays a sortable
  column, and the operator never leaves the list.

  The sticky footer states the conclusion the table cannot: all N waits lead
  back to one session, with a one-click switch to the view that shows it.

  There is deliberately NO inline kill button — see DbmTerminateSql for the
  reasoning. The destructive action is copyable SQL, never an execution.
-->
<template>
  <OPageLayout
    :title="t('dbm.blocked.title')"
    :subtitle="t(isLiveWindow ? 'dbm.blocked.subtitle' : 'dbm.blocked.subtitlePast')"
    icon="database"
    title-data-test="dbm-blocked-title"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <DbmSectionTabs
        :database-count="databaseCount"
        :query-count="queryCount"
        :activity-count="activityCount"
        :deadlock-count="deadlockCount"
        :blocked-count="waitingCount"
        :table-health-count="tableHealthCount"
      />
    </template>

    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="range.type"
        :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
        :default-relative-time="range.relativeTimePeriod ?? undefined"
        data-test-name="dbm-blocked-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <OTable
        :data="tableRows"
        :columns="columns"
        row-key="rowKey"
        :loading="loading"
        :frame="false"
        :error="error"
        sorting="client"
        pagination="none"
        :show-global-filter="false"
        table-id="dbm-blocked"
        :row-class="rowClass"
        custom-pagination-bar
        data-test="dbm-blocked-table"
      >
        <template #toolbar>
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <div class="w-64 shrink-0">
              <OSearchInput
                v-model="search"
                :placeholder="t('dbm.blocked.searchPlaceholder')"
                clearable
                :debounce="400"
                data-test="dbm-blocked-search"
                @update:model-value="load"
              />
            </div>

            <!-- Which question the table answers. Defaults to "who's stuck". -->
            <OToggleGroup
              v-model="perspective"
              class="shrink-0"
              data-test="dbm-blocked-perspective"
            >
              <OToggleGroupItem value="waiting" size="sm">
                {{ t("dbm.blocked.perspective.waiting") }}
                <OTooltip side="bottom" :content="t('dbm.blocked.perspective.waitingHint')" />
              </OToggleGroupItem>
              <OToggleGroupItem value="blocking" size="sm">
                {{ t("dbm.blocked.perspective.blocking") }}
                <OTooltip side="bottom" :content="t('dbm.blocked.perspective.blockingHint')" />
              </OToggleGroupItem>
            </OToggleGroup>
          </div>
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            class="shrink-0"
            data-test="dbm-blocked-refresh"
            @click="onRefresh"
          >
            <OTooltip side="bottom" :content="t('dbm.common.reload')" />
          </OButton>
        </template>

        <template #subheader>
          <!-- The counts that used to be crammed into the page subtitle. They
               summarise exactly the rows below, so they belong inside the table
               frame rather than in the header. -->
          <div
            class="px-page-edge border-table-row-divider border-b py-1.5"
            data-test="dbm-blocked-summary"
          >
            <OStatStrip :items="summaryStats" :loading="loading" />
          </div>

          <div
            v-if="samples.length"
            class="border-border-subtle bg-surface-base text-text-secondary text-2xs px-page-edge flex shrink-0 items-center gap-2 border-b py-1"
            data-test="dbm-blocked-coverage"
          >
            <span class="bg-status-warning-text size-1.5 shrink-0 rounded-full"></span>
            <span>{{ coverageLine }}</span>
            <template v-if="checkedLabel">
              <span class="opacity-45">·</span>
              <span>{{ checkedLabel }}</span>
            </template>
          </div>

          <!-- The one blocking cause whose fix is in code: a session sitting in
               an open transaction without running anything. -->
          <div
            v-if="idleRootWarning"
            class="bg-status-warning-bg text-text-body text-2xs px-page-edge flex shrink-0 items-start gap-2 border-b border-(--color-border-subtle) py-1.5"
            data-test="dbm-blocked-degraded"
          >
            <OIcon name="info-outline" class="text-status-warning-text mt-px size-3.5 shrink-0" />
            <span>{{ idleRootWarning }}</span>
          </div>
        </template>

        <!-- The stuck statement, or — in the blocking view — the session and
             what it is running, indented to its depth in the chain. -->
        <template #cell-query="{ row }">
          <div class="flex min-w-0 items-stretch gap-0">
            <!-- Depth as indent + connector elbow: the same trick OTable's tree
                 mode uses, applied here because the rows are a flattened chain
                 rather than lazily-expanded children. -->
            <template v-if="row.depth">
              <span
                v-for="(rail, index) in row.rails"
                :key="`rail-${index}`"
                class="relative w-4.5 shrink-0 self-stretch"
              >
                <span
                  v-if="rail"
                  class="bg-border-default absolute top-0 bottom-0 left-1.5 w-px"
                ></span>
              </span>
              <span class="relative w-4.5 shrink-0 self-stretch" data-test="dbm-blocked-elbow">
                <span
                  class="bg-border-default absolute top-0 left-1.5 w-px"
                  :class="row.isLast ? 'h-1/2' : 'bottom-0'"
                ></span>
                <span class="bg-border-default absolute top-1/2 left-1.5 h-px w-2.5"></span>
              </span>
            </template>

            <div class="flex min-w-0 flex-1 flex-col gap-px">
              <div v-if="row.pill" class="flex min-w-0 items-center gap-1.5">
                <span
                  class="text-3xs shrink-0 rounded-full px-1.5 py-px font-bold tracking-wide uppercase"
                  :class="row.pill.tone"
                  :data-test="`dbm-blocked-pill-${row.kind}`"
                >
                  {{ row.pill.label }}
                </span>
                <span v-if="row.pillNote" class="text-text-secondary truncate text-xs">
                  {{ row.pillNote }}
                </span>
              </div>

              <span
                class="text-text-code min-w-0 truncate font-mono text-xs"
                :title="row.query ?? ''"
              >
                {{ raw(row.query ?? "—") }}
              </span>

              <div class="text-text-label text-3xs flex min-w-0 items-center gap-1 truncate">
                <OTag type="dbSystem" :value="row.db_system" size="xs" />
                <template v-if="row.application">
                  <span class="opacity-45">·</span>
                  <span class="text-text-secondary font-medium">{{ raw(row.application) }}</span>
                </template>
                <template v-if="row.db_instance">
                  <span class="opacity-45">·</span>
                  <span>{{ raw(row.db_instance) }}</span>
                </template>
                <template v-if="row.waitingOnPid != null">
                  <span class="opacity-45">·</span>
                  <span>{{ t("dbm.blocked.waitingOn", { pid: row.waitingOnPid }) }}</span>
                </template>
                <span
                  v-if="row.longestWait"
                  class="bg-status-error-bg text-status-error-text rounded-default text-3xs ml-0.5 px-1 py-px font-semibold tracking-wide uppercase"
                >
                  {{ t("dbm.blocked.longestWait") }}
                </span>
              </div>
            </div>
          </div>
        </template>

        <template #cell-session="{ row }">
          <span
            class="rounded-default text-2xs px-1.5 py-px font-mono font-semibold"
            :class="
              row.kind === 'root'
                ? 'bg-status-error-bg text-status-error-text'
                : 'bg-surface-subtle text-text-heading'
            "
            data-test="dbm-blocked-pid"
          >
            {{ row.pid ?? raw("—") }}
          </span>
        </template>

        <!-- What THIS session is waiting on. A row lock, a table lock and a
             buffer read are three different problems with three different
             fixes, so the cell reads the row's own wait event rather than
             printing one sentence for every row. The database's own name for it
             stays underneath, for the DBA who wants to look it up. -->
        <template #cell-waitingFor="{ row }">
          <div class="flex flex-col items-end leading-tight">
            <span v-if="row.waitEventLabel" class="text-text-body text-xs">
              {{ row.waitEventLabel }}
            </span>
            <span
              v-else-if="row.waitEventRaw"
              class="text-text-body font-mono text-xs"
              data-test="dbm-blocked-wait-event-raw"
            >
              {{ raw(row.waitEventRaw) }}
            </span>
            <span v-else class="text-text-muted text-xs">{{ raw("—") }}</span>
            <span
              v-if="row.waitEventLabel && row.waitEventRaw"
              class="text-text-label text-3xs font-mono"
              :title="row.waitEventRaw"
            >
              {{ raw(row.waitEventRaw) }}
            </span>
          </div>
        </template>

        <!-- The direct blocker, plus how far the real culprit is. -->
        <template #cell-heldUpBy="{ row }">
          <div class="flex flex-col items-end leading-tight">
            <span class="text-text-body truncate text-xs">
              {{ raw(row.blockerApplication ?? "—") }}
            </span>
            <span class="text-text-muted text-3xs flex items-center justify-end gap-1">
              <span v-if="row.blockerPid != null">
                {{ t("dbm.deadlocks.detail.pid", { pid: row.blockerPid }) }}
              </span>
              <span
                v-if="row.depth > 1"
                class="bg-surface-subtle text-text-secondary rounded-default px-1 py-px font-semibold"
              >
                {{ t("dbm.blocked.deep", { count: row.depth }) }}
              </span>
            </span>
          </div>
        </template>

        <template #cell-application="{ row }">
          <span
            class="text-text-body block truncate font-mono text-xs"
            :title="row.application ?? ''"
          >
            {{ raw(row.application ?? "—") }}
          </span>
        </template>

        <template #cell-blocking="{ row }">
          <div v-if="row.blockingCount" class="flex flex-col items-end leading-tight">
            <span
              class="text-compact font-mono font-semibold tabular-nums"
              :class="row.kind === 'root' ? 'text-status-error-text' : 'text-status-warning-text'"
            >
              {{ row.blockingCount }}
            </span>
            <span class="text-text-label text-3xs">
              {{ t("dbm.blocked.sessionCount", { count: row.blockingCount }, row.blockingCount) }}
            </span>
          </div>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <!-- Wait time with its bar: a length is comparable at a glance in a way
             a column of numbers is not. -->
        <template #cell-waiting="{ row }">
          <div v-if="row.waitSeconds != null" class="flex items-center justify-end gap-1.5">
            <span class="bg-surface-subtle h-1.5 w-13 shrink-0 overflow-hidden rounded-full">
              <span
                class="block h-full rounded-full"
                :class="waitTone(row.waitShare)"
                :style="shareWidth(row.waitShare)"
              ></span>
            </span>
            <span class="text-text-heading text-compact font-mono font-semibold tabular-nums">
              {{ formatSeconds(row.waitSeconds) }}
            </span>
          </div>
          <div v-else class="flex flex-col items-end leading-tight">
            <span class="text-text-muted">{{ raw("—") }}</span>
            <span class="text-text-label text-3xs">{{ t("dbm.blocked.notWaiting") }}</span>
          </div>
        </template>

        <!-- The end-session statement, to COPY. Never an inline execution. -->
        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <!-- Root only. Every other row is a victim, and asking about a
                 victim gets advice aimed at the wrong session. -->
            <DbmSuggestFixButton
              v-if="row.kind === 'root'"
              :label="t('dbm.ai.blockingFix')"
              :tooltip="t('dbm.ai.blockingFixHint')"
              size="xs"
              data-test="dbm-blocked-ask-ai"
              @click="askAiForFix(row)"
            />
            <DbmTerminateSql
              v-if="row.kind === 'root' || perspective === 'blocking'"
              :db-system="row.db_system"
              :pid="row.pid"
              :instance="row.db_instance"
              data-test="dbm-blocked-terminate"
            />
            <DbmRowActions
              :actions="rowActions"
              data-test="dbm-blocked-row-actions"
              @action="(id) => onRowAction(id, row)"
            />
          </div>
        </template>

        <template #bottom>
          <!-- The conclusion the table cannot state: everything leads back to
               one session, and here is the way to it. -->
          <div
            v-if="samples.length && footerLine"
            class="border-border-subtle bg-surface-panel text-text-secondary text-2xs px-page-edge flex shrink-0 items-center gap-2 border-t py-1.5"
            data-test="dbm-blocked-footer"
          >
            <OIcon
              :name="perspective === 'blocking' ? 'check-circle' : 'info-outline'"
              class="size-3.5 shrink-0"
              :class="
                perspective === 'blocking' ? 'text-status-success-text' : 'text-status-warning-text'
              "
            />
            <span class="text-text-body font-semibold">{{ footerLine }}</span>
            <span>{{ footerDetail }}</span>
            <div class="flex-1"></div>
            <OButton
              v-if="perspective === 'waiting' && rootPids.length === 1"
              variant="ghost-muted"
              size="sm"
              data-test="dbm-blocked-switch-perspective"
              @click="perspective = 'blocking'"
            >
              {{ t("dbm.blocked.footer.switchToBlocking") }}
            </OButton>
            <span v-else-if="perspective === 'blocking'" class="text-text-muted">
              {{ timeLostLabel }}
            </span>
          </div>

          <div
            class="border-border-default bg-surface-panel text-text-secondary text-2xs px-page-edge flex h-7.5 items-center gap-2.5 border-t"
            data-test="dbm-blocked-status-bar"
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
          <DbmLockEmptyState
            v-if="!loading && notCollecting"
            :healthy="false"
            :title="t('dbm.blocked.notCollecting.title')"
            :description="t('dbm.blocked.notCollecting.description')"
            :checklist-title="t('dbm.blocked.notCollecting.checklistTitle')"
            :checks="notCollectingChecks"
            data-test="dbm-blocked-not-collecting"
          />
          <DbmLockEmptyState
            v-else-if="!loading"
            :healthy="true"
            :title="t('dbm.blocked.healthy.title')"
            :description="
              t(
                isLiveWindow
                  ? 'dbm.blocked.healthy.description'
                  : 'dbm.blocked.healthy.descriptionPast',
              )
            "
            :checklist-title="t('dbm.blocked.healthy.checklistTitle')"
            :checks="healthyChecks"
            :collection-healthy-label="t('dbm.blocked.healthy.collectionHealthy')"
            data-test="dbm-blocked-healthy"
          />
        </template>
      </OTable>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmLockEmptyState, { type DbmLockCheck } from "@/components/dbm/DbmLockEmptyState.vue";
import DbmRowActions, { type DbmRowAction } from "@/components/dbm/DbmRowActions.vue";
import DbmSectionTabs from "@/components/dbm/DbmSectionTabs.vue";
import DbmSuggestFixButton from "@/components/dbm/DbmSuggestFixButton.vue";
import DateTime from "@/components/DateTime.vue";
import DbmTerminateSql from "@/components/dbm/DbmTerminateSql.vue";
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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, {
  type ActivityStateBucket,
  type BlockingChain,
  type BlockingSample,
} from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDbmRequestSeq } from "@/composables/dbm/useDbmRequestSeq";
import { badgesFrom, DbmPartialCounts, useDbmCountCache } from "@/composables/dbm/useDbmCountCache";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import {
  contextRegistry,
  createDbmContextProvider,
  DBM_CONTEXT_KEY,
} from "@/composables/contextProviders";
import { copyToClipboard } from "@/utils/clipboard";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import { buildDbmLockPrefill } from "@/utils/alerts/prefill/fromDbmLocks";
import { buildBlockingFixPrompt } from "@/utils/dbm/aiPrompts";
import {
  buildWaitingRows,
  chainsFromSamples,
  DEFAULT_BLOCKING_PERSPECTIVE,
  flattenChains,
  isIdleBlocker,
  isNotablyLongestWait,
  parseBlockingSamples,
  rootBlockerPids,
  rootIdleSeconds,
  totalWaitSeconds,
  waitEventKey,
  WAIT_TONE_RULES,
} from "@/utils/dbm/blocking";
import { countClaim, type DbmCountClaim } from "@/utils/dbm/format";
import { activitySampleTotal } from "@/utils/dbm/activity";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

// This page is a route root, so MainLayout's `@sendToAiChat` binding is on it
// directly — no re-emit chain needed.
const emit = defineEmits<{
  (e: "sendToAiChat", value: { query: string; autoSend: boolean }): void;
}>();

const { range, current, refresh, setRange, queryParams } = useDbmScope(route.query);

// Search, the picker and refresh can all be in flight at once; this keeps the
// last request the reader made the one that paints.
const requestSeq = useDbmRequestSeq();

// The sibling-tab badges are the same numbers on every tab, so they are
// fetched once per window and shared across the six routes rather than
// re-fetched on each remount. See useDbmCountCache.
const countCache = useDbmCountCache();

/**
 * Whether this page is describing NOW or a stretch of the past.
 *
 * Blocking is a live condition — a session is stuck, then it is not — so the
 * copy is written in the present tense. But the picker above accepts any
 * window, and on an absolute one that tense is a lie: set it to yesterday and
 * long-resolved waits get reported as sessions stuck "right now".
 *
 * A relative range always ends at now; an absolute one is a historical window
 * the reader chose deliberately. That distinction is the whole signal, and the
 * scope already carries it.
 */
const isLiveWindow = computed(() => range.value.type === "relative");

const samples = ref<BlockingSample[]>([]);
const serverChains = ref<BlockingChain[] | null>(null);
const waitingCount = ref(0);
/** The server capped the read, so the waits below are a subset of what is stuck. */
const truncated = ref(false);
const deadlockCount = ref<DbmCountClaim | null>(null);
const tableHealthCount = ref<number | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const notCollecting = ref(false);
const sampledAt = ref<number | null>(null);
const sampleInterval = ref<number | null>(null);
const queryCount = ref<number | null>(null);
const databaseCount = ref<number | null>(null);
/** `null` until read, and again if the read fails — so the badge stays bare. */
const activityStates = ref<ActivityStateBucket[] | null>(null);
/** Sessions in the window. See `activitySampleTotal` for why not `hits.length`. */
const activityCount = computed(() => activitySampleTotal(activityStates.value));

const search = ref("");
/** "My query is hanging" is how the incident arrives, so this is the default. */
const perspective = ref<string>(DEFAULT_BLOCKING_PERSPECTIVE);

const org = computed(() => store.state.selectedOrganization?.identifier as string);
const dbmEnabled = computed(() => Boolean(store.state.zoConfig?.database_monitoring_enabled));

interface BlockedRow {
  rowKey: string;
  depth: number;
  rails: boolean[];
  isLast: boolean;
  pid: number | null;
  query?: string | null;
  application?: string | null;
  db_system: string;
  db_instance?: string | null;
  waitingOnPid: number | null;
  waitSeconds: number | null;
  waitShare: number;
  blockingCount: number;
  kind: "root" | "waiting-blocking" | "waiting";
  blockerPid: number | null;
  blockerApplication?: string | null;
  longestWait: boolean;
  pill: { label: I18nText; tone: string } | null;
  pillNote: I18nText | null;
  /** What this session is waiting on, translated. Null when the sample carried
   *  no wait event, or when the row is a root and waits for nothing. */
  waitEventLabel: I18nText | null;
  /** The database's own name for it, kept alongside the sentence for the DBA. */
  waitEventRaw: string | null;
}

/**
 * The database's vocabulary translated into a sentence, with the raw event kept
 * as secondary text. An event we have no sentence for shows the raw name alone
 * rather than a guess.
 */
const waitEventText = (
  waitEvent: string | null | undefined,
  waitEventType: string | null | undefined,
): { label: I18nText | null; raw: string | null } => {
  const key = waitEventKey(waitEvent, waitEventType);
  return { label: key ? t(key) : null, raw: waitEvent?.trim() || null };
};

/**
 * The server assembles chains when it can — it sees the whole sample set, so it
 * can climb past a blocker that fell outside the row limit. This falls back to
 * rebuilding them locally so the tree works before that lands.
 */
const chains = computed<BlockingChain[]>(
  () => serverChains.value ?? chainsFromSamples(samples.value),
);

const rootPids = computed(() => rootBlockerPids(samples.value));

/** Flat, longest wait first — the worst-hit query is row 1. */
const waitingRows = computed<BlockedRow[]>(() => {
  const built = buildWaitingRows(samples.value);
  return built.map((row, index) => {
    const wait = waitEventText(row.wait_event, row.wait_event_type);
    return {
      rowKey: row.rowKey,
      depth: row.depth,
      rails: [],
      isLast: true,
      pid: row.blocked_pid,
      query: row.blocked_query,
      application: row.blocked_application,
      db_system: row.db_system,
      db_instance: row.db_instance,
      waitingOnPid: null,
      waitSeconds: row.wait_seconds ?? null,
      waitShare: row.waitShare,
      blockingCount: 0,
      kind: "waiting" as const,
      blockerPid: row.blocking_pid,
      blockerApplication: row.blocking_application,
      // Row 1 is always the longest by sort order, so saying so is only worth a
      // badge when the wait is notable in its own right and clearly worse than
      // the next one down.
      longestWait:
        index === 0 && isNotablyLongestWait(row.wait_seconds, built[1]?.wait_seconds ?? null),
      pill: null,
      pillNote: null,
      waitEventLabel: wait.label,
      waitEventRaw: wait.raw,
    };
  });
});

const PILL_TONES: Record<BlockedRow["kind"], string> = {
  root: "bg-status-error-bg text-status-error-text",
  "waiting-blocking": "bg-status-warning-bg text-status-warning-text",
  waiting: "bg-surface-subtle text-text-secondary",
};

/** Root first, waiters indented beneath — the chain as rows, never a drawer. */
const blockingRows = computed<BlockedRow[]>(() =>
  flattenChains(chains.value, samples.value).map((row) => {
    const wait = waitEventText(row.waitEvent, row.waitEventType);
    return {
      rowKey: row.rowKey,
      depth: row.depth,
      rails: row.rails,
      isLast: row.isLast,
      pid: row.pid,
      query: row.query,
      application: row.application,
      db_system: row.db_system,
      db_instance: row.db_instance,
      waitingOnPid: row.waitingOnPid,
      waitSeconds: row.waitSeconds,
      waitShare: row.waitShare,
      blockingCount: row.blockingCount,
      kind: row.kind,
      blockerPid: row.waitingOnPid,
      blockerApplication: null,
      longestWait: false,
      pill: {
        label:
          row.kind === "root"
            ? t("dbm.blocked.pills.root")
            : row.kind === "waiting-blocking"
              ? t("dbm.blocked.pills.waitingBlocking", { count: row.blockingCount })
              : t("dbm.blocked.pills.waiting"),
        tone: PILL_TONES[row.kind],
      },
      // Only the root earns an explanatory note: it is the row whose state
      // ("holding a lock, waiting for nothing") is not obvious from the columns.
      pillNote:
        row.kind === "root" && isIdleBlocker(row.idleSeconds)
          ? t("dbm.blocked.idleInTransaction")
          : null,
      waitEventLabel: wait.label,
      waitEventRaw: wait.raw,
    };
  }),
);

const tableRows = computed<BlockedRow[]>(() =>
  perspective.value === "blocking" ? blockingRows.value : waitingRows.value,
);

const columns = computed<OTableColumnDef<BlockedRow>[]>(() =>
  perspective.value === "blocking"
    ? [
        {
          id: "query",
          accessorKey: "query",
          header: t("dbm.blocked.columns.sessionQuery"),
          enableSorting: false,
        },
        {
          id: "session",
          accessorKey: "pid",
          header: t("dbm.blocked.columns.session"),
          size: 80,
          meta: { align: "right" },
        },
        {
          id: "application",
          accessorKey: "application",
          header: t("dbm.blocked.columns.application"),
          size: 140,
          meta: { align: "right" },
        },
        {
          id: "blocking",
          accessorKey: "blockingCount",
          header: t("dbm.blocked.columns.blocking"),
          size: 96,
          meta: { align: "right" },
        },
        {
          id: "waiting",
          accessorKey: "waitSeconds",
          header: t("dbm.blocked.columns.waiting"),
          size: 120,
          meta: { align: "right" },
        },
        {
          id: "actions",
          header: raw(""),
          size: 200,
          enableSorting: false,
          meta: { align: "right" },
        },
      ]
    : [
        {
          id: "query",
          accessorKey: "query",
          header: t("dbm.blocked.columns.stuckQuery"),
          enableSorting: false,
        },
        {
          id: "session",
          accessorKey: "pid",
          header: t("dbm.blocked.columns.session"),
          size: 80,
          meta: { align: "right" },
        },
        {
          id: "waitingFor",
          header: t("dbm.blocked.columns.waitingFor"),
          size: 144,
          enableSorting: false,
          meta: { align: "right" },
        },
        {
          id: "heldUpBy",
          accessorKey: "blockerApplication",
          header: t("dbm.blocked.columns.heldUpBy"),
          size: 176,
          meta: { align: "right" },
        },
        {
          id: "waiting",
          accessorKey: "waitSeconds",
          header: t("dbm.blocked.columns.waiting"),
          size: 120,
          meta: { align: "right" },
        },
        {
          id: "actions",
          header: raw(""),
          size: 112,
          enableSorting: false,
          meta: { align: "right" },
        },
      ],
);

/** Only what the handler actually implements — a control that does nothing is
 *  worse than no control. */
const rowActions = computed<DbmRowAction[]>(() => [
  { id: "copy", icon: "content-copy", label: t("dbm.blocked.rowActions.copy") },
  { id: "alert", icon: "shield", label: t("dbm.blocked.rowActions.alertMe") },
]);

const longestWait = computed(() =>
  samples.value.reduce((max, s) => Math.max(max, s.wait_seconds ?? 0), 0),
);

/**
 * The live picture, over the rows below. "Not collecting" is an em dash rather
 * than a zero: nothing sampling the lock tables is not the same claim as
 * nothing waiting, and the empty state below says which.
 */
const summaryStats = computed<StatItem[]>(() => [
  {
    key: "waiting",
    label: t("dbm.blocked.summary.waiting"),
    value: notCollecting.value ? raw("—") : waitingCount.value,
    icon: "lock",
    tone: waitingCount.value > 0 ? "warning" : "neutral",
    dataTest: "dbm-blocked-summary-waiting",
  },
  {
    key: "longest",
    label: t("dbm.blocked.summary.longest"),
    value: notCollecting.value || !longestWait.value ? raw("—") : formatSeconds(longestWait.value),
    icon: "timer",
    tone: "neutral",
    dataTest: "dbm-blocked-summary-longest",
  },
  {
    key: "chains",
    label: t("dbm.blocked.summary.chains"),
    value: notCollecting.value ? raw("—") : chains.value.length,
    icon: "account-tree",
    tone: "neutral",
    dataTest: "dbm-blocked-summary-chains",
  },
]);

// The waiting count is the first stat tile directly above this line, so the
// sentence does not restate it — it adds what the tiles cannot say. "Every wait
// traces back to…" is a claim over the WHOLE set, so at the cap it becomes a
// claim about the subset we managed to read.
const coverageLine = computed<I18nText>(() => {
  const params = {
    longest: formatSeconds(longestWait.value),
    roots:
      rootPids.value.length === 1
        ? t("dbm.blocked.coverage.summaryOneRoot")
        : t("dbm.blocked.coverage.summaryManyRoots", { count: rootPids.value.length }),
  };
  return countClaim(waitingCount.value, truncated.value).complete
    ? t("dbm.blocked.coverage.summary", params)
    : t("dbm.blocked.coverage.summaryCapped", params);
});

const checkedLabel = computed<I18nText | null>(() =>
  sampleInterval.value && sampledAt.value
    ? t("dbm.blocked.coverage.checked", {
        interval: sampleInterval.value,
        time: formatClock(sampledAt.value),
      })
    : null,
);

/**
 * Only when the root really is idle. Idle time lives on the SAMPLES rather than
 * on the chain, so a chain alone cannot answer this — and without the number
 * the warning would be a guess.
 */
const idleRootWarning = computed<I18nText | null>(() => {
  for (const chain of chains.value) {
    const idle = rootIdleSeconds(chain, samples.value);
    if (!isIdleBlocker(idle)) continue;
    return t("dbm.blocked.degraded", {
      count: t("dbm.blocked.sessionCount", { count: chain.blocked_count }, chain.blocked_count),
      age: formatSeconds(idle ?? 0),
    });
  }
  return null;
});

const footerLine = computed<I18nText | null>(() => {
  if (!samples.value.length) return null;
  if (perspective.value === "blocking") {
    const root = chains.value[0];
    if (!root) return null;
    return t("dbm.blocked.footer.releaseAll", {
      pid: root.root_pid,
      count: root.blocked_count,
    });
  }
  // "All N waits lead back to one session" cannot be said over a capped read —
  // the waits we could not read may well lead somewhere else.
  if (rootPids.value.length !== 1 || truncated.value) return null;
  return t("dbm.blocked.footer.allLeadBack", {
    waits: t(
      isLiveWindow.value ? "dbm.blocked.waitingCount" : "dbm.blocked.waitingCountPast",
      { count: waitingCount.value },
      waitingCount.value,
    ),
    pid: rootPids.value[0],
  });
});

const footerDetail = computed<I18nText>(() => {
  if (perspective.value === "blocking") return t("dbm.blocked.footer.releaseAllDetail");
  const object = samples.value.find((s) => s.object)?.object;
  return object ? t("dbm.blocked.footer.allLeadBackDetail", { object }) : raw("");
});

const timeLostLabel = computed<I18nText>(() =>
  t("dbm.blocked.footer.timeLost", {
    seconds: formatSeconds(totalWaitSeconds(samples.value)),
    sessions: t("dbm.blocked.sessionCount", { count: samples.value.length }, samples.value.length),
  }),
);

const keyboardHints = computed(() => [
  { key: raw("j"), label: t("dbm.keys.move") },
  { key: raw("b"), label: t("dbm.keys.perspective") },
  { key: raw("/"), label: t("dbm.keys.search") },
  { key: raw("c"), label: t("dbm.keys.copy") },
]);

// ── the two empty states ────────────────────────────────────────────────────

const healthyChecks = computed<DbmLockCheck[]>(() => [
  {
    id: "sampling",
    status: "ok",
    title: t("dbm.blocked.healthy.checks.sampling.title"),
    detail:
      sampleInterval.value && sampledAt.value
        ? t("dbm.blocked.healthy.checks.sampling.detail", {
            interval: sampleInterval.value,
            age: formatAge(sampledAt.value),
          })
        : t("dbm.blocked.healthy.checks.sampling.detailUnknown"),
  },
  {
    id: "sessions",
    status: "ok",
    title: t("dbm.blocked.healthy.checks.sessions.title"),
    detail: t("dbm.blocked.healthy.checks.sessions.detail"),
  },
  {
    id: "meaning",
    status: "note",
    title: t("dbm.blocked.healthy.checks.meaning.title"),
    detail: t("dbm.blocked.healthy.checks.meaning.detail"),
  },
]);

const notCollectingChecks = computed<DbmLockCheck[]>(() => {
  const hasQueries = (queryCount.value ?? 0) > 0;
  return [
    {
      id: "queries",
      status: hasQueries ? "ok" : "fail",
      title: hasQueries
        ? t("dbm.blocked.notCollecting.checks.queries.ok")
        : t("dbm.blocked.notCollecting.checks.queries.no"),
      detail: hasQueries
        ? t("dbm.blocked.notCollecting.checks.queries.okDetail", {
            queries: t("dbm.queries.queryCount", queryCount.value ?? 0),
            databases: t("dbm.databases.databaseCount", databaseCount.value ?? 0),
          })
        : t("dbm.blocked.notCollecting.checks.queries.noDetail"),
    },
    {
      id: "enabled",
      status: dbmEnabled.value ? "ok" : "fail",
      title: dbmEnabled.value
        ? t("dbm.blocked.notCollecting.checks.enabled.ok")
        : t("dbm.blocked.notCollecting.checks.enabled.no"),
      detail: dbmEnabled.value
        ? t("dbm.blocked.notCollecting.checks.enabled.okDetail")
        : t("dbm.blocked.notCollecting.checks.enabled.noDetail"),
    },
    {
      id: "sampling",
      status: "fail",
      title: t("dbm.blocked.notCollecting.checks.sampling.no"),
      detail: t("dbm.blocked.notCollecting.checks.sampling.noDetail"),
    },
    {
      id: "settings",
      status: "note",
      title: t("dbm.blocked.notCollecting.checks.settings.title"),
      detail: t("dbm.blocked.notCollecting.checks.settings.detail"),
    },
  ];
});

// ── formatting ──────────────────────────────────────────────────────────────

const formatClock = (micros: number): string =>
  new Date(micros / 1000).toLocaleTimeString(undefined, { hour12: false });

const formatAge = (micros: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - micros / 1000) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
};

/** Sub-minute waits read in seconds with one decimal — 4.8s, not 5s. */
const formatSeconds = (seconds: number): string =>
  seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds.toFixed(1)}s`;

/** A wait bar's width is a percentage of its track, not a fixed length. */
const shareWidth = (share: number) => ({ width: `${Math.round(share * 100)}%` });

const waitTone = (share: number) =>
  share >= WAIT_TONE_RULES.critical
    ? "bg-status-error-text"
    : share >= WAIT_TONE_RULES.warning
      ? "bg-status-warning-text"
      : "bg-accent";

// eslint-disable-next-line local/no-hardcoded-px -- state rail: a 3-device-pixel inset shadow, which must not scale with text or it blurs at fractional zoom
const ROOT_RAIL = "shadow-[inset_3px_0_0_var(--color-status-error-text)]";

const rowClass = (row: BlockedRow) => (row.kind === "root" ? ROOT_RAIL : "");

// ── behaviour ───────────────────────────────────────────────────────────────

/** The window on screen, in whole minutes, so the alert evaluates the same span. */
const windowMinutes = computed(() =>
  Math.max(1, Math.round((current.value.endTime - current.value.startTime) / 60_000_000)),
);

const onRowAction = (id: string, row: BlockedRow) => {
  if (id === "copy") {
    copyToClipboard(row.query ?? "", t);
    return;
  }
  if (id === "alert") {
    // Instance scope, not session scope. A pid is the identity of one stuck
    // session that will be gone by the time the alert next evaluates, so an
    // alert pinned to it could never fire twice. What is worth being woken for
    // is "this database is blocking again", which is the instance.
    //
    // The threshold comes from the wait on THIS row rather than the page's
    // longest: the operator picked this row, so this is the wait they judged
    // to be too long.
    requestAlertCreation(
      buildDbmLockPrefill({
        kind: "blocking",
        dbSystem: row.db_system,
        dbInstance: row.db_instance,
        observedWaitSeconds: row.waitSeconds,
        periodMinutes: windowMinutes.value,
      }),
    );
  }
};

/**
 * The refresh button. A named handler rather than `@click="load"`: that passes
 * the click EVENT as the first argument, which would arrive as a truthy
 * `force` and quietly make every caller look like a refresh.
 *
 * `force` reaches the BADGE cache only — the table is always fetched live.
 */
const onRefresh = () => {
  void load();
  void loadContext(requestSeq.current(), true);
};

const onDateChange = (value: DbmDateChange) => {
  setRange(value);
  router.replace({ query: { ...route.query, ...queryParams.value } }).catch(() => {});
  load();
};

const load = async () => {
  if (!org.value) return;
  const token = requestSeq.begin();
  loading.value = true;
  error.value = null;
  refresh();

  try {
    const { data } = await dbMonitoringService.getBlocking(org.value, {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      search: search.value || undefined,
    });

    // A newer search or window already owns the page.
    if (requestSeq.isStale(token)) return;

    samples.value = parseBlockingSamples(data.hits ?? []);
    serverChains.value = data.chains ?? null;
    waitingCount.value = data.total ?? samples.value.length;
    truncated.value = Boolean(data.truncated);
    notCollecting.value = Boolean(data.not_collecting);
    sampledAt.value = data.sampled_at ?? null;
    sampleInterval.value = data.sample_interval_seconds ?? null;
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    // The endpoint is not on this build yet, or nothing has ever sampled the
    // lock tables: "not collecting", not a failure the user can act on.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 501) {
      notCollecting.value = true;
      samples.value = [];
      waitingCount.value = 0;
      truncated.value = false;
    } else {
      error.value =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        String(err);
    }
  } finally {
    if (!requestSeq.isStale(token)) loading.value = false;
  }
};

const loadContext = async (token: number = requestSeq.current(), force = false) => {
  if (!org.value) return;
  const window = { startTime: current.value.startTime, endTime: current.value.endTime };

  // Through the SHARED cache, keyed on the range: these five badges are the
  // same five numbers on every DBM tab, and the six tabs are separate routes,
  // so without this each switch re-fetches all of them.
  const badges = await badgesFrom(
    countCache.read(
      org.value,
      range.value,
      async () => {
        // CONCURRENT, not sequential — see DatabasesPage.loadQueryCount for the
        // measurement. `allSettled`, not `all`, so one dead endpoint blanks ONE
        // badge instead of abandoning the rest.
        const [databases, queries, deadlocks, activity, tableHealth] = await Promise.allSettled([
          dbMonitoringService.getDatabases(org.value, window),
          dbMonitoringService.getQueries(org.value, { ...window, limit: 1 }),
          dbMonitoringService.getDeadlocks(org.value, window),
          dbMonitoringService.getActivity(org.value, window),
          dbMonitoringService.getTableHealth(org.value, window),
        ]);
        // A blank badge is the honest rendering when we could not count. The
        // claim objects are built HERE, inside the cached value, so the
        // server's `truncated` survives a hit and the badge still shows `65+`.
        const value = {
          // `hits.length`, as before: /databases returns no `total`, and
          // inventing one would make this badge disagree with the Overview
          // table it counts.
          databaseCount:
            databases.status === "fulfilled" ? (databases.value.data.hits?.length ?? 0) : null,
          queryCount:
            queries.status === "fulfilled"
              ? (queries.value.data.total ?? queries.value.data.hits?.length ?? 0)
              : null,
          deadlockCount:
            deadlocks.status === "fulfilled"
              ? countClaim(
                  deadlocks.value.data.total ?? deadlocks.value.data.hits?.length ?? 0,
                  deadlocks.value.data.truncated,
                )
              : null,
          // The STATE BREAKDOWN, never `total`/`hits.length`: those are a
          // row-limited sample and would render a constant cap as the
          // population.
          activityStates:
            activity.status === "fulfilled" ? (activity.value.data.by_state ?? []) : null,
          tableHealthCount:
            tableHealth.status === "fulfilled"
              ? (tableHealth.value.data.total ?? tableHealth.value.data.hits?.length ?? 0)
              : null,
        };
        // `allSettled` never rejects, so a fan-out in which a badge failed
        // would otherwise be CACHED — remembering "we could not count" as the
        // answer for the whole window. Throwing keeps it out of the cache; the
        // partial result still reaches the badges below.
        if (
          [databases, queries, deadlocks, activity, tableHealth].some(
            (r) => r.status === "rejected",
          )
        ) {
          throw new DbmPartialCounts(value);
        }
        return value;
      },
      { force },
    ),
  );

  if (requestSeq.isStale(token) || !badges) return;

  databaseCount.value = badges.databaseCount;
  queryCount.value = badges.queryCount;
  deadlockCount.value = badges.deadlockCount;
  activityStates.value = badges.activityStates;
  tableHealthCount.value = badges.tableHealthCount;
};

// ─── AI ──────────────────────────────────────────────────────────────────────

/** The root's idle time lives on the SAMPLES, not on the row — see `idleRootWarning`. */
const idleSecondsForRoot = (pid: number | null): number | null => {
  if (pid == null) return null;
  const chain = chains.value.find((entry) => entry.root_pid === pid);
  return chain ? rootIdleSeconds(chain, samples.value) : null;
};

/** The longest wait behind this root — the cost of leaving it alone. */
const longestWaitBehind = (pid: number | null): number | null => {
  if (pid == null) return null;
  const behind = samples.value
    .filter((sample) => sample.blocking_pid === pid)
    .map((sample) => sample.wait_seconds ?? 0);
  return behind.length ? Math.max(...behind) : null;
};

const askAiForFix = (row: BlockedRow) => {
  emit("sendToAiChat", {
    query: buildBlockingFixPrompt({
      query: row.query,
      dbSystem: row.db_system,
      dbInstance: row.db_instance,
      pid: row.pid,
      application: row.application,
      idleSeconds: idleSecondsForRoot(row.pid),
      blockingCount: row.blockingCount,
      longestWaitSeconds: longestWaitBehind(row.pid),
    }),
    autoSend: true,
  });
};

const dbmContext = createDbmContextProvider(() => {
  const root = tableRows.value.find((row) => row.kind === "root");
  return {
    currentPage: "blocked_queries" as const,
    scope: {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      period: range.value.relativeTimePeriod,
      system: root?.db_system,
      instance: root?.db_instance,
    },
    focus: { blockingRootPid: root?.pid, blockingRootQuery: root?.query },
  };
}, store);

onMounted(() => {
  contextRegistry.register(DBM_CONTEXT_KEY, dbmContext);
  contextRegistry.setActive(DBM_CONTEXT_KEY);
  load();
  loadContext();
});

onBeforeUnmount(() => {
  contextRegistry.unregister(DBM_CONTEXT_KEY);
  contextRegistry.setActive("");
});
</script>
