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
  <span class="inline-flex items-center gap-1" data-test="frustration-event-badge-wrapper">
    <OTag
      v-for="(type, index) in frustrationTypes"
      :key="index"
      type="frustrationEventType"
      :value="type"
      :data-test="`frustration-event-badge-${type}`"
      :title="getTooltipText(type)"
    />
  </span>
</template>

<script setup lang="ts">
import OTag from "@/lib/core/Badge/OTag.vue";

interface Props {
  frustrationTypes: string[];
}

defineProps<Props>();

const tooltips: Record<string, string> = {
  rage_click: "User clicked rapidly multiple times (3+) - indicating frustration",
  dead_click: "Click produced no response - element may be broken or misleading",
  error_click: "Click triggered a JavaScript error",
  rage_tap: "User tapped rapidly multiple times (3+) - indicating frustration",
  error_tap: "Tap triggered a JavaScript error",
};

const getTooltipText = (type: string) => tooltips[type] || `Frustration signal: ${type}`;
</script>
