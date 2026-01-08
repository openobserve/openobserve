<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="row qp-2 tw:h-full tw:px-[0.625rem] tw:pt-[0.25rem]">
    <div class="col-12 row items-end tw:pb-[0.625rem]">
      <div class="col-12 row card-container tw:px-[0.625rem] tw:py-[0.625rem]">
        <div
          class="flex justify-center items-center q-mr-md cursor-pointer hover:tw:text-[var(--o2-primary-btn-bg)] tw:border-[1.5px] tw:border-solid tw:rounded-full tw:w-[1.375rem] tw:h-[1.375rem]"
          title="Go Back"
          @click="router.back()"
        >
          <q-icon name="arrow_back_ios_new" size="0.875rem" />
        </div>
        <div class="text-caption ellipsis row items-center q-mr-md">
          <q-icon name="language" size="0.875rem" class="q-pr-xs" />
          {{ sessionDetails.ip }}
        </div>
        <div class="text-caption ellipsis row items-center q-mr-md">
          <q-icon name="calendar_month" size="0.875rem" class="q-pr-xs" />
          {{ sessionDetails.date }}
        </div>
        <div class="text-caption ellipsis row items-center q-mr-md">
          <q-icon name="person" size="0.875rem" class="q-pr-xs" />
          {{ sessionDetails.user_email || "Unknown User" }}
        </div>
        <div class="text-caption ellipsis row items-center q-mr-md">
          <q-icon name="location_on" size="0.875rem" class="q-pr-xs" />
          {{ sessionDetails.city }}, {{ sessionDetails.country }}
        </div>
        <div class="text-caption ellipsis row items-center q-mr-md">
          <q-icon name="settings" size="0.875rem" class="q-pr-xs" />
          {{ sessionDetails.browser }}, {{ sessionDetails.os }}
        </div>
        <div
          v-if="frustrationCount > 0"
          class="text-caption ellipsis row items-center"
          :title="`${frustrationCount} frustration signal${frustrationCount > 1 ? 's' : ''} detected`"
          data-test="session-viewer-frustration-summary"
        >
          <q-icon name="sentiment_very_dissatisfied" size="0.875rem" class="q-pr-xs" style="color: #fb923c;" data-test="frustration-summary-icon" />
          <span class="tw:font-semibold" style="color: #fb923c;" data-test="frustration-summary-text">{{ frustrationCount }} Frustration{{ frustrationCount > 1 ? 's' : '' }}</span>
        </div>
      </div>
    </div>
    <div
      class="col-12 row card-container tw:overflow-hidden tw:mb-[0.325rem] tw:h-[calc(100%-58px)]!"
    >
      <div class="col-9 full-height">
        <VideoPlayer
          ref="videoPlayerRef"
          :events="segmentEvents"
          :segments="segments"
          :is-loading="!!isLoading.length"
        />
      </div>
      <div class="col-3 row">
        <q-separator vertical class="full-height" />
        <PlayerEventsSidebar
          :events="segmentEvents"
          :sessionDetails="sessionDetails"
          @event-emitted="handleSidebarEvent"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import PlayerEventsSidebar from "@/components/rum/PlayerEventsSidebar.vue";
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import { cloneDeep } from "lodash-es";
import { computed, onActivated, onBeforeMount, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import searchService from "@/services/search";
import useQuery from "@/composables/useQuery";
import useSessionsReplay from "@/composables/useSessionReplay";
import usePerformance from "@/composables/rum/usePerformance";

import { date } from "quasar";
import { getUUID } from "@/utils/zincutils";

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
  user: {},
  frustration_type: null,
  frustration_types: [],
};

const sessionId = ref("1");
const router = useRouter();
const store = useStore();
const isLoading = ref<boolean[]>([]);
const { buildQueryPayload, getTimeInterval, parseQuery } = useQuery();
const segments = ref<any[]>([]);
const segmentEvents = ref<any[]>([]);
const { sessionState } = useSessionsReplay();
const videoPlayerRef = ref<any>(null);
const errorCount = ref(10);
const { performanceState } = usePerformance();

const session_start_time = 1692884313968;
const session_end_time = 1692884769270;

const getSessionId = computed(() => router.currentRoute.value.params.id);

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

const frustrationCount = computed(() => {
  return segmentEvents.value.filter((event: any) =>
    event.frustration_types && event.frustration_types.length > 0
  ).length;
});

onBeforeMount(async () => {
  sessionId.value = router.currentRoute.value.params.id as string;
  await getSession();
  getSessionSegments();
  getSessionEvents();
});

const getSessionDetails = () => {
  sessionDetails.value = {
    date: getFormattedDate(sessionState.data.selectedSession?.start_time),
    browser: sessionState.data.selectedSession?.browser,
    os: sessionState.data.selectedSession?.os,
    ip: sessionState.data.selectedSession?.ip,
    user_email: sessionState.data.selectedSession?.user_email || "Unknown User",
    city: sessionState.data.selectedSession?.city || "Unknown",
    country: sessionState.data.selectedSession?.country || "Unknown",
    id: sessionState.data.selectedSession?.session_id,
  };
};

const getSession = () => {
  return new Promise((resolve) => {
    let geoFields = "";

    if (
      performanceState.data.streams["_sessionreplay"]["schema"][
        "geo_info_country"
      ]
    ) {
      geoFields += "min(geo_info_city) as city,";
    }

    if (
      performanceState.data.streams["_sessionreplay"]["schema"]["geo_info_city"]
    ) {
      geoFields += "min(geo_info_country) as country,";
    }

    const req = {
      query: {
        sql: `select min(${store.state.zoConfig.timestamp_column}) as zo_sql_timestamp, min(start) as start_time, max(end) as end_time, min(user_agent_user_agent_family) as browser, min(user_agent_os_family) as os, min(ip) as ip, min(source) as source, ${geoFields} min(session_id) as session_id from "_sessionreplay" where session_id='${getSessionId.value}' order by zo_sql_timestamp`,
        start_time:
          Number(router.currentRoute.value.query.start_time) - 86400000000,
        end_time:
          Number(router.currentRoute.value.query.end_time) + 86400000000,
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

const getSessionSegments = () => {
  if (!sessionState.data.selectedSession) return;

  const queryPayload: any = {
    from: 0,
    size: 1000,
    timestamp_column: store.state.zoConfig.timestamp_column,
    timestamps: {
      startTime:
        Number(sessionState.data.selectedSession?.start_time) * 1000 - 300000,
      endTime:
        Number(sessionState.data.selectedSession?.end_time) * 1000 + 300000000,
    },
    sqlMode: false,
    currentPage: 0,
    parsedQuery: null,
  };

  const req = buildQueryPayload(queryPayload);
  req.query.sql = `select * from "_sessionreplay" where session_id='${sessionId.value}' order by start asc`;
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
      // const segmentsCopy = [];
      // const viewIds = [];
      res.data.hits.forEach((hit: any) => {
        segments.value.push(JSON.parse(hit.segment));
      });

      // res.data.hits.forEach((hit: any) => {
      //   if (!viewIds.includes(hit.view_id)) viewIds.push(hit.view_id);
      // });

      // // loop over view_id Group ( array of array) segments from view_id and sort each group by start_time
      // viewIds.forEach((view_id) => {
      //   const group = res.data.hits
      //     .filter((hit: any) => hit.view_id === view_id)
      //     .sort((a, b) => a.start - b.start);

      //   segmentsCopy.push(group.map((hit: any) => JSON.parse(hit.segment)));
      // });

      // segments.value = segmentsCopy.flat();
    })
    .catch((error) => {
      console.error("Failed to fetch session events:", error);
    })
    .finally(() => isLoading.value.pop());
};

const getSessionEvents = () => {
  const queryPayload: any = {
    from: 0,
    size: 150,
    timestamp_column: store.state.zoConfig.timestamp_column,
    timestamps: {
      startTime:
        Number(sessionState.data.selectedSession?.start_time) * 1000 - 1,
      endTime: Number(sessionState.data.selectedSession?.end_time) * 1000 + 1,
    },
    sqlMode: false,
    currentPage: 0,
    parsedQuery: null,
  };

  const req = buildQueryPayload(queryPayload);
  req.query.sql = `select * from "_rumdata" where session_id='${sessionId.value}' and (type='error' or type='action' or type='view') order by date asc`;
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

      if (
        !sessionDetails.value.user_email ||
        sessionDetails.value.user_email === "Unknown User"
      )
        sessionDetails.value.user_email = res.data.hits[0].usr_email;

      segmentEvents.value = res.data.hits.filter((hit: any) => {
        return (
          !!events.includes(hit.type) &&
          hit.date >= Number(sessionState.data.selectedSession.start_time)
        );
      });
      segmentEvents.value = segmentEvents.value.map((hit: any) => {
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
      startTime:
        Number(sessionState.data.selectedSession?.start_time) * 1000 - 1,
      endTime: Number(sessionState.data.selectedSession?.end_time) * 1000 + 1,
    },
    sqlMode: false,
    currentPage: 0,
    parsedQuery: null,
  };

  const req = buildQueryPayload(queryPayload);
  req.query.sql = `select * from "_rumlog" where session_id='${sessionId.value}' and status='error' order by date asc`;
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

      events.forEach((hit: any, index: number) => {
        hit.type = "error";
        hit.error_id = getUUID();
        hit.error_message = hit.message;
        segmentEvents.value.push(formatEvent(hit));
      });

      segmentEvents.value.sort((a, b) => a.timestamp - b.timestamp);
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
  _event.name = event?.action_type + ' on "' + event?.action_target_name + '"' || "--";

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
  _event.name = event?.view_loading_type + " : " + event?.view_url || "--";
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
  let minutes: string | number = Math.floor(
    (milliSeconds % (1000 * 60 * 60)) / (1000 * 60),
  );
  let seconds: string | number = Math.floor(
    (milliSeconds % (1000 * 60)) / 1000,
  );

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
  date.formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss Z");

const handleSidebarEvent = (event: string, payload: any) => {
  videoPlayerRef.value.goto(
    payload.relativeTime,
    !!videoPlayerRef.value.playerState?.isPlaying,
  );
};
</script>

<style scoped></style>
