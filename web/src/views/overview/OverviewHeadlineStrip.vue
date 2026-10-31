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
  <OStatStrip
    :items="items"
    :loading="pending"
    compact
    selectable
    data-test="overview-headline-strip"
    @select="(key) => emit('select', key as OverviewTarget)"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { OrgOverview, OverviewSection } from "@/ts/interfaces/overview";
import {
  firingCount,
  levelCount,
  microsToMs,
  oldestKnownFiring,
  sectionView,
} from "./overviewFormat";
import { useOverviewTime } from "./useOverviewTime";

export type OverviewTarget = "firing" | "failing" | "incidents" | "pipelines" | "quiet" | "streams";
export type IncidentsTile = "ok" | "loading" | "error" | "locked" | "unavailable" | "forbidden";

const props = defineProps<{
  overview: OrgOverview | null;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
  incidentsState: IncidentsTile;
  incidentsTotal: number;
}>();

const emit = defineEmits<{ select: [target: OverviewTarget] }>();

const { t } = useI18nTyped();
const { formatElapsed } = useOverviewTime();

const DASH = raw("—");

const unavailableNote = (view: ReturnType<typeof sectionView>): I18nText | undefined => {
  if (view === "forbidden") return t("overview.state.tileForbidden");
  if (view === "locked") return t("overview.state.tileLocked");
  if (view === "error") return t("overview.state.tileError");
  return undefined;
};

const sectionTile = <T,>(
  section: OverviewSection<T> | undefined,
  pick: (data: T) => number,
): { value: string | number; note?: I18nText; ok: boolean; loading: boolean } => {
  const view = sectionView(section, {
    pending: props.pending,
    failed: props.failed,
    forbidden: props.forbidden,
  });
  if (view !== "ok" || !section?.data)
    return { value: DASH, note: unavailableNote(view), ok: false, loading: view === "loading" };
  return { value: pick(section.data), ok: true, loading: false };
};

const pipelinesSub = (tile: { ok: boolean; note?: I18nText }): I18nText | undefined => {
  if (!tile.ok) return tile.note;
  const enabled = props.overview?.pipelines.data?.enabled ?? 0;
  return enabled > 0 ? t("overview.cards.pipelinesOf", { enabled }) : undefined;
};

// a zero with no rules behind it would read as reassurance, so say nothing is monitored
const notSetUp = () => t("overview.dataHealth.status.notSetUp");

// one short piece only: the tile has room for "2 critical" or "oldest 1h 0m", not both
const firingSub = (tile: { ok: boolean; note?: I18nText }): I18nText | undefined => {
  if (!tile.ok) return tile.note;
  const alerts = props.overview?.alerts.data;
  if (alerts?.total === 0) return notSetUp();
  const critical = levelCount(alerts, "critical");
  if (critical > 0) return t("overview.cards.firingCritical", { count: critical });
  const oldest = oldestKnownFiring(alerts);
  if (!oldest) return undefined;
  const age = formatElapsed(Date.now() - microsToMs(oldest.since));
  return t("overview.cards.firingOldest", { age });
};

const items = computed<StatItem[]>(() => {
  const o = props.overview;
  const firing = sectionTile(o?.alerts, (d) => firingCount(d));
  const failing = sectionTile(o?.alerts, (d) => d.failed_evaluation);
  const noRules = firing.ok && o?.alerts.data?.total === 0;
  const pipelines = sectionTile(o?.pipelines, (d) => d.errored);
  const streams = sectionTile(o?.streams, (d) => d.total_streams);
  const quiet = sectionTile(o?.streams, (d) => d.quiet_count);
  const incidentNote: Record<IncidentsTile, I18nText | undefined> = {
    ok: undefined,
    loading: undefined,
    unavailable: t("overview.state.tileUnavailable"),
    error: t("overview.state.tileError"),
    locked: t("overview.state.tileLocked"),
    forbidden: t("overview.state.tileForbidden"),
  };
  const incidentsOk = props.incidentsState === "ok";
  return [
    {
      key: "firing",
      loading: firing.loading,
      label: t("overview.cards.firingAlerts"),
      value: noRules ? DASH : firing.value,
      sub: firingSub(firing),
      icon: "notifications",
      tone: firing.ok && Number(firing.value) > 0 ? "error" : "neutral",
      dataTest: "overview-headline-firing",
    },
    {
      key: "failing",
      loading: firing.loading,
      label: t("overview.cards.failingRules"),
      value: noRules ? DASH : failing.value,
      sub: noRules ? notSetUp() : failing.note,
      icon: "error",
      tone: failing.ok && Number(failing.value) > 0 ? "error" : "neutral",
      dataTest: "overview-headline-failing",
    },
    {
      key: "incidents",
      label: t("overview.cards.openIncidents"),
      value: incidentsOk ? props.incidentsTotal : DASH,
      sub: incidentNote[props.incidentsState],
      loading: props.incidentsState === "loading",
      icon: "warning",
      tone: incidentsOk && props.incidentsTotal > 0 ? "warning" : "neutral",
      selectable: props.incidentsState !== "unavailable" && props.incidentsState !== "forbidden",
      dataTest: "overview-headline-incidents",
    },
    {
      key: "pipelines",
      loading: pipelines.loading,
      label: t("overview.cards.pipelineErrors"),
      value: pipelines.value,
      sub: pipelinesSub(pipelines),
      icon: "database",
      tone: pipelines.ok && Number(pipelines.value) > 0 ? "error" : "neutral",
      dataTest: "overview-headline-pipelines",
    },
    {
      key: "quiet",
      loading: quiet.loading,
      label: t("overview.cards.quietStreams"),
      value: quiet.value,
      sub: quiet.ok ? undefined : quiet.note,
      icon: "schedule",
      tone: quiet.ok && Number(quiet.value) > 0 ? "warning" : "neutral",
      dataTest: "overview-headline-quiet",
    },
    {
      key: "streams",
      loading: streams.loading,
      label: t("overview.cards.streams"),
      value: streams.value,
      sub: streams.ok ? undefined : streams.note,
      icon: "storage",
      // no real maximum exists, so a huge one keeps the tile bar from drawing full
      max: Number.MAX_SAFE_INTEGER,
      tone: "neutral",
      dataTest: "overview-headline-streams",
    },
  ];
});
</script>
