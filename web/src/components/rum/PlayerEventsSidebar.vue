<template>
  <div class="events-container relative-position">
    <AppTabs :tabs="tabs" v-model:active-tab="activeTab" />
    <template v-if="activeTab === 'tags'">
      <div class="row q-pa-sm event-metadata bg-white">
        <div class="col-12 row">
          <div class="col-12 q-pb-sm text-caption">
            <q-icon name="mail" size="16px" class="q-pr-xs" />
            {{ sessionDetails.user_email || "Unknown User" }}
          </div>
          <div class="col-12 q-mb-sm text-caption ellipsis q-pr-xs">
            <q-icon name="schedule" size="16px" class="q-pr-xs" />
            {{ sessionDetails.date }}
          </div>
          <div class="col-12 q-mb-sm text-caption ellipsis q-pr-xs">
            <q-icon name="settings" size="16px" class="q-pr-xs" />
            {{ sessionDetails.browser }}, {{ sessionDetails.os }}
          </div>
          <div class="col-12 q-mb-sm text-caption ellipsis">
            <q-icon name="language" size="16px" class="q-pr-xs" />
            {{ sessionDetails.ip }}
          </div>
          <div class="col-12 q-mb-sm text-caption ellipsis">
            <q-icon name="location_on" size="16px" class="q-pr-xs" />
            {{ sessionDetails.city }}, {{ sessionDetails.country }}
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="flex items-center justify-between col-12 q-pt-sm">
        <div class="q-pr-xs" style="width: 60%">
          <q-input
            v-model="searchEvent"
            size="xs"
            filled
            borderless
            dense
            clearable
            debounce="1"
            placeholder="Search Event"
            @update:model-value="searchEvents"
          />
        </div>
        <div class="q-pl-xs event-type-selector" style="width: 40%">
          <q-select
            v-model="selectedEventTypes"
            :options="eventOptions"
            behavior="menu"
            multiple
            filled
            borderless
            dense
            emit-value
            size="xs"
          />
        </div>
      </div>
      <q-separator class="q-mt-sm" />
      <div class="events-list">
        <template v-for="event in filteredEvents" :key="event.id">
          <div
            v-if="selectedEventTypes && selectedEventTypes.includes(event.type)"
            class="q-mt-xs q-px-sm event-container q-py-sm cursor-pointer rounded-borders"
            @click="handleEventClick(event)"
          >
            <div class="ellipsis">
              <div class="q-mr-md inline">{{ event.displayTime }}</div>
              <div
                class="q-mr-md inline event-type q-px-xs"
                style="border-radius: 4px"
                :class="event.type === 'error' ? 'bg-red-3' : ''"
              >
                {{ event.type }}
              </div>
              <div class="inline" :title="event.name">{{ event.name }}</div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { cloneDeep } from "lodash-es";
import { ref, watch } from "vue";
import AppTabs from "../common/AppTabs.vue";

const props = defineProps({
  events: {
    type: Array,
    required: true,
  },
  sessionDetails: {
    type: Object,
    required: true,
  },
});

const activeTab = ref<string>("breadcrumbs");
const tabs = [
  {
    label: "Breadcrumbs",
    value: "breadcrumbs",
    style: { width: "fit-content", padding: "8px 10px", "margin-right": "4px" },
  },
  {
    label: "Tags",
    value: "tags",
    style: { width: "fit-content", padding: "8px 10px" },
  },
];

const emit = defineEmits(["event-emitted"]);

const filteredEvents = ref<any[]>([]);

watch(
  () => props.events,
  () => {
    filteredEvents.value = cloneDeep(props.events);
  },
  { immediate: true, deep: true }
);

const selectedEventTypes = ref<string[] | null>(["error", "action", "view"]);
const searchEvent = ref<string>("");

const eventOptions = [
  { label: "Error", value: "error" },
  { label: "Action", value: "action" },
  { label: "View", value: "view" },
];

const searchEvents = (value: string) => {
  if (value) {
    filteredEvents.value = cloneDeep(
      props.events.filter((event) => {
        return (
          event?.name.toLowerCase().includes(value.toLowerCase()) ||
          event?.type.toLowerCase().includes(value.toLowerCase())
        );
      })
    );
  } else {
    filteredEvents.value = cloneDeep(props.events);
  }
};

const handleEventClick = (event: any) => {
  emit("event-emitted", "event-click", event);
};
</script>

<style scoped lang="scss">
.inline {
  display: inline;
}

.events-container {
  width: calc(100% - 1px);
  height: calc(100vh - 57px);
  overflow: hidden;
  padding-right: 8px;
  padding-left: 8px;
}

.events-list {
  height: calc(100vh - 207px);
  overflow-x: hidden;
  overflow-y: auto;
}

.event-container:hover {
  background-color: #ededed;
}

.event-type {
  text-transform: capitalize;
}

.event-metadata {
  position: sticky;
  top: 0;
}
</style>

<style lang="scss">
.event-type-selector {
  .q-field__control {
    .q-field__native {
      span {
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
      }
    }
  }
}
</style>
