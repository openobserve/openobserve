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
  <div
    v-if="presetTools !== undefined && !customizing"
    class="mb-4 flex items-center gap-2 text-sm"
    data-test="ai-toolset-preset-tools"
  >
    <span>{{ t("aiToolset.presetTools", { count: presetTools }) }}</span>
    <OButton
      variant="ghost"
      size="xs"
      data-test="ai-toolset-preset-tools-customize"
      @click="customizing = true"
    >
      {{ t("aiToolset.customize") }}
    </OButton>
  </div>
  <div v-else class="mb-4" data-test="ai-toolset-tool-picker">
    <div class="mb-2 flex items-center gap-2">
      <div class="text-sm font-medium">{{ t("aiToolset.tools") }}</div>
      <OButton
        variant="outline"
        size="xs"
        icon-left="refresh"
        :loading="status === 'loading'"
        data-test="ai-toolset-tools-refresh"
        @click="emit('refresh')"
      >
        {{ t("aiToolset.refreshTools") }}
      </OButton>
    </div>

    <div
      v-if="status === 'loading'"
      class="text-text-secondary mb-2 text-xs"
      data-test="ai-toolset-tools-loading"
    >
      {{ t("aiToolset.toolsLoading") }}
    </div>
    <div
      v-else-if="status === 'failed'"
      role="alert"
      class="text-status-negative mb-2 text-xs"
      data-test="ai-toolset-tools-error"
    >
      {{ t("aiToolset.toolsFailed", { message: error }) }}
    </div>
    <div
      v-else-if="status === 'idle' && !tools"
      class="text-text-secondary mb-2 text-xs"
      data-test="ai-toolset-tools-idle"
    >
      {{ t("aiToolset.toolsIdle") }}
    </div>

    <div
      v-if="lists.allowed === null && !tools"
      class="text-text-secondary mb-2 text-xs"
      data-test="ai-toolset-tools-all-allowed"
    >
      {{ t("aiToolset.toolsAllAllowed") }}
    </div>

    <template v-if="tools && tools.length">
      <div class="mb-2 flex gap-2">
        <OButton
          variant="outline"
          size="xs"
          data-test="ai-toolset-tools-allow-all"
          @click="update(allowAll(lists, tools))"
        >
          {{ t("aiToolset.allowAll") }}
        </OButton>
        <OButton
          variant="outline"
          size="xs"
          data-test="ai-toolset-tools-allow-read-only"
          @click="update(allowReadOnly(lists, tools))"
        >
          {{ t("aiToolset.allowReadOnly") }}
        </OButton>
      </div>
      <div class="border-border-default rounded-default mb-2 border">
        <div
          v-for="tool in tools"
          :key="tool.name"
          class="border-border-default flex flex-col gap-1 border-b px-3 py-2 last:border-b-0"
          :data-test="`ai-toolset-tool-${tool.name}`"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm">{{ tool.name }}</span>
            <OBadge
              v-if="mayWrite(tool)"
              variant="warning-outline"
              size="sm"
              data-test="ai-toolset-tool-may-write"
            >
              {{ t("aiToolset.mayWrite") }}
            </OBadge>
            <div class="flex-1" />
            <OToggleGroup
              :model-value="toolState(lists, tool)"
              :disabled="setByGlob(lists, tool.name)"
              :aria-label="tool.name"
              @update:model-value="(state: any) => setState(tool, state)"
            >
              <OToggleGroupItem
                v-for="option in stateOptions"
                :key="option.value"
                :value="option.value"
                size="sm"
                :data-test="`ai-toolset-tool-state-${option.value}`"
              >
                {{ option.label }}
              </OToggleGroupItem>
            </OToggleGroup>
          </div>
          <div v-if="tool.description" class="text-text-secondary text-xs">
            {{ tool.description }}
          </div>
          <div
            v-if="setByGlob(lists, tool.name)"
            class="text-text-secondary text-xs"
            data-test="ai-toolset-tool-set-by-glob"
          >
            {{ t("aiToolset.setByOtherEntry") }}
          </div>
          <div
            v-else-if="mayWrite(tool) && toolState(lists, tool) === 'allowed'"
            role="alert"
            class="text-status-warning text-xs"
            data-test="ai-toolset-tool-write-warning"
          >
            {{ t("aiToolset.mayWriteWarning") }}
          </div>
        </div>
      </div>
    </template>

    <div v-if="status === 'failed'" class="mb-2 flex items-end gap-2">
      <OInput
        v-model="typedName"
        :label="t('aiToolset.typedToolName')"
        :error="!!typedError"
        :error-message="typedError"
        class="o2-input flex-1"
        data-test="ai-toolset-typed-tool"
        @keydown.enter.prevent="addTyped"
      />
      <OCheckbox
        v-model="typedCanWrite"
        :label="t('aiToolset.stateWrite')"
        data-test="ai-toolset-typed-tool-write"
      />
      <OButton
        variant="outline"
        size="sm"
        :disabled="!typedName.trim() || !!typedError"
        data-test="ai-toolset-typed-tool-add"
        @click="addTyped"
      >
        {{ t("aiToolset.addTool") }}
      </OButton>
    </div>

    <div v-if="others.length" data-test="ai-toolset-other-entries">
      <div class="mb-1 text-xs font-medium">{{ t("aiToolset.otherEntries") }}</div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="other in others"
          :key="`${other.list}:${other.entry}`"
          class="border-border-default rounded-default inline-flex items-center gap-1 border px-2 py-0.5 text-xs"
          :data-test="`ai-toolset-other-${other.list}-${other.entry}`"
        >
          <span class="font-mono">{{ other.entry }}</span>
          <span class="text-text-secondary">{{ listLabel(other.list) }}</span>
          <OButton
            :aria-label="t('common.delete')"
            variant="ghost-destructive"
            size="icon-xs-sq"
            @click="update(removeEntry(lists, other))"
          >
            <OIcon name="close" size="xs" />
          </OButton>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { useI18nTyped } from "@/types/i18n";
import {
  addTypedTool,
  allowAll,
  allowReadOnly,
  mayWrite,
  otherEntries,
  removeEntry,
  setByGlob,
  setToolState,
  toolState,
  typedToolError,
  type DiscoveredTool,
  type ToolLists,
  type ToolState,
} from "./toolPicker";

const props = defineProps<{
  lists: ToolLists;
  tools: DiscoveredTool[] | null;
  status: "idle" | "loading" | "ok" | "failed";
  error?: string;
  /** Set when a preset chose the tools: the table stays collapsed until Customize. */
  presetTools?: number;
}>();

const emit = defineEmits<{
  (_e: "update:lists", _lists: ToolLists): void;
  (_e: "refresh"): void;
}>();

const { t } = useI18nTyped();

const stateOptions: { value: ToolState; label: string }[] = [
  { value: "off", label: t("aiToolset.stateOff") },
  { value: "allowed", label: t("aiToolset.stateAllowed") },
  { value: "write", label: t("aiToolset.stateWrite") },
];

const customizing = ref(false);
const typedName = ref("");
const typedCanWrite = ref(false);

const others = computed(() => otherEntries(props.lists, props.tools));

const typedError = computed(() =>
  typedToolError(typedName.value) ? t("aiToolset.typedToolNameNoGlob") : undefined,
);

const update = (lists: ToolLists) => emit("update:lists", lists);

// Turning a "may write" tool on starts at "can change things"; "Allowed" stays a deliberate choice.
const setState = (tool: DiscoveredTool, state: ToolState | undefined) => {
  if (!state) return;
  const current = toolState(props.lists, tool);
  const next = current === "off" && state === "allowed" && mayWrite(tool) ? "write" : state;
  update(setToolState(props.lists, tool.name, next));
};

const addTyped = () => {
  if (typedError.value) return;
  update(addTypedTool(props.lists, typedName.value, typedCanWrite.value));
  typedName.value = "";
  typedCanWrite.value = false;
};

const listLabel = (list: keyof ToolLists) =>
  ({
    allowed: t("aiToolset.listAllowed"),
    blocked: t("aiToolset.listBlocked"),
    write: t("aiToolset.listWrite"),
  })[list];
</script>
