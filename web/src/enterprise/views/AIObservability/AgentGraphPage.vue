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
  <OPageLayout
    data-test="ai-agent-graph-page"
    :title="t('aiObservability.nav.agentGraph')"
    :subtitle="t('aiObservability.subtitle.agentGraph')"
    icon="hub"
    bleed
    :scroll="false"
  >
      <template #actions>
        <date-time
          ref="dateTimeRef"
          auto-apply
          menu-align="end"
          :default-type="searchObj.data.datetime.type"
          :default-absolute-time="{
            startTime: searchObj.data.datetime.startTime ?? 0,
            endTime: searchObj.data.datetime.endTime ?? 0,
          }"
          :default-relative-time="
            searchObj.data.datetime.relativeTimePeriod ?? '15m'
          "
          data-test="ai-agent-graph-date-time"
          class="h-[2rem]"
          @on:date-change="onDateChange"
        />
      </template>

    <!-- Scope control — same Stream/Agent pattern as LLM Insights, so the two
         AI pages read as one product. Stream tab picks a trace stream; Agent
         tab picks a discovered agent and the graph follows its source_stream.
         Lives in OPageLayout's #subnav (which draws the full-bleed divider). -->
    <template #subnav>
    <div class="flex items-center gap-3 px-page-edge py-2">
      <OToggleGroup
        :model-value="filterMode"
        type="single"
        data-test="agent-graph-filter-mode"
        @update:model-value="onFilterModeChange"
      >
        <OToggleGroupItem value="stream" size="sm">{{
          t("aiObservability.agentGraph.stream")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="agent" size="sm">{{
          t("aiObservability.agentGraph.agent")
        }}</OToggleGroupItem>
      </OToggleGroup>

      <div
        v-if="filterMode === 'stream'"
        data-test="agent-graph-stream-selector"
        class="w-56 shrink-0"
      >
        <OSelect
          v-model="activeStream"
          :label="t('aiObservability.agentGraph.stream')"
          label-position="inside"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="w-full rounded-default"
        />
      </div>
      <div
        v-else
        data-test="agent-graph-agent-selector"
        class="w-56 shrink-0"
      >
        <SkeletonBox
          v-if="!agentsLoaded"
          width="100%"
          height="2.125rem"
          :rounded="true"
        />
        <OSelect
          v-else
          v-model="activeAgentKey"
          :label="t('aiObservability.agentGraph.agent')"
          label-position="inside"
          :options="agentSelectOptions"
          labelKey="label"
          valueKey="value"
          class="w-full rounded-default"
        />
      </div>
    </div>
    </template>

    <ServiceGraph
      :stream-filter="effectiveStream"
      hide-stream-selector
      agent-highlight
      class="flex-1 min-h-0"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import DateTime from "@/components/DateTime.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import useTraces from "@/composables/useTraces";
import useStreams from "@/composables/useStreams";
import { getConsumableRelativeTime } from "@/utils/date";
import genAiAgentMappingService, {
  type GenAiAgentListItem,
} from "@/services/gen-ai-agent-mapping.service";

defineOptions({ name: "AIAgentGraphPage" });

const { t } = useI18n();
const store = useStore();
const { searchObj } = useTraces();
const { getStreams } = useStreams();

const ServiceGraph = defineAsyncComponent(
  () => import("@/plugins/traces/ServiceGraph.vue"),
);

const DEFAULT_RELATIVE = "15m";

const filterMode = ref<"stream" | "agent">("stream");
const availableStreams = ref<string[]>([]);
const activeStream = ref<string>("default");

const agents = ref<GenAiAgentListItem[]>([]);
const agentsLoaded = ref(false);
const activeAgentKey = ref<string>("");

// Stream-scoped identity, mirroring LLM Insights — same-named agents in
// different streams don't collide.
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

// The stream the graph queries: the picked stream, or the selected agent's
// source_stream. Deriving the stream from the agent is the whole point — the
// user picks an agent, not a stream.
const effectiveStream = computed(() =>
  filterMode.value === "agent"
    ? (selectedAgent.value?.source_stream ?? activeStream.value)
    : activeStream.value,
);

function onFilterModeChange(mode?: string | number | null) {
  if (mode === "stream" || mode === "agent") filterMode.value = mode;
}

function effectiveWindow() {
  const dt = searchObj.data.datetime;
  if (dt.type === "relative" && dt.relativeTimePeriod) {
    const r = getConsumableRelativeTime(dt.relativeTimePeriod);
    if (r) return { startTime: r.startTime, endTime: r.endTime };
  }
  return { startTime: dt.startTime, endTime: dt.endTime };
}

async function loadStreams() {
  try {
    const res = await getStreams("traces", false, false);
    availableStreams.value = (res?.list ?? []).map((s: any) => s.name);
    if (
      availableStreams.value.length &&
      !availableStreams.value.includes(activeStream.value)
    ) {
      activeStream.value = availableStreams.value[0];
    }
  } catch {
    availableStreams.value = [];
  }
}

async function loadAgents() {
  try {
    const org = store.state.selectedOrganization.identifier;
    const { startTime, endTime } = effectiveWindow();
    const res = await genAiAgentMappingService.listAgents(
      org,
      startTime,
      endTime,
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

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  searchObj.data.datetime = {
    type: "relative",
    relativeTimePeriod: period,
    startTime: range.startTime,
    endTime: range.endTime,
  };
}

function onDateChange(value: any) {
  if (value?.valueType === "relative" && value.relativeTimePeriod) {
    applyRelative(value.relativeTimePeriod);
  } else {
    searchObj.data.datetime = {
      type: "absolute",
      relativeTimePeriod: "",
      startTime: value.startTime,
      endTime: value.endTime,
    };
  }
  loadAgents();
}

onMounted(() => {
  if (
    searchObj.data.datetime.type === "relative" ||
    !searchObj.data.datetime.startTime
  ) {
    applyRelative(
      searchObj.data.datetime.relativeTimePeriod || DEFAULT_RELATIVE,
    );
  }
  loadStreams();
  loadAgents();
});
</script>
