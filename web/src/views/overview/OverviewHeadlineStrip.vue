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
    layout="stacked"
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

export type OverviewTarget = "firing" | "failing" | "incidents" | "pipelines" | "quiet";
export type IncidentsTile = "ok" | "loading" | "error" | "locked" | "unavailable" | "forbidden";

interface Tile {
  value: string | number;
  note?: I18nText;
  ok: boolean;
  loading: boolean;
}

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
): Tile => {
  const view = sectionView(section, {
    pending: props.pending,
    failed: props.failed,
    forbidden: props.forbidden,
  });
  if (view !== "ok" || !section?.data)
    return { value: DASH, note: unavailableNote(view), ok: false, loading: view === "loading" };
  return { value: pick(section.data), ok: true, loading: false };
};

// a zero with no rules behind it would read as reassurance, so the value is a dash and the note says why
const noRulesNote = (): I18nText | undefined => {
  const alerts = props.overview?.alerts.data;
  if (!alerts || alerts.enabled > 0) return undefined;
  return alerts.total > 0 ? t("overview.cards.noEnabledRules") : t("overview.cards.noAlertRules");
};

const firingNote = (count: number): I18nText | undefined => {
  const alerts = props.overview?.alerts.data;
  if (count === 0) return t("overview.cards.firingNone");
  const critical = levelCount(alerts, "critical");
  const oldest = oldestKnownFiring(alerts);
  const age = oldest ? formatElapsed(Date.now() - microsToMs(oldest.since)) : "";
  if (critical > 0 && age)
    return t("overview.cards.firingCriticalOldest", { count: critical, age });
  if (critical > 0) return t("overview.cards.firingCritical", { count: critical });
  return age ? t("overview.cards.firingOldest", { age }) : undefined;
};

// one tile per alert question; both read "no rules" the same way
const alertTile = (tile: Tile, note: (count: number) => I18nText | undefined): Tile => {
  if (!tile.ok) return tile;
  const noRules = noRulesNote();
  if (noRules) return { ...tile, value: DASH, note: noRules };
  return { ...tile, note: note(Number(tile.value)) };
};

const pipelinesTile = (): Tile => {
  const tile = sectionTile(props.overview?.pipelines, (d) => d.errored);
  const data = props.overview?.pipelines.data;
  if (!tile.ok || !data) return tile;
  if (data.total === 0) return { ...tile, value: DASH, note: t("overview.cards.noPipelines") };
  return { ...tile, note: t("overview.cards.pipelinesOf", { enabled: data.enabled }) };
};

const quietTile = (): Tile => {
  const tile = sectionTile(props.overview?.streams, (d) => d.quiet_count);
  const data = props.overview?.streams.data;
  if (!tile.ok || !data) return tile;
  if (data.total_streams === 0)
    return { ...tile, value: DASH, note: t("overview.cards.noStreams") };
  return { ...tile, note: t("overview.cards.quietNote") };
};

const incidentsTile = (): Tile => {
  const unavailable: Record<IncidentsTile, I18nText | undefined> = {
    ok: undefined,
    loading: undefined,
    unavailable: t("overview.state.tileUnavailable"),
    error: t("overview.state.tileError"),
    locked: t("overview.state.tileLocked"),
    forbidden: t("overview.state.tileForbidden"),
  };
  const ok = props.incidentsState === "ok";
  if (!ok) {
    const loading = props.incidentsState === "loading";
    return { value: DASH, note: unavailable[props.incidentsState], ok, loading };
  }
  const total = props.incidentsTotal;
  return {
    value: total,
    note: total > 0 ? undefined : t("overview.cards.incidentsNone"),
    ok,
    loading: false,
  };
};

// a count above zero carries the tone; a dash or a zero stays quiet
const toneOf = (tile: Tile, tone: StatItem["tone"]): StatItem["tone"] =>
  tile.ok && Number(tile.value) > 0 ? tone : "neutral";

const items = computed<StatItem[]>(() => {
  const o = props.overview;
  const firing = alertTile(
    sectionTile(o?.alerts, (d) => firingCount(d)),
    firingNote,
  );
  const failing = alertTile(
    sectionTile(o?.alerts, (d) => d.failed_evaluation),
    (count) => (count > 0 ? t("overview.cards.failingNote") : t("overview.cards.failingNone")),
  );
  const incidents = incidentsTile();
  const pipelines = pipelinesTile();
  const quiet = quietTile();
  const tile = (
    key: OverviewTarget,
    label: I18nText,
    data: Tile,
    tone: StatItem["tone"],
    selectable: boolean,
  ): StatItem => ({
    key,
    label,
    value: data.value,
    sub: data.note,
    loading: data.loading,
    tone: toneOf(data, tone),
    selectable,
    dataTest: `overview-headline-${key}`,
  });
  return [
    tile("firing", t("overview.cards.firingAlerts"), firing, "error", firing.ok),
    tile("failing", t("overview.cards.failingRules"), failing, "error", failing.ok),
    tile(
      "incidents",
      t("overview.cards.openIncidents"),
      incidents,
      "error",
      props.incidentsState !== "unavailable" && props.incidentsState !== "forbidden",
    ),
    tile("pipelines", t("overview.cards.pipelineErrors"), pipelines, "error", pipelines.ok),
    tile("quiet", t("overview.cards.quietStreams"), quiet, "warning", quiet.ok),
  ];
});
</script>
