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
  <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 lg:tw:grid-cols-3 tw:gap-3" data-test="resource-performance-metrics">
    <MetricCard
      v-if="metrics?.resource?.duration"
      label="Total Duration"
      :value="metrics.resource.duration"
      unit="ns"
      icon="schedule"
      :status="getDurationStatus(metrics.resource.duration)"
      description="Total time to load resource"
      data-test="metric-duration"
    />

    <MetricCard
      v-if="metrics?.resource?.dns?.duration"
      label="DNS Lookup"
      :value="metrics.resource.dns.duration"
      unit="ns"
      icon="dns"
      description="DNS resolution time"
      data-test="metric-dns"
    />

    <MetricCard
      v-if="metrics?.resource?.connect?.duration"
      label="Connection Time"
      :value="metrics.resource.connect.duration"
      unit="ns"
      icon="link"
      description="TCP connection establishment time"
      data-test="metric-connect"
    />

    <MetricCard
      v-if="metrics?.resource?.ssl?.duration"
      label="SSL Handshake"
      :value="metrics.resource.ssl.duration"
      unit="ns"
      icon="security"
      description="SSL/TLS handshake time"
      data-test="metric-ssl"
    />

    <MetricCard
      v-if="metrics?.resource?.first_byte?.duration"
      label="Time to First Byte"
      :value="metrics.resource.first_byte.duration"
      unit="ns"
      icon="network_check"
      description="Server processing and response time"
      data-test="metric-ttfb"
    />

    <MetricCard
      v-if="metrics?.resource?.download?.duration"
      label="Download Time"
      :value="metrics.resource.download.duration"
      unit="ns"
      icon="cloud_download"
      description="Resource download time"
      data-test="metric-download"
    />

    <MetricCard
      v-if="metrics?.resource?.size"
      label="Resource Size"
      :value="formatBytes(metrics.resource.size)"
      unit=""
      icon="storage"
      description="Total size of the resource"
      data-test="metric-size"
    />

    <MetricCard
      v-if="metrics?.resource?.redirect?.duration"
      label="Redirect Time"
      :value="metrics.resource.redirect.duration"
      unit="ns"
      icon="redo"
      description="Time spent in redirects"
      data-test="metric-redirect"
    />
  </div>
</template>

<script setup lang="ts">
import MetricCard from "./MetricCard.vue";

interface Props {
  metrics: any;
}

defineProps<Props>();

// Resource performance thresholds (in nanoseconds)
const DURATION_GOOD = 500000000; // 500ms
const DURATION_NEEDS_IMPROVEMENT = 1000000000; // 1s

const getDurationStatus = (value: number): "good" | "needs-improvement" | "poor" => {
  if (value <= DURATION_GOOD) return "good";
  if (value <= DURATION_NEEDS_IMPROVEMENT) return "needs-improvement";
  return "poor";
};

const formatBytes = (bytes: number): string => {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};
</script>
