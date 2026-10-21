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
    class="flex h-104 flex-col gap-2 max-lg:h-auto lg:max-h-[calc(var(--reka-popper-available-height,26rem)-1.625rem)]"
    data-test="rum-analytics-funnel-add-step-picker"
  >
    <span
      v-if="full"
      class="text-text-secondary text-xs"
      data-test="rum-analytics-funnel-max-steps"
      >{{ t("rum.analytics.funnel.maxSteps") }}</span
    >
    <div v-else class="flex min-h-0 flex-1 flex-col max-lg:h-80">
      <GroupedFieldList
        keyboard
        :fields="listRows"
        :search="search"
        :search-placeholder="t('rum.analytics.funnel.searchStepAll')"
        search-class="px-0"
        row-key="id"
        data-test="rum-analytics-funnel-add-step-list"
        @update:search="onSearch"
        @row-click="(row: ListRow) => add(row.step)"
      >
        <template #before-list>
          <AnalyticsPanelState
            v-if="suggestionsState.status === 'error' || suggestionsState.status === 'forbidden'"
            :state="suggestionsState"
            data-test="rum-analytics-funnel-suggestions"
            @retry="emit('suggestions-retry')"
          />
        </template>
        <template #group-label="{ row, groupName }">
          <span
            v-if="row.group === SUGGESTED"
            class="flex min-w-0 items-center gap-1.5"
            data-test="rum-analytics-funnel-suggested-header"
          >
            <OIcon name="auto-awesome" size="sm" class="text-accent shrink-0" />
            <span class="text-accent">{{ groupName }}</span>
            <OTruncatedText class="text-text-secondary font-normal">{{
              t("rum.analytics.funnel.suggestedCaption", { step: def.steps.length })
            }}</OTruncatedText>
          </span>
          <span v-else>{{ groupName }}</span>
        </template>
        <template #field-row="{ row }">
          <OFieldRow :data-test="row.testId">
            <OTag
              :label="kindLabel(row.step)"
              :variant="kindVariant(row.step)"
              size="xs"
              class="shrink-0"
            />
            <OTruncatedText class="text-text-body flex-1 font-mono text-xs">{{
              row.name
            }}</OTruncatedText>
            <OTag
              v-if="row.custom"
              :label="t('rum.analytics.kind.event')"
              variant="default-soft"
              size="xs"
              class="shrink-0"
            />
            <span
              class="shrink-0 pe-1 text-xs tabular-nums"
              :class="row.count === null ? 'text-text-muted' : 'text-text-secondary'"
              >{{ row.count ?? dash }}</span
            >
          </OFieldRow>
        </template>
        <template #empty>
          <span class="text-text-secondary flex items-center gap-1.5 py-2 text-xs">
            <span data-test="rum-analytics-funnel-add-step-empty">{{ listEmpty }}</span>
            <OButton
              v-if="failed && !loading"
              variant="ghost-primary"
              size="xs"
              data-test="rum-analytics-funnel-add-step-empty-retry"
              @click="load"
              >{{ t("common.retry") }}</OButton
            >
          </span>
        </template>
        <template v-if="note && listRows.length" #after-list>
          <span class="text-text-secondary flex items-center gap-1.5 pt-2 text-xs">
            <span data-test="rum-analytics-funnel-add-step-note">{{ note }}</span>
            <OButton
              v-if="failed && !loading"
              variant="ghost-primary"
              size="xs"
              data-test="rum-analytics-funnel-add-step-retry"
              @click="load"
              >{{ t("common.retry") }}</OButton
            >
          </span>
        </template>
      </GroupedFieldList>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import GroupedFieldList from "@/components/common/GroupedFieldList.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import { fitsLink } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import useStepOptions, { encode } from "@/composables/rum/useStepOptions";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount, type NamedEvent } from "@/utils/rum/productAnalyticsModel";
import {
  MAX_FUNNEL_STEPS,
  type FunnelDef,
  type SampleRatio,
  type StepKind,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "FunnelAddStep" });

interface ListRow {
  id: string;
  name: string;
  group: string;
  isGroup?: true;
  groupName?: I18nText;
  step: StepRef;
  count: string | null;
  testId?: string;
  custom?: true;
}

const props = defineProps<{
  def: FunnelDef;
  suggestions: { step: StepRef; units: number }[];
  suggestionsState: PanelState<unknown>;
  sampled: SampleRatio;
  events: NamedEvent[];
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  "suggestions-retry": [];
}>();
const { t } = useI18nTyped();
const { kindLabel, kindVariant, labelOf } = useStepLabels(
  () => props.events,
  () => "ready",
);
const STEP_KINDS: StepKind[] = ["p", "c", "e", "r"];
const SUGGESTED = "suggested";
const dash = raw("—");

const {
  groups,
  loading,
  failed,
  noCustom,
  load,
  onSearch: searchServer,
} = useStepOptions({
  events: () => props.events,
  kinds: () => STEP_KINDS,
});

const search = ref("");
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const onSearch = (term: string) => {
  search.value = term;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchServer(term.trim()), 300);
};

onMounted(load);
onBeforeUnmount(() => clearTimeout(searchTimer));

const full = computed(() => props.def.steps.length >= MAX_FUNNEL_STEPS);

const header = (group: string, label: I18nText): ListRow => ({
  id: `header:${group}`,
  name: label,
  group,
  isGroup: true,
  groupName: label,
  step: { kind: "p", key: "" },
  count: null,
});

// A suggested step is listed once, under Suggested, rather than again in its kind's group.
const listRows = computed<ListRow[]>(() => {
  const suggested = props.suggestions.map((s, i): ListRow => ({
    id: `${SUGGESTED}:${encode(s.step)}`,
    name: labelOf(s.step),
    group: SUGGESTED,
    step: s.step,
    count: formatCount(s.units, props.sampled),
    testId: `rum-analytics-funnel-suggestion-${i}`,
  }));
  const taken = new Set(props.suggestions.map((s) => encode(s.step)));
  const rest = groups.value.flatMap((g) => {
    const rows = g.rows
      .filter((r) => !taken.has(encode(r.step)))
      .map((r): ListRow => ({
        id: encode(r.step),
        name: r.label,
        group: g.kind,
        step: r.step,
        count: r.sessions === null ? null : formatCount(r.sessions, 1),
        testId: `rum-analytics-funnel-add-step-${encode(r.step)}`,
        ...(r.custom ? { custom: true as const } : {}),
      }));
    return rows.length ? [header(g.kind, g.label), ...rows] : [];
  });
  return [
    ...(suggested.length
      ? [header(SUGGESTED, t("rum.analytics.funnel.suggested")), ...suggested]
      : []),
    ...rest,
  ];
});

const note = computed<I18nText | null>(() => {
  if (loading.value) return t("rum.analytics.funnel.stepsLoading");
  if (failed.value) return t("rum.analytics.picker.loadFailed");
  if (noCustom.value) return t("rum.analytics.picker.noCustom");
  return null;
});

const listEmpty = computed<I18nText>(() => {
  if (loading.value) return t("rum.analytics.funnel.stepsLoading");
  if (failed.value) return t("rum.analytics.picker.loadFailed");
  return t("components.select.noOptionsFound");
});

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
