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
    title="No panels here yet"
    description="Add a panel to start visualizing logs, metrics, and traces."
  >
    <template #illustration>
      <EmptyPanel data-test="empty-panel-art" />
    </template>

    <template #actions>
      <QuickStartCard
        v-if="!viewOnly"
        icon="add"
        label="Add panel"
        sublabel="Charts, tables &amp; more"
        data-test="dashboard-if-no-panel-add-panel-btn"
        @click="$emit('add')"
      />
    </template>
  </EmptyState>
</template>

<script setup lang="ts">
import EmptyState from "./EmptyState.vue";
import EmptyPanel from "../illustrations/EmptyPanel.vue";
import QuickStartCard from "./QuickStartCard.vue";

defineProps<{ viewOnly?: boolean }>();
defineEmits<{ add: [] }>();
</script>
