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
  <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 lg:tw:grid-cols-3 tw:gap-3" data-test="view-performance-metrics">
    <!-- Core Web Vitals -->
    <MetricCard
      v-if="metrics?.view?.largest_contentful_paint"
      label="Largest Contentful Paint (LCP)"
      :value="metrics.view.largest_contentful_paint"
      unit="ns"
      icon="speed"
      :status="getLCPStatus(metrics.view.largest_contentful_paint)"
      description="Time to render the largest content element"
      data-test="metric-lcp"
    />

    <MetricCard
      v-if="metrics?.view?.first_input_delay"
      label="First Input Delay (FID)"
      :value="metrics.view.first_input_delay"
      unit="ns"
      icon="touch_app"
      :status="getFIDStatus(metrics.view.first_input_delay)"
      description="Time from first user interaction to browser response"
      data-test="metric-fid"
    />

    <MetricCard
      v-if="metrics?.view?.cumulative_layout_shift !== undefined"
      label="Cumulative Layout Shift (CLS)"
      :value="metrics.view.cumulative_layout_shift"
      unit=""
      icon="swap_vert"
      :status="getCLSStatus(metrics.view.cumulative_layout_shift)"
      description="Visual stability score (lower is better)"
      data-test="metric-cls"
    />

    <MetricCard
      v-if="metrics?.view?.interaction_to_next_paint"
      label="Interaction to Next Paint (INP)"
      :value="metrics.view.interaction_to_next_paint"
      unit="ns"
      icon="mouse"
      :status="getINPStatus(metrics.view.interaction_to_next_paint)"
      description="Responsiveness to user interactions"
      data-test="metric-inp"
    />

    <!-- Additional Metrics -->
    <MetricCard
      v-if="metrics?.view?.first_contentful_paint"
      label="First Contentful Paint (FCP)"
      :value="metrics.view.first_contentful_paint"
      unit="ns"
      icon="image"
      description="Time to render first content element"
      data-test="metric-fcp"
    />

    <MetricCard
      v-if="metrics?.view?.time_to_first_byte"
      label="Time to First Byte (TTFB)"
      :value="metrics.view.time_to_first_byte"
      unit="ns"
      icon="network_check"
      description="Server response time"
      data-test="metric-ttfb"
    />

    <MetricCard
      v-if="metrics?.view?.dom_interactive"
      label="DOM Interactive"
      :value="metrics.view.dom_interactive"
      unit="ns"
      icon="code"
      description="Time until DOM is ready"
      data-test="metric-dom-interactive"
    />

    <MetricCard
      v-if="metrics?.view?.dom_content_loaded"
      label="DOM Content Loaded"
      :value="metrics.view.dom_content_loaded"
      unit="ns"
      icon="article"
      description="Time until DOM and scripts are loaded"
      data-test="metric-dom-content-loaded"
    />

    <MetricCard
      v-if="metrics?.view?.dom_complete"
      label="DOM Complete"
      :value="metrics.view.dom_complete"
      unit="ns"
      icon="check_circle"
      description="Time until page is fully loaded"
      data-test="metric-dom-complete"
    />

    <MetricCard
      v-if="metrics?.view?.load_event"
      label="Load Event"
      :value="metrics.view.load_event"
      unit="ns"
      icon="download"
      description="Time until load event completes"
      data-test="metric-load-event"
    />
  </div>
</template>

<script setup lang="ts">
import MetricCard from "./MetricCard.vue";

interface Props {
  metrics: any;
}

defineProps<Props>();

// Web Vitals thresholds (in nanoseconds)
const LCP_GOOD = 2500000000; // 2.5s
const LCP_NEEDS_IMPROVEMENT = 4000000000; // 4s

const FID_GOOD = 100000000; // 100ms
const FID_NEEDS_IMPROVEMENT = 300000000; // 300ms

const CLS_GOOD = 0.1;
const CLS_NEEDS_IMPROVEMENT = 0.25;

const INP_GOOD = 200000000; // 200ms
const INP_NEEDS_IMPROVEMENT = 500000000; // 500ms

const getLCPStatus = (value: number): "good" | "needs-improvement" | "poor" => {
  if (value <= LCP_GOOD) return "good";
  if (value <= LCP_NEEDS_IMPROVEMENT) return "needs-improvement";
  return "poor";
};

const getFIDStatus = (value: number): "good" | "needs-improvement" | "poor" => {
  if (value <= FID_GOOD) return "good";
  if (value <= FID_NEEDS_IMPROVEMENT) return "needs-improvement";
  return "poor";
};

const getCLSStatus = (value: number): "good" | "needs-improvement" | "poor" => {
  if (value <= CLS_GOOD) return "good";
  if (value <= CLS_NEEDS_IMPROVEMENT) return "needs-improvement";
  return "poor";
};

const getINPStatus = (value: number): "good" | "needs-improvement" | "poor" => {
  if (value <= INP_GOOD) return "good";
  if (value <= INP_NEEDS_IMPROVEMENT) return "needs-improvement";
  return "poor";
};
</script>
