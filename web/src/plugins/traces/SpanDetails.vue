<template>
  <div class="full-width q-mb-md q-px-md span-details-container">
    <div
      class="flex justify-between items-center full-width"
      style="border-bottom: 1px solid #e9e9e9"
    >
      <div style="font-size: 18px">
        {{ span.operationName }}
      </div>
      <div class="flex items-center">
        <div
          class="q-px-sm"
          style="border-right: 1px solid #cccccc; font-size: 14px"
        >
          <span>Service: </span>
          <span>{{ span.serviceName }}</span>
        </div>
        <div
          class="q-px-sm"
          style="border-right: 1px solid #cccccc; font-size: 14px"
        >
          <span>Duration: </span>
          <span>{{ getDuration }}</span>
        </div>
        <div class="q-pl-sm" style="font-size: 14px">
          <span>Start Time: </span>
          <span>{{ getStartTime }}</span>
        </div>
      </div>
    </div>
    <div class="q-mt-sm">
      <div>
        <div
          class="flex items-center no-wrap cursor-pointer"
          @click="toggleTags"
        >
          <q-icon
            name="expand_more"
            :class="!areTagsExpanded ? 'rotate-270' : ''"
            size="14px"
            class="cursor-pointer text-grey-7"
          />
          <div class="cursor-pointer text-bold">Tags</div>
          <div
            v-if="!areTagsExpanded"
            class="q-ml-sm"
            style="
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
          >
            <template v-for="(val, key) in tags" :key="key">
              <span class="text-grey-8">{{ key }}</span>
              <span class="text-grey-8">: </span>
              <span class="text-grey-10">{{ val }}</span>
              <span class="q-mx-xs bg-grey-5" style="padding-left: 1px"></span>
            </template>
          </div>
        </div>
        <div
          v-show="areTagsExpanded"
          class="q-px-md flex justify-start items-center"
        >
          <table class="q-my-sm">
            <tbody>
              <template v-for="(val, key) in tags" :key="key">
                <tr>
                  <td class="q-py-xs q-px-sm">{{ key }}</td>
                  <td class="q-py-xs q-px-sm">{{ val }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div
          class="flex items-center no-wrap cursor-pointer"
          @click="toggleProcess"
        >
          <q-icon
            name="expand_more"
            :class="!areProcessExpananded ? 'rotate-270' : ''"
            size="14px"
            class="cursor-pointer text-grey-7"
          />
          <div class="cursor-pointer text-bold">Process</div>
          <div
            v-if="!areProcessExpananded"
            class="q-ml-sm"
            style="
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
          >
            <template v-for="(val, key) in processes" :key="key">
              <span class="text-grey-8">{{ key }}</span>
              <span class="text-grey-8">: </span>
              <span class="text-grey-10">{{ val }}</span>
              <span class="q-mx-xs bg-grey-5" style="padding-left: 1px"></span>
            </template>
          </div>
        </div>
        <div v-show="areProcessExpananded" class="q-px-md">
          <table class="q-my-sm">
            <tbody>
              <template v-for="(val, key) in processes" :key="key">
                <tr>
                  <td class="q-py-xs q-px-sm">{{ key }}</td>
                  <td class="q-py-xs q-px-sm">{{ val }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Ref } from "vue";
import { watch } from "vue";
import { computed } from "vue";
import { ref } from "vue";
import { useStore } from "vuex";
import { formatTimeWithSuffix } from "@/utils/zincutils";

const props = defineProps({
  span: {
    type: Object,
    default: () => ({}),
  },
  spanData: {
    type: Object,
    default: () => ({}),
  },
  baseTracePosition: {
    type: Object,
    default: () => null,
  },
});

const store = useStore();

const getDuration = computed(() => formatTimeWithSuffix(props.span.durationUs));

const getStartTime = computed(() => {
  return props.span.startTimeMs - props.baseTracePosition.startTimeMs + "ms";
});

const span_details = new Set([
  "span_id",
  "trace_id",
  "operation_name",
  store.state.zoConfig.timestamp_column,
  "start_time",
  "end_time",
  "duration",
  "busy_ns",
  "idle_ns",
  "events",
]);

const tags: Ref<{ [key: string]: string }> = ref({});
const processes: Ref<{ [key: string]: string }> = ref({});

watch(
  () => props.spanData,
  () => {
    Object.keys(props.spanData).forEach((key: string) => {
      if (!span_details.has(key)) {
        tags.value[key] = props.spanData[key];
      }
    });

    processes.value["service_name"] = props.spanData["service_name"];
    processes.value["service_service_instance"] =
      props.spanData["service_service_instance"];
    processes.value["service_service_version"] =
      props.spanData["service_service_version"];
  },
  {
    deep: true,
    immediate: true,
  }
);

const areTagsExpanded = ref(false);

const areProcessExpananded = ref(false);

const toggleProcess = () => {
  areProcessExpananded.value = !areProcessExpananded.value;
};

const toggleTags = () => {
  areTagsExpanded.value = !areTagsExpanded.value;
};
</script>

<style scoped lang="scss">
.span-details-container {
  table {
    border-collapse: collapse;
    width: 100%;
    /* Other styling properties */
  }

  th,
  td {
    border: 1px solid #f0f0f0;
    text-align: left;
    padding: 4px 8px !important;
    font-size: 13px;
    /* Other styling properties */
  }
}
</style>
<style lang="scss">
.tags-expander {
  .q-item {
    width: fit-content;
    height: fit-content !important;
    min-height: fit-content !important;
    padding: 0 4px !important;
    border-radius: 4px;
    background-color: $primary;
  }

  .q-item__section {
    padding-right: 0;
  }

  .q-icon {
    font-size: 16px;
    color: #ffffff;
  }
}
</style>
