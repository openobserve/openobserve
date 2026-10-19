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
    <StepConditionEditor :step="step" :index="index" @update="(s) => emit('update', s)" />
  </OPopover>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import StepConditionEditor from "@/components/rum/productAnalytics/funnelParts/StepConditionEditor.vue";
import { useI18nTyped } from "@/types/i18n";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

defineProps<{ step: StepRef; index: number }>();
const emit = defineEmits<{ update: [StepRef] }>();
const { t } = useI18nTyped();
</script>
