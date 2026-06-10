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

<!--
  NoPanels — empty state for an empty dashboard (no panels yet). Action-first:
  a compact brand icon badge for context, with the panel-type QuickStartCards
  (recommended one emphasized) as the focal call-to-action. Emits `add`.
-->
<template>
  <EmptyState
    title="This dashboard is empty"
    description="Add your first panel to start visualizing logs, metrics, and traces."
    :actions-label="viewOnly ? '' : 'Add a panel'"
  >
    <template #illustration>
      <!-- Animated SVG illustration — subtle motion conveys the "empty, waiting"
           state without competing with the action below. -->
      <EmptyPanel data-test="empty-panel-art" />
    </template>

    <template #actions>
      <template v-if="!viewOnly">
        <QuickStartCard
          icon="show-chart"
          label="Time series"
          sublabel="Trends over time"
          data-test="dashboard-if-no-panel-add-panel-btn"
          @click="$emit('add')"
        />
        <QuickStartCard
          icon="bar-chart"
          label="Bar chart"
          sublabel="Compare categories"
          @click="$emit('add')"
        />
        <QuickStartCard
          icon="table-chart"
          label="Table"
          sublabel="Rows &amp; raw values"
          @click="$emit('add')"
        />
      </template>
    </template>
  </EmptyState>
</template>

<script setup lang="ts">
import EmptyState from "./EmptyState.vue";
import QuickStartCard from "./QuickStartCard.vue";
import EmptyPanel from "../illustrations/EmptyPanel.vue";

defineProps<{ viewOnly?: boolean }>();
defineEmits<{ add: [] }>();
</script>
