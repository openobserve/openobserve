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
  ServicesCatalogNoDataState — empty state for the services catalog panel.
  Shows the services-catalog illustration + a "widen time range" action card.
  Emits `widen-range` with the suggested period string so the parent can
  update the global datetime and re-fetch.
-->
<template>
  <OEmptyState preset="no-services-catalog" size="block" :hide-action="true">
    <template #actions>
      <EmptyStateActionCard
        icon="schedule"
        :label="t('traces.noEvents.expandRange')"
        :sublabel="expandRangeSublabel"
        data-test="services-catalog-empty-expand-range-card"
        class="tw:w-full"
        @click="onWidenRange"
      />
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import useTraces from "@/composables/useTraces";
import useWidenRange from "@/composables/useWidenRange";

const { t } = useI18n();
const emit = defineEmits<{ "widen-range": [period: string] }>();
const { searchObj } = useTraces();
const { suggestedPeriod, expandRangeSublabel } = useWidenRange(
  () => searchObj.data?.datetime?.type ?? "",
  () => searchObj.data?.datetime?.relativeTimePeriod ?? "",
  { absoluteExpandDesc: t("traces.noEvents.expandRangeDescAbsolute") },
);

const onWidenRange = () => emit("widen-range", suggestedPeriod.value);
</script>
