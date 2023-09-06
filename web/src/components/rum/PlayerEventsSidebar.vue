<template>
  <div class="events-container relative-position">
    <div class="row q-pa-sm event-metadata bg-white">
      <div class="col-12 row">
        <div class="col-12 q-pb-sm text-caption">example@gmail.com</div>
        <div class="col-6 q-mb-sm text-caption ellipsis q-pr-xs">
          Today, 4:54 pm
        </div>
        <div class="col-6 q-mb-sm q-pl-xs text-caption ellipsis">
          Chrome, Linux
        </div>
        <div class="col-6 q-mb-sm text-caption ellipsis q-pr-xs">
          Mumbai, MH, India
        </div>
        <div class="col-6 q-mb-sm q-pl-xs text-caption ellipsis">
          35.154.126.13
        </div>
      </div>
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
            size="xs"
          />
        </div>
      </div>
    </div>
    <q-separator />
    <div class="events-list">
      <div
        v-for="event in events"
        :key="event.id"
        class="q-mt-xs q-px-sm event-container q-py-sm cursor-pointer rounded-borders"
      >
        <div class="ellipsis">
          <div class="q-mr-md inline">{{ event.displayTime }}</div>
          <div class="q-mr-md inline event-type">{{ event.type }}</div>
          <div class="inline" :title="event.name">{{ event.name }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { defineComponent, ref } from "vue";

defineProps({
  events: {
    type: Array,
    required: true,
  },
});

const selectedEventTypes = ref<string[] | null>(null);
const searchEvent = ref<string>("");

const eventOptions = [
  { label: "Error", value: "error" },
  { label: "Action", value: "action" },
  { label: "View", value: "view" },
];
</script>

<style scoped lang="scss">
.inline {
  display: inline;
}

.events-container {
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
