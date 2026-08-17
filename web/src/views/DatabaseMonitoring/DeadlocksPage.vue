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
  Deadlocks — ranked by query pair, not listed by event.

  The lab produced 43 deadlocks from exactly 2 query pairs. An event log would
  be 43 near-identical rows and would leave the operator to notice the
  repetition themselves; ranking by pair puts the bug on row 1 with its
  frequency attached. The raw event list stays one toggle away for the case
  where a specific timestamp is what you need.

  Three structural choices, all shared with Top queries so the tabs read as one
  product:

    • Chrome is capped at the same ~250px, so ≥11 rows sit above the fold at
      1440×900. The expansion consumes its space IN PLACE rather than in a
      drawer, which is why three sibling rows stay visible beneath an open one.

    • The tab badge counts EVENTS (43) while the rows count PAIRS (2). "How
      much is happening" and "what is wrong" are different questions and each
      gets the number that answers it; row 1 saying "39 times" makes the
      relationship self-evident.

    • Empty means two opposite things here and they are never conflated:
      `not_collecting` says the database's log never arrives, while an empty
      list is the HEALTHY normal and is rendered as reassurance.
-->
<template>
  <DbmPageChrome
    :title="t('dbm.deadlocks.title')"
    :subtitle="t('dbm.deadlocks.subtitle')"
    title-data-test="dbm-deadlocks-title"
    date-time-data-test="dbm-deadlocks-date-time"
    :tab-counts="tabCounts"
    :range="range"
    @date-change="onDateChange"
  >
    <div class="flex min-h-0 flex-1 flex-col">
      <OTable
        :data="tableRows"
        :columns="columns"
        row-key="rowKey"
        :loading="loading"
        :frame="false"
        :error="error"
        sorting="client"
        expansion="multiple"
        :expand-on-row-click="true"
        :show-global-filter="false"
        table-id="dbm-deadlocks"
        :row-class="rowClass"
        :total-count-exact="!truncated"
        data-test="dbm-deadlocks-table"
      >
        <template #toolbar>
          <DbmTableToolbar
            v-model:search="search"
            :placeholder="t('dbm.deadlocks.searchPlaceholder')"
            :debounce="400"
            search-data-test="dbm-deadlocks-search"
            @search="load"
          >
            <DbmScopeFilters
              class="min-w-0 flex-1"
              :filters="dimensionFilters"
              @clear="clearScope"
            />
            <!-- What a ROW means. Not a data-processing mode — the reader is
                 choosing between "name the bug" and "give me a timestamp". -->
            <OToggleGroup v-model="grouping" class="shrink-0" data-test="dbm-deadlocks-grouping">
              <OToggleGroupItem value="pairs" size="sm">
                {{ t("dbm.deadlocks.grouping.pairs") }}
                <OTooltip side="bottom" :content="t('dbm.deadlocks.grouping.pairsHint')" />
              </OToggleGroupItem>
              <OToggleGroupItem value="events" size="sm">
                {{ t("dbm.deadlocks.grouping.events") }}
                <OTooltip side="bottom" :content="t('dbm.deadlocks.grouping.eventsHint')" />
              </OToggleGroupItem>
            </OToggleGroup>
          </DbmTableToolbar>
        </template>

        <template #toolbar-trailing>
          <DbmRefreshButton
            :loading="loading"
            :last-run-at="lastRunAt"
            data-test="dbm-deadlocks-refresh"
            @refresh="onRefresh"
          />
        </template>

        <template #subheader>
          <!-- The window's counts live inside the table frame, not in the page
               header: they summarise exactly the rows below. -->
          <DbmSubheaderBand data-test="dbm-deadlocks-summary">
            <OStatStrip :items="summaryStats" :loading="loading" />
          </DbmSubheaderBand>

          <!-- ONE storm band, not two. The completion-bias caution has no
               condition of its own beyond `storm`, so it rides inside this
               band — as its own band it could only ever arrive stacked under
               this one, saying something about the same situation. -->
          <OBanner
            v-if="storm"
            variant="error"
            dense
            inline-actions
            icon="warning-amber"
            class="rounded-none border-b border-(--color-status-error-text)/25"
            data-test="dbm-deadlocks-storm"
          >
            <span class="font-bold">{{ t("dbm.deadlocks.storm.title") }}</span>
            {{ stormBody }}
            <span class="block">{{ t("dbm.deadlocks.storm.biasWarning") }}</span>
            <template #actions>
              <OButton
                variant="primary"
                size="sm"
                icon-left="content-copy"
                data-test="dbm-deadlocks-storm-copy"
                @click="copyStormSummary()"
              >
                {{ t("dbm.deadlocks.storm.copyForSlack") }}
                <!-- The label is the bare word "Copy", so what lands on the
                     clipboard has to be said somewhere. Its twin inside the
                     expansion (DbmDeadlockCycle) already explained itself; this
                     one did not, and the two do the same job. -->
                <OTooltip side="bottom" :content="t('dbm.deadlocks.detail.copyForSlackHint')" />
              </OButton>
            </template>
          </OBanner>

          <!-- The database logs every deadlock it resolves, so this is not a
               sample — unless the read hit its cap, which is what `truncated`
               says and what turns the claim into a floor. -->
          <DbmLockCoverageLine
            v-if="rows.length"
            :summary="coverageLine"
            :dot-class="truncated ? 'bg-status-warning-text' : 'bg-status-success-text'"
            :trailing-label="readUpToLabel"
            data-test="dbm-deadlocks-coverage"
          />
        </template>

        <!-- The finding IS the collision, so the two statements share one cell
             with the ⇄ between them rather than sitting in two columns. -->
        <template #cell-pair="{ row }">
          <div class="flex min-w-0 flex-col gap-px">
            <div class="text-text-code min-w-0 truncate font-mono text-xs" :title="row.pairTitle">
              <template v-if="row.queries[0]">
                {{ raw(row.queries[0]) }}
                <span v-if="row.queries[1]" class="text-text-label px-1">{{ raw("⇄") }}</span>
                {{ raw(row.queries[1] ?? "") }}
              </template>
              <span v-else class="text-text-secondary italic">
                {{ t("dbm.deadlocks.detail.noQueryCaptured") }}
              </span>
            </div>
            <div class="text-text-label text-3xs flex min-w-0 items-center gap-1 truncate">
              <OTag type="dbSystem" :value="row.db_system" size="xs" />
              <template v-if="row.db_instance">
                <span class="opacity-45">·</span>
                <span>{{ raw(row.db_instance) }}</span>
              </template>
              <span
                v-for="chip in row.chips"
                :key="chip.id"
                class="rounded-default text-3xs ml-0.5 px-1 py-px font-semibold tracking-wide uppercase"
                :class="chip.tone"
              >
                {{ chip.label }}
              </span>
            </div>
          </div>
        </template>

        <template #cell-applications="{ row }">
          <div class="flex flex-col items-end leading-tight">
            <span
              v-for="(app, index) in row.applications.slice(0, 2)"
              :key="app"
              class="truncate font-mono text-xs"
              :class="index === 0 ? 'text-text-body' : 'text-text-muted'"
            >
              {{ raw(app) }}
            </span>
            <span v-if="!row.applications.length" class="text-text-muted">{{ raw("—") }}</span>
          </div>
        </template>

        <template #cell-objects="{ row }">
          <div class="flex flex-col items-end leading-tight">
            <span class="text-text-heading text-compact font-mono font-medium tabular-nums">
              {{ row.objects.length || raw("—") }}
            </span>
            <span class="text-text-label text-3xs truncate">{{ raw(row.objects[0] ?? "") }}</span>
          </div>
        </template>

        <template #cell-lastSeen="{ row }">
          <div class="flex flex-col items-end leading-tight">
            <span class="text-text-body font-mono text-xs tabular-nums">
              {{ formatClock(row.lastSeen) }}
            </span>
            <span class="text-text-label text-3xs">{{ formatAge(row.lastSeen) }}</span>
          </div>
        </template>

        <!-- Count, share and trend in ONE cell: three facts about the same
             quantity, so the comparison is pre-made rather than reassembled. -->
        <template #cell-count="{ row }">
          <div class="flex items-center justify-end gap-1.5">
            <div class="flex flex-col items-end leading-tight">
              <span class="text-text-heading text-compact font-mono font-semibold tabular-nums">
                {{ row.count }}
                <span class="text-text-label text-3xs font-normal">
                  {{ formatPercent(row.share, 0) }}
                </span>
              </span>
              <DbmShareBar
                :share="row.share"
                track-class="mt-0.5 h-1 w-14"
                :fill-class="row.critical ? 'bg-status-error-text' : 'bg-status-warning-text'"
              />
            </div>
          </div>
        </template>

        <template #cell-actions="{ row }">
          <DbmRowActions
            :actions="rowActions"
            data-test="dbm-deadlocks-row-actions"
            @action="(id) => onRowAction(id, row)"
          />
        </template>

        <!-- The cycle, IN PLACE. Never a drawer: a drawer covers the rows it is
             describing, and the sibling rows are the context that makes one
             deadlock legible as part of a pattern. -->
        <template #expansion="{ row }">
          <div class="bg-surface-panel px-3 py-2.5" data-test="dbm-deadlocks-expansion">
            <div v-if="row.selectedEvent" class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <span class="text-text-heading text-xs font-semibold">
                  {{
                    t("dbm.deadlocks.detail.mostRecent", {
                      time: formatClockMs(row.selectedEvent.timestamp),
                    })
                  }}
                </span>
                <span
                  class="bg-surface-subtle text-text-secondary rounded-default text-3xs px-1.5 py-px font-medium"
                >
                  {{
                    t("dbm.deadlocks.detail.nthOf", {
                      index: row.selectedEventIndex + 1,
                      total: row.count,
                    })
                  }}
                </span>
                <div class="flex-1"></div>
                <OButton
                  variant="ghost-muted"
                  size="sm"
                  icon-left="chevron-left"
                  :disabled="row.selectedEventIndex >= row.count - 1"
                  data-test="dbm-deadlocks-earlier"
                  @click="stepEvent(row, 1)"
                >
                  {{ t("dbm.deadlocks.detail.earlier") }}
                </OButton>
                <OButton
                  variant="ghost-muted"
                  size="sm"
                  icon-left="chevron-right"
                  :disabled="row.selectedEventIndex <= 0"
                  data-test="dbm-deadlocks-later"
                  @click="stepEvent(row, -1)"
                >
                  {{ t("dbm.deadlocks.detail.later") }}
                </OButton>
              </div>

              <DbmDeadlockCycle
                :event="row.selectedEvent"
                :opposite-row-order="row.oppositeRowOrder"
                data-test="dbm-deadlocks-cycle"
                @participant-action="(id, p) => onParticipantAction(id, p, row)"
                @copy-summary="copySummary(row)"
                @ask-ai="askAiForFix(row)"
              />

              <!-- The repeats as a two-lane timeline rather than N rows: the
                   lanes carry the "victim alternates" finding, which is the
                   signature of a symmetric bug and is invisible per event. -->
              <div
                v-if="row.count > 1"
                class="border-border-default bg-surface-base rounded-default border px-2.5 py-2"
                data-test="dbm-deadlocks-occurrences"
              >
                <div class="mb-1.5 flex items-center gap-2">
                  <h4 class="text-text-label text-2xs font-semibold tracking-wide uppercase">
                    {{ t("dbm.deadlocks.detail.occurrencesTitle", { count: row.count }) }}
                  </h4>
                  <div class="flex-1"></div>
                  <span class="text-text-label text-3xs">
                    {{ t("dbm.deadlocks.detail.occurrencesHint") }}
                  </span>
                </div>

                <div class="flex flex-col gap-1">
                  <div v-for="lane in row.lanes" :key="lane.pid" class="flex items-center gap-2">
                    <span class="text-text-label text-3xs w-16 shrink-0 text-right font-mono">
                      {{ t("dbm.deadlocks.detail.lostLabel", { pid: lane.pid }) }}
                    </span>
                    <div
                      class="border-border-subtle relative h-4 min-w-0 flex-1 border-b border-dashed"
                    >
                      <button
                        v-for="point in lane.points"
                        :key="point.id"
                        type="button"
                        class="absolute top-1 size-2 -translate-x-1/2 rounded-full"
                        :class="
                          point.id === row.selectedEvent?.id
                            ? 'bg-status-error-text ring-2 ring-(--color-accent)'
                            : 'bg-status-error-text/80 hover:bg-status-error-text'
                        "
                        :style="leftPercent(point.offset)"
                        :aria-label="t('dbm.deadlocks.detail.showAbove')"
                        :data-test="`dbm-deadlocks-event-${point.id}`"
                        @click.stop="selectEvent(row, point.id)"
                      >
                        <!-- The dot carried an `aria-label` and nothing else,
                             so a screen reader knew what it did and a sighted
                             mouse user did not: an unlabelled 8px circle with
                             no hover text. Same string, now reaching both. -->
                        <OTooltip side="top" :content="t('dbm.deadlocks.detail.showAbove')" />
                      </button>
                    </div>
                  </div>
                </div>

                <p class="text-text-label text-3xs mt-1.5">
                  {{ row.victimSummary }}
                </p>
              </div>
            </div>
          </div>
        </template>

        <!-- Two opposite meanings of "empty", never conflated. -->
        <template #empty>
          <DbmLockEmptyState
            v-if="!loading && notCollecting"
            :healthy="false"
            :title="t('dbm.deadlocks.notCollecting.title')"
            :description="t('dbm.deadlocks.notCollecting.description')"
            :checklist-title="t('dbm.deadlocks.notCollecting.checklistTitle')"
            :checks="notCollectingChecks"
            data-test="dbm-deadlocks-not-collecting"
          />
          <DbmLockEmptyState
            v-else-if="!loading"
            :healthy="true"
            :title="t('dbm.deadlocks.healthy.title')"
            :description="t('dbm.deadlocks.healthy.description')"
            :checklist-title="t('dbm.deadlocks.healthy.checklistTitle')"
            :checks="healthyChecks"
            :actions="healthyActions"
            :collection-healthy-label="t('dbm.deadlocks.healthy.collectionHealthy')"
            data-test="dbm-deadlocks-healthy"
            @action="onEmptyAction"
          />
        </template>
      </OTable>
    </div>
  </DbmPageChrome>
</template>

<script setup lang="ts">
// Explicit name so <keep-alive :include> in DbmShell.vue matches this view.
// Without it the name is inferred from the FILENAME, so a rename would
// silently drop the page from the cache and bring back the refetch-on-return.
defineOptions({ name: "DbmDeadlocksPage" });

import { computed, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmDeadlockCycle from "@/components/dbm/DbmDeadlockCycle.vue";
import DbmLockCoverageLine from "@/components/dbm/DbmLockCoverageLine.vue";
import DbmPageChrome from "@/components/dbm/DbmPageChrome.vue";
import DbmRefreshButton from "@/components/dbm/DbmRefreshButton.vue";
import DbmRowActions, { type DbmRowAction } from "@/components/dbm/DbmRowActions.vue";
import DbmScopeFilters from "@/components/dbm/DbmScopeFilters.vue";
import DbmShareBar from "@/components/dbm/DbmShareBar.vue";
import DbmSubheaderBand from "@/components/dbm/DbmSubheaderBand.vue";
import DbmTableToolbar from "@/components/dbm/DbmTableToolbar.vue";
import DbmLockEmptyState, {
  type DbmLockCheck,
  type DbmLockEmptyAction,
} from "@/components/dbm/DbmLockEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, {
  type DeadlockEvent,
  type DeadlockParticipant,
} from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { tabCountProps } from "@/composables/dbm/useDbmTabCounts";
import { useDbmListPage } from "@/composables/dbm/useDbmListPage";
import { useDbmScopeFilters } from "@/composables/dbm/useDbmScopeFilters";
import { createDbmContextProvider } from "@/composables/contextProviders";
import { copyToClipboard } from "@/utils/clipboard";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import { buildDbmLockPrefill } from "@/utils/alerts/prefill/fromDbmLocks";
import { buildDeadlockFixPrompt } from "@/utils/dbm/aiPrompts";
import {
  deadlockCadenceSeconds,
  groupDeadlocks,
  hasOppositeRowOrder,
  isDeadlockStorm,
  parseDeadlockEvents,
  DEADLOCK_DOMINANT_SHARE,
  type DeadlockPair,
} from "@/utils/dbm/deadlocks";
import {
  countClaim,
  discriminatingPart,
  formatAge,
  formatClock,
  formatPercent,
  formatWhenWithAge,
} from "@/utils/dbm/format";
import { buildDbmNotCollectingChecks } from "@/utils/dbm/notCollecting";
import { DBM_STATUS_TONES } from "@/utils/dbm/tones";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

// This page is a route root, so MainLayout's `@sendToAiChat` binding is on it
// directly — no re-emit chain needed.
const emit = defineEmits<{
  (e: "sendToAiChat", value: { query: string; autoSend: boolean }): void;
}>();

// The shared list-page spine: scope from the URL, the request-sequence guard,
// the shell's badge snapshot, refresh/date-change handlers, the load envelope
// and the AI-context registry lifecycle. See useDbmListPage.
const {
  scope: { range, rangeMinutes, current, setPeriod, queryParams },
  requestSeq,
  tabCountsContext,
  loading,
  error,
  search,
  lastRunAt,
  org,
  dbmEnabled,
  queryCount,
  databaseCount,
  run,
  onRefresh,
  onDateChange,
} = useDbmListPage({
  load: () => load(),
  context: () => dbmContext,
  syncUrl: () => syncUrl(),
  // This page's event total, from the read it actually performed under its own
  // filters — published so the badge reads the same from every tab.
  // `undefined` until this page has actually read: `eventCount` starts at 0,
  // and publishing that pre-load zero would stamp "no deadlocks" over the
  // shell's real count on every tab. See dbmTabCountsResilience.spec.ts.
  ownCounts: [
    {
      key: "deadlockCount",
      value: () => (lastRunAt.value === null ? undefined : eventCount.value),
    },
  ],
});

const events = shallowRef<DeadlockEvent[]>([]);
const eventCount = ref(0);
/** The server capped the read, so `eventCount` is a floor rather than a total. */
const truncated = ref(false);
/** The database's log never arrives — distinct from "no deadlocks happened". */
const notCollecting = ref(false);
const mysqlPrintAll = ref<boolean | null>(null);
const logLinesSeen = ref<number | null>(null);
const lastSeenBefore = ref<number | null>(null);
const readUpTo = ref<number | null>(null);
/**
 * The sibling badges from the shell's shared fan-out, plus THIS tab's own
 * count in place of the shared one.
 *
 * `eventCount` is the EVENT total this page loaded — deliberately a different
 * grain from the query-pair count the table shows (see DbmSectionTabs), and
 * fresher than the shared read.
 *
 * Passed as a bare number: the shared snapshot carries a `DbmCountClaim` here
 * so a capped read renders `65+`, but this page's own badge states the total
 * it loaded and `truncated` is already disclosed beside the table.
 */
/** Every badge, from the shell's shared snapshot — this page's own included. */
const tabCounts = computed(() => tabCountProps(tabCountsContext.counts.value));

const grouping = ref<string>("pairs");
/** Which event of a pair the expansion is showing, by pair key. */
const selectedEventByPair = ref<Record<string, string>>({});

interface DeadlockRow {
  rowKey: string;
  pairKey: string;
  queries: string[];
  pairTitle: string;
  db_system: string;
  db_instance?: string | null;
  applications: string[];
  objects: string[];
  lastSeen: number;
  count: number;
  share: number;
  critical: boolean;
  oppositeRowOrder: boolean;
  chips: { id: string; label: I18nText; tone: string }[];
  selectedEvent: DeadlockEvent | null;
  selectedEventIndex: number;
  lanes: { pid: string; points: { id: string; offset: number }[] }[];
  victimSummary: I18nText;
  events: DeadlockEvent[];
}

const rows = computed<DeadlockPair[]>(() => groupDeadlocks(events.value));

const storm = computed(() =>
  isDeadlockStorm(eventCount.value, rangeMinutes.value, truncated.value),
);

/** Rows are PAIRS by default; the event view is one row per deadlock. */
const tableRows = computed<DeadlockRow[]>(() =>
  grouping.value === "events" ? eventRows.value : pairRows.value,
);

const chipFor = (pair: DeadlockPair) => {
  const chips: { id: string; label: I18nText; tone: string }[] = [];
  if (hasOppositeRowOrder(pair)) {
    chips.push({
      id: "opposite",
      label: t("dbm.deadlocks.chips.oppositeOrder"),
      tone: DBM_STATUS_TONES.error,
    });
  }
  const cadence = deadlockCadenceSeconds(pair);
  if (cadence != null) {
    chips.push({
      id: "cadence",
      label: t("dbm.deadlocks.chips.cadence", { seconds: cadence }),
      tone: DBM_STATUS_TONES.neutral,
    });
  }
  if (!pair.queries[0]) {
    chips.push({
      id: "no-queries",
      label: t("dbm.deadlocks.chips.noQueries"),
      tone: DBM_STATUS_TONES.warning,
    });
  }
  // A pair built from one-sided events shows one statement where the reader
  // expects a collision — the chip explains that before they wonder.
  if (pair.events.some((e) => e.partial)) {
    chips.push({
      id: "partial",
      label: t("dbm.deadlocks.chips.partial"),
      tone: DBM_STATUS_TONES.warning,
    });
  }
  return chips;
};

/**
 * The two lanes of the occurrence strip — one per pid that was ever cancelled.
 * Alternating dots ARE the finding, so the lanes exist even when one side
 * dominates.
 */
const lanesFor = (pair: DeadlockPair) => {
  const span = Math.max(1, pair.lastSeen - pair.firstSeen);
  const pids = Object.keys(pair.victimCounts);
  return pids.map((pid) => ({
    pid,
    points: pair.events
      .filter((e) => e.participants.some((p) => p.victim && String(p.pid) === pid))
      .map((e) => ({ id: e.id, offset: (e.timestamp - pair.firstSeen) / span })),
  }));
};

const victimSummaryFor = (pair: DeadlockPair): I18nText => {
  const counts = Object.entries(pair.victimCounts);
  if (counts.length > 1) {
    return t("dbm.deadlocks.detail.bothSidesLose", {
      a: counts[0][1],
      b: counts[1][1],
    });
  }
  return counts.length ? t("dbm.deadlocks.detail.oneSideLoses", { pid: counts[0][0] }) : raw("");
};

const selectedEventFor = (pair: DeadlockPair): DeadlockEvent | null => {
  const chosen = selectedEventByPair.value[pair.pairKey];
  return pair.events.find((e) => e.id === chosen) ?? pair.events[0] ?? null;
};

const pairRows = computed<DeadlockRow[]>(() =>
  rows.value.map((pair) => {
    const selectedEvent = selectedEventFor(pair);
    return {
      rowKey: pair.pairKey,
      pairKey: pair.pairKey,
      // The two statements are near-identical apart from the row they name, so
      // the FULL text truncates before reaching the difference — which is the
      // whole finding. `discriminatingPart` anchors each side on its WHERE
      // clause, putting `id = 2 ⇄ id = 1` inside the visible width.
      queries: pair.queries.filter(Boolean).map(discriminatingPart),
      pairTitle: pair.queries.filter(Boolean).join(" ⇄ "),
      db_system: pair.db_system,
      db_instance: pair.db_instance,
      applications: pair.applications,
      objects: pair.objects,
      lastSeen: pair.lastSeen,
      count: pair.count,
      share: pair.share,
      // The dominant pair earns the red rail; a minority one does not.
      critical: pair.share >= DEADLOCK_DOMINANT_SHARE,
      oppositeRowOrder: hasOppositeRowOrder(pair),
      chips: chipFor(pair),
      selectedEvent,
      selectedEventIndex: Math.max(
        0,
        pair.events.findIndex((e) => e.id === selectedEvent?.id),
      ),
      lanes: lanesFor(pair),
      victimSummary: victimSummaryFor(pair),
      events: pair.events,
    };
  }),
);

/** One row per deadlock, newest first — for when a timestamp is the question. */
const eventRows = computed<DeadlockRow[]>(() =>
  [...events.value]
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((event) => {
      const queries = event.participants.map((p) => p.query ?? "").filter(Boolean);
      return {
        rowKey: event.id,
        pairKey: event.id,
        queries: queries.map(discriminatingPart),
        pairTitle: queries.join(" ⇄ "),
        db_system: event.db_system,
        db_instance: event.db_instance,
        applications: event.participants
          .map((p) => p.application ?? (p.pid != null ? String(p.pid) : ""))
          .filter(Boolean),
        objects: event.objects ?? [],
        lastSeen: event.timestamp,
        count: 1,
        share: eventCount.value > 0 ? 1 / eventCount.value : 0,
        critical: false,
        oppositeRowOrder: false,
        chips: [],
        selectedEvent: event,
        selectedEventIndex: 0,
        lanes: [],
        victimSummary: raw(""),
        events: [event],
      };
    }),
);

const columns = computed<OTableColumnDef<DeadlockRow>[]>(() => [
  {
    id: "pair",
    accessorKey: "pairTitle",
    header: t("dbm.deadlocks.columns.pair"),
    // By far the widest column: it holds BOTH statements with the ⇄ between
    // them, and the collision is the finding. Without an explicit size the
    // table shared width evenly and the row truncated before the ⇄, hiding
    // exactly what the reader came for. Sized so the second statement's WHERE
    // clause clears the fold without starving the Applications column.
    size: 560,
    enableSorting: false,
  },
  {
    id: "applications",
    accessorKey: "applications",
    header: t("dbm.deadlocks.columns.applications"),
    size: 132,
    meta: { align: "right" },
    enableSorting: false,
  },
  {
    id: "objects",
    accessorKey: "objects",
    header: t("dbm.deadlocks.columns.objects"),
    size: 104,
    meta: { align: "right" },
    enableSorting: false,
  },
  {
    id: "lastSeen",
    accessorKey: "lastSeen",
    header: t("dbm.deadlocks.columns.lastSeen"),
    size: 96,
    meta: { align: "right" },
  },
  {
    id: "count",
    accessorKey: "count",
    header: t("dbm.deadlocks.columns.count"),
    size: 120,
    meta: { align: "right" },
  },
  {
    id: "actions",
    header: raw(""),
    size: 96,
    enableSorting: false,
    meta: { align: "right" },
  },
]);

/** Only what the handler implements. "Show the deadlock" was a no-op anyway —
 *  a row click already expands the cycle in place. */
const rowActions = computed<DbmRowAction[]>(() => [
  { id: "top-queries", icon: "filter-list", label: t("dbm.deadlocks.rowActions.topQueries") },
  { id: "copy", icon: "content-copy", label: t("dbm.deadlocks.rowActions.copy") },
  { id: "alert", icon: "shield", label: t("dbm.deadlocks.rowActions.alert") },
]);

/**
 * The window's counts, over the rows below. "Not collecting" is an em dash
 * rather than a zero: nothing reporting deadlocks is not the same claim as no
 * deadlocks happening, and the empty state below says which.
 */
const summaryStats = computed<StatItem[]>(() => [
  {
    key: "deadlocks",
    label: t("dbm.deadlocks.summary.deadlocks"),
    value: notCollecting.value ? raw("—") : eventCount.value,
    icon: "swap-horiz",
    tone: eventCount.value > 0 ? "error" : "neutral",
    dataTest: "dbm-deadlocks-summary-deadlocks",
  },
  {
    key: "pairs",
    label: t("dbm.deadlocks.summary.pairs"),
    value: notCollecting.value ? raw("—") : rows.value.length,
    icon: "filter-list",
    tone: "neutral",
    dataTest: "dbm-deadlocks-summary-pairs",
  },
]);

/**
 * The completeness claim, but only when the read was actually complete. At the
 * cap `eventCount` is the number the CAP chose, so "every deadlock is here"
 * states the one thing the response already denies.
 */
const coverageLine = computed<I18nText>(() => {
  const claim = countClaim(eventCount.value, truncated.value);
  const params = {
    deadlocks: t("dbm.deadlocks.deadlockCount", { count: claim.count }, claim.count),
    pairs: t("dbm.deadlocks.pairCount", { count: rows.value.length }, rows.value.length),
  };
  return claim.complete
    ? t("dbm.deadlocks.coverage.complete", params)
    : t("dbm.deadlocks.coverage.capped", params);
});

const readUpToLabel = computed<I18nText | null>(() =>
  readUpTo.value
    ? t("dbm.deadlocks.coverage.readUpTo", { time: formatClock(readUpTo.value) })
    : null,
);

const stormBody = computed<I18nText>(() =>
  t("dbm.deadlocks.storm.body", { count: eventCount.value }),
);

// ── the two empty states ────────────────────────────────────────────────────

/** Reassurance, with the evidence that we actually looked. */
const healthyChecks = computed<DbmLockCheck[]>(() => {
  const list: DbmLockCheck[] = [
    {
      id: "reading",
      status: "ok",
      title: t("dbm.deadlocks.healthy.checks.reading.title"),
      // `databaseCount` is the TRACE-vantage fleet count, and this page is
      // server-vantage: a collector-only org reports 0 here while its deadlock
      // log is being read normally. So the clause is dropped rather than
      // printed as "0 databases", which would deny the very reading this
      // healthy state exists to confirm.
      detail: readUpTo.value
        ? databaseCount.value
          ? t("dbm.deadlocks.healthy.checks.reading.detail", {
              databases: t("dbm.databases.databaseCount", databaseCount.value),
              age: formatAge(readUpTo.value),
            })
          : t("dbm.deadlocks.healthy.checks.reading.detailNoFleet", {
              age: formatAge(readUpTo.value),
            })
        : databaseCount.value
          ? t("dbm.deadlocks.healthy.checks.reading.detailUnknown", {
              databases: t("dbm.databases.databaseCount", databaseCount.value),
            })
          : t("dbm.deadlocks.healthy.checks.reading.detailUnknownNoFleet"),
    },
    {
      id: "reporting",
      // `innodb_print_all_deadlocks` is a MySQL server variable. With it OFF the
      // engine writes nothing, so its absence is indistinguishable from "no
      // deadlocks happened" — there is no telemetry that could tell us. The
      // backend therefore sends `null` = UNKNOWN, and this stays a "!" item the
      // reader is asked to CHECK. Claiming a ✓ here would be the one thing this
      // whole screen exists to prevent: stating as observed something we only
      // assumed.
      status: mysqlPrintAll.value === true ? "ok" : "note",
      title:
        mysqlPrintAll.value === true
          ? t("dbm.deadlocks.healthy.checks.reporting.title")
          : t("dbm.deadlocks.healthy.checks.reporting.titleUnknown"),
      detail:
        mysqlPrintAll.value === true
          ? t("dbm.deadlocks.healthy.checks.reporting.detail")
          : mysqlPrintAll.value === false
            ? t("dbm.deadlocks.healthy.checks.reporting.detailMysqlPartial")
            : t("dbm.deadlocks.healthy.checks.reporting.detailUnknown"),
    },
  ];

  if (logLinesSeen.value != null) {
    list.push({
      id: "traffic",
      status: "ok",
      title: t("dbm.deadlocks.healthy.checks.traffic.title", { lines: logLinesSeen.value }),
      detail: t("dbm.deadlocks.healthy.checks.traffic.detail"),
    });
  } else {
    list.push({
      id: "traffic",
      status: "ok",
      title: t("dbm.deadlocks.healthy.checks.traffic.titleUnknown"),
      detail: t("dbm.deadlocks.healthy.checks.traffic.detail"),
    });
  }

  // The offer that converts a dead end into a starting point.
  list.push(
    lastSeenBefore.value
      ? {
          id: "last-ever",
          status: "note",
          title: t("dbm.deadlocks.healthy.checks.lastEver.title"),
          detail: t("dbm.deadlocks.healthy.checks.lastEver.detail", {
            when: formatWhenWithAge(lastSeenBefore.value),
          }),
        }
      : {
          id: "last-ever",
          status: "note",
          title: t("dbm.deadlocks.healthy.checks.lastEver.titleNone"),
          detail: t("dbm.deadlocks.healthy.checks.lastEver.detailNone"),
        },
  );

  return list;
});

/** `widen` is the only one `onEmptyAction` implements. */
const healthyActions = computed<DbmLockEmptyAction[]>(() => [
  { id: "widen", label: t("dbm.deadlocks.healthy.widen") },
]);

// The shared queries/enabled diagnostics in this page's namespace, plus the
// missing prerequisite this page names: the database's own log.
const notCollectingChecks = computed<DbmLockCheck[]>(() =>
  buildDbmNotCollectingChecks(
    "deadlocks",
    {
      queryCount: queryCount.value,
      databaseCount: databaseCount.value,
      dbmEnabled: dbmEnabled.value,
    },
    t,
    [
      {
        id: "log",
        status: "fail",
        title: t("dbm.deadlocks.notCollecting.checks.log.no"),
        detail: t("dbm.deadlocks.notCollecting.checks.log.noDetail"),
      },
      {
        // The trap the capture proof found: a config matching only the first
        // log line records the count and loses every participant query.
        id: "settings",
        status: "note",
        title: t("dbm.deadlocks.notCollecting.checks.settings.title"),
        detail: t("dbm.deadlocks.notCollecting.checks.settings.detail"),
      },
    ],
  ),
);

// ── formatting ──────────────────────────────────────────────────────────────

const formatClockMs = (micros: number): string => {
  const ms = String(Math.floor((micros / 1000) % 1000)).padStart(3, "0");
  return `${formatClock(micros)}.${ms}`;
};

/** A dot's position along its lane, as a percentage of the pair's time span. */
const leftPercent = (offset: number) => ({ left: `${Math.round(offset * 100)}%` });

// eslint-disable-next-line local/no-hardcoded-px -- state rail: a 3-device-pixel inset shadow, which must not scale with text or it blurs at fractional zoom
const CRITICAL_RAIL = "shadow-[inset_3px_0_0_var(--color-status-error-text)]";

const rowClass = (row: DeadlockRow) => (row.critical ? CRITICAL_RAIL : "");

// ── behaviour ───────────────────────────────────────────────────────────────

const selectEvent = (row: DeadlockRow, eventId: string) => {
  selectedEventByPair.value = { ...selectedEventByPair.value, [row.pairKey]: eventId };
};

/** `+1` walks back in time, because the list is newest-first. */
const stepEvent = (row: DeadlockRow, direction: number) => {
  const next = row.events[row.selectedEventIndex + direction];
  if (next) selectEvent(row, next.id);
};

const onRowAction = (id: string, row: DeadlockRow) => {
  if (id === "copy") {
    copyToClipboard(row.queries.join("\n\n"), t);
    return;
  }
  if (id === "top-queries") {
    router.push({
      name: "dbmQueries",
      query: { ...route.query, search: row.queries[0] ?? "", system: row.db_system },
    });
    return;
  }
  if (id === "alert") {
    // Instance scope rather than pair scope. The row IS a query pair, but a
    // deadlock alert pinned to one pair goes dark the moment the application
    // deploys a slightly different statement — and the thing worth being woken
    // for is "this database is deadlocking", not "this exact pair returned".
    //
    // `row.count` is the events THIS pair produced in the window, which is the
    // count the operator is looking at when they arm the alert.
    requestAlertCreation(
      buildDbmLockPrefill({
        kind: "deadlocks",
        dbSystem: row.db_system,
        dbInstance: row.db_instance,
        observedEvents: row.count,
        periodMinutes: rangeMinutes.value,
      }),
    );
  }
};

const onParticipantAction = (id: string, participant: DeadlockParticipant, row: DeadlockRow) => {
  if (id === "copy") {
    copyToClipboard(participant.query ?? "", t);
    return;
  }
  if (id === "top-queries") {
    router.push({
      name: "dbmQueries",
      query: { ...route.query, search: participant.query ?? "", system: row.db_system },
    });
    return;
  }
  if (id === "which-service") {
    // The callers view answers "which service ran this" — it is the query
    // detail page's endpoint breakdown, reached by fingerprint.
    //
    // `stream` is deliberately NOT passed. The deadlocks payload has no
    // trace_stream_name to give (a server-vantage event knows its database,
    // not which trace stream the client spans landed in), and the detail page
    // already resolves it: explicit param -> the row's stream -> the org's sole
    // trace stream -> otherwise its stream picker. Omitting it degrades into
    // that picker instead of a 400 from /query/endpoints, which requires both.
    if (!participant.fingerprint) return;
    router
      .push({
        name: "dbmQueryDetail",
        query: {
          ...route.query,
          fingerprint: participant.fingerprint,
          system: row.db_system,
          // The back affordance and the tab strip both honor the origin — a
          // Deadlocks reader must not be handed back to Top queries.
          from: "deadlocks",
          // No `tab` param: the query detail page is a single scroll with no
          // tabs and never reads one, so passing it only put a dead key in the
          // URL that a reader would reasonably expect to select something.
        },
      })
      .catch(() => {});
  }
};

/**
 * A paste-ready summary — the artefact that actually reaches the owning team.
 *
 * Two rules, both learned the hard way and shared with `incidentSummary.ts`:
 *
 *  • An ABSOLUTE time, never a bare clock. "last at 14:22" pasted into a
 *    channel is unreadable the next day, and a deadlock summary is read after
 *    the fact by definition.
 *  • FENCED SQL. Unfenced multi-line statements get reflowed by Slack into one
 *    unreadable line, which is exactly the content the reader needs intact.
 */
const summaryLines = (row: DeadlockRow): string[] => [
  `*Deadlock on ${row.db_system}${row.db_instance ? ` / ${row.db_instance}` : ""}*`,
  `${row.count} time(s), last at ${new Date(row.lastSeen / 1000).toISOString()}`,
  "```",
  ...row.queries.map((q, i) => `${i + 1}. ${q}`),
  "```",
];

const copySummary = (row: DeadlockRow) => {
  copyToClipboard(summaryLines(row).join("\n"), t);
};

/**
 * The STORM banner's own summary — every pair, not just the first.
 *
 * This button sits under "{count} deadlocks in this window", so a single-pair
 * summary here would put a fleet-wide headline over one pair's detail: the
 * label promising one thing while the clipboard holds another.
 */
const copyStormSummary = () => {
  const rows = tableRows.value;
  if (!rows.length) return;
  const header = `*${eventCount.value} deadlocks in this window, from ${rows.length} query pair(s)*`;
  copyToClipboard([header, "", ...rows.flatMap((r) => [...summaryLines(r), ""])].join("\n"), t);
};

const onEmptyAction = (id: string) => {
  if (id === "widen") {
    setPeriod("1d");
    // Through the page's own `syncUrl` rather than a hand-rolled replace, so
    // widening the window carries the scope filters along with the range —
    // the inline version wrote only the range and dropped them.
    syncUrl();
    load();
  }
};

// ─── Filters ─────────────────────────────────────────────────────────────────

// The three dimensions `/deadlocks` accepts, seeded from the URL so scope
// carried in from a sibling tab actually applies. This page ALREADY wrote
// `system` into the URL on both drill-outs (see `onRowAction` /
// `onParticipantAction`) while ignoring it on arrival — so it produced scoped
// links it could not itself honour. Reading it here closes that loop.
const {
  filters: dimensionFilters,
  requestParams: scopeParams,
  queryParams: scopeQuery,
  clear: clearScopeModels,
} = useDbmScopeFilters({
  query: route.query,
  // Re-read on activation: this page is kept alive, so its setup-time seed
  // above goes stale the moment a sibling tab changes the scope.
  liveQuery: () => route.query,
  // Adopting a sibling tab's scope changes the chip; only this changes the rows.
  onScopeAdopted: () => void load(),
  // Options come from the EVENTS, not the table rows: `DeadlockRow` drops
  // `db_namespace` in both builders, so deriving from the rendered rows would
  // silently offer an empty schema select.
  options: () => ({
    system: events.value.map((e) => e.db_system),
    instance: events.value.map((e) => e.db_instance),
    namespace: events.value.map((e) => e.db_namespace),
  }),
  apply: () => {
    syncUrl();
    load();
  },
});

const clearScope = () => {
  clearScopeModels();
  search.value = "";
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
        ...scopeQuery.value,
        search: search.value || undefined,
      },
    })
    .catch(() => {});
};

const load = () =>
  run(
    async (token) => {
      const { data } = await dbMonitoringService.getDeadlocks(org.value, {
        startTime: current.value.startTime,
        endTime: current.value.endTime,
        search: search.value || undefined,
        ...scopeParams.value,
      });

      // A newer search or window already owns the page.
      if (requestSeq.isStale(token)) return;

      // The wire rows carry participants as a JSON string, and MySQL splits one
      // deadlock across several entries — both are resolved here.
      events.value = parseDeadlockEvents(data.hits ?? []);
      // Prefer the server's uncapped total: the badge must say how much is
      // happening, not how much fitted in the row limit.
      eventCount.value = data.total ?? events.value.length;
      truncated.value = Boolean(data.truncated);
      notCollecting.value = Boolean(data.not_collecting);
      mysqlPrintAll.value = data.innodb_print_all_deadlocks ?? null;
      logLinesSeen.value = data.log_lines_seen ?? null;
      lastSeenBefore.value = data.last_seen_before ?? null;
      readUpTo.value = data.freshness?.data_through ?? null;
    },
    {
      reset: () => {
        events.value = [];
        eventCount.value = 0;
        truncated.value = false;
      },
      onNotCollecting: () => {
        notCollecting.value = true;
      },
    },
  );

// ─── AI ──────────────────────────────────────────────────────────────────────

/**
 * "How do I stop this deadlock" — asked on the pair, from the expanded cycle.
 *
 * The statements come off the EVENT's participants, not off `row.queries`:
 * those are `discriminatingPart`-trimmed for the table's width, and sending a
 * fragment would have the model reason about a WHERE clause with no statement
 * around it.
 */
const askAiForFix = (row: DeadlockRow) => {
  const participants = row.selectedEvent?.participants ?? [];
  const queries = participants.map((p) => p.query ?? "").filter(Boolean);
  emit("sendToAiChat", {
    query: buildDeadlockFixPrompt({
      queries: queries.length ? queries : row.queries,
      dbSystem: row.db_system,
      dbInstance: row.db_instance,
      objects: row.objects,
      oppositeRowOrder: row.oppositeRowOrder,
      count: row.count,
      cadenceSeconds: cadenceFor(row),
      applications: row.applications,
    }),
    autoSend: true,
  });
};

/** The pair's recurrence gap, when the pair grouping produced one. */
const cadenceFor = (row: DeadlockRow): number | null => {
  const pair = rows.value.find((entry) => entry.pairKey === row.pairKey);
  return pair ? deadlockCadenceSeconds(pair) : null;
};

// Registered/unregistered by useDbmListPage around this page's lifecycle.
const dbmContext = createDbmContextProvider(() => {
  const focused = tableRows.value.find(
    (row) => row.selectedEvent?.id === selectedEventByPair.value[row.pairKey],
  );
  return {
    currentPage: "deadlocks" as const,
    scope: {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      period: range.value.relativeTimePeriod,
      system: focused?.db_system,
      instance: focused?.db_instance,
    },
    focus: {
      deadlockQueries: focused?.selectedEvent?.participants
        .map((p) => p.query ?? "")
        .filter(Boolean),
    },
  };
}, store);
</script>
