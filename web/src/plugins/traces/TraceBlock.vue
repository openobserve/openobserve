<template>
  <div
    class="trace-container full-width px-mg cursor-pointer"
    :class="store.state.theme === 'dark' ? 'dark' : ''"
  >
    <div
      class="flex justify-between q-px-sm q-py-xs"
      :class="
        store.state.theme === 'dark'
          ? 'bg-grey-9'
          : 'tw:bg-[var(--o2-table-header-bg)]'
      "
    >
      <div class="trace-name text-body2 text-bold">
        <span class="q-mr-xs"> {{ item?.service_name }}:</span>
        {{ item?.operation_name }}
      </div>
      <div class="trace-duration">
        {{ getDuration }}
      </div>
    </div>
    <div class="q-pa-sm">
      <!-- First row: Spans/Errors, Services, and Date/Time -->
      <div class="row justify-between">
        <div class="trace-summary flex" style="width: 175px">
          <div
            class="trace-spans q-px-sm q-mr-xs"
            :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-8'"
          >
            <span class="">Spans : </span>
            <span>{{ item?.spans }}</span>
          </div>
          <div v-if="item?.errors" class="trace-errors q-px-sm">
            <span class="">Errors : </span>
            <span>{{ item?.errors }}</span>
          </div>
        </div>
        <div
          class="flex justify-start items-start q-px-md"
          style="width: calc(100% - 350px)"
          v-if="item?.services"
        >
          <template v-for="(count, service) in item.services" :key="service">
            <div
              class="q-mr-md flex trace-tag justify-center items-center q-mb-xs"
              style="height: 22px; font-size: 12px"
            >
              <div
                class="full-height"
                :style="{
                  width: '14px',
                  backgroundColor: searchObj.meta.serviceColors[service],
                }"
              ></div>
              <div class="q-mx-xs">{{ service }} ({{ count }})</div>
            </div>
          </template>
        </div>

        <div class="trace-date-time" style="width: 175px">
          <div class="section-1 flex justify-end items-center">
            <div style="font-size: 14px" data-test="trace-block-trace-date-day">
              {{ formattedDate?.day }}
            </div>
            <div
              vertical
              style="height: 16px; width: 2px"
              class="q-mx-sm bg-grey-4"
            />
            <div style="font-size: 14px" data-test="trace-block-trace-date-time">
              {{ formattedDate?.time }}
            </div>
          </div>
        </div>
      </div>

      <!-- Second row: LLM Metrics (conditional) -->
      <div
        v-if="isLLMTraceItem && llmData"
        class="llm-metrics-container flex items-center q-px-sm q-mt-xs"
      >

        <!-- Token metrics -->
        <div class="token-metric q-mr-sm text-caption">
          <q-icon name="arrow_upward" size="12px" class="q-mr-xs" />
          <span class="text-weight-bold">{{ formatTokens(llmData.usage.input) }}</span> in
        </div>
        <div class="token-metric q-mr-sm text-caption">
          <q-icon name="arrow_downward" size="12px" class="q-mr-xs" />
          <span class="text-weight-bold">{{ formatTokens(llmData.usage.output) }}</span> out
        </div>

        <!-- Total tokens -->
        <div class="token-metric q-mr-md text-caption">
          <q-icon name="functions" size="12px" class="q-mr-xs" />
          <span class="text-weight-bold">{{ formatTokens(llmData.usage.total) }}</span> total
        </div>

        <!-- Cost -->
        <div class="cost-metric q-mr-md text-caption">
          <q-icon name="attach_money" size="12px" class="q-mr-xs" />
          <span class="text-weight-bold">{{ formatCost(llmData.cost.total) }}</span>
        </div>

        <!-- Input preview (truncated) -->
        <div class="input-preview ellipsis text-caption flex-1">
          <q-icon name="chat" size="12px" class="q-mr-xs" />
          {{ llmData.inputPreview }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeMount,
  onMounted,
  ref,
  onBeforeUnmount,
  watch,
  defineExpose,
} from "vue";
import { date as qDate } from "quasar";
import {
  timestampToTimezoneDate,
  formatDuration,
  formatTimeWithSuffix,
} from "@/utils/zincutils";
import { useStore } from "vuex";
import useTraces from "@/composables/useTraces";
import {
  isLLMTrace,
  extractLLMData,
  formatCost,
  formatTokens,
} from "@/utils/llmUtils";

const props = defineProps({
  item: {
    type: Object,
    default: () => ({}),
  },
  index: {
    type: Number,
    default: 0,
  },
});

const { searchObj } = useTraces();

const store = useStore();

let moment: any;

watch(
  () => props?.item?.trace_start_time,
  () => {
    getFormattedDate();
  },
);

const importMoment = async () => {
  const momentModule: any = await import("moment-timezone");
  moment = momentModule.default;
};

onBeforeMount(async () => {
  await importMoment();
  getFormattedDate();
});

onBeforeUnmount(() => {
  moment = null;
});

const formattedDate = ref({
  day: "",
  time: "",
  diff: "",
});

const getFormattedDate = () => {
  const format = "YYYY-MM-DD HH:mm:ss";
  const timezone = store.state.timezone;

  const date1 = moment
    ?.tz(new Date((props.item["trace_start_time"] || 0) / 1000), timezone)
    .format(format);

  const date2 = moment?.tz(new Date(), timezone).format(format);

  const difference = qDate.getDateDiff(date2, date1, "seconds");
  const minDiff = qDate.getDateDiff(date2, date1, "minutes");

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

  const date3 = {
    day: "",
    time: "",
    diff: "",
  };

  if (difference < 86400) date3.day = "Today";
  else if (difference < 86400 * 2) date3.day = "Yesterday";
  else
    date3.day =
      new Date(date1).getDate().toString() +
      " " +
      months[new Date(date1).getMonth()];

  date3.time = formatDateTo12Hour(new Date(date1));

  if (minDiff > 1440) {
    date3.diff = Math.floor(minDiff / 1440).toString() + " days ago";
  } else if (minDiff > 60) {
    date3.diff = Math.floor(minDiff / 60).toString() + " hours ago";
  } else {
    date3.diff = minDiff.toString() + " minutes ago";
  }

  formattedDate.value = date3;
};

function formatDateTo12Hour(date: any) {
  let hours = date.getHours();
  let minutes = date.getMinutes();
  let seconds = date.getSeconds();
  let ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  minutes = minutes < 10 ? "0" + minutes : minutes;

  hours = hours < 10 ? "0" + hours : hours;
  seconds = seconds < 10 ? "0" + seconds : seconds;
  let strTime = hours + ":" + minutes + ":" + seconds + " " + ampm;
  return strTime;
}

const getDuration = computed(() => {
  return formatTimeWithSuffix(props?.item?.duration) || "0us";
});

// LLM trace detection and data extraction
const isLLMTraceItem = computed(() => {
  return isLLMTrace(props.item);
});

const llmData = computed(() => {
  if (!isLLMTraceItem.value) return null;
  return extractLLMData(props.item);
});

defineExpose({
  importMoment,
  getFormattedDate,
});
</script>

<style scoped lang="scss">
.trace-container,
.trace-spans,
.trace-errors,
.trace-tag {
  border: 1px solid #ececec;
  border-radius: 4px;
  overflow: hidden;
}

.trace-container {
  &.dark {
    border: 1px solid #787676;

    .trace-spans,
    .trace-errors,
    .trace-tag {
      border: 1px solid #787676;
    }
  }
}

.trace-spans,
.trace-errors {
  width: fit-content;
}

.trace-errors {
  border: 1px solid #ef9a9a;
  color: #cd4545;
}

.trace-spans {
  border: 1px solid #dddddd;
}

.trace-summary {
  height: fit-content;
}

.llm-metrics-container {
  border-top: 1px solid #ececec;
  padding: 6px 8px;
  background: linear-gradient(to right, rgba(25, 118, 210, 0.04), rgba(25, 118, 210, 0.02));
  border-radius: 4px;
  min-height: 32px;
}

.trace-container.dark .llm-metrics-container {
  border-top: 1px solid #787676;
  background: linear-gradient(to right, rgba(25, 118, 210, 0.12), rgba(25, 118, 210, 0.06));
}

.model-name {
  color: #1976d2;
  font-weight: 500;
}

.trace-container.dark .model-name {
  color: #64b5f6;
}

.token-metric,
.cost-metric {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
}

.trace-container.dark .token-metric,
.trace-container.dark .cost-metric {
  background-color: rgba(0, 0, 0, 0.3);
}

.input-preview {
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
