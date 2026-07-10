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
  ServiceGraphNoDataState — empty state for the service graph panel.

  Uses the hero size so the illustration and copy match the other traces empty
  states. No widen-range action (the panel aggregates across the window, so
  widening wouldn't reliably surface data), but when the stream has data outside
  the current window we offer a precise "jump to latest data" action, consistent
  with the traces search "no events" state.
-->
<template>
  <OEmptyState
    v-if="jumpTarget"
    preset="no-service-graph"
    size="hero"
  >
    <template #actions>
      <EmptyStateActionCard
        icon="schedule"
        :label="t('traces.noEvents.jumpToData')"
        :sublabel="jumpTargetSublabel"
        data-test="service-graph-no-data-jump-to-data-card"
        @click="emit('jump-to-stream-data', jumpTarget.from, jumpTarget.to)"
      />
    </template>
  </OEmptyState>
  <OEmptyState
    v-else
    preset="no-service-graph"
    size="hero"
    :hide-action="true"
  />
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import useJumpToLatestData from "@/composables/useJumpToLatestData";

const { t } = useI18n();
const { jumpTarget, jumpTargetSublabel } = useJumpToLatestData();

const emit = defineEmits<{
  "jump-to-stream-data": [fromUs: number, toUs: number];
}>();
</script>
