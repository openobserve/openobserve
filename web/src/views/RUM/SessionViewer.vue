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
          <!-- Mobile SDKs record wireframes (not a DOM); play them with the wireframe
               player. Browser sessions use the rrweb-based VideoPlayer. -->
          <MobileSessionPlayer
            v-if="isMobileReplay"
            :segments="segments"
            :events="segmentEvents"
            :is-loading="segmentsLoading"
            class="h-full"
          />
          <div v-else class="flex h-full min-h-0 flex-col">
            <div
              v-if="segmentNotice"
              class="bg-card-glass-bg text-text-secondary border-card-glass-border border-b px-3 py-1 text-xs"
              data-test="session-viewer-segment-notice"
            >
              {{ segmentNotice }}
            </div>
            <VideoPlayer
              ref="videoPlayerRef"
              :events="segmentEvents"
              :segments="segments"
              :is-loading="!!isLoading.length"
              class="min-h-0 flex-1"
            />
          </div>
        </template>
        <template #after>
          <PlayerEventsSidebar
            :events="segmentEvents"
            :sessionDetails="sessionDetails"
            :session-id="sessionId"
            :current-time="currentTime"
            :start-time="replayOrigin"
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
import { isMobileReplaySource } from "@/composables/rum/useMobileSessionReplay";
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
import ShareButton from "@/components/common/ShareButton.vue";
import useRum from "@/composables/rum/useRum";

import { formatDate } from "@/utils/date";
import { b64EncodeUnicode, generateTraceContext, getUUID } from "@/utils/zincutils";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";
import { collapseViewDocuments } from "@/utils/rum/viewDocuments";
import useHttpStreaming from "@/composables/useStreamingSearch";
import {
  selectInitialWindow,
  snapshotStarts,
  summarizeManifest,
  type ManifestEntry,
  type ManifestSummary,
} from "@/utils/rum/sessionReplayManifest";
import { planSeek, type TimeRange } from "@/utils/rum/sessionReplaySeekPlan";

// The backend caps one request at 1000 rows; the page cap only exists to stop a bad response looping forever.
const SEGMENT_PAGE_SIZE = 1000;
const MAX_SEGMENT_PAGES = 50;
const SEGMENT_BATCH = 25;

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
const { fetchQueryDataWithHttpStream } = useHttpStreaming();
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
const loadedRanges = shallowRef<TimeRange[]>([]);
const pendingSeek = ref<number | null>(null);
// Absolute start of the first window fed to the player, which is the player's own time origin.
const windowStart = ref(0);
// A target before the window can never be reached, because the background loader only moves forward.
const unreachableSeek = ref(false);
// Background batches outlive a route change; without this they keep pushing into a dead tree.
let cancelled = false;
const sessionNotFound = ref(false);

// Mobile sessions carry wireframe records (source: react-native/ios/android) → the
// wireframe player; browser sessions use the rrweb VideoPlayer.
const isMobileReplay = computed(() =>
  isMobileReplaySource(sessionState.data.selectedSession?.source),
);
const { sessionState } = useSessionsReplay();
const videoPlayerRef = ref<any>(null);
const splitterSize = ref(600);
const { performanceState } = usePerformance();

// Where playback actually begins, which is not always where the session begins.
//
// The converter resets its node-id counter and string table on every FullSnapshot
// (utils/rum/sessionReplayChangeFormat.ts), so a stream MUST open with one. When the
// first view loses its `index_in_view: 0` segment, the earliest rows by `start` are
// orphan mutations that decode against an empty id space: rrweb builds no DOM and the
// player paints nothing, even though the rest of the session is intact and playable.
//
// So play from the first full snapshot, and measure every timeline offset from that same
// instant — event markers, breadcrumbs and trace rows all treat this as t=0, so they
// desynchronise from the video if they keep counting from the session start.
// `replay_start` is null when no segment carries a snapshot; then nothing is playable
// anyway and the session start is the honest origin.
const replayOrigin = computed(() =>
  Number(
    sessionState.data.selectedSession?.replay_start ??
      sessionState.data.selectedSession?.start_time ??
      0,
  ),
);

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

  // event_time is in milliseconds, replayOrigin is also in milliseconds
  const eventTimestamp = Number(eventTime.value);

  // Relative time in milliseconds from the start of playback
  const relativeTime = formatTimeDifference(eventTimestamp, replayOrigin.value);

  // Only return valid positive relative times
  return relativeTime;
});

const sessionDetails = ref({
  date: "",
  browser: "",
  os: "",
  ip: "",
  user_email: "",
  city: "",
  country: "",
  id: "",
});

// One line under the player: a seek still waiting on its window, else a manifest cut short.
const segmentNotice = computed(() => {
  if (unreachableSeek.value) return t("rum.sessionReplaySeekBehindWindow");
  if (pendingSeek.value !== null) return t("rum.sessionReplaySeekLoading");
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
});

onBeforeMount(async () => {
  sessionId.value = router.currentRoute.value.params.id as string;
  await getSession();
  if (sessionNotFound.value) return;
  getSessionSegments();
  getSessionEvents();
});

// Track if we've already seeked to prevent multiple seeks
const hasAutoSeeked = ref(false);
let seekTimer: number | null = null;

// Watch for when all data is loaded and seek to event_time if provided
watch(
  [
    videoPlayerRef,
    () => segments.value.length,
    () => segmentEvents.value.length,
    forwardToEventTime,
  ],
  ([playerRef, segmentsCount, eventsCount, relativeTime]) => {
    // Only seek once when all conditions are met and we haven't seeked yet
    if (
      !hasAutoSeeked.value &&
      playerRef &&
      segmentsCount > 0 &&
      eventsCount > 0 &&
      relativeTime &&
      Number(relativeTime[0]) > 0
    ) {
      // Clear any existing timer
      if (seekTimer !== null) {
        clearTimeout(seekTimer);
      }

      // Use setTimeout to give video player time to fully initialize

      seekTimer = setTimeout(() => {
        if (videoPlayerRef.value) {
          try {
            videoPlayerRef.value.goto(
              toPlayerOffset(Number(relativeTime[0])),
              false, // Don't auto-play
            );
            hasAutoSeeked.value = true; // Mark as seeked
          } catch {
            // Player might not be ready yet, silently fail
          }
        }
      }, 1000) as unknown as number; // 1 second delay for player initialization
    }
  },
  { immediate: false },
);

const getSessionDetails = () => {
  sessionDetails.value = {
    date: getFormattedDate(sessionState.data.selectedSession?.start_time),
    browser: sessionState.data.selectedSession?.browser,
    os: sessionState.data.selectedSession?.os,
    ip: sessionState.data.selectedSession?.ip,
    user_email: sessionState.data.selectedSession?.user_email || t("common.unknownUser"),
    city: sessionState.data.selectedSession?.city || t("common.unknown"),
    country: sessionState.data.selectedSession?.country || t("common.unknown"),
    id: sessionState.data.selectedSession?.session_id,
  };
};

const getSession = () => {
  return new Promise((resolve) => {
    let geoFields = "";

    if (performanceState.data.streams["_sessionreplay"]["schema"]["geo_info_country"]) {
      geoFields += "min(geo_info_city) as city,";
    }

    if (performanceState.data.streams["_sessionreplay"]["schema"]["geo_info_city"]) {
      geoFields += "min(geo_info_country) as country,";
    }

    // Older streams (and mobile schemas) have no has_full_snapshot column. Ask for the
    // playback origin only when it exists; replayOrigin falls back to the session start.
    const replayStartField = performanceState.data.streams["_sessionreplay"]["schema"][
      "has_full_snapshot"
    ]
      ? "min(case when has_full_snapshot then start end) as replay_start,"
      : "";

    const req = {
      query: {
        sql: `select min(${store.state.zoConfig.timestamp_column}) as zo_sql_timestamp, min(start) as start_time, max(end) as end_time, ${replayStartField} min(user_agent_user_agent_family) as browser, min(user_agent_os_family) as os, min(ip) as ip, min(source) as source, ${geoFields} min(session_id) as session_id from "_sessionreplay" where ${sqlEquals("session_id", getSessionId.value)} order by zo_sql_timestamp`,
        start_time: Number(router.currentRoute.value.query.start_time) - 86400000000,
        end_time: Number(router.currentRoute.value.query.end_time) + 86400000000,
        from: 0,
        size: 10,
      },
    };

    isLoading.value.push(true);
    searchService
      .search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: req,
          page_type: "logs",
        },
        "RUM",
      )
      .then((res) => {
        if (res.data.hits.length === 0) {
          sessionNotFound.value = true;
          segmentsLoading.value = false;
          return;
        }

        sessionState.data.selectedSession = {
          ...sessionState.data.selectedSession,
          ...res.data.hits[0],
          type: res.data.hits[0].source,
          time_spent: res.data.hits[0].end_time - res.data.hits[0].start_time,
          timestamp: res.data.hits[0].zo_sql_timestamp,
        };

        getSessionDetails();
      })
      .catch((error) => {
        console.error("Failed to fetch session:", error);
      })
      .finally(() => {
        isLoading.value.pop();
        resolve(true);
      });
  });
};

const buildSegmentRequest = (sql: string, from: number, size: number) => {
  const req = buildQueryPayload(
    {
      from,
      size,
      timestamp_column: store.state.zoConfig.timestamp_column,
      timestamps: {
        startTime: Number(sessionState.data.selectedSession?.start_time) * 1000 - 300000,
        endTime: Number(sessionState.data.selectedSession?.end_time) * 1000 + 300000000,
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

const runSegmentQuery = (sql: string, from: number, size: number): Promise<any[]> =>
  new Promise((resolve, reject) => {
    const hits: any[] = [];
    let settled = false;

    fetchQueryDataWithHttpStream(
      {
        queryReq: buildSegmentRequest(sql, from, size),
        type: "search",
        traceId: generateTraceContext()?.traceId || getUUID(),
        org_id: store.state.selectedOrganization.identifier,
        pageType: "logs",
        searchType: "RUM",
      },
      {
        data: (_req: any, response: any) => {
          if (response?.type === "search_response_hits") {
            hits.push(...(response.content?.results?.hits ?? []));
          }
        },
        error: (_req: any, response: any) => {
          if (settled) return;
          settled = true;
          reject(new Error(response?.content?.message || "session replay query failed"));
        },
        complete: () => {
          if (settled) return;
          settled = true;
          resolve(hits);
        },
        // A reset replays the whole stream, so partial hits must be dropped first.
        reset: () => {
          hits.length = 0;
        },
      },
    ).catch(reject);
  });

// A manifest truncated by the per-request size cap corrupts the snapshot-anchor search, so page past it.
const fetchAllPages = async (sql: string): Promise<{ hits: any[]; complete: boolean }> => {
  const hits: any[] = [];
  for (let page = 0; page < MAX_SEGMENT_PAGES; page++) {
    const batch = await runSegmentQuery(sql, page * SEGMENT_PAGE_SIZE, SEGMENT_PAGE_SIZE);
    hits.push(...batch);
    if (batch.length < SEGMENT_PAGE_SIZE) return { hits, complete: true };
    if (cancelled) break;
  }
  return { hits, complete: false };
};

const manifestSql = () =>
  `select start, "end", has_full_snapshot, records_count from "_sessionreplay" where ${sqlEquals("session_id", sessionId.value)} order by start asc`;

const bodiesSql = (lo: number, hi: number) =>
  `select start, "end", segment from "_sessionreplay" where ${sqlEquals("session_id", sessionId.value)} and start >= ${lo} and start <= ${hi} order by start asc`;

// The player can only be fed forward, so every loaded body is appended in start order.
const appendSegmentBodies = (hits: any[]) => {
  const bodies = hits
    .map((hit: any) => {
      try {
        return JSON.parse(hit.segment);
      } catch (error) {
        console.error("Failed to parse a session replay segment:", error);
        return null;
      }
    })
    .filter(Boolean);

  if (!bodies.length) return;

  segments.value = [...segments.value, ...bodies];
  loadedRanges.value = [
    ...loadedRanges.value,
    { start: hits[0].start, end: hits[hits.length - 1].end },
  ];
};

// Later segments only: an earlier range would decode against converter state that has already moved on.
const loadRemainingSegments = async (fromIndex: number) => {
  for (let i = fromIndex; i < manifest.value.length; i += SEGMENT_BATCH) {
    if (cancelled) return;
    const batch = manifest.value.slice(i, i + SEGMENT_BATCH);
    try {
      const { hits } = await fetchAllPages(
        bodiesSql(batch[0].start, batch[batch.length - 1].start),
      );
      if (cancelled) return;
      appendSegmentBodies(hits);
    } catch (error) {
      console.error("Failed to fetch session replay segments:", error);
      return;
    }
  }
};

// Absolute time the player must reach first: the forwarded event if the route asks for one, else the session start.
const initialTarget = () => {
  const sessionStart = Number(sessionState.data.selectedSession?.start_time) || 0;
  // forwardToEventTime is a [milliseconds, label] pair; only the first element is a time.
  const relative = Number(forwardToEventTime.value?.[0]) || 0;
  return relative > 0 ? sessionStart + relative : sessionStart;
};

const getSessionSegments = async () => {
  if (!sessionState.data.selectedSession) {
    // No session to fetch a replay for — resolve the loading state so the player can fall
    // through to its empty message instead of spinning forever.
    segmentsLoading.value = false;
    return;
  }

  isLoading.value.push(true);
  // A second load must not judge seeks against the previous session's window.
  windowStart.value = 0;
  unreachableSeek.value = false;
  try {
    const { hits, complete } = await fetchAllPages(manifestSql());
    manifest.value = hits as ManifestEntry[];
    manifestSummary.value = summarizeManifest(manifest.value, complete);
    if (cancelled || !manifest.value.length) return;

    // Only the window from the nearest full snapshot to the target, so the first frame does not wait on the whole session.
    const firstWindow = selectInitialWindow(manifest.value, initialTarget());
    if (!firstWindow) return;
    windowStart.value = firstWindow.from;

    const { hits: bodyHits } = await fetchAllPages(bodiesSql(firstWindow.from, firstWindow.to));
    if (cancelled) return;
    appendSegmentBodies(bodyHits);

    void loadRemainingSegments(firstWindow.targetIndex + 1);
  } catch (error) {
    console.error("Failed to fetch session replay segments:", error);
  } finally {
    isLoading.value.pop();
    // Segment fetch settled: the mobile player can now decide between the replay and the
    // empty state without a premature "No session replay available" flash.
    segmentsLoading.value = false;
  }
};

const getSessionEvents = () => {
  const queryPayload: any = {
    from: 0,
    size: 150,
    timestamp_column: store.state.zoConfig.timestamp_column,
    timestamps: {
      startTime: Number(sessionState.data.selectedSession?.start_time) * 1000 - 1,
      endTime: Number(sessionState.data.selectedSession?.end_time) * 1000 + 1,
    },
    sqlMode: false,
    currentPage: 0,
    parsedQuery: null,
  };

  const req = buildQueryPayload(queryPayload, t);
  req.query.sql = `select * from "_rumdata" where ${sqlEquals("session_id", sessionId.value)} and (type='error' or type='action' or type='view') order by date asc`;
  delete req.aggs;
  isLoading.value.push(true);
  searchService
    .search(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: req,
        page_type: "logs",
      },
      "RUM",
    )
    .then((res) => {
      const events = ["action", "view", "error"];

      // Test the SOURCE field, not the rendered value: user_email is filled with
      // t("common.unknownUser") when absent, so comparing it to the English
      // literal stopped this backfill firing in every non-English locale.
      if (!sessionState.data.selectedSession?.user_email)
        sessionDetails.value.user_email = res.data.hits[0]?.usr_email;

      // Each view arrives once per SDK update (same view_id, rising document
      // version); collapse them so one navigation reads as one breadcrumb.
      segmentEvents.value = collapseViewDocuments(
        res.data.hits.filter((hit: any) => {
          return (
            !!events.includes(hit.type) &&
            hit.date >= Number(sessionState.data.selectedSession.start_time)
          );
        }),
      );
      segmentEvents.value = segmentEvents.value.map((hit: any) => {
        // Store raw event data for detail view
        const eventId = hit[`${hit.type}_id`];
        if (eventId) {
          rawEventsMap.value.set(eventId, hit);
        }
        return formatEvent(hit);
      });
      getSessionErrorLogs();
    })
    .catch((error) => {
      console.error("Failed to fetch sesion events:", error);
    })
    .finally(() => isLoading.value.pop());
};

const getSessionErrorLogs = () => {
  const queryPayload: any = {
    from: 0,
    size: 150,
    timestamp_column: store.state.zoConfig.timestamp_column,
    timestamps: {
      startTime: Number(sessionState.data.selectedSession?.start_time) * 1000 - 1,
      endTime: Number(sessionState.data.selectedSession?.end_time) * 1000 + 1,
    },
    sqlMode: false,
    currentPage: 0,
    parsedQuery: null,
  };

  const req = buildQueryPayload(queryPayload, t);
  req.query.sql = `select * from "_rumlog" where ${sqlEquals("session_id", sessionId.value)} and status='error' order by date asc`;
  delete req.aggs;
  isLoading.value.push(true);
  searchService
    .search(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: req,
        page_type: "logs",
      },
      "RUM",
    )
    .then((res) => {
      const events = res.data.hits.filter((hit: any) => {
        return hit.date >= Number(sessionState.data.selectedSession.start_time);
      });

      const errorEvents = events.map((hit: any) => {
        hit.type = "error";
        hit.error_id = getUUID();
        hit.error_message = hit.message;
        // Store raw event data
        rawEventsMap.value.set(hit.error_id, hit);
        return formatEvent(hit);
      });

      // One assignment: a shallowRef does not react to a push.
      segmentEvents.value = [...segmentEvents.value, ...errorEvents].sort(
        (a, b) => a.timestamp - b.timestamp,
      );

      videoPlayerRef.value?.updatePlayerState();

      // Calculate time_spent based on actual event timestamps (lastEvent - firstEvent)
      // This matches rrweb-player's calculation
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
  // formatTimeDifference is absolute, so an event from before playback begins would come
  // back as a positive offset pointing the wrong way. Pin those to the first frame.
  const relativeTime = formatTimeDifference(
    Math.max(_event.timestamp, replayOrigin.value),
    replayOrigin.value,
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

// goto() counts from the first event fed to the player, which is the anchored window, not the session start.
const toPlayerOffset = (relativeTime: number) => {
  const sessionStart = Number(sessionState.data.selectedSession?.start_time) || 0;
  const baseline =
    Number(videoPlayerRef.value?.playerState?.startTime) || windowStart.value || sessionStart;
  return Math.max(0, relativeTime - (baseline - sessionStart));
};

// The loader only moves forward, so a target before the window never becomes playable in this run.
const isBehindWindow = (relativeTime: number) => {
  const sessionStart = Number(sessionState.data.selectedSession?.start_time) || 0;
  return windowStart.value > 0 && sessionStart + relativeTime < windowStart.value;
};

const planSeekForRelativeTime = (relativeTime: number) =>
  planSeek(
    (Number(sessionState.data.selectedSession?.start_time) || 0) + relativeTime,
    loadedRanges.value,
    snapshotStarts(manifest.value),
  );

// Retry the seek once the background loader covers it; an unplayable target is left alone.
watch(loadedRanges, () => {
  if (pendingSeek.value === null) return;
  const target = pendingSeek.value;
  const plan = planSeekForRelativeTime(target);
  if (plan.status === "needs-fetch") return;
  pendingSeek.value = null;
  if (plan.status === "ready") {
    videoPlayerRef.value?.goto(
      toPlayerOffset(target),
      !!videoPlayerRef.value?.playerState?.isPlaying,
    );
  }
});

const handleSidebarEvent = (event: string, payload: any) => {
  if (event === "event-click") {
    // Open event detail drawer
    selectedEvent.value = payload;
    selectedRawEvent.value = rawEventsMap.value.get(payload.event_id) || {};
    showEventDetailDrawer.value = true;
  }

  const relativeTime = Number(payload.relativeTime) || 0;

  // Always seek to the event time in the video player
  videoPlayerRef.value?.goto(
    toPlayerOffset(relativeTime),
    !!videoPlayerRef.value?.playerState?.isPlaying,
  );

  // The seek still happened; this only tracks whether the window behind it is loaded yet.
  unreachableSeek.value = isBehindWindow(relativeTime);
  const plan = unreachableSeek.value ? null : planSeekForRelativeTime(relativeTime);
  pendingSeek.value = plan?.status === "needs-fetch" ? relativeTime : null;
};
</script>
