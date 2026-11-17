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
  <OCard variant="glass" class="shrink-0" data-test="incident-overview-alerts">
    <OCardSection role="header" dense class="justify-between gap-3">
      <h2 class="text-text-heading text-sm font-semibold">
        {{ t("alerts.incidents.overview.alerts") }}
      </h2>
      <span
        v-if="model"
        class="text-text-secondary text-xs tabular-nums"
        data-test="incident-overview-alerts-caption"
        >{{ caption }}</span
      >
    </OCardSection>
    <OCardSection role="body" dense>
      <p
        v-if="!model"
        class="text-text-secondary py-4 text-sm"
        data-test="incident-overview-alerts-empty"
      >
        {{ t("alerts.incidents.overview.noFirings") }}
      </p>
      <div v-else class="grid grid-cols-[minmax(0,17rem)_minmax(0,1fr)] gap-x-6">
        <template v-for="(lane, i) in shownLanes" :key="lane.alertId">
          <div
            class="border-border-default flex min-w-0 flex-col justify-center gap-1 border-b py-3"
            data-test="incident-overview-lane"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="rounded-default size-2.5 shrink-0"
                :style="seriesSwatch(slotOf(i))"
                aria-hidden="true"
              />
              <router-link
                v-if="linkOf(lane)"
                :to="linkOf(lane)!"
                class="text-accent min-w-0 text-sm font-medium hover:underline"
                data-test="incident-overview-lane-name"
                ><OTruncatedText>{{ lane.name }}</OTruncatedText></router-link
              >
              <OTruncatedText
                v-else
                class="text-text-heading min-w-0 text-sm font-medium"
                data-test="incident-overview-lane-name"
                >{{ lane.name }}</OTruncatedText
              >
            </div>
            <OTruncatedText v-if="conditionOf(lane)" class="text-text-secondary text-xs">{{
              conditionOf(lane)
            }}</OTruncatedText>
            <div class="flex items-baseline gap-1.5" data-test="incident-overview-lane-facts">
              <span class="text-text-heading text-lg leading-none font-semibold tabular-nums">{{
                lane.count.toLocaleString(locale)
              }}</span>
              <span class="text-text-secondary text-xs">{{ factsOf(lane) }}</span>
            </div>
          </div>
          <div class="border-border-default relative flex flex-col justify-end border-b py-3">
            <span
              v-if="peakBox"
              class="border-accent rounded-default pointer-events-none absolute inset-y-1 border"
              :style="peakBox"
              aria-hidden="true"
            />
            <div
              class="text-text-secondary text-2xs grid tabular-nums"
              :style="columns"
              aria-hidden="true"
            >
              <span v-for="(count, i) in lane.counts" :key="i" class="text-center">{{
                count ? count.toLocaleString(locale) : ""
              }}</span>
            </div>
            <OSparkline
              :points="lane.points"
              shape="bar"
              size="md"
              :series="slotOf(i)"
              :max="model.max"
              :aria-label="caption"
            />
          </div>
        </template>
        <div />
        <div class="grid pt-2" :style="columns" data-test="incident-overview-axis">
          <span
            v-for="tick in model.ticks"
            :key="tick.index"
            class="text-text-secondary flex justify-center text-xs whitespace-nowrap tabular-nums"
            :style="{ gridColumnStart: tick.index + 1 }"
          >
            <OTag
              v-if="tick.peak"
              variant="primary-soft"
              size="sm"
              :label="t('alerts.incidents.overview.peak')"
              data-test="incident-overview-peak"
            />
            <template v-else-if="tick.soFar">{{
              t("alerts.incidents.overview.soFar", { time: tick.label })
            }}</template>
            <template v-else>{{ tick.label }}</template>
          </span>
        </div>
      </div>
      <OButton
        v-if="hiddenCount || expanded"
        variant="ghost-primary"
        size="sm"
        class="mt-2"
        data-test="incident-overview-lanes-more"
        @click="expanded = !expanded"
        >{{
          expanded
            ? t("alerts.incidents.overview.showFewer")
            : t("alerts.incidents.overview.showMore", { count: hiddenCount }, hiddenCount)
        }}</OButton
      >
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import { seriesSwatch } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import { getIntlLocale } from "@/locales";
import type { IncidentAlert, IncidentAlertDefinition } from "@/services/incidents";
import {
  alertNeedsWords,
  type IncidentAlertListRow,
  type PanelAlert,
} from "@/utils/incidents/incidentAlertPanel";
import { incidentAge, incidentTime, unfoldDuration } from "@/utils/incidents/incidentUnfold";
import { overviewLanes, type OverviewLane } from "@/utils/incidents/incidentOverview";

const props = defineProps<{
  triggers: IncidentAlert[];
  definitions: IncidentAlertDefinition[];
  rows: IncidentAlertListRow[] | null;
  zone: string;
  /** The header's server clock, microseconds. */
  now: number;
  open: boolean;
}>();

const SHOWN_LANES = 5;
// The dashboard palette has twelve series tokens; a lane keeps its slot when the list expands.
const SERIES_SLOTS = 12;

const { t } = useI18nTyped();
const store = useStore();
const locale = getIntlLocale();
const expanded = ref(false);

const model = computed(() => overviewLanes(props.triggers, props.zone, props.now, props.open));
const shownLanes = computed(() =>
  expanded.value ? (model.value?.lanes ?? []) : (model.value?.lanes ?? []).slice(0, SHOWN_LANES),
);
const hiddenCount = computed(() =>
  Math.max(0, (model.value?.lanes.length ?? 0) - shownLanes.value.length),
);
const columns = computed(() => ({
  gridTemplateColumns: `repeat(${model.value?.buckets ?? 1}, minmax(0, 1fr))`,
}));
const peakBox = computed(() => {
  const n = model.value?.buckets ?? 1;
  const peak = model.value?.peak ?? null;
  return peak === null ? null : { left: `${(peak / n) * 100}%`, width: `${100 / n}%` };
});
const slotOf = (index: number) => (index % SERIES_SLOTS) + 1;

const caption = computed(() => {
  const m = model.value;
  if (!m) return "";
  const to = incidentTime(props.zone, m.end);
  return t("alerts.incidents.unfold.histogramCaption", {
    bucket: unfoldDuration(t, m.bucketUs),
    from: incidentTime(props.zone, m.start),
    to: props.open ? t("alerts.incidents.unfold.nowAt", { time: to }) : to,
  });
});

const definitionOf = (alertId: string) =>
  props.definitions.find((d) => d.id === alertId) as
    (IncidentAlertDefinition & PanelAlert) | undefined;
const rowOf = (alertId: string) => props.rows?.find((r) => r.alert_id === alertId);

// External and AutoObserve firings have no alert of their own to open.
const linkOf = (lane: OverviewLane) =>
  lane.alertKind && lane.alertKind !== "internal"
    ? null
    : {
        name: "alertDetail",
        params: { alert_id: lane.alertId },
        query: {
          org_identifier: store.state.selectedOrganization?.identifier,
          folder:
            rowOf(lane.alertId)?.folder_id ?? (definitionOf(lane.alertId)?.folder_id as string),
        },
      };

const conditionOf = (lane: OverviewLane) => {
  const alert = definitionOf(lane.alertId) ?? rowOf(lane.alertId);
  if (!alert) return null;
  const needs = alertNeedsWords(t, alert, locale, true);
  const stream = (alert as { stream_name?: string }).stream_name;
  if (needs && stream) return t("alerts.incidents.overview.condition", { stream, needs });
  return needs ?? null;
};

const factsOf = (lane: OverviewLane) => {
  const m = model.value!;
  const age = incidentAge(lane.last, props.now);
  if (m.lanes.length === 1) return t("alerts.incidents.overview.laneFactsOne", { age }, lane.count);
  const share = (lane.count / m.total).toLocaleString(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  return t("alerts.incidents.overview.laneFacts", { share, age }, lane.count);
};
</script>
