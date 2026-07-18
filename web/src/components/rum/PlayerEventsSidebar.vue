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
  <div class="w-[calc(100%-1px)] overflow-hidden relative-position h-full flex flex-col">
    <AppTabs :tabs="tabs" v-model:active-tab="activeTab" class="px-2 py-1 mt-2! mx-2!" />
    <template v-if="activeTab === 'tags'">
      <div
        data-test="event-metadata"
        class="flex p-2 sticky top-0 px-3"
      >
        <div class="w-full flex flex-col">
          <div class="w-full pb-2 text-xs">
            <OIcon name="mail" size="sm" class="pr-1" />
            {{ sessionDetails.user_email || "Unknown User" }}
          </div>
          <div class="w-full mb-2 text-xs truncate pr-1">
            <OIcon name="schedule" size="sm" class="pr-1" />
            {{ sessionDetails.date }}
          </div>
          <div class="w-full mb-2 text-xs truncate pr-1">
            <OIcon name="settings" size="sm" class="pr-1" />
            {{ sessionDetails.browser }}, {{ sessionDetails.os }}
          </div>
          <div class="w-full mb-2 text-xs truncate">
            <OIcon name="language" size="sm" class="pr-1" />
            {{ sessionDetails.ip }}
          </div>
          <div class="w-full mb-2 text-xs truncate">
            <OIcon name="location-on" size="sm" class="pr-1" />
            {{ sessionDetails.city }}, {{ sessionDetails.country }}
          </div>
        </div>
      </div>
    </template>
    <template v-else-if="activeTab === 'traces'">
      <PlayerTracesTab
        :session-id="sessionId"
        :current-time="currentTime"
        :start-time="startTime"
        :end-time="endTime"
        @event-emitted="(type, payload) => emit('event-emitted', type, payload)"
      />
    </template>
    <template v-else>
      <div
        class="flex items-center justify-between w-full pt-2 px-1.5"
      >
        <div class="pr-1 w-[60%]">
          <OInput
            v-model="searchEvent"
            clearable
            :placeholder="t('rum.searchEvents')"
            @update:model-value="searchEvents"
          />
        </div>
        <div class="pl-1 event-type-selector w-[40%] relative-position">
          <OSelect
            v-model="selectedEventTypes"
            :options="eventOptions"
            multiple
            labelKey="label"
            valueKey="value"
            data-test="player-events-filter-select"
            @update:model-value="searchEvents(searchEvent)"
          />
        </div>
      </div>
      <OSeparator class="my-2" />
      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2">
        <template
          v-for="(filteredEvent, index) in filteredEvents"
          :key="filteredEvent.id + '-' + index"
        >
          <div
            class="mb-1 px-2 py-2 cursor-pointer rounded-default hover:bg-interactive-hover-bg hover:text-text-body"
            @click="handleEventClick(filteredEvent)"
            :data-test="`player-event-row-${filteredEvent.type}`"
          >
            <div class="truncate">
              <div class="mr-3 inline" data-test="event-display-time">
                {{ filteredEvent.displayTime }}
              </div>
              <OTag
                type="rumEventType"
                :value="filteredEvent.type"
                class="mr-3"
                data-test="event-type-badge"
              />
              <template
                v-if="
                  filteredEvent.frustration_types &&
                  filteredEvent.frustration_types.length > 0
                "
              >
                <FrustrationEventBadge
                  :frustration-types="filteredEvent.frustration_types"
                  class="mr-1 inline"
                />
              </template>
              <div
                class="inline"
                :title="filteredEvent.name"
                data-test="event-name"
              >
                {{ filteredEvent.name }}
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from "vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import AppTabs from "../common/AppTabs.vue";

import { useI18n } from "vue-i18n";
import FrustrationEventBadge from "./FrustrationEventBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OTag from "@/lib/core/Badge/OTag.vue";
import PlayerTracesTab from "./PlayerTracesTab.vue";

const { t } = useI18n();

const props = defineProps({
  events: {
    type: Array,
    required: true,
  },
  sessionDetails: {
    type: Object,
    required: true,
  },
  sessionId: {
    type: String,
    default: "",
  },
  currentTime: {
    type: Number,
    default: 0,
  },
  startTime: {
    type: Number,
    default: 0,
  },
  endTime: {
    type: Number,
    default: 0,
  },
});

const activeTab = ref<string>("breadcrumbs");
const tabs = [
  {
    label: t("rum.breadcrumbs"),
    value: "breadcrumbs",
    icon: "send",
    style: {
      width: "fit-content",
      padding: "0.5rem 0.625rem",
      "margin-right": "0.25rem",
    },
  },
  {
    label: t("rum.tags"),
    value: "tags",
    icon: "tag",
    style: { width: "fit-content", padding: "0.5rem 0.625rem" },
  },
  {
    label: t("rum.traces"),
    value: "traces",
    icon: "timeline",
    style: { width: "fit-content", padding: "0.5rem 0.625rem" },
  },
];

const emit = defineEmits(["event-emitted"]);

const filteredEvents = ref<any[]>([]);

watch(
  () => props.events,
  () => {
    filteredEvents.value = [...props.events];
  },
  { immediate: true, deep: true },
);

const selectedEventTypes = ref<string[]>([
  "error",
  "action",
  "view",
  "frustration",
]);
const searchEvent = ref<string>("");

const eventOptions = [
  { label: "Error", value: "error" },
  { label: "Action", value: "action" },
  { label: "View", value: "view" },
  { label: "Frustration", value: "frustration" },
];

const searchEvents = (value: string | number | null) => {
  if (value === null) {
    value = "";
  }
  const _value = value.toString();
  filteredEvents.value = props.events.filter((event: any) => {
    // If no event types are selected, show all events
    const shouldShow =
      selectedEventTypes.value.length === 0
        ? true
        : (() => {
            // Check if event type is selected
            const isTypeSelected = selectedEventTypes.value.includes(
              event.type,
            );

            // Check if frustration filter is active and event has frustrations
            const hasFrustration =
              event.frustration_types && event.frustration_types.length > 0;
            const showFrustration =
              selectedEventTypes.value.includes("frustration") &&
              hasFrustration;

            // Show event if its type is selected OR if frustration filter is active and event has frustrations
            return isTypeSelected || showFrustration;
          })();

    // Apply text search filter
    const matchesSearch = (event.type + " " + event?.name)
      .toLowerCase()
      .includes(_value.toString().toLowerCase());

    return shouldShow && matchesSearch;
  });
};

const handleEventClick = (event: any) => {
  emit("event-emitted", "event-click", event);
};
</script>
