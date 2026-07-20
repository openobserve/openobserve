<!--
  Copyright 2026 OpenObserve Inc.

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
  <div
    data-test="ai-agent-behavior-page"
    class="flex flex-col h-full min-h-0 overflow-hidden"
  >
    <AppPageHeader
      :title="t('aiObservability.nav.agentBehavior')"
      :subtitle="t('aiObservability.subtitle.agentBehavior')"
      icon="troubleshoot"
      class="px-4 border-b border-border-default"
    >
      <template #actions>
        <date-time
          ref="dateTimeRef"
          auto-apply
          menu-align="end"
          :default-type="dateState.valueType"
          :default-absolute-time="{
            startTime: dateState.startTime ?? 0,
            endTime: dateState.endTime ?? 0,
          }"
          :default-relative-time="dateState.relativeTimePeriod ?? ''"
          data-test="ai-agent-behavior-date-time"
          class="h-[2rem]"
          @on:date-change="onDateChange"
        />
        <!-- Last-refresh + refresh control, consistent with LLM Insights /
             Sessions page headers. -->
        <div
          class="inline-flex items-center border border-border-default rounded-md px-1 h-[2rem] overflow-hidden"
        >
          <ORefreshButton
            :last-run-at="behaviorLastRunAt"
            :loading="isLoading"
            :disabled="isLoading"
            data-test="ai-agent-behavior-refresh-btn"
            @click="refresh"
          />
        </div>
      </template>
    </AppPageHeader>

    <!-- Scope control — same Stream/Agent pattern as Agent Graph, so the AI
         pages read as one product. Stream tab shows every agent's signals for
         the stream; Agent tab narrows to one discovered agent (and follows its
         source_stream). -->
    <div class="flex items-center gap-3 px-4 py-2 border-b border-border-default">
      <OToggleGroup
        :model-value="filterMode"
        type="single"
        data-test="agent-behavior-filter-mode"
        @update:model-value="onFilterModeChange"
      >
        <OToggleGroupItem value="agent" size="sm">{{
          t("aiObservability.agentGraph.agent")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="stream" size="sm">{{
          t("aiObservability.agentGraph.stream")
        }}</OToggleGroupItem>
      </OToggleGroup>

      <div
        v-if="filterMode === 'agent'"
        data-test="agent-behavior-agent-selector"
        class="w-[14rem] flex-shrink-0"
      >
        <SkeletonBox
          v-if="!agentsLoaded"
          width="100%"
          height="2.125rem"
          rounded
        />
        <OSelect
          v-else
          v-model="activeAgentKey"
          :label="t('aiObservability.agentGraph.agent')"
          label-position="inside"
          :options="agentSelectOptions"
          labelKey="label"
          valueKey="value"
          class="w-full rounded"
        />
      </div>
      <div
        v-else
        data-test="agent-behavior-stream-selector"
        class="w-[14rem] flex-shrink-0"
      >
        <OSelect
          v-model="activeStream"
          :label="t('aiObservability.agentGraph.stream')"
          label-position="inside"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="w-full rounded"
        />
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-auto p-4">
      <AgentBehaviorPanel
        ref="panelRef"
        :source-stream="effectiveStream"
        :agent-filter="agentFilter"
        :start-time="timeRange.startTime"
        :end-time="timeRange.endTime"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import DateTime from "@/components/DateTime.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import AgentBehaviorPanel from "./AgentBehaviorPanel.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import useStreams from "@/composables/useStreams";
import { useStore } from "vuex";
import genAiAgentMappingService, {
  type GenAiAgentListItem,
} from "@/services/gen-ai-agent-mapping.service";
import { getConsumableRelativeTime } from "@/utils/date";
import {
  useAiDateRange,
  resolveAiDateWindow,
} from "@/enterprise/composables/useAiDateRange";

defineOptions({ name: "AgentBehaviorPage" });

const { t } = useI18n();
const { getStreams } = useStreams();
const store = useStore();

const DEFAULT_RELATIVE = "15m";

// Shared with LLM Insights / Sessions / Quality — see useAiDateRange.ts.
const { state: dateState } = useAiDateRange();

const timeRange = ref({ startTime: 0, endTime: 0 });
// Agent is the default scope: the page is about a specific agent's behaviour,
// so it opens focused on one agent. Stream mode widens to every agent's signals.
const filterMode = ref<"stream" | "agent">("agent");
const availableStreams = ref<string[]>([]);
const activeStream = ref<string>("");
const dateTimeRef = ref<any>(null);
const panelRef = ref<any>(null);
const isRefreshing = ref(false);

// Agent-mode selection — mirrors Agent Graph. Same stream-scoped identity so
// same-named agents in different streams don't collide.
const agents = ref<GenAiAgentListItem[]>([]);
const agentsLoaded = ref(false);
const activeAgentKey = ref<string>("");
const agentKey = (a: GenAiAgentListItem) => `${a.source_stream}::${a.name}`;
const agentSelectOptions = computed(() =>
  agents.value.map((a) => ({
    label: a.id ? `${a.name} (${a.id})` : a.name,
    value: agentKey(a),
  })),
);
const selectedAgent = computed<GenAiAgentListItem | null>(
  () => agents.value.find((a) => agentKey(a) === activeAgentKey.value) ?? null,
);

// The stream the panel queries: the picked stream, or the selected agent's
// source_stream (deriving stream from the agent is the point of Agent mode).
const effectiveStream = computed(() =>
  filterMode.value === "agent"
    ? (selectedAgent.value?.source_stream ?? activeStream.value)
    : activeStream.value,
);
// In Agent mode, narrow the panel to that one agent's name; Stream mode shows all.
const agentFilter = computed(() =>
  filterMode.value === "agent" ? (selectedAgent.value?.name ?? "") : "",
);

function onFilterModeChange(mode?: string | number | null) {
  if (mode === "stream" || mode === "agent") filterMode.value = mode;
  if (mode === "agent" && !agentsLoaded.value) loadAgents();
}

async function loadAgents() {
  try {
    const org = store.state.selectedOrganization?.identifier as string;
    const res = await genAiAgentMappingService.listAgents(
      org,
      timeRange.value.startTime,
      timeRange.value.endTime,
    );
    agents.value = res.agents ?? [];
    if (!activeAgentKey.value && agents.value.length) {
      activeAgentKey.value = agentKey(agents.value[0]);
    }
  } catch {
    agents.value = [];
  } finally {
    agentsLoaded.value = true;
  }
}

// Last-refresh + loading for the header's ORefreshButton — the panel stamps
// `lastRunAt` when its fetch settles and exposes its own `loading`.
const behaviorLastRunAt = computed<number | null>(
  () => panelRef.value?.lastRunAt ?? null,
);
const isLoading = computed(
  () => isRefreshing.value || panelRef.value?.loading || false,
);

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  timeRange.value = { startTime: range.startTime, endTime: range.endTime };
  dateState.value = {
    ...dateState.value,
    valueType: "relative",
    relativeTimePeriod: period,
    startTime: range.startTime,
    endTime: range.endTime,
  };
}

function onDateChange(value: any) {
  if (value?.valueType === "relative" && value.relativeTimePeriod) {
    applyRelative(value.relativeTimePeriod);
  } else {
    dateState.value = {
      valueType: "absolute",
      startTime: value.startTime,
      endTime: value.endTime,
      relativeTimePeriod: null,
    };
    timeRange.value = { startTime: value.startTime, endTime: value.endTime };
  }
}

async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
    }
    await panelRef.value?.refresh?.();
  } finally {
    isRefreshing.value = false;
  }
}

onMounted(async () => {
  const window = resolveAiDateWindow(dateState.value);
  if (window) {
    timeRange.value = window;
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
    }
  } else {
    applyRelative(DEFAULT_RELATIVE);
  }

  try {
    const res = await getStreams("traces", false, false);
    availableStreams.value = (res?.list ?? []).map((s: any) => s.name);
    if (availableStreams.value.length && !activeStream.value) {
      activeStream.value = availableStreams.value[0];
    }
  } catch {
    availableStreams.value = [];
  }

  // Agent is the default scope, so the agent list must be ready on first paint.
  await loadAgents();
});
</script>
