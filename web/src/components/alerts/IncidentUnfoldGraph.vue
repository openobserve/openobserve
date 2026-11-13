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
    ref="root"
    class="flex min-h-0 flex-1 flex-col"
    :class="panelSummary ? 'md:pe-120' : ''"
    data-test="incident-unfold"
  >
    <OEmptyState
      v-if="!unfold.alertCount"
      size="hero"
      :title="t('alerts.incidents.unfold.emptyTitle')"
      :description="t('alerts.incidents.unfold.emptyText')"
      data-test="incident-unfold-empty"
    />
    <AutoObserveUnfoldGraph
      v-else
      :key="incident.id"
      v-model:selection="selection"
      :cards="unfold.cards"
      :hint="hint"
      :legend="legend"
      :column-minutes="COLUMN_MINUTES"
      :panel-kinds="PANEL_KINDS"
      :step="stepped ? STEP_REM : undefined"
      route-around
      scroll-cue
      compact
      data-test="incident-unfold-graph"
      @expand-lane="expandLane"
    >
      <template #header>
        <p class="text-text-body m-0 text-sm" data-test="incident-unfold-summary">
          <i18n-t :keypath="summaryKey" tag="span" scope="global">
            <template #firings>
              <span class="text-text-heading font-semibold">{{
                t("alerts.incidents.unfold.firings", { count: unfold.firings }, unfold.firingCount)
              }}</span>
            </template>
            <template #alerts>{{
              t(
                "alerts.incidents.unfold.alerts",
                { count: unfold.alertCount.toLocaleString(getIntlLocale()) },
                unfold.alertCount,
              )
            }}</template>
            <template #span>{{ unfold.span }}</template>
          </i18n-t>
        </p>
      </template>
    </AutoObserveUnfoldGraph>
    <IncidentAlertPanel
      :summary="heldSummary"
      :open="!!panelSummary"
      :row="panelRow"
      :rows-state="rowsState"
      :incident-id="incident.id"
      :zone="zone"
      :now="nowMicros"
      :anchor="root"
      @close="selection = null"
      @retry-state="alertRows.refetch()"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import AutoObserveUnfoldGraph from "@/components/autoobserve/AutoObserveUnfoldGraph.vue";
import IncidentAlertPanel from "./IncidentAlertPanel.vue";
import type {
  UnfoldCard,
  UnfoldKind,
  UnfoldLegendItem,
} from "@/components/autoobserve/unfold.types";
import type { IncidentWithAlerts } from "@/services/incidents";
import { firingAlertsQuery } from "@/services/alerts.queries";
import { incidentEventsQuery } from "@/services/incidents.queries";
import { useOrgId } from "@/composables/query";
import { useNowMicros } from "@/composables/downtimes/useNowMicros";
import { getIntlLocale } from "@/locales";
import { timezoneAbbr } from "@/utils/formatters";
import {
  COLUMN_MINUTES,
  incidentUnfold,
  incidentZone,
  liveRowsOf,
} from "@/utils/incidents/incidentUnfold";
import type { IncidentAlertListRow } from "@/utils/incidents/incidentAlertPanel";

const props = defineProps<{ incident: IncidentWithAlerts }>();

const PANEL_KINDS: UnfoldKind[] = ["alert"];
// Beside the open panel, more than this many alerts step right so every card stays in view.
const STEP_ABOVE = 3;
const STEP_REM = 5.25;

const { t } = useI18nTyped();
const store = useStore();
const orgId = useOrgId();

// The header's clock, so every age agrees; it ticks on a resolved incident too.
const nowMicros = useNowMicros();

const expandedLanes = ref<string[]>([]);
const selection = ref<string | null>(null);
watch(
  () => props.incident.id,
  () => {
    expandedLanes.value = [];
    selection.value = null;
  },
);
const expandLane = (lane: string) => {
  if (!expandedLanes.value.includes(lane)) expandedLanes.value = [...expandedLanes.value, lane];
};

const alertRows = useQuery(() =>
  Object.assign(firingAlertsQuery(orgId.value), {
    enabled: !!orgId.value,
  }),
);
const rows = computed<IncidentAlertListRow[]>(() => alertRows.data.value?.list ?? []);
const liveRows = computed(() => liveRowsOf(alertRows.data.value));
const rowsState = computed(() => {
  if (alertRows.isPending.value) return "loading" as const;
  return !liveRows.value ? ("error" as const) : ("ready" as const);
});
const events = useQuery(() =>
  Object.assign(incidentEventsQuery(orgId.value, props.incident.id), {
    enabled: !!orgId.value && !!props.incident.id,
  }),
);

const zone = computed(() => incidentZone(store.state.timezone));

const unfold = computed(() =>
  incidentUnfold(
    {
      status: props.incident.status,
      firstAlertAt: props.incident.first_alert_at,
      resolvedAt: props.incident.resolved_at,
      acknowledgedAt: props.incident.acknowledged_at,
      acknowledgedBy: props.incident.acknowledged_by,
      triggers: props.incident.triggers ?? [],
      alerts: props.incident.alerts ?? [],
      topology: props.incident.topology_context,
      now: nowMicros.value,
      expandedLanes: expandedLanes.value,
      locale: getIntlLocale(),
      timezone: store.state.timezone,
      alertRows: liveRows.value ?? undefined,
      events: events.data.value,
    },
    t,
  ),
);

const panelSummary = computed(() =>
  selection.value ? (unfold.value.alerts[selection.value] ?? null) : null,
);
// The closing panel keeps its alert, so it never slides out blank.
const heldSummary = ref(panelSummary.value);
watch(panelSummary, (summary) => {
  if (summary) heldSummary.value = summary;
});
const panelRow = computed(() =>
  heldSummary.value ? rows.value.find((r) => r.alert_id === heldSummary.value?.alertId) : undefined,
);

const summaryKey = computed(() =>
  unfold.value.span ? "alerts.incidents.unfold.summary" : "alerts.incidents.unfold.summaryNoSpan",
);

const root = ref<HTMLElement | null>(null);

// Every time on the cards carries its own day when it is not today, so the hint names the zone only.
const hint = computed(() =>
  t("alerts.incidents.unfold.hintZone", {
    zone: timezoneAbbr(zone.value, new Date(nowMicros.value / 1000)),
  }),
);

const stepped = computed(() => !!panelSummary.value && unfold.value.alertCount > STEP_ABOVE);

// Only what the graph shows: each tone on screen, and a link line only when one alert links to another.
const legend = computed<UnfoldLegendItem[]>(() => {
  const cards = unfold.value.cards;
  const alertCards = cards.filter((c) => c.kind === "alert" || c.kind === "fold");
  const alertTone = (tone: UnfoldCard["tone"]) => alertCards.some((c) => c.tone === tone);
  const linked = alertCards.slice(1);
  const items: (UnfoldLegendItem | false)[] = [
    alertTone("danger") && {
      key: "cause",
      label: t("autoobserve.unfold.likelyCause"),
      tone: "danger",
    },
    alertTone("info") && {
      key: "alert",
      label: t("alerts.incidents.unfold.legendAlert"),
      tone: "info",
    },
    alertTone("warning") && {
      key: "firing",
      label: t("alerts.incidents.unfold.firingNow"),
      tone: "warning",
    },
    cards.some((c) => c.tone === "team") && {
      key: "team",
      label: t("autoobserve.unfold.team"),
      tone: "team",
    },
    cards.some((c) => c.tone === "success") && {
      key: "resolved",
      label: t("autoobserve.unfold.outcome.resolved"),
      tone: "success",
    },
    linked.some((c) => !c.dependency) && {
      key: "after",
      label: t("alerts.incidents.unfold.legendFiredLater"),
      line: "solid",
      tooltip: t("alerts.incidents.unfold.legendFiredLaterWhy"),
    },
    linked.some((c) => c.dependency) && {
      key: "dependency",
      label: t("alerts.incidents.unfold.legendDependency"),
      line: "dashed",
    },
  ];
  return items.filter((item): item is UnfoldLegendItem => !!item);
});
</script>
