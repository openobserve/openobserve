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

  data-test on each: `${prefix}-cascade-{env|agent|version}`.
-->
<template>
  <div class="flex items-center gap-2">
    <div class="w-44 flex-shrink-0">
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
    <div class="w-48 flex-shrink-0">
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
    <div v-if="showVersion" class="w-44 flex-shrink-0">
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
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";

withDefaults(
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
  }>(),
  {
    showVersion: true,
  },
);

const emit = defineEmits<{
  (e: "update:selectedEnv", value: string): void;
  (e: "update:selectedAgentName", value: string): void;
  (e: "update:selectedVersion", value: string): void;
}>();

const { t } = useI18nTyped();

const onEnvChange = (value: unknown) => {
  emit("update:selectedEnv", value as string);
};

const onAgentNameChange = (value: unknown) => {
  emit("update:selectedAgentName", value as string);
};

const onVersionChange = (value: unknown) => {
  emit("update:selectedVersion", value as string);
};
</script>
