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

<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <OCard
    ref="card"
    variant="outlined"
    class="rounded-surface flex flex-col"
    data-test="rum-analytics-trends"
  >
    <span class="sr-only" aria-live="polite" data-test="rum-analytics-trends-announce">{{
      announcement
    }}</span>
    <div class="flex flex-wrap items-center gap-2 px-4 pt-3">
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.trends.title")
        }}</span>
        <span class="text-text-secondary text-xs" data-test="rum-analytics-trends-subtitle">{{
          subtitle
        }}</span>
      </div>
      <OToggleGroup
        v-if="!series.length"
        :model-value="metric"
        type="single"
        data-test="rum-analytics-trends-metric"
        @update:model-value="(v) => v && (metric = v as 'sessions' | 'users')"
      >
        <OToggleGroupItem
          value="sessions"
          size="xs"
          data-test="rum-analytics-trends-metric-sessions"
          >{{ t("rum.analytics.trends.sessions") }}</OToggleGroupItem
        >
        <OToggleGroupItem
          v-if="identity"
          value="users"
          size="xs"
          data-test="rum-analytics-trends-metric-users"
          >{{ usersLabel ?? t("rum.analytics.trends.users") }}</OToggleGroupItem
        >
      </OToggleGroup>
      <span>
        <OButton
          variant="outline"
          size="icon-toolbar"
          icon-left="dashboard-customize"
          :disabled="eventsGate !== 'ready'"
          :aria-label="t('rum.analytics.dashboard.add')"
          data-test="rum-analytics-trends-add-dashboard-btn"
          @click="dashboardOpen = true"
        />
        <OTooltip :content="t('rum.analytics.dashboard.add')" />
      </span>
    </div>
    <div v-if="series.length" class="flex flex-wrap items-center gap-1.5 px-4 pt-2">
      <OTag
        v-for="(s, i) in series"
        :key="`${s.kind}:${s.key}`"
        :label="labelOf(s)"
        :variant="s.kind === 'p' ? 'blue-soft' : s.kind === 'c' ? 'teal-soft' : 'purple-soft'"
        size="sm"
        removable
        :class="isFresh(s) ? 'outline-accent outline-2 outline-offset-2' : ''"
        :data-new="isFresh(s) || undefined"
        :data-test="`rum-analytics-trends-series-${i}`"
        @remove="
          emit(
            'update:series',
            series.filter((_, j) => j !== i),
          )
        "
      />
      <OButton
        variant="ghost"
        size="sm"
        data-test="rum-analytics-trends-clear-btn"
        @click="emit('update:series', [])"
        >{{ t("rum.analytics.trends.clear") }}</OButton
      >
    </div>
    <div v-if="eventsHeld" class="px-4 pt-2">
      <NamedEventsNotice
        :status="eventsGate"
        subject="series"
        data-test="rum-analytics-trends"
        @retry="emit('retry-events')"
      />
    </div>
    <div v-if="!eventsHeld || chartSeries.length" class="h-64 w-full px-2 pb-2">
      <OSkeleton
        v-if="eventsGate === 'loading'"
        class="h-full w-full"
        data-test="rum-analytics-trends-loading"
      />
      <PanelSchemaRenderer
        v-else
        :key="rendererKey"
        class="h-full w-full"
        :panelSchema="panelSchema"
        :selectedTimeObj="selectedTimeObj"
        :variablesData="{}"
        :forceLoad="true"
        searchType="RUM"
        :allowAnnotationsAPI="false"
      />
    </div>
    <AddToDashboard
      v-if="dashboardOpen"
      v-model:open="dashboardOpen"
      :dashboard-panel-data="{ data: {} }"
      :panels="[dashboardPanel]"
      :notice="t('rum.analytics.dashboard.snapshot')"
    />
  </OCard>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import NamedEventsNotice from "@/components/rum/productAnalytics/NamedEventsNotice.vue";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import { buildTrendsPanel, stepLabel } from "@/utils/rum/productAnalyticsPanels";
import type { AnalyticsScope, IdentitySql, StepRef } from "@/utils/rum/productAnalyticsQueries";

const AddToDashboard = defineAsyncComponent(() => import("@/plugins/metrics/AddToDashboard.vue"));

const DAILY_LIMIT_US = 31 * 86400000000;
const FRESH_MS = 2000;

const props = defineProps<{
  scope: AnalyticsScope;
  identity: IdentitySql | null;
  usersLabel?: I18nText;
  series: StepRef[];
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
  range: { startUs: number; endUs: number };
  timezone: string;
}>();
const emit = defineEmits<{ "update:series": [StepRef[]]; "retry-events": [] }>();
const { t } = useI18nTyped();
const metric = ref<"sessions" | "users">("sessions");
// Users needs an identity, so losing it must not leave the toggle with nothing selected.
watch(
  () => props.identity,
  (id) => {
    if (!id && metric.value === "users") metric.value = "sessions";
  },
);
const dashboardOpen = ref(false);
// Add to dashboard leaves for the dashboard it filled, so it must not greet the user on Back.
onDeactivated(() => (dashboardOpen.value = false));
const card = ref<InstanceType<typeof OCard> | null>(null);
const fresh = ref<string | null>(null);
const announcement = ref<I18nText>(raw(""));
let freshTimer: ReturnType<typeof setTimeout> | undefined;
let announced: string | null = null;

const interval = computed<"1 day" | "1 week">(() =>
  props.range.endUs - props.range.startUs > DAILY_LIMIT_US ? "1 week" : "1 day",
);

const subtitle = computed(() => {
  const weekly = interval.value === "1 week";
  if (metric.value !== "users" || !props.identity || props.series.length) {
    return weekly
      ? t("rum.analytics.trends.sessionsPerWeek")
      : t("rum.analytics.trends.sessionsPerDay");
  }
  const unit = props.usersLabel ?? t("rum.analytics.trends.users");
  return weekly
    ? t("rum.analytics.trends.usersPerWeek", { unit })
    : t("rum.analytics.trends.usersPerDay", { unit });
});

// Until the events are ready an event series would compile as a zero-match, so it is not charted.
const eventsGate = computed<NamedEventsStatus>(() =>
  props.series.some((s) => s.kind === "e") ? props.eventsStatus : "ready",
);

const eventsHeld = computed(
  () => eventsGate.value === "failed" || eventsGate.value === "forbidden",
);

const chartSeries = computed<StepRef[]>(() =>
  eventsHeld.value ? props.series.filter((s) => s.kind !== "e") : props.series,
);

const panelSchema = computed(() =>
  buildTrendsPanel(
    props.scope,
    props.identity,
    props.identity ? metric.value : "sessions",
    chartSeries.value,
    props.events,
    interval.value,
    props.timezone,
    t,
  ),
);

// The dialog stamps an id and title onto what it adds, so it gets a copy.
const dashboardPanel = computed(() => JSON.parse(JSON.stringify(panelSchema.value)));

// usePanelDataLoader reads getTime() off these Dates as microseconds.
const selectedTimeObj = computed(() => ({
  start_time: new Date(props.range.startUs),
  end_time: new Date(props.range.endUs),
}));

const rendererKey = computed(() =>
  JSON.stringify([
    props.range,
    (panelSchema.value.queries as { query: string }[])[0].query,
    metric.value,
  ]),
);

// With no list to name it, an event's id is opaque, so it gets a neutral name until the list is ready.
const labelOf = (s: StepRef): I18nText =>
  eventsGate.value !== "ready" && s.kind === "e" && !props.events.some((e) => e.id === s.key)
    ? t("rum.analytics.events.unloadedName")
    : raw(stepLabel(s, props.events));

const seriesId = (s: StepRef) => `${s.kind}:${s.key}`;

const isFresh = (s: StepRef) => fresh.value === seriesId(s);

const clearFresh = () => {
  fresh.value = null;
  announced = null;
  announcement.value = raw("");
};

// The add happens in a table far below, so the panel is pulled into view and names the new series.
const reveal = async (step: StepRef) => {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  (card.value?.$el as HTMLElement | undefined)?.scrollIntoView?.({
    block: "nearest",
    behavior: reduce ? "auto" : "smooth",
  });
  fresh.value = seriesId(step);
  announced = seriesId(step);
  clearTimeout(freshTimer);
  freshTimer = setTimeout(clearFresh, FRESH_MS);
  // A live region speaks only on a text change, so the same series added again must clear it first.
  announcement.value = raw("");
  await nextTick();
  if (announced === seriesId(step)) {
    announcement.value = t("rum.analytics.trends.added", { name: labelOf(step) });
  }
};

watch(
  () => props.series.map(seriesId),
  (ids) => {
    if (announced && !ids.includes(announced)) clearFresh();
  },
);

defineExpose({ reveal });

onBeforeUnmount(() => clearTimeout(freshTimer));
</script>
