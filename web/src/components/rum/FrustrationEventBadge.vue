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
  <span class="tw:inline-flex tw:gap-1 tw:items-center" data-test="frustration-event-badge-wrapper">
    <OBadge
      v-for="(type, index) in frustrationTypes"
      :key="index"
      :variant="getBadgeVariant(type)"
      size="sm"
      :data-test="`frustration-event-badge-${type}`"
      :title="getTooltipText(type)"
    >{{ getBadgeLabel(type) }}</OBadge>
  </span>
</template>

<script setup lang="ts">
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

interface Props {
  frustrationTypes: string[];
}

defineProps<Props>();

const frustrationConfig: Record<
  string,
  { label: string; variant: BadgeVariant; tooltip: string }
> = {
  rage_click: {
    label: "Rage Click",
    variant: "warning",
    tooltip: "User clicked rapidly multiple times (3+) - indicating frustration",
  },
  dead_click: {
    label: "Dead Click",
    variant: "default",
    tooltip: "Click produced no response - element may be broken or misleading",
  },
  error_click: {
    label: "Error Click",
    variant: "error-soft",
    tooltip: "Click triggered a JavaScript error",
  },
  rage_tap: {
    label: "Rage Tap",
    variant: "warning",
    tooltip: "User tapped rapidly multiple times (3+) - indicating frustration",
  },
  error_tap: {
    label: "Error Tap",
    variant: "error-soft",
    tooltip: "Tap triggered a JavaScript error",
  },
};

const getBadgeLabel = (type: string) =>
  frustrationConfig[type]?.label || type;

const getBadgeVariant = (type: string): BadgeVariant =>
  frustrationConfig[type]?.variant ?? "default";

const getTooltipText = (type: string) =>
  frustrationConfig[type]?.tooltip || `Frustration signal: ${type}`;
</script>
