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
  <AiPageShell
    data-test="ai-sessions"
    :title="t('aiObservability.nav.sessions')"
    :subtitle="t('aiObservability.subtitle.sessions')"
    icon="forum"
    :date-state="dateState"
    :last-run-at="sessionsLastRunAt"
    :is-loading="isLoading"
    @date-change="onDateChange"
    @refresh="refresh"
  >
    <SessionsList
      ref="sessionsRef"
      :stream-name="streamName"
      :start-time="timeRange.startTime"
      :end-time="timeRange.endTime"
      detail-route-name="aiSessionDetails"
      class="min-h-0 flex-1"
    />
  </AiPageShell>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { useI18nTyped } from "@/types/i18n";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import SessionsList from "@/plugins/traces/SessionsList.vue";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import { useChildRefresh } from "@/enterprise/composables/useChildRefresh";

defineOptions({ name: "AISessionsPage" });

const { t } = useI18nTyped();

// Shared with LLM Insights + Quality — see useAiDateRange.ts. Sessions syncs its
// date to the URL (urlSync:true) so deep-links reproduce the exact view.
const {
  dateState,
  timeRange,
  applyRelative,
  onDateChange: onDateStateChange,
  writeToUrl,
  mountResolve,
  DEFAULT_RELATIVE,
} = useAiDateController();

const streamName = ref("");
const sessionsRef = ref<any>(null);

// Last-refresh + loading state for the header's ORefreshButton. SessionsList
// stamps `lastRunAt` when its fetch settles and exposes its own `loading`; the
// composable ORs in a page-level `isRefreshing` so the icon spins from the
// moment of click (covering the relative-window re-anchor before the list load
// starts).
const {
  lastRunAt: sessionsLastRunAt,
  isLoading,
  refresh,
} = useChildRefresh(sessionsRef, {
  onBeforeRefresh: () => {
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
      writeToUrl();
    }
  },
  // Sessions hands SessionsList an explicit re-anchored window after nextTick
  // (its prior refresh call), rather than relying on the bare no-arg default.
  invokeRefresh: async () => {
    await nextTick();
    await sessionsRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
  },
});

async function onDateChange(value: any) {
  // Date state + URL sync is owned by useAiDateController; the page then re-fetches
  // the list with the resolved window.
  onDateStateChange(value);
  await nextTick();
  // `userChangedValue` distinguishes a genuine user date pick from the
  // programmatic window replay DateTime fires on every mount. Only the former
  // forces a re-fetch; the mount replay lets SessionsList restore its cached
  // list (so returning from a session detail doesn't re-hit the API).
  sessionsRef.value?.refresh?.(
    timeRange.value.startTime,
    timeRange.value.endTime,
    value?.userChangedValue === true,
  );
}

onMounted(() => {
  // Precedence: URL > cross-page shared state > default relative.
  mountResolve();
});
</script>
