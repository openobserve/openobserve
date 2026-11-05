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
  <ul
    class="grid grid-cols-6 gap-3 max-xl:grid-cols-3 max-md:grid-cols-2"
    data-test="overview-headline-strip"
  >
    <li v-for="item in items" :key="item.key" class="flex min-w-0">
      <section
        :class="[
          'rounded-surface flex min-w-0 flex-1 flex-col border transition-colors motion-reduce:transition-none',
          SURFACE[item.cardTone ?? 'none'],
          item.selectable && !item.cardTone ? 'hover:border-border-strong' : '',
        ]"
        :data-test="`overview-tile-card-${item.key}`"
      >
        <!-- a tile without a list behind it is plain text, so it never looks clickable -->
        <component
          :is="item.selectable ? OButton : 'div'"
          v-bind="item.selectable ? { variant: 'cell' } : {}"
          class="flex flex-1 flex-col"
          :data-test="`overview-headline-${item.key}`"
          @click="item.selectable && emit('select', item.key)"
        >
          <span class="flex flex-1 flex-col gap-1 p-3 text-start">
            <span class="text-text-label text-xs">{{ item.label }}</span>
            <OSkeleton v-if="item.loading" class="h-9 w-16" data-test="overview-tile-skeleton" />
            <span v-else class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <span
                :class="['text-3xl font-bold tabular-nums', item.tone]"
                data-test="overview-tile-value"
                >{{ item.value }}</span
              >
              <span
                v-if="item.unit"
                class="text-text-secondary text-xs"
                data-test="overview-tile-unit"
                >{{ item.unit }}</span
              >
            </span>
            <!-- the note slot keeps two lines even when empty, so all six tiles share one rhythm -->
            <span class="mt-auto flex min-h-8 items-start gap-1 text-xs">
              <OIcon
                v-if="item.note && !item.loading && item.noteTone === 'positive'"
                name="check-circle"
                size="xs"
                class="text-status-success-text mt-0.5"
              />
              <span
                v-if="item.note && !item.loading"
                :class="NOTE_TONE[item.noteTone] ?? item.tone"
                data-test="overview-tile-note"
                >{{ item.note }}</span
              >
            </span>
          </span>
        </component>
      </section>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
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

export type OverviewTarget =
  "firing" | "failing" | "incidents" | "pipelines" | "delivery" | "quiet";
export type IncidentsTile = "ok" | "loading" | "error" | "locked" | "unavailable" | "forbidden";

type NoteTone = "positive" | "problem" | "plain";
type TileTone = "danger" | "warning";

interface Tile {
  value: string | number;
  unit?: I18nText;
  note?: I18nText;
  // a good-state note ("None firing") gets the success cue; a descriptive one stays plain
  positive?: boolean;
  ok: boolean;
  loading: boolean;
}

type TileDetail = Pick<Tile, "unit" | "note" | "positive">;

interface TileItem {
  key: OverviewTarget;
  label: I18nText;
  value: string | number;
  unit?: I18nText;
  note?: I18nText;
  noteTone: NoteTone;
  tone: string;
  cardTone?: TileTone;
  loading: boolean;
  selectable: boolean;
}

const TONE = {
  error: "text-status-negative",
  warning: "text-status-warning-text",
  zero: "text-text-heading",
  absent: "text-text-muted",
} as const;

// a tile with a problem takes a soft status surface so it reads before its number
const SURFACE: Record<TileTone | "none", string> = {
  none: "bg-surface-panel border-border-default",
  danger: "bg-status-error-bg border-status-negative",
  warning: "bg-status-warning-bg border-status-warning-text",
};

// a problem note takes its value's tone, so it is left out here and falls back to it
const NOTE_TONE: Partial<Record<NoteTone, string>> = {
  positive: "text-status-success-text",
  plain: "text-text-secondary",
};

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

const firingDetail = (count: number): TileDetail => {
  const alerts = props.overview?.alerts.data;
  if (count === 0) return { note: t("overview.cards.firingNone"), positive: true };
  const critical = levelCount(alerts, "critical");
  const oldest = oldestKnownFiring(alerts);
  return {
    unit: t("overview.cards.criticalUnit", { count: critical }),
    note: oldest
      ? t("overview.cards.oldestFiring", {
          age: formatElapsed(Date.now() - microsToMs(oldest.since)),
        })
      : undefined,
  };
};

// every alert tile reads "no rules" the same way
const alertTile = (tile: Tile, detail: (count: number) => TileDetail): Tile => {
  if (!tile.ok) return tile;
  const noRules = noRulesNote();
  if (noRules) return { ...tile, value: DASH, note: noRules };
  return { ...tile, ...detail(Number(tile.value)) };
};

const pipelinesTile = (): Tile => {
  const tile = sectionTile(props.overview?.pipelines, (d) => d.errored);
  const data = props.overview?.pipelines.data;
  if (!tile.ok || !data) return tile;
  if (data.total === 0) return { ...tile, value: DASH, note: t("overview.cards.noPipelines") };
  return {
    ...tile,
    note: t("overview.cards.pipelinesOf", { enabled: data.enabled }),
    positive: data.errored === 0,
  };
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
    positive: total === 0,
    ok,
    loading: false,
  };
};

const hasProblem = (tile: Tile) => tile.ok && Number(tile.value) > 0;

// a count above zero carries the tone, a zero is plain strong ink, and only an unknown dash is muted
const toneOf = (tile: Tile, tone: string): string => {
  if (hasProblem(tile)) return tone;
  return tile.ok && tile.value !== DASH ? TONE.zero : TONE.absent;
};

const noteToneOf = (tile: Tile): NoteTone => {
  if (hasProblem(tile)) return "problem";
  return tile.positive ? "positive" : "plain";
};

const items = computed<TileItem[]>(() => {
  const o = props.overview;
  const firing = alertTile(
    sectionTile(o?.alerts, (d) => firingCount(d)),
    firingDetail,
  );
  const failing = alertTile(
    sectionTile(o?.alerts, (d) => d.failed_evaluation),
    (count) => ({
      note: count > 0 ? t("overview.cards.failingNote") : t("overview.cards.failingNone"),
      positive: count === 0,
    }),
  );
  const delivery = alertTile(
    sectionTile(o?.alerts, (d) => d.by_state.notify_failed ?? 0),
    () => ({ note: t("overview.cards.deliveryNote") }),
  );
  const incidents = incidentsTile();
  const pipelines = pipelinesTile();
  const quiet = quietTile();
  const tile = (
    key: OverviewTarget,
    label: I18nText,
    data: Tile,
    tone: string,
    selectable: boolean,
  ): TileItem => ({
    key,
    label,
    value: data.value,
    unit: data.unit,
    note: data.note,
    noteTone: noteToneOf(data),
    loading: data.loading,
    tone: toneOf(data, tone),
    cardTone: hasProblem(data) ? (tone === TONE.warning ? "warning" : "danger") : undefined,
    selectable,
  });
  return [
    tile("firing", t("overview.cards.firingAlerts"), firing, TONE.error, firing.ok),
    tile("failing", t("overview.cards.failingRules"), failing, TONE.error, failing.ok),
    tile(
      "incidents",
      t("overview.cards.openIncidents"),
      incidents,
      TONE.error,
      props.incidentsState !== "unavailable" && props.incidentsState !== "forbidden",
    ),
    tile("pipelines", t("overview.cards.pipelineErrors"), pipelines, TONE.error, pipelines.ok),
    tile("delivery", t("overview.cards.deliveryFailures"), delivery, TONE.error, delivery.ok),
    tile("quiet", t("overview.cards.quietStreams"), quiet, TONE.warning, quiet.ok),
  ];
});
</script>
