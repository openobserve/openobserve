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
  <FunnelSectionRow
    :title="t('rum.analytics.funnel.exclusionStepsTitle')"
    :caption="t('rum.analytics.funnel.exclusionStepsCaption')"
    :stacked="stacked"
    :boxed="!!def.x?.length"
    test-id="rum-analytics-funnel-exclusions"
  >
    <span
      v-for="(x, j) in def.x ?? []"
      :key="j"
      class="flex min-w-0 flex-wrap items-center gap-1.5"
      :class="stacked ? 'basis-full' : ''"
    >
      <span class="text-text-secondary shrink-0 text-xs">{{
        j === 0 ? t("rum.analytics.funnel.didNotSee") : t("rum.analytics.funnel.filterAnd")
      }}</span>
      <OTag
        :label="chipLabel(x)"
        variant="primary-outline"
        size="sm"
        clickable
        removable
        class="max-w-full min-w-0"
        :remove-label="t('rum.analytics.funnel.removeExclusion')"
        :data-test="`rum-analytics-funnel-exclusion-${j}`"
        @click="edit(j)"
        @remove="remove(j)"
      >
        <OTag :label="kindLabel(x.step)" :variant="kindVariant(x.step)" size="xs" />
        <OTruncatedText as="span" class="min-w-0">{{ chipLabel(x) }}</OTruncatedText>
      </OTag>
      <span
        v-if="removed[j] !== null && removed[j] !== undefined"
        class="text-text-secondary basis-full text-xs"
        :data-test="`rum-analytics-funnel-exclusion-${j}-removed`"
        >{{
          t("rum.analytics.funnel.exclusionRemoved", {
            count: formatCount(removed[j], sampled),
            step: x.b ?? x.a,
          })
        }}</span
      >
    </span>
    <template #action>
      <OPopover
        :open="open"
        :side="stacked ? 'right' : 'bottom'"
        align="start"
        content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]"
        @update:open="setOpen"
      >
        <template #trigger>
          <span>
            <OButton
              v-if="stacked"
              variant="ghost"
              size="icon-sm"
              icon-left="add"
              :active="open"
              :disabled="!!blocked"
              :aria-label="t('rum.analytics.funnel.addExclusionStep')"
              data-test="rum-analytics-funnel-add-exclusion-btn"
              @click="editing = null"
            />
            <OTooltip
              v-if="stacked"
              :content="blocked ?? t('rum.analytics.funnel.addExclusionStep')"
            />
            <template v-else>
              <OButton
                variant="ghost-primary"
                size="sm"
                icon-left="add"
                :active="open"
                :disabled="!!blocked"
                data-test="rum-analytics-funnel-add-exclusion-btn"
                @click="editing = null"
                >{{ t("rum.analytics.funnel.addExclusionStep") }}</OButton
              >
              <OTooltip v-if="blocked" :content="blocked" />
            </template>
          </span>
        </template>
        <ExclusionPicker
          v-if="open"
          :key="editing ?? '+'"
          :def="def"
          :events="events"
          :events-status="eventsStatus"
          :deleted-names="deletedNames"
          :initial="editing !== null ? def.x?.[editing] : undefined"
          @apply="apply"
          @cancel="setOpen(false)"
        />
      </OPopover>
    </template>
  </FunnelSectionRow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import FunnelSectionRow from "@/components/rum/productAnalytics/funnelParts/FunnelSectionRow.vue";
import ExclusionPicker from "@/components/rum/productAnalytics/funnelParts/ExclusionPicker.vue";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import { isWholeFunnel } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount, type NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { ExclusionStep, FunnelDef, SampleRatio } from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "ExclusionSection" });

const MAX_EXCLUSIONS = 5;

const props = defineProps<{
  def: FunnelDef;
  removed: (number | null)[];
  sampled: SampleRatio;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
  deletedNames?: Readonly<Record<string, string>>;
  stacked?: boolean;
}>();
const emit = defineEmits<{ "update:def": [FunnelDef] }>();
const { t } = useI18nTyped();
const { labelOf, kindLabel, kindVariant } = useStepLabels(
  () => props.events,
  () => props.eventsStatus,
  () => props.deletedNames ?? {},
);

const open = ref(false);
// Index 0 is a valid edit, so every check is against null, never truthiness.
const editing = ref<number | null>(null);

const blocked = computed<I18nText | null>(() => {
  if (props.def.steps.length < 2) return t("rum.analytics.funnel.exclusionNeedsSteps");
  return (props.def.x?.length ?? 0) >= MAX_EXCLUSIONS
    ? t("rum.analytics.funnel.maxExclusions", { max: MAX_EXCLUSIONS })
    : null;
});

const rangeLabel = (x: ExclusionStep): I18nText => {
  if (isWholeFunnel(x, props.def.steps.length)) return t("rum.analytics.funnel.exclusionChipWhole");
  return x.b !== undefined
    ? t("rum.analytics.funnel.exclusionBetween", { a: x.a, b: x.b })
    : t("rum.analytics.funnel.exclusionWithin", { seconds: (x.withinMs ?? 0) / 1000, a: x.a });
};

const chipLabel = (x: ExclusionStep): I18nText =>
  t("rum.analytics.funnel.exclusionChip", { step: labelOf(x.step), range: rangeLabel(x) });

const updateX = (x: ExclusionStep[]) => emit("update:def", { ...props.def, x });

const setOpen = (v: boolean) => {
  open.value = v;
  if (!v) editing.value = null;
};

const edit = (j: number) => {
  editing.value = j;
  open.value = true;
};

const apply = (x: ExclusionStep) => {
  const current = props.def.x ?? [];
  updateX(
    editing.value !== null ? current.map((e, k) => (k === editing.value ? x : e)) : [...current, x],
  );
  setOpen(false);
};

const remove = (j: number) => updateX((props.def.x ?? []).filter((_, k) => k !== j));

// The picker's step numbers belong to the steps it was opened against.
watch(
  () => props.def.steps,
  () => setOpen(false),
);
</script>
