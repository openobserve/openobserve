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
  <!-- Pane width picks the form: full labels, short labels with hints, or a chip. -->
  <div
    class="hidden shrink-0 items-center gap-1.5 @min-[67rem]/results:inline-flex"
    data-test="traces-scope"
  >
    <span class="text-text-secondary text-xs whitespace-nowrap">{{ t("traces.scope.label") }}</span>
    <OToggleGroup
      :model-value="shown"
      :aria-label="t('traces.scope.label')"
      data-test="traces-scope-switch"
      @update:model-value="pick"
    >
      <OToggleGroupItem
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        size="xs"
        :disabled="option.disabled"
        :focusable-unavailable="option.disabled"
        :tooltip="option.disabled ? t('traces.scope.rootUnavailable') : undefined"
        :aria-label="option.label"
        :data-test="`traces-scope-option-${option.value}`"
      >
        <!-- OToggleGroupItem shows its own tooltip only while disabled, so the hint binds to the item here. -->
        <OTooltip v-if="!option.disabled" :content="option.hint" />
        <span class="hidden @min-[76rem]/results:inline" data-test="traces-scope-option-label">{{
          option.label
        }}</span>
        <span class="@min-[76rem]/results:hidden" data-test="traces-scope-option-short">{{
          option.short
        }}</span>
      </OToggleGroupItem>
    </OToggleGroup>
  </div>
  <span
    class="rounded-default inline-flex h-6 shrink-0 items-center border ps-2 pe-0.5 @min-[67rem]/results:hidden"
    :class="shown === 'all' ? 'border-border-default' : 'border-accent bg-accent/10'"
    data-test="traces-scope-chip-wrap"
  >
    <OSelect
      :model-value="shown"
      :aria-label="chipLabel"
      appearance="inline"
      size="xs"
      :searchable="false"
      data-test="traces-scope-chip"
      @update:model-value="pick"
    >
      <template #trigger>
        <span data-test="traces-scope-chip-value">{{ chipLabel }}</span>
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
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { isTracesScope, type TracesScope } from "@/utils/traces/tracesScope";

const props = defineProps<{
  modelValue: TracesScope;
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
    short: t("traces.scope.allShort"),
    hint: t("traces.scope.allHint"),
    description: t("traces.scope.allDesc"),
    disabled: false,
  },
  {
    value: "root" as const,
    label: t("traces.scope.root"),
    short: t("traces.scope.rootShort"),
    hint: t("traces.scope.rootHint"),
    description: t("traces.scope.rootDesc"),
    disabled: !props.hasParentColumn,
  },
  {
    value: "entrypoint" as const,
    label: t("traces.scope.entrypoint"),
    short: t("traces.scope.entrypointShort"),
    hint: t("traces.scope.entrypointHint"),
    description: t("traces.scope.entrypointDesc"),
    disabled: false,
  },
]);

// Root spans on a stream without parent ids adds no condition, so it reads as All spans.
const shown = computed<TracesScope>(() =>
  props.modelValue === "root" && !props.hasParentColumn ? "all" : props.modelValue,
);

const chipLabel = computed(() =>
  t("traces.scope.chip", {
    scope: options.value.find((option) => option.value === shown.value)?.short ?? "",
  }),
);

const pick = (value: unknown) => {
  if (isTracesScope(value) && value !== props.modelValue) emit("update:modelValue", value);
};
</script>
