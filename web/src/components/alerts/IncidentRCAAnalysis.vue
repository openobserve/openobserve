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
  <div data-test="rca-analysis-container" class="flex flex-col flex-1 overflow-hidden">
    <!-- Trigger button when no analysis exists and not loading and not in-flight -->
    <div v-if="!hasExistingRca && !rcaLoading && !analysisInFlight" data-test="rca-trigger-section" class="mb-2 flex-shrink-0">
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
      class="flex items-center gap-3 rounded-lg px-4 py-3 mb-2 flex-shrink-0"
      :class="isDarkMode ? 'bg-indigo-900/20 border border-indigo-700/40' : 'bg-indigo-50 border border-indigo-200'"
    >
      <OSpinner variant="dots" size="xs" />
      <div>
        <p
          class="text-sm font-medium mb-0"
          :class="isDarkMode ? 'text-indigo-200' : 'text-indigo-800'"
        >
          {{ hasExistingRca ? 'AI SRE Agent is seeing what changed since the last analysis…' : 'AI SRE Agent is analyzing this incident, please wait…' }}
        </p>
        <p
          class="text-xs mt-0.5 mb-0"
          :class="isDarkMode ? 'text-indigo-300/70' : 'text-indigo-600/70'"
        >
          {{ hasExistingRca ? 'The report will be updated once the analysis is complete.' : 'The report will appear here once the analysis is complete.' }}
        </p>
      </div>
    </div>

    <!-- Streaming content while loading -->
    <div
      v-if="rcaLoading && rcaStreamContent"
      data-test="rca-stream-container"
      class="rca-container rounded p-3 flex-1 overflow-auto border"
      :class="isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'"
    >
      <div
        data-test="rca-stream-content"
        class="text-sm whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>

    <!-- Existing analysis content -->
    <div v-else-if="hasExistingRca && !rcaLoading" data-test="rca-existing-container" class="rca-container rounded p-3 flex-1 overflow-auto border" :class="isDarkMode ? ' border-gray-700' : 'bg-white border-gray-200'">
      <div
        data-test="rca-existing-content"
        class="text-sm whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import DOMPurify from "dompurify";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "IncidentRCAAnalysis",
  components: { OButton, OSpinner },
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
