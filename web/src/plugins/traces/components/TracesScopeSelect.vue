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
  <div class="inline-flex shrink-0 items-center gap-2" data-test="traces-scope-select-wrap">
    <!-- First child, so the tooltip binds to the wrapper, not to the select that takes no pointer events. -->
    <OTooltip v-if="sqlMode" :content="t('traces.scope.sqlModeDisabled')" />
    <span class="text-text-secondary text-xs whitespace-nowrap">{{ t("traces.scope.label") }}</span>
    <div class="w-36">
      <OSelect
        :model-value="shown"
        :aria-label="t('traces.scope.label')"
        size="xs"
        :searchable="false"
        :disabled="sqlMode"
        :class="{ 'pointer-events-none': sqlMode }"
        data-test="traces-scope-select"
        @update:model-value="pick"
      >
        <template #trigger>
          <span class="truncate text-xs" data-test="traces-scope-select-value">{{
            optionLabel(shown)
          }}</span>
        </template>
        <div v-for="option in options" :key="option.value">
          <!-- A disabled item takes no pointer events, so its wrapper carries the reason. -->
          <OTooltip
            v-if="option.disabled"
            :content="t('traces.scope.rootUnavailable')"
            side="right"
          />
          <OSelectItem :value="option.value" :label="option.label" :disabled="option.disabled">
            <span class="flex min-w-0 flex-col">
              <span>{{ option.label }}</span>
              <span class="text-text-secondary text-xs">{{ option.description }}</span>
            </span>
          </OSelectItem>
        </div>
      </OSelect>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { isTracesScope, type TracesScope } from "@/utils/traces/tracesScope";

const props = defineProps<{
  modelValue: TracesScope;
  sqlMode: boolean;
  hasParentColumn: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [scope: TracesScope];
}>();

const { t } = useI18nTyped();

const options = computed(() => [
  {
    value: "all" as const,
    label: t("traces.scope.all"),
    description: t("traces.scope.allDesc"),
    disabled: false,
  },
  {
    value: "root" as const,
    label: t("traces.scope.root"),
    description: t("traces.scope.rootDesc"),
    disabled: !props.hasParentColumn,
  },
  {
    value: "entrypoint" as const,
    label: t("traces.scope.entrypoint"),
    description: t("traces.scope.entrypointDesc"),
    disabled: false,
  },
]);

// Root spans on a stream without parent ids adds no condition, so it reads as All spans.
const shown = computed<TracesScope>(() =>
  props.modelValue === "root" && !props.hasParentColumn ? "all" : props.modelValue,
);

const optionLabel = (scope: TracesScope) =>
  options.value.find((option) => option.value === scope)?.label ?? "";

const pick = (value: unknown) => {
  if (isTracesScope(value) && value !== props.modelValue) emit("update:modelValue", value);
};
</script>
