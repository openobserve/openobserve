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
  <OPopover side="bottom" align="end" content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]">
    <template #trigger>
      <slot name="trigger">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="filter-alt"
          :aria-label="t('rum.analytics.funnel.stepFilters')"
          :data-test="`rum-analytics-funnel-step-${index}-filters`"
          ><OTooltip :content="t('rum.analytics.funnel.stepFilters')"
        /></OButton>
      </slot>
    </template>
    <StepConditionEditor
      :step="step"
      :index="index"
      :fields="fields"
      :fields-state="fieldsState"
      :values="values"
      @update="(s) => emit('update', s)"
      @filter-values="(f) => emit('filter-values', f)"
      @load-fields="emit('load-fields')"
    />
  </OPopover>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import StepConditionEditor from "@/components/rum/productAnalytics/funnelParts/StepConditionEditor.vue";
import type { FilterValuesState } from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import type { FieldSampleState } from "@/composables/rum/useFunnelFieldSample";
import { useI18nTyped } from "@/types/i18n";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

defineProps<{
  step: StepRef;
  index: number;
  fields?: readonly string[];
  fieldsState?: FieldSampleState;
  values?: FilterValuesState;
}>();
const emit = defineEmits<{
  update: [StepRef];
  "filter-values": [string];
  "load-fields": [];
}>();
const { t } = useI18nTyped();
</script>
