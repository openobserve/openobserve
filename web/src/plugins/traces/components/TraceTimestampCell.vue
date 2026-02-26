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
  <div class="column justify-center" data-test="trace-row-timestamp">
    <span
      class="text-caption text-weight-medium tw:text-[var(--o2-text-1)]!"
      data-test="trace-row-timestamp-day"
    >
      {{ formatted.day }} {{ formatted.time }}
    </span>
  </div>
</template>

<script lang="ts">
// Module-level moment singleton — loaded once, shared across all row instances
let _moment: any = null;
const _momentReady = import("moment-timezone").then((m) => {
  _moment = m.default;
});
</script>

<script setup lang="ts">
import { ref, watch, onBeforeMount } from "vue";
import { date as qDate } from "quasar";
import { useStore } from "vuex";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatTimeTo12Hour(date: Date): string {
  let hr = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ampm = hr >= 12 ? "PM" : "AM";
  hr = hr % 12 || 12;
  return `${String(hr).padStart(2, "0")}:${m}:${s} ${ampm}`;
}

const props = defineProps<{
  item: Record<string, any>;
}>();

const store = useStore();
const formatted = ref({ day: "", time: "" });

function buildFormatted() {
  if (!_moment) return;
  const tz = store.state.timezone;
  const ts = (props.item.trace_start_time || 0) / 1000;
  const FMT = "YYYY-MM-DD HH:mm:ss";
  const tsMoment = _moment.tz(new Date(ts), tz);
  const nowStr = _moment.tz(new Date(), tz).format(FMT);
  const diffSec = qDate.getDateDiff(nowStr, tsMoment.format(FMT), "seconds");

  const d = tsMoment.toDate();
  let day = "";
  if (diffSec < 86400) day = "Today";
  else if (diffSec < 86400 * 2) day = "Yesterday";
  else day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;

  formatted.value = { day, time: formatTimeTo12Hour(d) };
}

watch(() => props.item?.trace_start_time, buildFormatted);

onBeforeMount(async () => {
  await _momentReady;
  buildFormatted();
});
</script>
