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
  <div data-test="rca-analysis-container" class="tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden">
    <!-- Trigger button when no analysis exists and not loading and not in-flight -->
    <div v-if="!hasExistingRca && !rcaLoading && !analysisInFlight" data-test="rca-trigger-section" class="tw:mb-2 tw:flex-shrink-0">
      <OButton
        data-test="trigger-rca-btn"
        variant="outline"
        size="sm"
        :disabled="rcaLoading"
        @click="$emit('trigger-rca')"
      >
        Analyze Incident
      </OButton>
    </div>

    <!-- Analysis in progress: both background (in-flight) and user-triggered (rcaLoading) -->
    <div
      v-if="analysisInFlight || rcaLoading"
      data-test="rca-inflight-container"
      class="tw:flex tw:items-center tw:gap-3 tw:rounded-lg tw:px-4 tw:py-3 tw:mb-2 tw:flex-shrink-0"
      :class="isDarkMode ? 'tw:bg-indigo-900/20 tw:border tw:border-indigo-700/40' : 'tw:bg-indigo-50 tw:border tw:border-indigo-200'"
    >
      <q-spinner-dots size="20px" :color="isDarkMode ? 'indigo-3' : 'indigo-7'" />
      <div>
        <p
          class="tw:text-sm tw:font-medium tw:mb-0"
          :class="isDarkMode ? 'tw:text-indigo-200' : 'tw:text-indigo-800'"
        >
          {{ hasExistingRca ? 'AI SRE Agent is seeing what changed since the last analysis…' : 'AI SRE Agent is analyzing this incident, please wait…' }}
        </p>
        <p
          class="tw:text-xs tw:mt-0.5 tw:mb-0"
          :class="isDarkMode ? 'tw:text-indigo-300/70' : 'tw:text-indigo-600/70'"
        >
          {{ hasExistingRca ? 'The report will be updated once the analysis is complete.' : 'The report will appear here once the analysis is complete.' }}
        </p>
      </div>
    </div>

    <!-- Streaming content while loading -->
    <div
      v-if="rcaLoading && rcaStreamContent"
      data-test="rca-stream-container"
      class="rca-container tw:rounded tw:p-3 tw:flex-1 tw:overflow-auto tw:border"
      :class="isDarkMode ? 'tw:bg-gray-800 tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'"
    >
      <div
        data-test="rca-stream-content"
        class="tw:text-sm tw:whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>

    <!-- Existing analysis content -->
    <div v-else-if="hasExistingRca && !rcaLoading" data-test="rca-existing-container" class="rca-container tw:rounded tw:p-3 tw:flex-1 tw:overflow-auto tw:border" :class="isDarkMode ? ' tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'">
      <div
        data-test="rca-existing-content"
        class="tw:text-sm tw:whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import DOMPurify from "dompurify";
import OButton from "@/lib/core/Button/OButton.vue";

export default defineComponent({
  name: "IncidentRCAAnalysis",
  components: { OButton },
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
    analysisInFlight: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['trigger-rca'],
  methods: {
    sanitize(html: string): string {
      return DOMPurify.sanitize(html);
    },
  },
});
</script>

<style scoped>
/* RCA styles are imported from parent */
</style>
