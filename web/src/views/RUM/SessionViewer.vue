<template>
  <div class="row qp-2 full-height">
    <div
      class="q-pb-lg flex items-center justify-center text-center full-width"
      style="height: calc(100vh - 200px)"
    >
      <div>
        <q-spinner-hourglass
          color="primary"
          size="40px"
          style="margin: 0 auto; display: block"
        />
        <div class="text-center full-width">
          Hold on tight, we're fetching session.
        </div>
      </div>
    </div>

    <div class="col-12 q-px-sm q-pt-md row items-end bg-grey-2">
      <div class="col-9 row">
        <div
          class="text-caption ellipsis row items-center q-mr-md"
          style="font-size: 20px"
        >
          <q-icon name="language" size="20px" class="q-pr-xs" />
          {{ getSessionDetails.ip }}
        </div>
        <div class="text-caption ellipsis q-pr-xs row items-center q-mr-md">
          <q-icon name="calendar_month" size="16px" class="q-pr-xs" />
          {{ getSessionDetails.date }}
        </div>
      </div>
      <q-separator class="full-width q-mt-sm" />
    </div>
    <div class="col-9">
      <VideoPlayer
        ref="videoPlayerRef"
        :events="segmentEvents"
        :segments="segments"
      />
    </div>
    <div class="col-3 row">
      <q-separator vertical class="full-height" />
      <PlayerEventsSidebar
        :events="segmentEvents"
        :sessionDetails="getSessionDetails"
        @event-emitted="handleSidebarEvent"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import PlayerEventsSidebar from "@/components/rum/PlayerEventsSidebar.vue";
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import { cloneDeep } from "lodash-es";
import { computed, onBeforeMount, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import searchService from "@/services/search";
import useQuery from "@/composables/useQuery";
import useSessionsReplay from "@/composables/useSessionReplay";
import { date } from "quasar";

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

const session_start_time = 1692884313968;
const session_end_time = 1692884769270;

const getSessionId = computed(() => router.currentRoute.value.params.id);

onBeforeMount(async () => {
  sessionId.value = router.currentRoute.value.params.id as string;
  await getSession();
  getSessionSegments();
  getSessionEvents();
});

const getSessionDetails = computed(() => {
  return {
    date: getFormattedDate(sessionState.data.selectedSession?.start_time),
    browser: sessionState.data.selectedSession?.browser,
    os: sessionState.data.selectedSession?.os,
    ip: sessionState.data.selectedSession?.ip,
    user_email: sessionState.data.selectedSession?.user_email,
    city: sessionState.data.selectedSession?.city,
    country: sessionState.data.selectedSession?.country,
  };
});

const getSession = () => {
  console.log(router.currentRoute.value.query.start_time);
  return new Promise((resolve) => {
    const req = {
      query: {
        sql: `select min(${store.state.zoConfig.timestamp_column}) as zo_sql_timestamp, min(start) as start_time, max(end) as end_time, min(user_agent_user_agent_family) as browser, min(user_agent_os_family) as os, min(ip) as ip, min(source) as source, min(geo_info_city) as city, min(geo_info_country) as country, min(session_id) as session_id from "_sessionreplay" where session_id='${getSessionId.value}' order by zo_sql_timestamp`,
        start_time:
          Number(router.currentRoute.value.query.start_time) - 900000000,
        end_time: Number(router.currentRoute.value.query.end_time) + 900000000,
        from: 0,
        size: 10,
        sql_mode: "full",
      },
    };

    isLoading.value.push(true);
    searchService
      .search({
        org_identifier: store.state.selectedOrganization.identifier,
        query: req,
        page_type: "logs",
      })
      .then((res) => {
        if (res.data.hits.length === 0) {
          console.log("No session found");
          return;
        }
        sessionState.data.selectedSession = {
          ...res.data.hits[0],
          type: res.data.hits[0].source,
          time_spent: res.data.hits[0].end_time - res.data.hits[0].start_time,
          timestamp: res.data.hits[0].zo_sql_timestamp,
        };
      })
      .finally(() => {
        isLoading.value.pop();
        resolve(true);
      });
  });
};

const getSessionSegments = () => {
  if (!sessionState.data.selectedSession) return;

  const queryPayload = {
    from: 0,
    size: 150,
    timestamp_column: store.state.zoConfig.timestamp_column,
    timestamps: {
      startTime:
        Number(sessionState.data.selectedSession?.start_time) * 1000 - 300000,
      endTime:
        Number(sessionState.data.selectedSession?.end_time) * 1000 + 300000,
    },
    sqlMode: false,
    currentPage: 0,
    parsedQuery: null,
  };

  const req = buildQueryPayload(queryPayload);
  req.query.sql = `select * from "_sessionreplay" where session_id='${sessionId.value}' order by ${store.state.zoConfig.timestamp_column} asc`;
  delete req.aggs;
  isLoading.value.push(true);
  searchService
    .search({
      org_identifier: store.state.selectedOrganization.identifier,
      query: req,
      page_type: "logs",
    })
    .then((res) => {
      res.data.hits.forEach((hit: any) => {
        segments.value.push(JSON.parse(hit.segment));
      });
    })
    .finally(() => isLoading.value.pop());
};

const getSessionEvents = () => {
  const queryPayload = {
    from: 0,
    size: 150,
    timestamp_column: store.state.zoConfig.timestamp_column,
    timestamps: {
      startTime:
        Number(sessionState.data.selectedSession?.start_time) * 1000 - 300000,
      endTime:
        Number(sessionState.data.selectedSession?.start_time) * 1000 + 300000,
    },
    sqlMode: false,
    currentPage: 0,
    parsedQuery: null,
  };

  const req = buildQueryPayload(queryPayload);
  req.query.sql = `select * from "_rumdata" where session_id='${sessionId.value}' order by ${store.state.zoConfig.timestamp_column} asc`;
  delete req.aggs;
  isLoading.value.push(true);
  searchService
    .search({
      org_identifier: store.state.selectedOrganization.identifier,
      query: req,
      page_type: "logs",
    })
    .then((res) => {
      const events = ["action", "view", "error"];
      segmentEvents.value = res.data.hits.filter((hit: any) => {
        return !!events.includes(hit.type);
      });
      segmentEvents.value = segmentEvents.value.map((hit: any) => {
        return formatEvent(hit);
      });
    })
    .finally(() => isLoading.value.pop());
};

const getDefaultEvent = (event: any) => {
  const _event = cloneDeep(defaultEvent);
  _event.id = event[`${event.type}_id`];
  _event.event_id = event[`${event.type}_id`];
  _event.type = event.type;
  _event.timestamp = event[store.state.zoConfig.timestamp_column];
  const relativeTime = formatTimeDifference(
    _event.timestamp / 1000,
    Number(router.currentRoute.value.query.start_time)
  );
  _event.relativeTime = relativeTime[0];
  _event.displayTime = relativeTime[1];
  return _event;
};

const handleErrorEvent = (event: any) => {
  const _event = getDefaultEvent(event);
  _event.name = event.error_message;
  return _event;
};

const handleActionEvent = (event: any) => {
  const _event = getDefaultEvent(event);
  // if (event.event.custom.error) {
  //   _event.name = event.event.custom.error.message;
  // }
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
  _event.name = event.view_loading_type + " : " + event.view_url;
  return _event;
};

const formatEvent = (event: any) => {
  try {
    const eventTypes = {
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
    (milliSeconds % (1000 * 60 * 60)) / (1000 * 60)
  );
  let seconds: string | number = Math.floor(
    (milliSeconds % (1000 * 60)) / 1000
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

const handleSidebarEvent = (event, payload) => {
  videoPlayerRef.value.goto(
    payload.relativeTime,
    !!videoPlayerRef.value.playerState?.isPlaying
  );
};
</script>

<style scoped></style>
