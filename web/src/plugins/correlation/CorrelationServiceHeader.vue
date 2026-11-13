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
  <div class="flex w-full min-w-0 items-center gap-3" data-test="svcver-correlation-header">
    <OIcon name="link" size="md" class="shrink-0" />
    <ServiceNameLabel
      class="shrink-0"
      :service-key="serviceName"
      :display-name="displayServiceName"
      :display-source="serviceDisplay?.display_source"
      :candidates="serviceDisplay?.display_candidates"
      :qualifier="serviceDisplay?.display_qualifier"
      primary-class="text-dialog-header-text text-base font-semibold"
      secondary-class="text-dialog-content-text mt-0.5 text-xs opacity-70"
    >
      <template #primary="{ label }">{{
        t("correlation.correlatedStreamsFor", { service: label })
      }}</template>
      <template v-if="timeRange" #meta>{{
        t("correlation.timeRangeWithDuration", timeRangeParams(timeRange, timezone))
      }}</template>
    </ServiceNameLabel>
    <CorrelationScopeChips v-if="scope" :scope="scope" :by-pod="byPod" @close="emit('close')" />
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import type { Scope } from "@/services/service_versions";
import type { ServiceDisplayFields } from "@/types/serviceRef";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ServiceNameLabel from "@/components/shared/ServiceNameLabel.vue";
import CorrelationScopeChips from "./CorrelationScopeChips.vue";
import { timeRangeParams, type CorrelationTimeRange } from "./correlationVersions";
import type { ScopeByPod } from "./useCorrelationVersions";

defineProps<{
  serviceName: string;
  displayServiceName?: string;
  serviceDisplay?: Omit<ServiceDisplayFields, "display_name">;
  scope: Scope | null;
  byPod?: ScopeByPod | null;
  timeRange?: CorrelationTimeRange;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18nTyped();
const store = useStore();
const timezone = computed<string>(() => store.state.timezone || "UTC");
</script>
