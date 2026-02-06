<!-- Copyright 2025 OpenObserve Inc.

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
  <div data-test="rca-analysis-container" class="tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden">
    <!-- Trigger button when no analysis exists and not loading -->
    <div v-if="!hasExistingRca && !rcaLoading" data-test="rca-trigger-section" class="tw:mb-2 tw:flex-shrink-0">
      <q-btn
        data-test="trigger-rca-btn"
        size="sm"
        color="primary"
        outline
        no-caps
        @click="$emit('trigger-rca')"
        :disable="rcaLoading"
      >
        Analyze Incident
      </q-btn>
    </div>

    <!-- Loading state with streaming content -->
    <div v-if="rcaLoading" data-test="rca-loading-container" class="rca-container tw:rounded tw:p-3 tw:flex-1 tw:overflow-auto tw:border" :class="isDarkMode ? 'tw:bg-gray-800 tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'">
      <div data-test="rca-loading-indicator" class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
        <q-spinner data-test="rca-spinner" size="sm" color="primary" />
        <span data-test="rca-loading-text" class="tw:text-sm">Analysis in progress...</span>
      </div>
      <div
        v-if="rcaStreamContent"
        data-test="rca-stream-content"
        class="tw:text-sm tw:whitespace-pre-wrap rca-content"
        v-html="formattedRcaContent"
      />
    </div>

    <!-- Existing analysis content -->
    <div v-else-if="hasExistingRca" data-test="rca-existing-container" class="rca-container tw:rounded tw:p-3 tw:flex-1 tw:overflow-auto tw:border" :class="isDarkMode ? ' tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'">
      <div
        data-test="rca-existing-content"
        class="tw:text-sm tw:whitespace-pre-wrap rca-content"
        v-html="formattedRcaContent"
      />
    </div>

    <!-- No analysis yet -->
    <div v-else data-test="rca-empty-state" class="tw:rounded tw:p-3 tw:text-sm tw:flex-1 tw:border" :class="isDarkMode ? 'tw:bg-gray-700 tw:border-gray-600 tw:text-gray-300' : 'tw:bg-gray-50 tw:border-gray-200 tw:text-gray-500'">
      No analysis performed yet
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";

export default defineComponent({
  name: "IncidentRCAAnalysis",
  props: {
    hasExistingRca: {
      type: Boolean,
      required: true,
    },
    rcaLoading: {
      type: Boolean,
      required: true,
    },
    rcaStreamContent: {
      type: String,
      default: "",
    },
    formattedRcaContent: {
      type: String,
      default: "",
    },
    isDarkMode: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['trigger-rca'],
});
</script>

<style scoped>
/* RCA styles are imported from parent */
</style>
