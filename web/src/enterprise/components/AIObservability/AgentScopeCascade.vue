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
  AgentScopeCascade — the three inline Env → Agent → Version dropdowns that
  replace the single grouped agent picker in the AI scope bar. It is a thin,
  presentational shell over useAgentScope's cascade state: the parent owns the
  derived option lists (envs / agentNames / versions) and the three selection
  refs, and re-derives the lower lists whenever a higher dimension changes. This
  component only renders them and forwards changes back via v-model.

  Styling matches the standard OpenObserve dropdown (the single agent picker it
  replaces): `label-position="inside"`, `w-full rounded-default` on the OSelect
  inside a fixed-width wrapper, so it reads as native.

  Dropdowns stay ENABLED even when a dimension has a single option — a disabled
  (greyed) control reads as "broken". The user can still open it to see the one
  value; the parent has auto-selected it. UNSET dimensions arrive with their
  label already resolved to the unset i18n string in the option object.

  When there are no agents at all (empty options), the whole cascade is hidden by
  the parent (the page shows its own no-agents empty state), so this component
  never renders a stuck/empty dropdown.

  A fourth Stream dropdown renders only when the selected env + agent + version
  sends to more than one stream (useAgentScope.agentStreams), so a single-stream
  setup keeps its three-control row. It shows the stream the page reads (the
  pick, else the default) and emits the pick via update:selectedStream. Below md
  it takes its own row under the three-up cascade.

  data-test on each: `${prefix}-cascade-{env|agent|version|stream}`.
-->
<template>
  <div
    class="flex flex-wrap items-center gap-2 max-md:basis-full"
    :class="{ 'max-md:flex-nowrap': !showStream }"
  >
    <div class="w-44 flex-shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:shrink">
      <OSelect
        :model-value="selectedEnv"
        :label="t('aiObservability.scope.env')"
        label-position="inside"
        :options="envs"
        labelKey="label"
        valueKey="value"
        class="rounded-default w-full"
        :data-test="`${prefix}-cascade-env`"
        @update:model-value="onEnvChange"
      />
    </div>
    <!-- The agent shows by name; its registered id(s) on hover. -->
    <div
      class="w-48 flex-shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:shrink"
      :title="selectedAgentIdHint"
      :data-test="`${prefix}-cascade-agent-id`"
    >
      <OSelect
        :model-value="selectedAgentName"
        :label="t('aiObservability.scope.agent')"
        label-position="inside"
        :options="agentNames"
        labelKey="label"
        valueKey="value"
        class="rounded-default w-full"
        :data-test="`${prefix}-cascade-agent`"
        @update:model-value="onAgentNameChange"
      />
    </div>
    <div
      v-if="showVersion"
      class="w-44 flex-shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:shrink"
    >
      <OSelect
        :model-value="selectedVersion"
        :label="t('aiObservability.scope.version')"
        label-position="inside"
        :options="versions"
        labelKey="label"
        valueKey="value"
        class="rounded-default w-full"
        :data-test="`${prefix}-cascade-version`"
        @update:model-value="onVersionChange"
      />
    </div>
    <div
      v-if="showStream"
      class="w-44 flex-shrink-0 max-md:w-auto max-md:min-w-0 max-md:basis-full"
      :title="t('aiObservability.scope.streamHint', { count: agentStreams.length })"
    >
      <OSelect
        :model-value="selectedStream"
        :label="t('aiObservability.scope.stream')"
        label-position="inside"
        :options="agentStreams"
        labelKey="label"
        valueKey="value"
        class="rounded-default w-full"
        :data-test="`${prefix}-cascade-stream`"
        @update:model-value="onStreamChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";

const props = withDefaults(
  defineProps<{
    /** Page prefix — every emitted data-test is `${prefix}-cascade-...`. */
    prefix: string;
    /** Distinct env options (from useAgentScope.envs; UNSET pre-labelled). */
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
    /**
     * Render the Version dropdown. Defaults to true; the Agent Graph page passes
     * false because its topology is version-agnostic (the same across versions),
     * so a Version pick there does nothing and only confuses. When hidden, only
     * the Env + Agent dropdowns render.
     */
    showVersion?: boolean;
    /** The Stream dropdown shows only when there are two or more. */
    agentStreams?: SelectOption[];
    /** The stream the page reads for the selected agent (two-way via update:selectedStream). */
    selectedStream?: string;
  }>(),
  {
    showVersion: true,
    agentStreams: () => [],
    selectedStream: "",
  },
);

const emit = defineEmits<{
  (e: "update:selectedEnv", value: string): void;
  (e: "update:selectedAgentName", value: string): void;
  (e: "update:selectedVersion", value: string): void;
  (e: "update:selectedStream", value: string): void;
}>();

const { t } = useI18nTyped();

const showStream = computed(() => props.agentStreams.length > 1);

// useAgentScope puts the ids behind each name on its option (`agentIds`).
const selectedAgentIdHint = computed(() => {
  const ids = props.agentNames.find((o) => o.value === props.selectedAgentName)?.agentIds;
  return Array.isArray(ids) && ids.length
    ? t("aiObservability.scope.agentIdHint", { ids: ids.join(", ") })
    : undefined;
});

const onEnvChange = (value: unknown) => {
  emit("update:selectedEnv", value as string);
};

const onAgentNameChange = (value: unknown) => {
  emit("update:selectedAgentName", value as string);
};

const onVersionChange = (value: unknown) => {
  emit("update:selectedVersion", value as string);
};

const onStreamChange = (value: unknown) => {
  emit("update:selectedStream", value as string);
};
</script>
