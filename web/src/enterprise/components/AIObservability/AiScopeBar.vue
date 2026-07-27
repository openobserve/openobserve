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
  AiScopeBar — the ONE scope control (Stream/Agent toggle + stream picker +
  agent-count badge + Env→Agent→Version cascade) shared by every AI
  observability page (Sessions, Agent Graph, Agent Behavior, LLM Insights).

  It reproduces today's per-page scope bar EXACTLY — same markup, same class
  strings, same `data-test` pattern — and parameterizes only what differs
  between pages:
    - `labels`      — resolved i18n strings (each page owns its own keys).
    - `dataTest`    — the page prefix, so every `${dataTest}-...` value is
                      identical to what the page emitted before extraction.
    - `allAgents`   — whether the empty-selection trigger falls back to the
                      "All Agents" label (Sessions/LLM) or the plain agent
                      label (Graph/Behavior, which have no All-Agents concept).
    - skeleton/loading — Sessions/LLM gate the stream select behind an
                      OSkeleton (`showStreamSkeleton`); Graph/Behavior don't.

  Two-way state (`filterMode` / `activeStream` + the three cascade selections
  `selectedEnv` / `selectedAgentName` / `selectedVersion`) is exposed via the
  modelValue/update pattern used elsewhere in the codebase, plus dedicated
  change events so each page can wire its own side-effects. Agent mode renders
  the AgentScopeCascade (Env→Agent→Version dropdowns) driven by useAgentScope's
  cascade state; the three dropdowns show the selection, so the former
  env/version scope badges are gone.
-->
<template>
  <div
    class="px-page-edge flex items-center gap-3 py-2"
    :class="{ 'border-border-default border-b': bordered }"
  >
    <OToggleGroup
      :model-value="filterMode"
      type="single"
      :data-test="`${dataTest}-filter-mode`"
      @update:model-value="onFilterModeChange"
    >
      <OToggleGroupItem value="agent" size="sm">{{ labels.agent }}</OToggleGroupItem>
      <OToggleGroupItem value="stream" size="sm">{{ labels.stream }}</OToggleGroupItem>
    </OToggleGroup>

    <div
      v-if="filterMode === 'stream'"
      :data-test="`${dataTest}-stream-selector`"
      class="w-64 flex-shrink-0"
    >
      <OSkeleton type="text" v-if="showStreamSkeleton && !streamsLoaded" class="h-8.5 w-full" />
      <OSelect
        v-else
        v-model="activeStreamModel"
        :label="labels.streamLabel"
        label-position="inside"
        :options="streamSelectOptions"
        labelKey="label"
        valueKey="value"
        :option-tooltip="streamOptionTooltip"
        class="rounded-default w-full"
        @update:model-value="onStreamChange"
      />
    </div>
    <StreamAgentCountBadge
      v-if="filterMode === 'stream' && activeStreamModel"
      :count="selectedStreamCount"
      :data-test="countDataTest ?? `${dataTest}-stream-count`"
    />

    <!-- Agent mode: the Env→Agent→Version cascade replaces the single grouped
         agent dropdown. The three dropdowns themselves SHOW the current
         selection, so the separate env/version scope badges are gone. The
         skeleton gate is preserved (LLM gates until agents load). -->
    <template v-else>
      <OSkeleton type="text" v-if="agentSkeleton && !agentsLoaded" class="h-8.5 w-44" />
      <AgentScopeCascade
        v-else
        :prefix="dataTest"
        :envs="envs"
        :agent-names="agentNames"
        :versions="versions"
        :selected-env="selectedEnv"
        :selected-agent-name="selectedAgentName"
        :selected-version="selectedVersion"
        :show-version="showVersion"
        @update:selected-env="onSelectedEnvChange"
        @update:selected-agent-name="onSelectedAgentNameChange"
        @update:selected-version="onSelectedVersionChange"
      />
      <!-- Page-supplied affordance beside the cascade (agent mode only). Agent
           Graph rides its version-agnostic hint here since it hides the Version
           dropdown. -->
      <slot name="badges" />
    </template>

    <slot name="trailing" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import StreamAgentCountBadge from "@/components/shared/StreamAgentCountBadge.vue";
import AgentScopeCascade from "./AgentScopeCascade.vue";

type FilterMode = "stream" | "agent";

interface ScopeBarLabels {
  /** Agent toggle item label. */
  agent: string;
  /** Stream toggle item label. */
  stream: string;
  /** Inside-label of the stream picker. */
  streamLabel: string;
  /** All-Agents label — retained for API compatibility across the 4 pages. */
  allAgents: string;
}

const props = withDefaults(
  defineProps<{
    /** Page prefix — every emitted data-test is `${dataTest}-...`. */
    dataTest: string;
    /** Resolved i18n strings (each page passes its own t(...) values). */
    labels: ScopeBarLabels;
    /** Current scope mode (two-way via update:filterMode). */
    filterMode: FilterMode;
    /** Selected stream (two-way via update:activeStream). */
    activeStream: string;
    streamSelectOptions: SelectOption[];
    /** Agent count for the selected stream (stream mode badge). */
    selectedStreamCount: number;
    streamsLoaded: boolean;
    agentsLoaded: boolean;
    /** All-Agents shape (Sessions/LLM) — retained for API compatibility. */
    allAgents?: boolean;
    // ── Env→Agent→Version cascade (agent mode) ─────────────────────────────
    /** Distinct env options (useAgentScope.envs, cascade:true). */
    envs: SelectOption[];
    /** Agent-name options scoped to the selected env (useAgentScope.agentNames). */
    agentNames: SelectOption[];
    /** Version options scoped to env + name (useAgentScope.versions). */
    versions: SelectOption[];
    /** Selected env (two-way via update:selectedEnv). */
    selectedEnv: string;
    /** Selected agent name (two-way via update:selectedAgentName). */
    selectedAgentName: string;
    /** Selected version (two-way via update:selectedVersion). */
    selectedVersion: string;
    /** Gate the stream select behind an OSkeleton until streams load
        (Sessions/LLM). Graph/Behavior derive the stream from the agents API
        and never skeleton it. */
    showStreamSkeleton?: boolean;
    /** Gate the agent cascade behind an OSkeleton until agents load (LLM).
        When false the cascade renders immediately (Sessions/Graph/Behavior). */
    agentSkeleton?: boolean;
    /** data-test override for the stream-count badge. Sessions' original bar
        used the `sessions-` prefix here (not its `sessions-list-` bar prefix),
        so preserving byte-identical data-test values needs an explicit override.
        Defaults to `${dataTest}-stream-count`. */
    countDataTest?: string;
    /** Draw the bottom divider on the bar root. Sessions/LLM place the bar in a
        plain page div and own the divider here (true, the default). Graph/
        Behavior place it in OPageLayout's `#subnav`, which already draws the
        full-bleed divider, so they pass false to avoid a double border. */
    bordered?: boolean;
    /** Enable the stream picker's per-option tooltip (Graph, whose stream names
        can be long). Matches OSelect's own default (false) for the others. */
    streamOptionTooltip?: boolean;
    /** Show the cascade's Version dropdown. Defaults to true; Agent Graph passes
        false because its topology is version-agnostic. Forwarded to
        AgentScopeCascade. */
    showVersion?: boolean;
  }>(),
  {
    allAgents: false,
    showStreamSkeleton: false,
    agentSkeleton: false,
    countDataTest: undefined,
    bordered: true,
    streamOptionTooltip: false,
    showVersion: true,
  },
);

const emit = defineEmits<{
  (e: "update:filterMode", value: FilterMode): void;
  (e: "update:activeStream", value: string): void;
  (e: "update:selectedEnv", value: string): void;
  (e: "update:selectedAgentName", value: string): void;
  (e: "update:selectedVersion", value: string): void;
  (e: "filter-mode-change", value: FilterMode): void;
  (e: "stream-change", value: string): void;
}>();

// v-model bridge for the stream picker — read the prop, write both the model
// update and the page-facing change event.
const activeStreamModel = computed({
  get: () => props.activeStream,
  set: (value: string) => emit("update:activeStream", value),
});

const onFilterModeChange = (value: unknown) => {
  const mode = value as FilterMode;
  emit("update:filterMode", mode);
  emit("filter-mode-change", mode);
};

const onStreamChange = (value: unknown) => {
  emit("stream-change", value as string);
};

// Forward the cascade dropdown updates to the parent (which owns the
// useAgentScope selection refs and re-derives the lower lists).
const onSelectedEnvChange = (value: string) => {
  emit("update:selectedEnv", value);
};

const onSelectedAgentNameChange = (value: string) => {
  emit("update:selectedAgentName", value);
};

const onSelectedVersionChange = (value: string) => {
  emit("update:selectedVersion", value);
};
</script>
