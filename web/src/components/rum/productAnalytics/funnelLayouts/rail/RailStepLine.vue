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
  <span class="flex min-w-0 flex-wrap items-center gap-1.5 text-start text-xs">
    <OTag :label="kindLabel(step)" :variant="kindVariant(step)" size="xs" />
    <span class="text-text-body min-w-0 font-mono break-all">{{ labelOf(step) }}</span>
    <span v-if="chips.length" class="flex basis-full flex-wrap items-center gap-1 ps-3">
      <span class="text-text-secondary">{{ t("rum.analytics.funnel.where") }}</span>
      <OTag v-for="c in chips" :key="c" :label="c" variant="primary-outline" size="xs" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { useI18nTyped } from "@/types/i18n";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

const props = defineProps<{
  step: StepRef;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
  deletedNames?: Readonly<Record<string, string>>;
}>();
const { t } = useI18nTyped();
const { labelOf, kindLabel, kindVariant, filterChips } = useStepLabels(
  () => props.events,
  () => props.eventsStatus,
  () => props.deletedNames ?? {},
);

const chips = computed(() => filterChips(props.step));
</script>
