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
  <div class="flex flex-wrap items-center gap-2" data-test="rum-analytics-funnel-suggestions">
    <AnalyticsPanelState
      v-if="suggestionsState.status === 'error' || suggestionsState.status === 'forbidden'"
      :state="suggestionsState"
      data-test="rum-analytics-funnel-suggestions"
      @retry="emit('suggestions-retry')"
    />
    <template v-else>
      <span v-if="suggestions.length" class="text-text-secondary flex items-center gap-1 text-xs">
        <OIcon name="auto-awesome" size="sm" />{{
          t("rum.analytics.funnel.nextStep", { step: def.steps.length })
        }}
      </span>
      <OButton
        v-for="(s, i) in suggestions"
        :key="`${s.step.kind}:${s.step.key}`"
        variant="outline"
        size="sm"
        icon-left="add"
        :disabled="full"
        :data-test="`rum-analytics-funnel-suggestion-${i}`"
        @click="add(s.step)"
      >
        <span class="flex items-center gap-1.5">
          <OTag :label="kindLabel(s.step)" :variant="kindVariant(s.step)" size="xs" />
          <span class="max-w-60 truncate font-mono text-xs">{{ s.step.key }}</span>
          <span class="text-text-secondary text-xs">{{ formatCount(s.units, sampled) }}</span>
        </span>
      </OButton>
    </template>
    <span :class="stacked ? 'w-full' : 'w-72 max-md:w-full'">
      <StepPicker
        :model-value="null"
        :placeholder="t('rum.analytics.funnel.searchStep')"
        :events="events"
        :kinds="STEP_KINDS"
        :disabled="full"
        data-test="rum-analytics-funnel-add-step-select"
        @update:model-value="(s) => s && add(s)"
      />
      <OTooltip v-if="full" :content="t('rum.analytics.funnel.maxSteps')" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import StepPicker from "@/components/rum/productAnalytics/StepPicker.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import { fitsLink } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import { useI18nTyped } from "@/types/i18n";
import { formatCount, type NamedEvent } from "@/utils/rum/productAnalyticsModel";
import {
  MAX_FUNNEL_STEPS,
  type FunnelDef,
  type SampleRatio,
  type StepKind,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "FunnelAddStep" });

const props = defineProps<{
  def: FunnelDef;
  suggestions: { step: StepRef; units: number }[];
  suggestionsState: PanelState<unknown>;
  sampled: SampleRatio;
  events: NamedEvent[];
  stacked?: boolean;
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  "suggestions-retry": [];
}>();
const { t } = useI18nTyped();
const { kindLabel, kindVariant } = useStepLabels(
  () => props.events,
  () => "ready",
);
const STEP_KINDS: StepKind[] = ["e", "p", "c", "r"];

const full = computed(() => props.def.steps.length >= MAX_FUNNEL_STEPS);

const add = (step: StepRef) => {
  if (full.value) return;
  const next = { ...props.def, steps: [...props.def.steps, step] };
  if (!fitsLink(next)) {
    toast({ variant: "error", message: t("rum.analytics.funnel.tooLongForLink") });
    return;
  }
  emit("update:def", next);
};

defineExpose({ add });
</script>
