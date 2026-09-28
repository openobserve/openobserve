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
  <OPageLayout
    class="qp-2"
    :title="sessionDetails.id ? raw(sessionDetails.id) : t('rum.sessionReplay')"
    :back="{
      label: t('rum.sessionReplay'),
      onClick: () => router.back(),
      dataTest: 'session-viewer-back-btn',
    }"
    bleed
  >
    <template v-if="isLive" #title-trail>
      <OBadge variant="error" size="sm" dot data-test="session-viewer-live-badge">{{
        t("rum.sessionReplayLiveBadge")
      }}</OBadge>
    </template>
    <template v-if="!sessionNotFound" #subtitle>
      <div
        class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
        data-test="session-viewer-subtitle"
      >
        <div class="flex items-center gap-1.5 truncate text-xs">
          <OIcon name="language" size="sm" />
          {{ sessionDetails.ip }}
        </div>
        <div class="flex items-center gap-1.5 truncate text-xs">
          <OIcon name="calendar-month" size="sm" />
          {{ sessionDetails.date }}
        </div>
        <div
          v-if="sessionDetails.duration"
          class="flex items-center gap-1.5 truncate text-xs"
          data-test="session-viewer-duration"
        >
          <OIcon name="access-time" size="sm" />
          {{ sessionDetails.duration }}
        </div>
        <div class="flex items-center gap-1.5 truncate text-xs">
          <OIcon name="person" size="sm" />
          {{ sessionDetails.user_email || t("common.unknownUser") }}
        </div>
        <div class="flex items-center gap-1.5 truncate text-xs">
          <OIcon name="location-on" size="sm" />
          {{ sessionDetails.city }}, {{ sessionDetails.country }}
        </div>
        <div class="flex items-center gap-1.5 truncate text-xs">
          <OIcon name="settings" size="sm" />
          {{ sessionDetails.browser }}, {{ sessionDetails.os }}
        </div>
        <div
          v-if="frustrationCount > 0"
          class="flex items-center truncate text-xs"
          :title="
            t('rum.frustrationSignalsDetected', { count: frustrationCount }, frustrationCount)
          "
          data-test="session-viewer-frustration-summary"
        >
          <OIcon
            name="sentiment-very-dissatisfied"
            size="sm"
            class="text-severity-warning-color pe-1"
            data-test="frustration-summary-icon"
          />
          <span
            class="text-severity-warning-color font-semibold"
            data-test="frustration-summary-text"
            >{{ t("rum.frustration", { count: frustrationCount }, frustrationCount) }}</span
          >
        </div>
      </div>
    </template>
    <template v-if="!sessionNotFound" #actions>
      <ShareButton
        data-test="session-viewer-share-link-btn"
        :url="shareUrl"
        variant="outline"
        size="icon-toolbar"
      />
    </template>
    <OEmptyState
      v-if="sessionNotFound"
      size="hero"
      illustration="no-results"
      :title="t('rum.noReplayRecordedTitle')"
      :description="t('rum.noReplayRecordedMessage', { id: sessionId })"
      data-test="session-viewer-no-replay"
    />
    <div
      v-else
      class="bg-card-glass-bg flex h-[calc(100%-3.125)]! min-h-0 w-full flex-1 overflow-hidden"
    >
      <OSplitter
        v-model="splitterSize"
        :limits="[200, 1400]"
        unit="px"
        class="h-full w-full"
        separatorClass="bg-card-glass-border w-px! hover:bg-theme-accent"
      >
        <template #before>
          <div class="flex h-full min-h-0 flex-col">
            <div
              v-if="segmentNotice"
              class="bg-card-glass-bg text-text-secondary border-card-glass-border border-b px-3 py-1 text-xs"
              data-test="session-viewer-segment-notice"
            >
              {{ segmentNotice }}
            </div>
            <!-- Mobile SDKs record wireframes (not a DOM); play them with the wireframe
                 player. Browser sessions use the rrweb-based VideoPlayer. -->
            <MobileSessionPlayer
              v-if="isMobileReplay"
              ref="mobilePlayerRef"
              v-bind="playerBindings"
              v-model:speed="replaySpeed"
              v-model:skip-inactivity="replaySkipInactivity"
              v-model:intent="replayIntent"
              :segments="segments"
              :events="segmentEvents"
              :is-loading="segmentsLoading"
              class="min-h-0 flex-1"
              @ready="handlePlayerReady"
              @seek-request="requestSeek"
              @retry="handleRetry"
              @playback-state="playerPlaybackState = $event"
            />
            <VideoPlayer
              v-else
              ref="videoPlayerRef"
              v-bind="playerBindings"
              v-model:speed="replaySpeed"
              v-model:skip-inactivity="replaySkipInactivity"
              v-model:intent="replayIntent"
              :events="segmentEvents"
              :segments="segments"
              :is-loading="!!isLoading.length"
              :single-snapshot="singleSnapshot"
              class="min-h-0 flex-1"
              @ready="handlePlayerReady"
              @seek-request="requestSeek"
              @retry="handleRetry"
              @playback-state="playerPlaybackState = $event"
              @loaded-end-change="playerLoadedEndMs = $event"
              @segments-taken="playerTakenCount = $event"
            />
          </div>
        </template>
        <template #after>
          <PlayerEventsSidebar
            :events="segmentEvents"
            :sessionDetails="sessionDetails"
            :session-id="sessionId"
            :current-time="currentTime"
            :start-time="sessionState.data.selectedSession?.start_time || 0"
            :end-time="sessionState.data.selectedSession?.end_time || 0"
            @event-emitted="handleSidebarEvent"
            class="h-full"
          />
        </template>
      </OSplitter>
    </div>

    <!-- Event Detail Drawer -->
    <EventDetailDrawer
      v-model="showEventDetailDrawer"
      :event="selectedEvent"
      :raw-event="selectedRawEvent"
      :session-id="sessionId"
      :session-details="sessionDetails"
    />
  </OPageLayout>
</template>

<script lang="ts" setup>
import PlayerEventsSidebar from "@/components/rum/PlayerEventsSidebar.vue";
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import MobileSessionPlayer from "@/components/rum/MobileSessionPlayer.vue";
import {
  buildMobileTimeline,
  isMobileReplaySource,
} from "@/composables/rum/useMobileSessionReplay";
import EventDetailDrawer from "@/components/rum/EventDetailDrawer.vue";
import { cloneDeep } from "lodash-es";
import { computed, onBeforeMount, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import searchService from "@/services/search";
import useQuery from "@/composables/useQuery";
import useSessionsReplay from "@/composables/useSessionReplay";
import usePerformance from "@/composables/rum/usePerformance";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import useRum from "@/composables/rum/useRum";

import { formatDate } from "@/utils/date";
import {
  b64EncodeUnicode,
  durationFormatter,
  generateTraceContext,
  getUUID,
} from "@/utils/zincutils";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";
import { collapseViewDocuments } from "@/utils/rum/viewDocuments";
import useHttpStreaming from "@/composables/useStreamingSearch";
import {
  dedupManifest,
  trimBeforeReplayStart,
  segmentId,
  selectInitialWindow,
  snapshotStarts,
  summarizeManifest,
  type ManifestEntry,
  type ManifestSummary,
} from "@/utils/rum/sessionReplayManifest";
import {
  isBeforeRun,
  isCoveredBrowser,
  isCoveredMobile,
  type RunCoverage,
} from "@/utils/rum/sessionReplaySeekPlan";
import {
  appendableIndexes,
  createActivityTimer,
  createLoaderState,
  createQueryError,
  extendLoaderState,
  failBatch,
  isFetchable,
  isSettled,
  markInFlight,
  markSkipped,
  markStored,
  networkSkippedIndexes,
  requeueNetworkSkips,
  settleBatch,
  withRetries,
  type LoaderState,
  type RetryOptions,
} from "@/utils/rum/sessionReplayLoader";
import { MAX_IN_FLIGHT, nextBatches } from "@/utils/rum/sessionReplayLoadPlan";
import {
  LIVE_OVERLAP_US,
  LIVE_POLL_MS,
  errorLogKey,
  eventKey,
  isSessionLive,
  mergeManifestTail,
  raiseUpperTs,
  shouldStopLive,
} from "@/utils/rum/sessionReplayLive";
import {
  expectsMoreData,
  type LoadState,
  type LoadedRange,
  type PlaybackState,
  type ReplayIntent,
  type SkipMarker,
} from "@/utils/rum/sessionReplayTimeline";

interface ReplayRun {
  runId: number;
  anchorIndex: number;
  appendedThroughIndex: number;
}

interface QueryWindow {
  start: number;
  end: number;
}

// The page cap only exists to stop a bad response looping forever.
const SEGMENT_PAGE_SIZE = 1000;
const MAX_SEGMENT_PAGES = 50;
const DAY_US = 86_400_000_000;
const SECOND_US = 1_000_000;
// Events arrive in 30 s flushes plus the SDK's retry backoff, so their window runs a minute past the last replay row.
const EVENTS_TAIL_US = 60_000_000;
const DEFAULT_LOOKUP_US = 30 * DAY_US;
const WATCHDOG_MS = 2000;
const EVENTS_PAGE_SIZE = 150;
const RUM_EVENT_TYPES = ["action", "view", "error"];
const MAX_EVENT_PAGES = 50;

const defaultEvent = {
  id: "",
  event_id: "",
  type: "",
  name: "",
  timestamp: 0,
  relativeTime: 0,
  displayTime: "",
  loading_time: "",
  loading_type: "",
  user: {} as Record<string, any>,
  frustration_type: null as string | null,
  frustration_types: [] as string[],
};

const sessionId = ref("1");
const currentTime = ref(0);
const router = useRouter();
const store = useStore();
const { t } = useI18nTyped();
const { shareUrl } = useRum();
const isLoading = ref<boolean[]>([]);
const { buildQueryPayload } = useQuery();
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
// shallowRef: these hold whole replay segments, and deep reactivity over them is the load cost.
const segments = shallowRef<any[]>([]);
const segmentEvents = shallowRef<any[]>([]);
// Dedicated to the replay-segment fetch, initialised true so the mobile player shows a
// loading state from first paint. The shared isLoading counter can't be used here: it
// dips back to 0 in the gap between getSession() resolving and getSessionSegments()
// starting, which is exactly the moment the mobile player mounts — that dip is what let
// the "No session replay available" empty state flash before the segments arrived.
const segmentsLoading = ref(true);
const manifest = shallowRef<ManifestEntry[]>([]);
const manifestSummary = ref<ManifestSummary | null>(null);
const run = shallowRef<ReplayRun>({ runId: 0, anchorIndex: 0, appendedThroughIndex: -1 });
const loadState = ref<LoadState>("loading");
const retryAttempt = ref(0);
const storedRecords = ref(0);
// Loader state lives outside Vue for speed; this counter is what tells the band and chip it moved.
const loaderVersion = ref(0);
const pendingSeekMs = ref<number | null>(null);
const playerReady = ref(false);
const playerLoadedEndMs = ref<number | null>(null);
// The browser player converts appended segments asynchronously, so the run record runs ahead of what it can show.
const playerTakenCount = ref(0);
const playerPlaybackState = ref<PlaybackState>("loading");
const replayIntent = ref<ReplayIntent>("pause");
const replaySpeed = ref<number | undefined>(undefined);
const replaySkipInactivity = ref<boolean | undefined>(undefined);
// A target before the window can never be reached, because the background loader only moves forward.
const unreachableSeek = ref(false);
const sessionNotFound = ref(false);
const sessionLoadFailed = ref(false);
// Background batches outlive a route change; without this they keep pushing into a dead tree.
let cancelled = false;
let loader: LoaderState = createLoaderState(0);
let segmentIds: string[] = [];
let indexById = new Map<string, number>();
const bodyStore = new Map<string, any>();
// Segments the player stepped past as skip markers stay gaps in this run even if a retry fetches them later.
const skipAppended = new Set<number>();
const liveTraceIds = new Set<string>();
let inFlightBatches = 0;
// Keyed by a batch's first index, so the overlay shows the worst retry among the batches in flight.
const batchAttempts = new Map<number, number>();
let watchdog: ReturnType<typeof setInterval> | null = null;
// Server-time upper bound for body queries; it only moves forward, and never from the viewer's clock.
let upperTs = 0;
const isLive = ref(false);
const lateRows = ref(false);
let liveTimer: ReturnType<typeof setTimeout> | null = null;
let livePolling = false;
let lastNewIdAtMs = 0;
let lastEventsTs = 0;
let lastLogsTs = 0;
// Formatted events by stream key, so a poll overlapping the last one adds nothing twice.
const rumEvents = new Map<string, any>();
const logEvents = new Map<string, any>();

// Mobile sessions carry wireframe records (source: react-native/ios/android) → the
// wireframe player; browser sessions use the rrweb VideoPlayer.
const isMobileReplay = computed(() =>
  isMobileReplaySource(sessionState.data.selectedSession?.source),
);
const { sessionState } = useSessionsReplay();
const videoPlayerRef = ref<any>(null);
const mobilePlayerRef = ref<any>(null);
const splitterSize = ref(600);
const { performanceState } = usePerformance();

const getSessionId = computed(() => router.currentRoute.value.params.id);

// Read event_time query parameter
const eventTime = computed(() => {
  return router.currentRoute.value.query.event_time as string | undefined;
});

// Calculate relative time from session start
const forwardToEventTime = computed(() => {
  if (!eventTime.value || !sessionState.data.selectedSession?.start_time) {
    return null;
  }

  // event_time is in milliseconds, session start_time is also in milliseconds
  const eventTimestamp = Number(eventTime.value);
  const sessionStartTime = Number(sessionState.data.selectedSession.start_time);

  // Relative time in milliseconds from session start
  const relativeTime = formatTimeDifference(eventTimestamp, sessionStartTime);

  // Only return valid positive relative times
  return relativeTime;
});

const sessionDetails = ref({
  date: "",
  duration: "",
  browser: "",
  os: "",
  ip: "",
  user_email: "",
  city: "",
  country: "",
  id: "",
});

// The metadata bounds come first; the manifest's first start and last end stand in when they are missing.
const sessionStartMs = computed(
  () =>
    Number(sessionState.data.selectedSession?.start_time) || Number(manifest.value[0]?.start) || 0,
);

// Session ms of the first full snapshot; nothing before it can be drawn, so seeks there land on it.
const replayStartOffsetMs = computed(() => {
  const replayStart = Number(sessionState.data.selectedSession?.replay_start);
  return replayStart > 0 ? Math.max(0, replayStart - sessionStartMs.value) : 0;
});

const sessionEndMs = computed(
  () =>
    Number(sessionState.data.selectedSession?.end_time) ||
    Number(manifest.value[manifest.value.length - 1]?.end) ||
    0,
);

// Absolute start of the run's anchor segment, which is the player's own time origin.
const windowStart = computed(() => Number(manifest.value[run.value.anchorIndex]?.start) || 0);

const singleSnapshot = computed(() => snapshotStarts(manifest.value).length <= 1);

const loadPercent = computed(() => {
  const total = manifestSummary.value?.recordCount ?? 0;
  return total > 0 ? Math.min(100, (storedRecords.value / total) * 100) : 0;
});

const loadedRanges = computed<LoadedRange[]>(() => {
  void loaderVersion.value;
  const rows = manifest.value;
  const start = sessionStartMs.value;
  const { anchorIndex, appendedThroughIndex } = run.value;
  const out: LoadedRange[] = [];
  if (rows.length && appendedThroughIndex >= anchorIndex) {
    const reachedEnd = appendedThroughIndex >= rows.length - 1;
    const edge = rows[appendedThroughIndex].end;
    const end = reachedEnd ? Math.max(edge, sessionEndMs.value) : edge;
    out.push({ start: rows[anchorIndex].start - start, end: end - start, state: "inPlayer" });
  }
  rows.forEach((row, i) => {
    const inRun = i >= anchorIndex && i <= appendedThroughIndex;
    const range = { start: row.start - start, end: row.end - start };
    if (loader.status[i] === "skipped" || skipAppended.has(i)) {
      out.push({ ...range, state: "skipped" });
    } else if (loader.status[i] === "stored" && !inRun) {
      out.push({ ...range, state: "fetched" });
    }
  });
  if (manifestSummary.value?.truncated && rows.length) {
    const tail = rows[rows.length - 1].end - start;
    out.push({
      start: tail,
      end: Math.max(tail, sessionEndMs.value - start),
      state: "unavailable",
    });
  }
  return out;
});

const failedFromMs = computed(() => {
  void loaderVersion.value;
  const failed = networkSkippedIndexes(loader);
  return failed.length ? manifest.value[failed[0]].start - sessionStartMs.value : null;
});

const mobileRecords = computed(() =>
  isMobileReplay.value ? buildMobileTimeline(segments.value).records : [],
);

const activePlayer = computed(() =>
  isMobileReplay.value ? mobilePlayerRef.value : videoPlayerRef.value,
);

// Holes before the anchor may still load, but nothing after the run's edge will reach this player.
const runComplete = computed(
  () => manifest.value.length > 0 && run.value.appendedThroughIndex >= manifest.value.length - 1,
);

const playerBindings = computed(() => ({
  runComplete: runComplete.value,
  sessionStartMs: sessionStartMs.value,
  sessionEndMs: sessionEndMs.value,
  loadedRanges: loadedRanges.value,
  loadState: loadState.value,
  loadPercent: loadPercent.value,
  failedFromMs: failedFromMs.value,
  truncated: !!manifestSummary.value?.truncated,
  pendingSeekMs: pendingSeekMs.value,
  retryAttempt: retryAttempt.value,
}));

// One notice at a time: a seek before the loaded window, then late earlier rows, then a manifest cut short.
const segmentNotice = computed(() => {
  if (unreachableSeek.value) return t("rum.sessionReplaySeekBehindWindow");
  if (lateRows.value) return t("rum.sessionReplayLateRows");
  if (manifestSummary.value?.truncated)
    return t("rum.sessionReplayTruncated", { count: manifestSummary.value.segmentCount });
  return "";
});

const frustrationCount = computed(() => {
  return segmentEvents.value.filter(
    (event: any) => event.frustration_types && event.frustration_types.length > 0,
  ).length;
});

// Event detail drawer state
const showEventDetailDrawer = ref(false);
const selectedEvent = ref<any>({});
const selectedRawEvent = ref<any>({});
const rawEventsMap = ref<Map<string, any>>(new Map());

onBeforeUnmount(() => {
  cancelled = true;
  stopWatchdog();
  stopLivePolling();
  // Leaving the page must stop the streams too, not only the loop that would start new ones.
  for (const traceId of liveTraceIds) {
    cancelStreamQueryBasedOnRequestId({
      trace_id: traceId,
      org_id: store.state.selectedOrganization.identifier,
    });
  }
  liveTraceIds.clear();
});

onBeforeMount(async () => {
  sessionId.value = router.currentRoute.value.params.id as string;
  await getSession();
  if (sessionNotFound.value || sessionLoadFailed.value) return;
  openEventSeek();
  getSessionSegments();
  getSessionEvents();
});

const getSessionDetails = () => {
  sessionDetails.value = {
    date: getFormattedDate(sessionState.data.selectedSession?.start_time),
    duration: formatSessionDuration(Number(sessionState.data.selectedSession?.time_spent)),
    browser: sessionState.data.selectedSession?.browser,
    os: sessionState.data.selectedSession?.os,
    ip: sessionState.data.selectedSession?.ip,
    user_email: sessionState.data.selectedSession?.user_email || t("common.unknownUser"),
    city: sessionState.data.selectedSession?.city || t("common.unknown"),
    country: sessionState.data.selectedSession?.country || t("common.unknown"),
    id: sessionState.data.selectedSession?.session_id,
  };
};

// A deep link without start_time/end_time still gets a bounded lookup instead of NaN.
const routeRangeUs = () => {
  const start = Number(router.currentRoute.value.query.start_time);
  const end = Number(router.currentRoute.value.query.end_time);
  if (start > 0 && end > 0) return { start: start - DAY_US, end: end + DAY_US };
  const now = Date.now() * 1000;
  return { start: now - DEFAULT_LOOKUP_US, end: now };
};

// Rows are stamped with server receive time, so later queries use the arrival bounds getSession found, not the device clock.
const serverWindowUs = (tailUs: number) => {
  const minTs = Number(sessionState.data.selectedSession?.min_ts);
  if (minTs > 0 && upperTs > 0) return { start: minTs - SECOND_US, end: upperTs + tailUs };
  return routeRangeUs();
};

const retryOptions = () => ({
  isCancelled: () => cancelled,
  onRetry: (attempt: number) => {
    retryAttempt.value = attempt;
  },
});

const searchWithRetry = (req: any, options: RetryOptions = { isCancelled: () => cancelled }) =>
  withRetries(
    () =>
      searchService.search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: req,
          page_type: "logs",
        },
        "RUM",
      ),
    options,
  );

const getSession = async () => {
  let geoFields = "";

  if (performanceState.data.streams["_sessionreplay"]["schema"]["geo_info_country"]) {
    geoFields += "min(geo_info_city) as city,";
  }

  if (performanceState.data.streams["_sessionreplay"]["schema"]["geo_info_city"]) {
    geoFields += "min(geo_info_country) as country,";
  }

  // Older streams (and mobile schemas) have no has_full_snapshot column, so ask for replay_start only when it exists.
  const replayStartField = performanceState.data.streams["_sessionreplay"]["schema"][
    "has_full_snapshot"
  ]
    ? "min(case when has_full_snapshot then start end) as replay_start,"
    : "";

  const timestampColumn = store.state.zoConfig.timestamp_column;
  const range = routeRangeUs();
  const req = {
    query: {
      sql: `select min(${timestampColumn}) as zo_sql_timestamp, max(${timestampColumn}) as max_ts, min(start) as start_time, max(end) as end_time, ${replayStartField} min(user_agent_user_agent_family) as browser, min(user_agent_os_family) as os, min(ip) as ip, min(source) as source, ${geoFields} min(session_id) as session_id from "_sessionreplay" where ${sqlEquals("session_id", getSessionId.value)} order by zo_sql_timestamp`,
      start_time: range.start,
      end_time: range.end,
      from: 0,
      size: 10,
    },
  };

  isLoading.value.push(true);
  try {
    const res: any = await searchWithRetry(req, retryOptions());
    sessionLoadFailed.value = false;
    if (res.data.hits.length === 0) {
      sessionNotFound.value = true;
      segmentsLoading.value = false;
      loadState.value = "empty";
      return;
    }

    const hit = res.data.hits[0];
    sessionState.data.selectedSession = {
      ...sessionState.data.selectedSession,
      ...hit,
      type: hit.source,
      time_spent: hit.end_time - hit.start_time,
      timestamp: hit.zo_sql_timestamp,
      min_ts: hit.zo_sql_timestamp,
      max_ts: hit.max_ts,
    };
    upperTs = Math.max(upperTs, Number(hit.max_ts) || 0);
    isLive.value = isSessionLive(hit.end_time, Date.now());

    getSessionDetails();
  } catch (error) {
    console.error("Failed to fetch session:", error);
    sessionLoadFailed.value = true;
    segmentsLoading.value = false;
    loadState.value = "error";
  } finally {
    isLoading.value.pop();
    retryAttempt.value = 0;
  }
};

const buildSegmentRequest = (sql: string, from: number, size: number, window: QueryWindow) => {
  const req = buildQueryPayload(
    {
      from,
      size,
      timestamp_column: store.state.zoConfig.timestamp_column,
      timestamps: {
        startTime: window.start,
        endTime: window.end,
      },
      sqlMode: false,
      currentPage: 0,
      parsedQuery: null,
    } as any,
    t,
  );
  // buildQueryPayload encodes its own template SQL, so SQL assigned after it must be re-encoded in base64 mode.
  req.query.sql = req.encoding === "base64" ? b64EncodeUnicode(sql) : sql;
  req.query.from = from;
  req.query.size = size;
  delete req.aggs;
  return req;
};

// A stream error keeps its status or code so the retry policy can tell a lost connection from a bad query.
const queryErrorFrom = (response: any) => {
  const content = response?.content ?? {};
  const code = Number(content.code);
  const status =
    typeof content.status === "number"
      ? content.status
      : code >= 100 && code < 600
        ? code
        : undefined;
  const errorCode =
    content.code === undefined || content.code === null ? undefined : String(content.code);
  return createQueryError(content.message || "session replay query failed", status, errorCode);
};

const runSegmentQuery = (
  sql: string,
  from: number,
  size: number,
  window: QueryWindow,
): Promise<any[]> =>
  new Promise((resolve, reject) => {
    const hits: any[] = [];
    const traceId = generateTraceContext()?.traceId || getUUID();
    const orgId = store.state.selectedOrganization.identifier;
    let settled = false;
    const settle = (done: () => void) => {
      if (settled) return;
      settled = true;
      timer.clear();
      liveTraceIds.delete(traceId);
      done();
    };
    // A cancelled stream fires no callback, so the timeout has to settle the promise itself.
    const timer = createActivityTimer(() => {
      cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: orgId });
      settle(() =>
        reject(createQueryError("session replay query timed out", undefined, "timeout")),
      );
    });
    liveTraceIds.add(traceId);

    void fetchQueryDataWithHttpStream(
      {
        queryReq: buildSegmentRequest(sql, from, size, window),
        type: "search",
        traceId,
        org_id: orgId,
        pageType: "logs",
        searchType: "RUM",
      },
      {
        data: (_req: any, response: any) => {
          if (response?.type === "search_response_hits") {
            hits.push(...(response.content?.results?.hits ?? []));
          }
        },
        error: (_req: any, response: any) => settle(() => reject(queryErrorFrom(response))),
        complete: () => settle(() => resolve(hits)),
        onActivity: () => timer.touch(),
      },
    );
  });

// A manifest truncated by the per-request size cap corrupts the snapshot-anchor search, so page past it.
const fetchAllPages = async (
  sql: string,
  window: QueryWindow = serverWindowUs(SECOND_US),
): Promise<{ hits: any[]; complete: boolean }> => {
  const hits: any[] = [];
  for (let page = 0; page < MAX_SEGMENT_PAGES; page++) {
    const batch = await runSegmentQuery(sql, page * SEGMENT_PAGE_SIZE, SEGMENT_PAGE_SIZE, window);
    hits.push(...batch);
    if (batch.length < SEGMENT_PAGE_SIZE) return { hits, complete: true };
    if (cancelled) break;
  }
  return { hits, complete: false };
};

// Older streams lack the view columns; the key and the sort then fall back to the time span.
const hasViewColumns = () => {
  const schema = performanceState.data.streams["_sessionreplay"]?.["schema"] ?? {};
  return !!schema["view_id"] && !!schema["index_in_view"];
};

// view_id gives no time order, but as the last key it makes the order repeatable across pages.
const segmentOrder = () =>
  hasViewColumns()
    ? `order by start asc, "end" asc, index_in_view asc, view_id asc`
    : `order by start asc, "end" asc`;

const timestampField = () => store.state.zoConfig.timestamp_column || "_timestamp";

// The arrival time is selected for the live upper bound only; it is not sorted on and not part of the segment id.
const manifestSql = (minStart: number | null = null) =>
  `select start, "end", has_full_snapshot, records_count${hasViewColumns() ? ", view_id, index_in_view" : ""}, ${timestampField()} from "_sessionreplay" where ${sqlEquals("session_id", sessionId.value)}${minStart === null ? "" : ` and start >= ${minStart}`} ${segmentOrder()}`;

// Inclusive bounds: a tie fetched by two batches is matched by segment id and stored once.
const bodiesSql = (lo: number, hi: number) =>
  `select start, "end", segment, records_count${hasViewColumns() ? ", view_id, index_in_view" : ""} from "_sessionreplay" where ${sqlEquals("session_id", sessionId.value)} and start >= ${lo} and start <= ${hi} ${segmentOrder()}`;

const fetchBodies = async (indexes: number[]) => {
  const rows = manifest.value;
  const { hits } = await fetchAllPages(
    bodiesSql(rows[indexes[0]].start, rows[indexes[indexes.length - 1]].start),
  );
  return hits;
};

const bumpLoader = () => {
  loaderVersion.value++;
};

const resetLoader = () => {
  manifest.value = [];
  manifestSummary.value = null;
  loader = createLoaderState(0);
  segmentIds = [];
  indexById = new Map();
  bodyStore.clear();
  skipAppended.clear();
  storedRecords.value = 0;
  segments.value = [];
  run.value = { runId: run.value.runId + 1, anchorIndex: 0, appendedThroughIndex: -1 };
  playerLoadedEndMs.value = null;
  playerTakenCount.value = 0;
  unreachableSeek.value = false;
  lateRows.value = false;
  bumpLoader();
};

const adoptManifest = (rows: ManifestEntry[], complete: boolean) => {
  upperTs = raiseUpperTs(upperTs, rows, timestampField());
  manifest.value = rows;
  manifestSummary.value = summarizeManifest(rows, complete);
  loader = createLoaderState(rows.length);
  segmentIds = rows.map(segmentId);
  indexById = new Map(segmentIds.map((id, i) => [id, i]));
  bumpLoader();
};

// A live poll only appends, so every index the loader and the run already hold stays valid.
const extendManifest = (rows: ManifestEntry[]) => {
  const first = manifest.value.length;
  manifest.value = [...manifest.value, ...rows];
  manifestSummary.value = summarizeManifest(manifest.value, !manifestSummary.value?.truncated);
  extendLoaderState(loader, rows.length);
  rows.forEach((row, i) => {
    const id = segmentId(row);
    segmentIds.push(id);
    indexById.set(id, first + i);
  });
  extendSessionEnd(Math.max(...rows.map((row) => Number(row.end) || 0)));
  bumpLoader();
};

const extendSessionEnd = (endMs: number) => {
  const session = sessionState.data.selectedSession;
  if (!session || !(endMs > (Number(session.end_time) || 0))) return;
  session.end_time = endMs;
  session.time_spent = endMs - Number(session.start_time);
  sessionDetails.value.duration = formatSessionDuration(Number(session.time_spent));
};

// A body is kept only if its id is in the manifest and not stored yet, so ties and duplicate rows are dropped.
const storeBodies = (hits: any[]) => {
  for (const hit of hits) {
    const id = segmentId(hit);
    const index = indexById.get(id);
    if (index === undefined || bodyStore.has(id) || loader.skipReason[index] === "parse") continue;
    let body: any;
    try {
      body = JSON.parse(hit.segment);
    } catch (error) {
      console.error("Failed to parse a session replay segment:", error);
      markSkipped(loader, index, "parse");
      continue;
    }
    bodyStore.set(id, body);
    markStored(loader, index);
    storedRecords.value += Number(manifest.value[index].records_count) || 0;
  }
  bumpLoader();
};

const skipMarkerFor = (index: number): SkipMarker => ({
  skipped: true,
  segmentId: segmentIds[index],
  start: manifest.value[index].start,
  end: manifest.value[index].end,
});

// The player can only be fed forward, so segment k goes in only once every earlier one in the run is stored or skipped.
const appendInOrder = () => {
  const current = run.value;
  const next = appendableIndexes(loader, current.appendedThroughIndex);
  if (!next.length) return;
  const items = next.map((i) => {
    if (loader.status[i] === "stored") return bodyStore.get(segmentIds[i]);
    skipAppended.add(i);
    return skipMarkerFor(i);
  });
  segments.value = [...segments.value, ...items];
  run.value = { ...current, appendedThroughIndex: next[next.length - 1] };
};

// Complete only once nothing is in flight and every segment is stored or skipped; a live session stays live instead.
const settleLoadState = () => {
  if (inFlightBatches > 0 || !isSettled(loader)) return;
  const failed = networkSkippedIndexes(loader).length > 0;
  loadState.value = failed ? "failed" : isLive.value ? "live" : "complete";
  // A wait that can no longer be satisfied must end, or the overlay spins forever.
  if (failed) pendingSeekMs.value = null;
};

const activeLoadState = (): LoadState => (isLive.value ? "live" : "loading");

const setBatchAttempt = (key: number, attempt: number) => {
  if (attempt > 0) batchAttempts.set(key, attempt);
  else batchAttempts.delete(key);
  retryAttempt.value = Math.max(0, ...batchAttempts.values());
};

// The loader state is captured, so a batch that outlives a reset settles against the state it was started on.
const fetchBatch = async (batch: number[], runId: number) => {
  const state = loader;
  markInFlight(state, batch);
  bumpLoader();
  try {
    const hits = await withRetries(() => fetchBodies(batch), {
      isCancelled: () => cancelled,
      onRetry: (attempt: number) => setBatchAttempt(batch[0], attempt),
    });
    if (cancelled) return;
    storeBodies(hits);
    settleBatch(state, batch);
  } catch (error) {
    if (cancelled) return;
    console.error("Failed to fetch session replay segments:", error);
    failBatch(state, batch);
  } finally {
    setBatchAttempt(batch[0], 0);
  }
  bumpLoader();
  if (runId === run.value.runId) appendInOrder();
};

const launchBatch = async (batch: number[], runId: number) => {
  inFlightBatches++;
  try {
    await fetchBatch(batch, runId);
  } finally {
    inFlightBatches--;
  }
  pumpLoader();
};

// Up to three batches in flight; bodies may land in any order, and appendInOrder is the reorder buffer.
const pumpLoader = () => {
  if (cancelled) return;
  const batches = nextBatches(manifest.value, loader, run.value, {
    maxInFlight: MAX_IN_FLIGHT,
    inFlight: inFlightBatches,
  });
  const runId = run.value.runId;
  for (const batch of batches) void launchBatch(batch, runId);
  settleLoadState();
};

// Absolute time the player must reach first; mobile always starts at the session start so nothing before the event is lost.
const initialTarget = () => {
  const sessionStart = Number(sessionState.data.selectedSession?.start_time) || 0;
  if (isMobileReplay.value) return sessionStart;
  const relative = eventRelativeMs();
  return relative > 0 ? sessionStart + relative : sessionStart;
};

// E0: the manifest and the first window each get the retry policy; if either still fails, nothing can play.
const getSessionSegments = async () => {
  if (!sessionState.data.selectedSession) {
    // No session to fetch a replay for — resolve the loading state so the player can fall
    // through to its empty message instead of spinning forever.
    segmentsLoading.value = false;
    return;
  }

  isLoading.value.push(true);
  segmentsLoading.value = true;
  resetLoader();
  loadState.value = activeLoadState();
  try {
    const { hits, complete } = await withRetries(
      () => fetchAllPages(manifestSql()),
      retryOptions(),
    );
    if (cancelled) return;
    retryAttempt.value = 0;
    const rows = trimBeforeReplayStart(
      dedupManifest(hits as ManifestEntry[]),
      sessionState.data.selectedSession?.replay_start,
    );
    adoptManifest(rows, complete);
    if (!rows.length) {
      loadState.value = "empty";
      return;
    }

    // Only the window from the nearest full snapshot to the target, so the first frame does not wait on the whole session.
    const firstWindow = selectInitialWindow(rows, initialTarget())!;
    // Rows tied on the session start could put a later snapshot ahead of segment 0, and mobile must never skip it.
    const anchorIndex = isMobileReplay.value ? 0 : firstWindow.anchorIndex;
    run.value = {
      runId: run.value.runId,
      anchorIndex,
      appendedThroughIndex: anchorIndex - 1,
    };
    const indexes: number[] = [];
    for (let i = anchorIndex; i <= firstWindow.targetIndex; i++) indexes.push(i);
    markInFlight(loader, indexes);
    const bodyHits = await withRetries(() => fetchBodies(indexes), retryOptions());
    if (cancelled) return;
    storeBodies(bodyHits);
    settleBatch(loader, indexes);
    appendInOrder();
    bumpLoader();
    pumpLoader();
    startLivePolling();
  } catch (error) {
    if (cancelled) return;
    console.error("Failed to fetch session replay segments:", error);
    loadState.value = "error";
    pendingSeekMs.value = null;
  } finally {
    isLoading.value.pop();
    retryAttempt.value = 0;
    // Segment fetch settled: the mobile player can now decide between the replay and the
    // empty state without a premature "No session replay available" flash.
    segmentsLoading.value = false;
  }
};

// E1: only segments lost to the network go back on the queue; the player keeps the gaps it already stepped past.
const retryFailedSegments = () => {
  if (!requeueNetworkSkips(loader).length) return;
  loadState.value = activeLoadState();
  bumpLoader();
  pumpLoader();
};

const handleRetry = async () => {
  if (loadState.value === "failed") {
    retryFailedSegments();
    return;
  }
  if (loadState.value !== "error") return;
  if (sessionLoadFailed.value) {
    loadState.value = activeLoadState();
    segmentsLoading.value = true;
    await getSession();
    if (sessionNotFound.value || sessionLoadFailed.value) return;
    getSessionEvents();
  }
  pendingSeekMs.value = null;
  openEventSeek();
  void getSessionSegments();
};

// Restarts a loader that stopped while the player still waits on a segment it can fetch; skipped, capped and in-flight ones never qualify.
const checkWatchdog = () => {
  if (cancelled || !expectsMoreData(loadState.value)) return;
  const next = run.value.appendedThroughIndex + 1;
  if (next < loader.status.length && isFetchable(loader, next)) pumpLoader();
};

const stopWatchdog = () => {
  if (watchdog !== null) clearInterval(watchdog);
  watchdog = null;
};

watch(playerPlaybackState, (state) => {
  const waiting = state === "buffering" || state === "waiting";
  if (waiting && watchdog === null) watchdog = setInterval(checkWatchdog, WATCHDOG_MS);
  if (!waiting) stopWatchdog();
});

const clearLiveTimer = () => {
  if (liveTimer !== null) clearTimeout(liveTimer);
  liveTimer = null;
};

const scheduleLivePoll = () => {
  clearLiveTimer();
  if (!isLive.value || cancelled || document.visibilityState === "hidden") return;
  liveTimer = setTimeout(() => void runLivePoll(), LIVE_POLL_MS);
};

// A hidden tab polls nothing; showing it again starts a fresh wait.
const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") clearLiveTimer();
  else if (!livePolling) scheduleLivePoll();
};

const startLivePolling = () => {
  if (!isLive.value || cancelled) return;
  lastNewIdAtMs = Date.now();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (!livePolling) scheduleLivePoll();
};

const stopLivePolling = () => {
  clearLiveTimer();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
};

// The badge goes and the chip settles; batches still in flight keep the chip on loading until they land.
const endLive = () => {
  stopLivePolling();
  isLive.value = false;
  if (loadState.value !== "live") return;
  loadState.value = "loading";
  settleLoadState();
};

const runLivePoll = async () => {
  liveTimer = null;
  if (!isLive.value || cancelled || document.visibilityState === "hidden") return;
  livePolling = true;
  try {
    await Promise.allSettled([pollManifest(), pollEvents()]);
  } finally {
    livePolling = false;
  }
  if (cancelled || !isLive.value) return;
  if (shouldStopLive(lastNewIdAtMs, sessionStartMs.value, Date.now())) endLive();
  else scheduleLivePoll();
};

// Polls look a minute behind the bound so a row that arrived late is still found; the dedup drops what was already seen.
const liveWindowUs = (cursorUs: number): QueryWindow => {
  const nowUs = Date.now() * 1000;
  const from = cursorUs > 0 ? cursorUs - LIVE_OVERLAP_US : serverWindowUs(0).start;
  return { start: from, end: Math.max(nowUs, upperTs) + LIVE_OVERLAP_US };
};

// New ids join the end of the manifest and load through the normal loader; a row sorting before the tail only raises the notice.
const pollManifest = async () => {
  const rows = manifest.value;
  if (!rows.length || manifestSummary.value?.truncated) return;
  const { hits } = await fetchAllPages(
    manifestSql(rows[rows.length - 1].start),
    liveWindowUs(upperTs),
  );
  if (cancelled || !isLive.value) return;
  upperTs = raiseUpperTs(upperTs, hits, timestampField());
  const { appended, late } = mergeManifestTail(manifest.value, hits as ManifestEntry[], indexById);
  if (late) lateRows.value = true;
  if (!appended.length) return;
  lastNewIdAtMs = Date.now();
  extendManifest(appended);
  pumpLoader();
};

const pollEvents = async () => {
  const hits = await fetchEventPages(rumEventsSql(), liveWindowUs(lastEventsTs));
  if (cancelled) return;
  const logs = await fetchEventPages(errorLogsSql(), liveWindowUs(lastLogsTs));
  if (cancelled) return;
  const changed = addRumEvents(hits);
  if (addErrorLogs(logs) || changed) publishEvents();
};

const eventsRequest = (sql: string, window: QueryWindow, from: number) => {
  const req = buildQueryPayload(
    {
      from,
      size: EVENTS_PAGE_SIZE,
      timestamp_column: store.state.zoConfig.timestamp_column,
      timestamps: {
        startTime: window.start,
        endTime: window.end,
      },
      sqlMode: false,
      currentPage: 0,
      parsedQuery: null,
    } as any,
    t,
  );
  req.query.sql = sql;
  req.query.from = from;
  req.query.size = EVENTS_PAGE_SIZE;
  delete req.aggs;
  return req;
};

const rumEventsSql = () =>
  `select * from "_rumdata" where ${sqlEquals("session_id", sessionId.value)} and (type='error' or type='action' or type='view') order by date asc`;

const errorLogsSql = () =>
  `select * from "_rumlog" where ${sqlEquals("session_id", sessionId.value)} and status='error' order by date asc`;

// Polls page past the query size, since a busy half minute can hold more than one page of events.
const fetchEventPages = async (sql: string, window: QueryWindow) => {
  const hits: any[] = [];
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const res: any = await searchWithRetry(eventsRequest(sql, window, page * EVENTS_PAGE_SIZE));
    const rows = res?.data?.hits ?? [];
    hits.push(...rows);
    if (rows.length < EVENTS_PAGE_SIZE || cancelled) break;
  }
  return hits;
};

// A re-sent view merges into the stored one (latest document, earliest date), because a view is updated under the same view_id; other rows are kept once.
const addRumEvents = (hits: any[]) => {
  const start = Number(sessionState.data.selectedSession?.start_time);
  const field = timestampField();
  let changed = false;
  for (const hit of hits) {
    lastEventsTs = Math.max(lastEventsTs, Number(hit[field]) || 0);
    if (!RUM_EVENT_TYPES.includes(hit.type) || !(hit.date >= start)) continue;
    const key = eventKey(hit) ?? `unkeyed|${rumEvents.size}`;
    if (rumEvents.has(key) && hit.type !== "view") continue;
    const eventId = hit[`${hit.type}_id`];
    const previous = rumEvents.has(key) && eventId ? rawEventsMap.value.get(eventId) : undefined;
    const row = previous ? collapseViewDocuments([previous, hit])[0] : hit;
    if (eventId) rawEventsMap.value.set(eventId, row);
    rumEvents.set(key, formatEvent(row));
    changed = true;
  }
  return changed;
};

const addErrorLogs = (hits: any[]) => {
  const start = Number(sessionState.data.selectedSession?.start_time);
  const field = timestampField();
  let changed = false;
  for (const hit of hits) {
    lastLogsTs = Math.max(lastLogsTs, Number(hit[field]) || 0);
    const key = errorLogKey(hit, field);
    if (!(hit.date >= start) || logEvents.has(key)) continue;
    hit.type = "error";
    hit.error_id = getUUID();
    hit.error_message = hit.message;
    rawEventsMap.value.set(hit.error_id, hit);
    logEvents.set(key, formatEvent(hit));
    changed = true;
  }
  return changed;
};

// One assignment: a shallowRef does not react to a push.
const publishEvents = () => {
  segmentEvents.value = [...rumEvents.values(), ...logEvents.values()]
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
  videoPlayerRef.value?.updatePlayerState?.();
};

const getSessionEvents = () => {
  const req = eventsRequest(rumEventsSql(), serverWindowUs(EVENTS_TAIL_US), 0);
  isLoading.value.push(true);
  searchWithRetry(req)
    .then((res: any) => {
      // Test the SOURCE field, not the rendered value: user_email is filled with
      // t("common.unknownUser") when absent, so comparing it to the English
      // literal stopped this backfill firing in every non-English locale.
      if (!sessionState.data.selectedSession?.user_email)
        sessionDetails.value.user_email = res.data.hits[0]?.usr_email;

      addRumEvents(res.data.hits);
      publishEvents();
      getSessionErrorLogs();
    })
    .catch((error) => {
      console.error("Failed to fetch sesion events:", error);
    })
    .finally(() => isLoading.value.pop());
};

const getSessionErrorLogs = () => {
  const req = eventsRequest(errorLogsSql(), serverWindowUs(EVENTS_TAIL_US), 0);
  isLoading.value.push(true);
  searchWithRetry(req)
    .then((res: any) => {
      addErrorLogs(res.data.hits);
      publishEvents();
    })
    .catch((error) => {
      console.error("Failed to fetch sesion error logs:", error);
    })
    .finally(() => isLoading.value.pop());
};

const getDefaultEvent = (event: any) => {
  const _event = cloneDeep(defaultEvent);
  _event.id = event[`${event.type}_id`];
  _event.event_id = event[`${event.type}_id`];
  _event.type = event.type;
  _event.timestamp = event.date;
  const relativeTime = formatTimeDifference(
    _event.timestamp,
    Number(sessionState.data.selectedSession.start_time),
  );
  _event.relativeTime = relativeTime[0] as number;
  _event.displayTime = relativeTime[1] as string;
  return _event;
};

const handleErrorEvent = (event: any) => {
  const _event = getDefaultEvent(event);
  _event.name = event?.error_message || "--";
  return _event;
};

const handleActionEvent = (event: any) => {
  const _event = getDefaultEvent(event);
  _event.name =
    t("rum.actionOnTarget", {
      action: event?.action_type,
      target: event?.action_target_name,
    }) || "--";

  // Add frustration information if present
  if (event?.action_frustration_type) {
    _event.frustration_type = event.action_frustration_type;
    try {
      const frustrationTypes = JSON.parse(event.action_frustration_type);
      if (Array.isArray(frustrationTypes)) {
        _event.frustration_types = frustrationTypes;
      } else {
        _event.frustration_types = [frustrationTypes];
      }
    } catch (error) {
      console.warn(
        "Failed to parse frustration type as JSON:",
        event.action_frustration_type,
        error,
      );
      _event.frustration_types = [event.action_frustration_type];
    }
  }

  return _event;
};

const handleViewEvent = (event: any) => {
  const _event = getDefaultEvent(event);
  // if (event.event.custom.error) {
  //   _event.name =
  //     event.event.custom.error["source"] +
  //     " error " +
  //     event.event.custom.error.stack;
  // }
  // Browser view events carry `view_loading_type` (initial_load / route_change)
  // and show as "type : url". Mobile SDK views have no loading_type, so fall back
  // to the human view name (e.g. "ProductDetail") and only then the url — avoids
  // the "undefined : <url>" label for mobile sessions.
  _event.name = event?.view_loading_type
    ? event.view_loading_type + " : " + event?.view_url
    : event?.view_name || event?.view_url || "--";
  return _event;
};

const formatEvent = (event: any) => {
  try {
    const eventTypes: { [key: string]: (event: any) => void } = {
      error: handleErrorEvent,
      action: handleActionEvent,
      view: handleViewEvent,
    };

    return eventTypes[event.type](event);
  } catch (err) {
    console.log(err);
    return null;
  }
};

function formatTimeDifference(start_time: number, end_time: number) {
  const milliSeconds = Math.abs(start_time - end_time);
  // Calculate hours, minutes, and seconds
  let hours: string | number = Math.floor(milliSeconds / (1000 * 60 * 60));
  let minutes: string | number = Math.floor((milliSeconds % (1000 * 60 * 60)) / (1000 * 60));
  let seconds: string | number = Math.floor((milliSeconds % (1000 * 60)) / 1000);

  // Add leading zeros if needed
  hours = hours < 10 ? "0" + hours : hours;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  seconds = seconds < 10 ? "0" + seconds : seconds;

  if (hours === "00") {
    return [milliSeconds, `${minutes}:${seconds}`];
  }

  if (hours === "00" && minutes === "00") {
    return [milliSeconds, `${seconds}`];
  }

  return [milliSeconds, `${hours}:${minutes}:${seconds}`];
}

const getFormattedDate = (timestamp: number) =>
  formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss Z");

const formatSessionDuration = (ms: number) => {
  if (!(ms > 0)) return "";
  if (ms < 1000) return raw("<1s");
  return durationFormatter(Math.round(ms / 1000));
};

// forwardToEventTime is unsigned, so an event_time before the session start must not become a target.
const eventRelativeMs = () => {
  const start = Number(sessionState.data.selectedSession?.start_time) || 0;
  if (!(Number(eventTime.value) > start)) return 0;
  return Number(forwardToEventTime.value?.[0]) || 0;
};

// The error-link auto-seek is a one-time pending seek at open; a later run never re-triggers it.
const openEventSeek = () => {
  const relative = eventRelativeMs();
  if (relative > 0) pendingSeekMs.value = relative;
};

const runCoverage = (): RunCoverage => ({
  anchorIndex: run.value.anchorIndex,
  appendedThroughIndex: Math.min(
    run.value.appendedThroughIndex,
    run.value.anchorIndex + playerTakenCount.value - 1,
  ),
  lastIndex: manifest.value.length - 1,
  anchorStartMs: windowStart.value - sessionStartMs.value,
  playerEndMs: playerLoadedEndMs.value,
});

// Once nothing more can load, a mobile target outside the records would wait forever, so the player clamps it instead.
const isCoveredMobileTarget = (sessionMs: number) => {
  const records = mobileRecords.value;
  const settled =
    loadState.value === "complete" ||
    loadState.value === "failed" ||
    (loadState.value === "live" && runComplete.value);
  if (records.length && settled) return true;
  const firstMs = records.length ? records[0].timestamp : 0;
  return isCoveredMobile(Math.max(sessionStartMs.value + sessionMs, firstMs), records);
};

const isCovered = (sessionMs: number) =>
  isMobileReplay.value
    ? isCoveredMobileTarget(sessionMs)
    : isCoveredBrowser(sessionMs, runCoverage());

// The forward-only loader never reaches a target before the browser window, so it lands on the window start and says why.
const isBehindBrowserWindow = (sessionMs: number) =>
  !isMobileReplay.value && manifest.value.length > 0 && isBeforeRun(sessionMs, runCoverage());

// Bar clicks, ±10 s and sidebar clicks all end here: seek now if the live player holds the target, else wait for it.
const requestSeek = (sessionMs: number, play: boolean = replayIntent.value === "play") => {
  if (loadState.value === "error" || loadState.value === "empty") return;
  const target = Math.max(replayStartOffsetMs.value, sessionMs);
  unreachableSeek.value = isBehindBrowserWindow(target);
  if (unreachableSeek.value) {
    pendingSeekMs.value = null;
    if (playerReady.value) activePlayer.value?.seekTo(runCoverage().anchorStartMs, play);
    return;
  }
  if (playerReady.value && isCovered(target)) {
    pendingSeekMs.value = null;
    activePlayer.value?.seekTo(target, play);
    return;
  }
  pendingSeekMs.value = target;
  checkWatchdog();
};

// Cleared and seeked in the same tick, so the player never sees the target without the seek that satisfies it.
const resolvePendingSeek = () => {
  const target = pendingSeekMs.value;
  if (target === null || !playerReady.value) return;
  if (isBehindBrowserWindow(target)) {
    requestSeek(target);
    return;
  }
  if (!isCovered(target)) return;
  pendingSeekMs.value = null;
  activePlayer.value?.seekTo(target, replayIntent.value === "play");
};

const handlePlayerReady = () => {
  playerReady.value = true;
  resolvePendingSeek();
};

// Post flush, so a player's props already hold the segments this check counted.
watch([run, playerLoadedEndMs, playerTakenCount, mobileRecords, loadState], resolvePendingSeek, {
  flush: "post",
});

const handleSidebarEvent = (event: string, payload: any) => {
  if (event === "event-click") {
    // Open event detail drawer
    selectedEvent.value = payload;
    selectedRawEvent.value = rawEventsMap.value.get(payload.event_id) || {};
    showEventDetailDrawer.value = true;
  }

  // Always seek to the event time in the player, through the same path as a bar click.
  requestSeek(Number(payload.relativeTime) || 0);
};
</script>
