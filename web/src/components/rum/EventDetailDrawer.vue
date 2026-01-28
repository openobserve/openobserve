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
  <q-dialog
    v-model="isOpen"
    position="right"
    full-height
    maximized
    @hide="closeDrawer"
  >
    <EventDetailDrawerContent
      :event="event"
      :raw-event="rawEvent"
      :session-id="sessionId"
      :session-details="sessionDetails"
      @close="closeDrawer"
      @resource-selected="$emit('resource-selected', $event)"
    />
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import EventDetailDrawerContent from "./EventDetailDrawerContent.vue";

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  event: {
    type: Object,
    default: () => ({}),
  },
  rawEvent: {
    type: Object,
    default: () => ({}),
  },
  sessionId: {
    type: String,
    default: "",
  },
  sessionDetails: {
    type: Object,
    default: () => ({
      user_email: "",
      date: "",
      browser: "",
      os: "",
      ip: "",
      city: "",
      country: "",
    }),
  },
});

const emit = defineEmits(["update:modelValue", "resource-selected"]);

const isOpen = ref(props.modelValue);

watch(
  () => props.modelValue,
  (val) => {
    isOpen.value = val;
  },
);

watch(isOpen, (val) => {
  emit("update:modelValue", val);
});

const closeDrawer = () => {
  isOpen.value = false;
};
</script>

<style lang="scss" scoped></style>
