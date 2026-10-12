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
  <OPopover side="bottom" align="end" content-class="p-3 w-80 max-w-[calc(100vw-1.5rem)]">
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
    <div
      class="flex flex-col gap-3"
      :data-test="`rum-analytics-funnel-step-${index}-filters-popover`"
    >
      <span class="text-text-heading text-sm font-semibold">{{
        t("rum.analytics.funnel.stepFilters")
      }}</span>
      <OInput
        type="number"
        size="sm"
        :min="0"
        :max="MAX_STEP_MS / 1000"
        :label="t('rum.analytics.funnel.filterMinTime')"
        :model-value="step.f?.minMs !== undefined ? step.f.minMs / 1000 : ''"
        :data-test="`rum-analytics-funnel-step-${index}-filter-min`"
        @update:model-value="(v) => setFilters({ minMs: toMs(v) })"
      />
      <OCheckbox
        :model-value="!!step.f?.frustrated"
        :label="t('rum.analytics.funnel.filterFrustrated')"
        :data-test="`rum-analytics-funnel-step-${index}-filter-frustrated`"
        @update:model-value="(v) => setFilters({ frustrated: v === true })"
      />
      <OCheckbox
        :model-value="!!step.f?.errored"
        :label="t('rum.analytics.funnel.filterErrored')"
        :data-test="`rum-analytics-funnel-step-${index}-filter-errored`"
        @update:model-value="(v) => setFilters({ errored: v === true })"
      />
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { useI18nTyped } from "@/types/i18n";
import type { StepFilters, StepRef } from "@/utils/rum/productAnalyticsQueries";
import { MAX_STEP_MS, toMs } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";

const props = defineProps<{ step: StepRef; index: number }>();
const emit = defineEmits<{ update: [StepRef] }>();
const { t } = useI18nTyped();

const setFilters = (patch: { minMs?: number; frustrated?: boolean; errored?: boolean }) => {
  const s = props.step;
  const merged = { ...s.f, ...patch };
  const f: StepFilters = {
    ...(merged.minMs !== undefined ? { minMs: merged.minMs } : {}),
    ...(merged.frustrated ? { frustrated: true as const } : {}),
    ...(merged.errored ? { errored: true as const } : {}),
  };
  emit(
    "update",
    Object.keys(f).length ? { kind: s.kind, key: s.key, f } : { kind: s.kind, key: s.key },
  );
};
</script>
