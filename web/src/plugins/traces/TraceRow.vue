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
  <div
    data-test="trace-row"
    class="trace-row tw:flex-nowrap! tw:w-max! row items-center q-px-sm cursor-pointer tw:bg-white!"
    :class="{ 'trace-row--error': hasErrors }"
    @click="$emit('click', item)"
  >
    <!-- TIMESTAMP -->
    <div
      data-test="trace-row-timestamp"
      class="row-cell col-timestamp column justify-center"
    >
      <span
        data-test="trace-row-timestamp-day"
        class="text-caption text-weight-medium tw:text-[var(--o2-text-1)]!"
      >
        {{ formattedDate.day }} {{ formattedDate.time }}
      </span>
    </div>

    <!-- SERVICE & OPERATION -->
    <div
      data-test="trace-row-service"
      class="row-cell col-service row items-center"
    >
      <!-- Service color dot -->
      <span
        data-test="trace-row-service-dot"
        class="service-dot q-mr-sm"
        :style="{
          backgroundColor: rootServiceColor,
          boxShadow: `0 0 0.5rem ${rootServiceColor}`,
        }"
      />

      <div class="column" style="min-width: 0">
        <span
          data-test="trace-row-service-name"
          class="text-weight-bold ellipsis tw:text-[var(--o2-text-4)]! tw:text-[0.875rem]! tw:tracking-[0.03rem]!"
        >
          {{ item["service_name"] }}
        </span>
        <span
          data-test="trace-row-operation-name"
          class="text-caption text-grey-6 ellipsis tw:text-[var(--o2-text-1)]!"
        >
          {{ item["operation_name"] }}
        </span>
      </div>

      <!-- +N more badge for multi-service traces -->
      <q-badge
        v-if="extraServiceCount > 0"
        data-test="trace-row-extra-services"
        :label="`+${extraServiceCount}`"
        class="spans-badge tw:bg-[var(--o2-tag-grey-2)]! tw:text-[var(--o2-text-1)]! tw:px-[0.5rem]! tw:py-[0.25rem]! tw:ml-[0.5rem]"
      >
        <q-tooltip
          class="extra-services-tooltip"
          anchor="bottom middle"
          self="top middle"
        >
          <div
            v-for="svc in extraServicesData"
            :key="svc.name"
            class="tw:flex tw:items-center"
          >
            <div
              class="tw:h-[0.5rem]! tw:w-[0.5rem]! tw:rounded tw:mr-[0.5rem] tw:pt-[0.06rem]"
              :style="{
                backgroundColor: svc.color,
                boxShadow: `0 0 0.5rem ${svc.color}`,
              }"
            />
            <span
              class="text-weight-bold ellipsis tw:text-[var(--o2-text-4)]! tw:text-[0.875rem]! tw:tracking-[0.03rem]!"
              >{{ svc.name }}</span
            >
          </div>
        </q-tooltip>
      </q-badge>
    </div>

    <!-- DURATION -->
    <div
      data-test="trace-row-duration"
      class="row-cell col-duration text-caption text-right"
    >
      {{ duration }}
    </div>

    <!-- LLM: INPUT TOKENS -->
    <template v-if="showLlmColumns">
      <div
        data-test="trace-row-input-tokens"
        class="row-cell col-llm text-caption text-right"
      >
        {{ llmData ? formatTokens(llmData.usage.input) : "-" }}
      </div>

      <!-- LLM: OUTPUT TOKENS -->
      <div
        data-test="trace-row-output-tokens"
        class="row-cell col-llm text-caption text-right"
      >
        {{ llmData ? formatTokens(llmData.usage.output) : "-" }}
      </div>

      <!-- LLM: COST -->
      <div
        data-test="trace-row-cost"
        class="row-cell col-cost text-caption text-right"
      >
        {{ llmData ? `$${formatCost(llmData.cost.total)}` : "-" }}
      </div>
    </template>

    <!-- STATUS -->
    <div
      data-test="trace-row-status"
      class="row-cell col-status flex justify-center"
    >
      <div
        data-test="trace-row-status-pill"
        class="status-pill row items-center q-px-sm"
        :class="hasErrors ? 'status-pill--error' : 'status-pill--success'"
      >
        <span class="status-dot q-mr-xs" />
        <span class="text-caption text-weight-bold status-label">
          {{ statusLabel }}
        </span>
      </div>
    </div>

    <!-- SPANS -->
    <div
      data-test="trace-row-spans"
      class="row-cell col-spans flex justify-center"
    >
      <q-badge
        data-test="trace-row-spans-badge"
        :label="item.spans"
        class="spans-badge tw:bg-[var(--o2-tag-grey-2)]! tw:text-[var(--o2-text-1)]! tw:px-[0.5rem]! tw:py-[0.325rem]!"
      />
    </div>

    <!-- SERVICE LATENCY mini-bar -->
    <div data-test="trace-row-latency" class="row-cell col-latency">
      <div data-test="trace-row-latency-bar" class="latency-bar row no-wrap">
        <template v-for="(count, service) in item.services" :key="service">
          <div
            data-test="trace-row-latency-segment"
            class="latency-segment"
            :style="{
              width: `${getServiceWidth(count)}%`,
              backgroundColor: serviceColors[service] || '#9e9e9e',
            }"
          >
            <q-tooltip>
              {{ service }}: {{ count }} span{{ count !== 1 ? "s" : "" }}
            </q-tooltip>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeMount, onBeforeUnmount } from "vue";
import { date as qDate } from "quasar";
import { formatTimeWithSuffix } from "@/utils/zincutils";
import { useStore } from "vuex";
import useTraces from "@/composables/useTraces";
import {
  isLLMTrace,
  extractLLMData,
  formatCost,
  formatTokens,
} from "@/utils/llmUtils";

export interface TraceRowProps {
  item: Record<string, any>;
  index: number;
  showLlmColumns?: boolean;
}

const props = withDefaults(defineProps<TraceRowProps>(), {
  showLlmColumns: false,
});

defineEmits<{
  click: [item: Record<string, any>];
}>();

const store = useStore();
const { searchObj } = useTraces();

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------
let moment: any;

const formattedDate = ref({ day: "", time: "" });

const importMoment = async () => {
  const m = await import("moment-timezone");
  moment = m.default;
};

const getFormattedDate = () => {
  if (!moment) return;
  const format = "YYYY-MM-DD HH:mm:ss";
  const timezone = store.state.timezone;
  const ts = (props.item["trace_start_time"] || 0) / 1000;

  const dateStr = moment.tz(new Date(ts), timezone).format(format);
  const nowStr = moment.tz(new Date(), timezone).format(format);
  const diffSec = qDate.getDateDiff(nowStr, dateStr, "seconds");

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  let day = "";
  if (diffSec < 86400) day = "Today";
  else if (diffSec < 86400 * 2) day = "Yesterday";
  else {
    const d = new Date(dateStr);
    day = `${d.getDate()} ${months[d.getMonth()]}`;
  }

  formattedDate.value = { day, time: formatTimeTo12Hour(new Date(dateStr)) };
};

function formatTimeTo12Hour(date: Date): string {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${m}:${s} ${ampm}`;
}

watch(() => props.item?.trace_start_time, getFormattedDate);

onBeforeMount(async () => {
  await importMoment();
  getFormattedDate();
});

onBeforeUnmount(() => {
  moment = null;
});

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------
const duration = computed(
  () => formatTimeWithSuffix(props.item?.duration) || "0us",
);

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
const hasErrors = computed(() => (props.item?.errors ?? 0) > 0);

const statusLabel = computed(() => {
  if (!hasErrors.value) return "SUCCESS";
  const n = props.item.errors;
  return `${n} ERROR${n !== 1 ? "S" : ""}`;
});

// ---------------------------------------------------------------------------
// Service & multi-service badge
// ---------------------------------------------------------------------------
const serviceColors = computed(() => searchObj.meta.serviceColors ?? {});

const rootServiceColor = computed(
  () => serviceColors.value[props.item.service_name] ?? "#9e9e9e",
);

const extraServiceCount = computed(() => {
  const services = props.item.services ?? {};
  const total = Object.keys(services).length;
  // Root service is already shown — count the remaining ones
  return Math.max(0, total - 1);
});

const extraServicesData = computed(() => {
  const services = props.item.services ?? {};
  return Object.keys(services)
    .filter((s) => s !== props.item.service_name)
    .map((s) => ({ name: s, color: serviceColors.value[s] ?? "#9e9e9e" }));
});

// ---------------------------------------------------------------------------
// Service latency mini-bar
// ---------------------------------------------------------------------------
const totalSpans = computed(() => {
  const services = props.item.services ?? {};
  return (
    Object.values(services).reduce<number>(
      (acc, c) => acc + (c as number),
      0,
    ) || 1
  );
});

function getServiceWidth(count: number): number {
  return (count / totalSpans.value) * 100;
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------
const llmData = computed(() => {
  if (!isLLMTrace(props.item)) return null;
  return extractLLMData(props.item);
});
</script>

<style lang="scss" scoped>
.trace-row {
  min-height: 52px;
  border-bottom: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.06));
  transition: background 0.15s ease;

  &:hover {
    background: var(--o2-table-header-bg);
  }

  &--error {
    border-left: 3px solid var(--q-negative);
    padding-left: 5px;
  }
}

.row-cell {
  padding: 8px;
  overflow: hidden;
}

/* Column widths — must match TracesTableHeader.vue */
.col-timestamp {
  width: 160px;
  flex: 0 0 160px;
}
.col-service {
  flex: 1 1 0;
  min-width: 180px;
}
.col-duration {
  width: 120px;
  flex: 0 0 120px;
}
.col-spans {
  width: 80px;
  flex: 0 0 80px;
}
.col-status {
  width: 160px;
  flex: 0 0 160px;
}
.col-llm {
  width: 125px;
  flex: 0 0 125px;
}
.col-cost {
  width: 80px;
  flex: 0 0 80px;
}
.col-latency {
  width: 160px;
  flex: 0 0 160px;
}

/* Service dot */
.service-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Status pill */
.status-pill {
  border-radius: 12px;
  padding: 2px 10px;
  display: inline-flex;
  align-items: center;
  width: fit-content;

  &--success {
    background: rgba(76, 175, 80, 0.12);
    color: var(--q-positive, #388e3c);

    .status-dot {
      background: var(--q-positive, #4caf50);
    }
  }

  &--error {
    background: rgba(244, 67, 54, 0.12);
    color: var(--q-negative, #c62828);

    .status-dot {
      background: var(--q-negative, #f44336);
    }
  }
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-label {
  font-size: 0.7rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

/* Extra services badge */
.extra-services-badge {
  font-size: 0.7rem;
  padding: 1px 6px;
  flex-shrink: 0;
}

/* Service latency mini-bar */
.latency-bar {
  height: 0.85rem;
  border-radius: 4px;
  overflow: hidden;
  width: 100%;
  background: var(--o2-border-color, rgba(0, 0, 0, 0.08));
}

.latency-segment {
  height: 100%;
  min-width: 2px;
}
</style>
