<template>
  <div class="row qp-2 full-height">
    <div class="col-9">
      <VideoPlayer :events="[]" />
    </div>
    <div class="col-3">
      <PlayerEventsSidebar :events="formatEvents" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import PlayerEventsSidebar from "@/components/rum/PlayerEventsSidebar.vue";
import VideoPlayer from "@/components/rum/VideoPlayer.vue";
import { events } from "./events.js";
import { cloneDeep } from "lodash-es";

const defaultEvent = {
  id: "",
  event_id: "",
  type: "",
  name: "",
  start_time: 0,
  end_time: 0,
  relativeTime: 0,
  displayTime: "",
  loading_time: "",
  loading_type: "",
  user: {},
};

const session_start_time = 1692884313968;
const session_end_time = 1692884769270;

const getDefaultEvent = (event: any) => {
  const _event = cloneDeep(defaultEvent);
  _event.id = event.id;
  _event.event_id = event.event_id;
  _event.type = event.event?.custom?.type;
  _event.start_time = event.event.client_time;
  _event.end_time = event.event.end_time;
  const relativeTime = formatTimeDifference(
    _event.start_time,
    session_start_time
  );
  _event.relativeTime = relativeTime[0];
  _event.displayTime = relativeTime[1];
  return _event;
};

const handleErrorEvent = (event: any) => {
  const _event = getDefaultEvent(event);
  if (event.event.custom.error) {
    _event.name =
      event.event.custom.error["source"] +
      " error " +
      event.event.custom.error.stack;
  }
  return _event;
};

const handleActionEvent = (event: any) => {
  const _event = getDefaultEvent(event);
  if (event.event.custom.error) {
    _event.name = event.event.custom.error.message;
  }
  return _event;
};

const handleViewEvent = (event: any) => {
  const _event = getDefaultEvent(event);
  if (event.event.custom.error) {
    _event.name =
      event.event.custom.error["source"] +
      " error " +
      event.event.custom.error.stack;
  }
  return _event;
};

const formatEvents = events.map((event: any) => {
  try {
    const eventTypes = {
      error: handleErrorEvent,
      action: handleActionEvent,
      view: handleViewEvent,
    };

    return eventTypes[event.event?.custom?.type](event);
  } catch (err) {
    console.log(err);
    return null;
  }
});

function formatTimeDifference(start_time: number, end_time: number) {
  const milliSeconds = Math.abs(start_time - end_time);
  console.log(start_time, end_time, milliSeconds);
  // Calculate hours, minutes, and seconds
  let hours: string | number = Math.floor(milliSeconds / (1000 * 60 * 60));
  let minutes: string | number = Math.floor(
    (milliSeconds % (1000 * 60 * 60)) / (1000 * 60)
  );
  let seconds: string | number = Math.floor(
    (milliSeconds % (1000 * 60)) / 1000
  );

  console.log(hours, minutes, seconds);

  // Add leading zeros if needed
  hours = hours < 10 ? "0" + hours : hours;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  seconds = seconds < 10 ? "0" + seconds : seconds;

  console.log(hours, minutes, seconds);

  if (hours === "00") {
    return [milliSeconds, `${minutes}:${seconds}`];
  }

  if (hours === "00" && minutes === "00") {
    return [milliSeconds, `${seconds}`];
  }

  return [milliSeconds, `${hours}:${minutes}:${seconds}`];
}
console.log(formatEvents.sort((a, b) => a.start_time - b.start_time));
</script>

<style scoped></style>
