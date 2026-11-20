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
  <div class="grid">
    <!-- the failed line overlays the hidden tiles, so a failure keeps the loading box and moves nothing -->
    <div
      v-if="failed"
      class="col-start-1 row-start-1 flex flex-wrap items-start gap-x-4 gap-y-2"
      data-test="overview-summary-failed"
    >
      <OButton
        v-if="deliveryFailures"
        variant="ghost"
        class="-ms-3"
        data-test="overview-failed-delivery"
        @click="emit('select', 'delivery')"
      >
        <span class="text-status-warning-text">{{
          t("overview.cards.deliveryCount", { count: deliveryFailures }, deliveryFailures)
        }}</span>
      </OButton>
      <div class="h-control-md flex min-w-0 items-center gap-2" data-test="overview-summary-error">
        <OIcon name="warning-amber" size="sm" class="text-status-error-text shrink-0" />
        <span class="text-compact">{{
          t(deliveryFailures ? "overview.summary.loadErrorRest" : "overview.summary.loadError")
        }}</span>
        <OButton size="sm" data-test="overview-summary-retry" @click="emit('retry')">
          {{ t("emptyState.loadError.action") }}
        </OButton>
      </div>
    </div>
    <ul
      :class="[
        'col-start-1 row-start-1 grid grid-cols-6 gap-x-6 gap-y-4 max-xl:grid-cols-3 max-md:grid-cols-2',
        failed && 'invisible',
      ]"
      :aria-hidden="failed || undefined"
      :inert="failed"
      data-test="overview-headline-strip"
    >
      <li
        v-for="item in items"
        :key="item.key"
        class="relative flex min-w-0 flex-col"
        :data-test="`overview-tile-card-${item.key}`"
      >
        <!-- the value opens its page; a tile without a page behind it stays plain text -->
        <component
          :is="item.selectable ? OButton : 'div'"
          v-bind="item.selectable ? { variant: 'ghost' } : {}"
          :class="[
            'min-w-0 self-start',
            item.selectable
              ? '-ms-3 max-w-[calc(100%+0.75rem)]'
              : 'h-control-md flex items-center gap-x-1.5',
          ]"
          :aria-describedby="`${uid}-${item.key}`"
          :data-test="`overview-headline-${item.key}`"
          @click="item.selectable && emit('select', item.key)"
        >
          <OSkeleton
            v-if="item.loading"
            shape="block"
            class="h-5 w-12"
            data-test="overview-tile-skeleton"
          />
          <template v-else>
            <span
              :class="['text-xl leading-7 font-semibold tabular-nums', item.tone]"
              data-test="overview-tile-value"
              >{{ item.value }}</span
            >
            <OTruncatedText
              v-if="item.unit"
              class="text-text-secondary min-w-0 text-xs font-normal"
              data-test="overview-tile-unit"
              >{{ item.unit }}</OTruncatedText
            >
          </template>
        </component>
        <span
          :id="`${uid}-${item.key}`"
          :class="['text-text-secondary text-xs leading-4', item.ask && askVisible ? 'pe-8' : '']"
          data-test="overview-tile-label"
          >{{ item.label }}</span
        >
        <!-- the note keeps two lines even when empty, so the six values share one rhythm -->
        <span class="mt-0.5 flex min-h-8 items-start gap-1 text-xs leading-4">
          <OIcon
            v-if="item.note && !item.loading && item.noteTone === 'positive'"
            name="check-circle"
            size="xs"
            class="text-status-success-text mt-0.5 shrink-0"
          />
          <span
            v-if="item.note && !item.loading"
            :class="NOTE_TONE[item.noteTone] ?? item.tone"
            data-test="overview-tile-note"
            >{{ item.note }}</span
          >
        </span>
        <OverviewAskAiButton
          v-if="item.ask"
          kind="tile"
          :item-key="item.key"
          :label="item.label"
          class="absolute end-0 top-0"
          @ask="emit('askAi', item.ask)"
        />
      </li>
      <!-- the sixth cell holds the strip's one load message; its height fits that message, so a failure never moves the page -->
      <li class="flex min-h-23 min-w-0 flex-col" data-test="overview-summary-aside">
        <slot name="aside" />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCompactCount } from "@/utils/formatters";
import type { IncidentsTile, OrgOverview, OverviewSection } from "@/ts/interfaces/overview";
import { sectionView } from "./overviewFormat";
import OverviewAskAiButton from "./OverviewAskAiButton.vue";
import type { OverviewAskAiTarget } from "./overviewAskAi";
import { useOverviewAskAi } from "./useOverviewAskAi";

export type OverviewTarget =
  "firing" | "failing" | "incidents" | "pipelines" | "delivery" | "quiet";

type NoteTone = "positive" | "problem" | "plain";

interface Tile {
  value: string | number;
  unit?: I18nText;
  note?: I18nText;
  // a good-state note ("None firing") gets the success cue; a descriptive one stays plain
  positive?: boolean;
  ok: boolean;
  loading: boolean;
  // refused or license-locked: there is no page to open, so the value is plain text
  blocked?: boolean;
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
  loading: boolean;
  selectable: boolean;
  ask?: OverviewAskAiTarget;
}

const TONE = {
  error: "text-status-negative",
  warning: "text-status-warning-text",
  zero: "text-text-heading",
  absent: "text-text-muted",
} as const;

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
  /** Delivery failures counted from the alert list; null when that list is unknown too. */
  deliveryFailures?: number | null;
}>();

const emit = defineEmits<{
  select: [target: OverviewTarget];
  retry: [];
  askAi: [target: OverviewAskAiTarget];
}>();

const { t } = useI18nTyped();
const uid = useId();
const { visible: askVisible } = useOverviewAskAi();

const DASH = raw("—");

// a failed request is said once in the strip's last cell, so only a section's own refusal gets a note
const unavailableNote = (view: ReturnType<typeof sectionView>): I18nText | undefined => {
  if (props.failed) return undefined;
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
    return {
      value: DASH,
      note: unavailableNote(view),
      ok: false,
      loading: view === "loading",
      blocked: view === "forbidden" || view === "locked",
    };
  return { value: pick(section.data), ok: true, loading: false };
};

// a zero with no rules behind it would read as reassurance, so the value is a dash and the note says why
const noRulesNote = (): I18nText | undefined => {
  const alerts = props.overview?.alerts.data;
  if (!alerts || alerts.enabled > 0) return undefined;
  return alerts.total > 0 ? t("overview.cards.noEnabledRules") : t("overview.cards.noAlertRules");
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
    value: typeof data.value === "number" ? raw(formatCompactCount(data.value)) : data.value,
    unit: data.unit,
    note: data.note,
    noteTone: noteToneOf(data),
    loading: data.loading,
    tone: toneOf(data, tone),
    selectable,
    ask: hasProblem(data) ? { kind: "count", topic: key, count: Number(data.value) } : undefined,
  });
  // firing has its own band above the strip; red is kept for incidents and dropped data (R9)
  const all: TileItem[] = [
    tile("failing", t("overview.cards.failingRules"), failing, TONE.warning, !failing.blocked),
    tile(
      "incidents",
      t("overview.cards.openIncidents"),
      incidents,
      TONE.error,
      props.incidentsState !== "unavailable" && props.incidentsState !== "forbidden",
    ),
    tile(
      "pipelines",
      t("overview.cards.pipelineErrors"),
      pipelines,
      TONE.error,
      !pipelines.blocked,
    ),
    tile(
      "delivery",
      t("overview.cards.deliveryFailures"),
      delivery,
      TONE.warning,
      !delivery.blocked,
    ),
    tile("quiet", t("overview.cards.quietStreams"), quiet, TONE.warning, !quiet.blocked),
  ];
  return all.filter((i) => !(i.key === "incidents" && props.incidentsState === "unavailable"));
});
</script>
