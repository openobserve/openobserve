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
  <span
    class="inline-flex size-4 shrink-0 items-center justify-center"
    data-test="home-state-mark"
    :data-bucket="bucket"
  >
    <span aria-hidden="true" :class="['size-2 rounded-full forced-colors:border', DOT[bucket]]" />
  </span>
</template>

<script setup lang="ts">
import type { OverviewBucket } from "@/composables/contextProviders/types";

defineProps<{ bucket: OverviewBucket }>();

const DOT: Record<OverviewBucket, string> = {
  critical: "bg-service-health-critical",
  degraded: "bg-service-health-warning",
  anomaly: "bg-status-info-text",
  recovered: "bg-service-health-healthy",
};
</script>
