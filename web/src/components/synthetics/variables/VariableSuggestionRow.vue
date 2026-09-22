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
  <span
    class="flex min-w-0 items-center gap-2 text-sm"
    data-test="synthetics-variable-suggestion-row"
  >
    <OIcon
      :name="suggestion.global && !suggestion.envs.length ? 'public' : 'layers'"
      size="sm"
      class="text-text-secondary shrink-0"
      role="img"
      :aria-label="sourceLabel"
      data-test="synthetics-variable-suggestion-scope-icon"
    />
    <span
      class="shrink-0 font-mono"
      :class="active ? 'text-text-heading' : 'text-text-body'"
      data-test="synthetics-variable-suggestion-name"
      >{{ suggestion.name }}</span
    >
    <span
      v-if="suggestion.envs.length"
      class="text-text-secondary min-w-0 truncate text-xs"
      data-test="synthetics-variable-suggestion-envs"
      >{{ envsText }}</span
    >
    <span v-if="gapText" class="ms-auto flex shrink-0">
      <OTooltip :content="gapText" side="top">
        <OIcon
          name="warning"
          size="xs"
          class="text-warning cursor-help"
          role="img"
          :aria-label="gapText"
          data-test="synthetics-variable-suggestion-gap"
        />
      </OTooltip>
    </span>
    <span v-if="suggestion.secret" class="flex shrink-0" :class="gapText ? '' : 'ms-auto'">
      <OTooltip :content="t('synthetics.variablesPanel.secretTooltip')" side="top">
        <OIcon
          name="lock"
          size="xs"
          class="text-text-secondary cursor-help"
          data-test="synthetics-variable-suggestion-secret"
        />
      </OTooltip>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { VariableSuggestion } from "./suggestions";

const props = defineProps<{
  suggestion: VariableSuggestion;
  active: boolean;
}>();

const { t } = useI18nTyped();

const envsText = computed<I18nText>(() => raw(props.suggestion.envs.join(", ")));

const sourceLabel = computed<I18nText | undefined>(() => {
  const sources = [...props.suggestion.envs];
  if (props.suggestion.global) sources.push(t("synthetics.variables.global"));
  return sources.length ? raw(sources.join(", ")) : undefined;
});

const gapText = computed<I18nText | undefined>(() => {
  const missing = props.suggestion.gap;
  if (!missing.length) return undefined;
  return missing.length > 2
    ? t("synthetics.inherited.notInMany", { count: missing.length })
    : t("synthetics.inherited.notIn", { envs: missing.join(", ") });
});
</script>
