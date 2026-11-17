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
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-test="autoobserve-unfold">
    <slot name="header" />
    <div :class="legendRow.row">
      <span :class="legendRow.hint" data-test="autoobserve-unfold-hint">{{
        hint ?? t("autoobserve.unfold.hint")
      }}</span>
      <span v-if="note" class="text-text-secondary text-xs" data-test="autoobserve-unfold-note">{{
        note
      }}</span>
      <ul ref="legendList" :class="legendRow.list" :aria-label="t('autoobserve.unfold.legend')">
        <template v-if="legend">
          <li
            v-for="item in legend.slice(0, legendShown)"
            :key="item.key"
            class="text-text-secondary flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap"
            :data-test="`autoobserve-unfold-legend-${item.key}`"
          >
            <span v-if="item.tone" class="h-3 w-1 rounded-full" :class="TONE[item.tone].bar" />
            <span
              v-else
              class="border-text-secondary w-5 border-t"
              :class="item.line === 'dashed' ? 'border-dashed' : ''"
            />
            <span>{{ item.label }}</span>
            <OTooltip v-if="item.tooltip" :content="item.tooltip" />
          </li>
          <li
            v-if="legendMore"
            class="text-text-secondary shrink-0 text-xs"
            data-test="autoobserve-unfold-legend-more"
          >
            {{ legendMore.label }}<OTooltip :content="legendMore.names" />
          </li>
        </template>
        <template v-else>
          <li
            v-for="item in kindLegend"
            :key="item.kind"
            class="text-text-secondary flex items-center gap-1 text-xs"
          >
            <OIcon :name="item.icon" size="xs" />
            <span>{{ t(item.key) }}</span>
          </li>
        </template>
      </ul>
    </div>

    <div ref="scroller" :class="[canvasClass, scrollCue ? 'flex' : '']" @scroll="updateCue">
      <div
        class="relative min-w-full"
        :class="scrollCue ? 'shrink-0 rtl:-scale-x-100' : ''"
        :style="{ width: rem(layout.width), height: rem(layout.height) }"
      >
        <div
          v-for="(_, i) in layout.lanes.slice(1)"
          :key="i"
          class="border-border-default absolute inset-x-0 border-t border-dashed"
          :style="{ top: rem(layout.laneTops[i + 1]) }"
        />
        <svg
          class="absolute inset-y-0 start-0"
          :style="{ width: rem(layout.width) }"
          :viewBox="`0 0 ${layout.width} ${layout.height}`"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            v-for="edge in layout.edges"
            :key="edge.id"
            :d="edge.d"
            :data-test="`autoobserve-unfold-edge-${edge.id}`"
            fill="none"
            stroke="currentColor"
            :stroke-width="(edge.active ? 2 : 1.5) - (compact ? 0.5 : 0)"
            :stroke-dasharray="edge.dashed ? '5 4' : undefined"
            vector-effect="non-scaling-stroke"
            :class="edge.active ? 'text-accent' : 'text-text-secondary'"
          />
          <circle
            v-for="edge in layout.edges"
            :key="`${edge.id}-end`"
            :cx="edge.end.x"
            :cy="edge.end.y"
            r="0.2"
            fill="currentColor"
            :class="edge.active ? 'text-accent' : 'text-text-secondary'"
          />
        </svg>

        <span
          v-for="(lane, i) in layout.lanes"
          :key="lane ?? 'team'"
          :class="[laneLabelClass, unmirror]"
          :style="{
            left: rem(layout.laneLeft[i] ?? PAD_X),
            top: rem(layout.laneTops[i] + (compact ? 0.2 : 0.4)),
          }"
        >
          {{ lane ?? t("autoobserve.unfold.team") }}
        </span>

        <template v-if="compact">
          <span
            v-for="edge in layout.edges.filter((e) => e.label)"
            :key="`${edge.id}-label`"
            class="absolute -translate-1/2 rounded-full px-1 text-xs leading-tight whitespace-nowrap"
            :class="[edge.active ? 'text-accent' : 'text-text-secondary', unmirror, canvasBg]"
            :style="{ left: rem(edge.mid.x), top: rem(edge.mid.y) }"
          >
            {{ edge.label }}
          </span>
        </template>
        <template v-else>
          <span
            v-for="edge in layout.edges.filter((e) => e.label)"
            :key="`${edge.id}-label`"
            class="bg-surface-base border-border-subtle text-text-secondary absolute max-w-18 -translate-1/2 rounded-full border px-1.5 text-center text-xs leading-tight"
            :class="[
              edge.active ? 'text-accent border-accent' : '',
              routeAround || liveIssue ? 'max-w-none whitespace-nowrap' : '',
              unmirror,
            ]"
            :style="{ left: rem(edge.mid.x), top: rem(edge.mid.y) }"
          >
            {{ edge.label }}
          </span>
        </template>

        <template v-for="node in layout.nodes" :key="node.card.id">
          <button
            v-if="compact"
            :ref="(el) => measure(node.card.id, el)"
            type="button"
            class="bg-surface-base rounded-surface focus-visible:outline-accent absolute flex flex-col gap-1 overflow-hidden border py-2 ps-3 pe-2 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            :class="[
              DASHED.includes(node.card.kind) ? 'border-dashed' : '',
              node.card.id === selectedId
                ? 'border-accent ring-accent/25 ring-2'
                : 'border-border-default hover:border-border-strong',
              unmirror,
            ]"
            :style="{ left: rem(node.x), top: rem(node.y), width: rem(cardW) }"
            :aria-pressed="node.card.id === selectedId"
            :data-test="`autoobserve-unfold-card-${node.card.id}`"
            @click="select(node.card.id)"
          >
            <span class="absolute inset-y-0 start-0 w-0.75" :class="TONE[node.card.tone].bar" />
            <span
              class="text-text-heading line-clamp-2 text-sm leading-4 font-semibold break-words"
              :data-test="`autoobserve-unfold-title-${node.card.id}`"
              ><template v-for="(part, i) in identifierBreaks(String(node.card.title))" :key="i"
                ><wbr v-if="i" />{{ part }}</template
              ><OTooltip :content="node.card.title"
            /></span>
            <span
              class="text-text-secondary flex w-full min-w-0 items-center gap-1.5 text-xs leading-4"
            >
              <span class="truncate tabular-nums">{{
                node.card.until ? `${node.card.at} → ${node.card.until}` : node.card.at
              }}</span>
              <span
                v-if="node.card.tag"
                class="rounded-default inline-flex shrink-0 items-center gap-0.5 px-1 font-medium"
                :class="
                  node.card.tone === 'danger'
                    ? 'bg-status-error-bg text-status-error-text'
                    : 'bg-accent/12 text-accent'
                "
                :data-test="`autoobserve-unfold-tag-${node.card.id}`"
                ><OIcon name="flag" size="xs" aria-hidden="true" />{{ t(node.card.tag) }}</span
              >
            </span>
            <span
              v-if="node.card.strip"
              class="bg-border-subtle flex h-0.5 w-full shrink-0 overflow-hidden rounded-full"
              :data-test="`autoobserve-unfold-strip-${node.card.id}`"
              aria-hidden="true"
            >
              <span
                v-for="(firings, i) in node.card.strip"
                :key="i"
                class="flex-1"
                :class="firings ? TONE[node.card.tone].bar : ''"
              />
            </span>
            <span class="flex w-full min-w-0 items-center gap-1 text-xs leading-4">
              <span
                v-if="node.card.count"
                class="text-text-heading shrink-0 font-semibold tabular-nums"
                >{{
                  t("autoobserve.unfold.times", {
                    count: node.card.count.toLocaleString(intlLocale),
                  })
                }}</span
              >
              <OTruncatedText v-else class="text-text-secondary min-w-0 flex-1">{{
                node.card.detail
              }}</OTruncatedText>
              <span
                v-if="node.card.live"
                class="ms-auto inline-flex shrink-0 items-center gap-1"
                :class="TONE[node.card.live.tone ?? 'neutral'].ink"
                :data-test="`autoobserve-unfold-live-${node.card.id}`"
                ><span
                  class="size-1.5 rounded-full"
                  :class="TONE[node.card.live.tone ?? 'neutral'].bar"
                  aria-hidden="true" />{{ node.card.live.label
                }}<OTooltip v-if="node.card.live.tooltip" :content="node.card.live.tooltip"
              /></span>
            </span>
          </button>
          <button
            v-else
            type="button"
            class="bg-surface-base rounded-surface focus-visible:outline-accent absolute flex flex-col gap-0.5 overflow-hidden border py-2 ps-3.5 pe-2.5 text-start shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            :class="[
              DASHED.includes(node.card.kind) ? 'border-dashed' : '',
              node.card.id === selectedId
                ? 'border-accent ring-accent ring-2'
                : 'border-border-default hover:border-border-strong',
              unmirror,
            ]"
            :style="{
              left: rem(node.x),
              top: rem(node.y),
              width: rem(cardW),
              height: rem(geometry.cardH),
            }"
            :aria-pressed="node.card.id === selectedId"
            :data-test="`autoobserve-unfold-card-${node.card.id}`"
            @click="select(node.card.id)"
          >
            <span class="absolute inset-y-0 start-0 w-1" :class="TONE[node.card.tone].bar" />
            <span class="text-text-secondary flex w-full items-center gap-1.5 text-xs">
              <OIcon :name="iconOf(node.card)" size="xs" :class="TONE[node.card.tone].ink" />
              <span class="truncate tabular-nums">{{ node.card.at }}</span>
              <span
                v-if="node.card.count"
                class="text-text-heading ms-auto font-semibold tabular-nums"
                >{{ t("autoobserve.unfold.times", { count: node.card.count }) }}</span
              >
              <span v-else-if="node.card.tag" class="text-accent ms-auto shrink-0 font-medium">{{
                t(node.card.tag)
              }}</span>
            </span>
            <span
              class="text-text-heading w-full text-sm font-medium"
              :class="teamOutcome(node.card) ? 'line-clamp-2' : 'truncate'"
              >{{ node.card.title }}</span
            >
            <span
              v-if="node.card.strip"
              class="bg-border-subtle flex h-1 w-full shrink-0 overflow-hidden rounded-full"
              :data-test="`autoobserve-unfold-strip-${node.card.id}`"
              aria-hidden="true"
            >
              <span
                v-for="(firings, i) in node.card.strip"
                :key="i"
                class="flex-1"
                :class="firings ? TONE[node.card.tone].bar : ''"
              />
            </span>
            <span class="text-text-body w-full truncate text-xs">{{
              node.card.peak ?? node.card.detail
            }}</span>
            <span
              v-if="!teamOutcome(node.card)"
              class="text-text-secondary w-full truncate text-xs"
              >{{ laneName(node.card.lane) }}</span
            >
          </button>
        </template>
      </div>
      <div
        v-if="scrollCue && moreLater"
        class="pointer-events-none sticky end-0 -ms-24 flex w-24 shrink-0 items-center justify-end bg-linear-to-l to-transparent pe-3 rtl:bg-linear-to-r"
        :class="compact ? 'from-surface-base' : 'from-surface-subtle'"
        data-test="autoobserve-unfold-later"
      >
        <OButton
          variant="outline"
          size="xs"
          class="pointer-events-auto"
          data-test="autoobserve-unfold-later-btn"
          @click="scrollLater"
          >{{ t("autoobserve.unfold.later") }}</OButton
        >
      </div>
    </div>

    <OCard
      v-if="selected && !panelKinds?.includes(selected.kind)"
      variant="glass"
      class="shrink-0"
      data-test="autoobserve-unfold-detail"
    >
      <OCardSection role="header" dense>
        <OIcon :name="iconOf(selected)" size="sm" :class="TONE[selected.tone].ink" />
        <OText variant="panel-title">{{ selected.title }}</OText>
        <OTag v-if="selected.tag" variant="primary-soft" size="sm" :label="t(selected.tag)" />
        <span class="text-text-secondary ms-auto text-xs">{{ laneName(selected.lane) }}</span>
      </OCardSection>
      <OCardSection role="body" dense class="flex items-start gap-6 max-md:flex-col">
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <p
            v-if="!selected.count && !selected.facts && selected.detail"
            class="text-text-body text-sm"
          >
            {{ selected.detail }}
          </p>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            <div v-for="fact in facts" :key="fact.key" class="flex min-w-0 flex-col">
              <dt class="text-text-secondary text-xs font-medium">{{ fact.label }}</dt>
              <dd class="text-text-heading truncate text-sm tabular-nums">{{ fact.value }}</dd>
            </div>
          </dl>
          <div v-if="selected.times?.length" class="flex flex-wrap items-center gap-1.5">
            <span class="text-text-secondary me-1 text-xs font-medium">{{
              t("autoobserve.unfold.firedAt")
            }}</span>
            <OTag
              v-for="(at, i) in selected.times"
              :key="i"
              variant="default-soft"
              size="sm"
              :label="raw(at)"
            />
          </div>
          <div v-if="selected.folded" class="flex flex-col items-start gap-2">
            <ul
              class="flex w-full max-w-120 flex-col gap-1"
              :aria-label="t('autoobserve.unfold.foldedAlerts')"
            >
              <li
                v-for="item in selected.folded"
                :key="item.id"
                class="flex min-w-0 items-center gap-2 text-sm"
              >
                <span class="text-text-secondary shrink-0 text-xs tabular-nums">{{ item.at }}</span>
                <OTruncatedText class="text-text-heading min-w-0">{{ item.title }}</OTruncatedText>
                <span
                  v-if="item.count > 1"
                  class="text-text-secondary ms-auto shrink-0 text-xs tabular-nums"
                  >{{
                    t("autoobserve.unfold.times", { count: item.count.toLocaleString(intlLocale) })
                  }}</span
                >
              </li>
            </ul>
            <OButton
              v-if="selected.lane !== null"
              variant="outline"
              size="sm"
              data-test="autoobserve-unfold-expand-lane"
              @click="emit('expand-lane', selected.expandKey ?? selected.lane)"
            >
              {{ selected.expandLabel ?? t("autoobserve.unfold.expandLane") }}
            </OButton>
          </div>
        </div>
        <div v-if="slots.chart" class="flex w-full shrink-0 flex-col gap-1 md:w-96">
          <slot name="chart" :card="selected" />
        </div>
        <div v-else-if="selected.points" class="flex w-full shrink-0 flex-col gap-1 md:w-64">
          <OSparkline
            :points="sparkPoints(selected)"
            :shape="selected.projected ? 'bar' : 'area'"
            size="sm"
            :tone="selected.projected ? 'warning' : 'danger'"
            :aria-label="selected.title"
          />
          <span class="text-text-secondary text-xs">{{ t("autoobserve.unfold.chartNote") }}</span>
        </div>
      </OCardSection>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { getIntlLocale } from "@/locales";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { identifierBreaks } from "@/utils/formatters";
import type {
  UnfoldCard,
  UnfoldKind,
  UnfoldLegendItem,
  UnfoldOutcome,
  UnfoldTone,
} from "./unfold.types";

interface Point {
  x: number;
  y: number;
}

interface PlacedCard {
  card: UnfoldCard;
  col: number;
  row: number;
  x: number;
  y: number;
  h: number;
  parent?: PlacedCard;
}

const props = defineProps<{
  cards: UnfoldCard[];
  focusId?: string;
  note?: I18nText | null;
  hint?: I18nText | null;
  legend?: UnfoldLegendItem[];
  /** A live AutoObserve issue: same-minute cards stack unlinked, links between lanes turn in a wider gap, the legend keys what is drawn. */
  liveIssue?: boolean;
  /** Cards in other lanes starting within this many minutes share a column; none joins your team's column. */
  columnMinutes?: number;
  /** Links travel along a free lane and turn in a column gap, so none crosses a card. */
  routeAround?: boolean;
  /** Cues cards past the inline end, so a reader knows to scroll; an RTL layout mirrors the timeline. */
  scrollCue?: boolean;
  /** Name-first cards sized to their content, each with its alert's live state. */
  compact?: boolean;
  /** Each column starts this many rem after the previous one, unless that lane is still taken. */
  step?: number;
  /** The page owns the selection when set; null selects nothing. */
  selection?: string | null;
  /** Cards of these kinds open the page's own panel, so they get no detail card. */
  panelKinds?: UnfoldKind[];
}>();

const emit = defineEmits<{ "expand-lane": [lane: string]; "update:selection": [id: string] }>();

defineSlots<{ header?(): unknown; chart?(props: { card: UnfoldCard }): unknown }>();

const slots = useSlots();
const { t } = useI18nTyped();
const intlLocale = computed(() => getIntlLocale());

// Layout units are rem, so the SVG viewBox and the HTML cards share one coordinate space.
const CARD_W = 11;
const COMPACT_CARD_W = 14;
const STEPPED_CARD_W = 13;
const COL_GAP = 3.75;
const LIVE_COL_GAP = 5.5;
// Cross-lane links turn this close to a card edge, clear of the gap labels centred in the gap.
const TURN_INSET = 0.6;
// Stepped cards in one lane sit closer, so a lane's later card still fits beside the open panel.
const STEPPED_LANE_GAP = 2.25;
const PAD_X = 1;
// Estimates in rem, used only until a compact card's own height is measured.
const COMPACT_BASE_H = 3.5;
const NAME_LINE_H = 1;
const STRIP_H = 0.5;
const NAME_CHAR_W = 0.5;
// The "+N" legend item's reserved width in rem, and the root font size when the page reports none.
const LEGEND_MORE_W = 2.5;
const ROOT_FONT = 16;
// A stepped link leaves its source this far in from the start edge.
const ELBOW_X = 1.75;

const DASHED: UnfoldKind[] = ["change", "unwatched", "forecast", "fold"];

const KIND_ICON: Record<Exclude<UnfoldKind, "outcome">, IconName> = {
  metric: "show-chart",
  log: "article",
  trace: "account-tree",
  change: "tune",
  unwatched: "visibility-off",
  forecast: "trending-up",
  alert: "notifications",
  fold: "unfold-more",
};

const OUTCOME_ICON: Record<UnfoldOutcome, IconName> = {
  paged: "notifications-active",
  asked: "help-outline",
  notified: "send",
  held: "schedule",
  fixFailed: "error-outline",
  fixed: "check-circle",
  resolved: "check-circle",
  open: "hourglass-empty",
  acknowledged: "check",
};

const LEGEND: { kind: Exclude<UnfoldKind, "outcome">; key: I18nKey }[] = [
  { kind: "metric", key: "autoobserve.unfold.kind.metric" },
  { kind: "log", key: "autoobserve.unfold.kind.log" },
  { kind: "trace", key: "autoobserve.unfold.kind.trace" },
  { kind: "change", key: "autoobserve.unfold.kind.change" },
];

const TONE: Record<UnfoldTone, { bar: string; ink: string }> = {
  danger: { bar: "bg-status-error-text", ink: "text-status-error-text" },
  warning: { bar: "bg-status-warning-text", ink: "text-status-warning-text" },
  info: { bar: "bg-accent", ink: "text-accent" },
  success: { bar: "bg-status-positive", ink: "text-status-positive" },
  neutral: { bar: "bg-border-strong", ink: "text-text-secondary" },
  team: { bar: "bg-section-accent-secondary", ink: "text-section-accent-secondary" },
};

// Only kinds on a live issue's graph get a legend entry, so a lane we have no feed for is never implied.
const kindLegend = computed<{ kind: string; key: I18nKey; icon: IconName }[]>(() => {
  const kinds = LEGEND.map((item) => ({ ...item, icon: KIND_ICON[item.kind] }));
  if (!props.liveIssue) return kinds;
  return [
    ...kinds.filter((item) => props.cards.some((c) => c.kind === item.kind)),
    ...[
      ...new Set(props.cards.flatMap((c) => (c.kind === "outcome" ? [c.outcome ?? "open"] : []))),
    ].map((outcome) => ({
      kind: `outcome-${outcome}`,
      key: `autoobserve.issueLive.unfold.outcome.${outcome}` as I18nKey,
      icon: OUTCOME_ICON[outcome],
    })),
  ];
});

const geometry = computed(() =>
  props.compact
    ? { cardH: COMPACT_BASE_H + NAME_LINE_H, laneLabel: 1.25, laneH: 0, laneGap: 0.25 }
    : { cardH: 6, laneLabel: 1.75, laneH: 1.75 + 6 + 0.75, laneGap: 0.75 },
);
const cardW = computed(() =>
  props.step !== undefined ? STEPPED_CARD_W : props.compact ? COMPACT_CARD_W : CARD_W,
);
const colGap = computed(() => (props.liveIssue ? LIVE_COL_GAP : COL_GAP));

const rem = (n: number) => `${n}rem`;

// Forecast points render muted, so a projection never reads as a measurement.
const sparkPoints = ({ points = [], projected }: UnfoldCard) => {
  const from = points.length - (projected ?? 0);
  return projected ? points.map((value, i) => ({ value, provisional: i >= from })) : points;
};
const canvasBg = computed(() => (props.compact ? "bg-surface-base" : "bg-surface-subtle"));
const canvasClass = computed(
  () =>
    `border-border-default ${canvasBg.value} rounded-surface shrink-0 overflow-x-auto border bg-[radial-gradient(var(--color-border-default)_0.0625rem,transparent_0.0625rem)] bg-size-[1.25rem_1.25rem] bg-local`,
);
const laneLabelClass = computed(
  () => `text-text-body ${canvasBg.value} rounded-default absolute px-1 text-xs font-medium`,
);

// The compact header keeps hint and legend on one row, so an opening panel moves nothing below it.
const legendRow = computed(() =>
  props.compact
    ? {
        row: "flex items-center gap-x-4",
        hint: "text-text-secondary shrink-0 text-xs max-md:shrink",
        list: "ms-auto flex min-w-0 flex-1 items-center justify-end gap-x-3 overflow-hidden",
      }
    : {
        row: "flex flex-wrap items-center gap-x-4 gap-y-2",
        hint: "text-text-secondary text-xs",
        list: "ms-auto flex flex-wrap items-center gap-x-3 gap-y-1",
      },
);

// Legend items past the row's width fold into "+N": every item renders once to be measured.
const legendList = ref<HTMLElement | null>(null);
const legendShown = ref(Infinity);
const fitLegend = async () => {
  if (!props.compact || !props.legend) return;
  legendShown.value = Infinity;
  await nextTick();
  const list = legendList.value;
  if (!list) return;
  const room = list.clientWidth;
  const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
  const widths = Array.from(list.children, (li) => (li as HTMLElement).offsetWidth);
  if (widths.reduce((sum, w) => sum + w + gap, -gap) <= room) return;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || ROOT_FONT;
  let used = LEGEND_MORE_W * root;
  let shown = 0;
  while (shown < widths.length && used + gap + widths[shown] <= room) {
    used += gap + widths[shown];
    shown += 1;
  }
  legendShown.value = shown;
};
const legendMore = computed(() => {
  const hidden = props.legend?.slice(legendShown.value) ?? [];
  if (!hidden.length) return undefined;
  const names = hidden.map((item) => String(item.label));
  return {
    label: t("autoobserve.unfold.legendMore", {
      count: hidden.length.toLocaleString(intlLocale.value),
    }),
    names: raw(new Intl.ListFormat(intlLocale.value, { type: "conjunction" }).format(names)),
  };
});
watch(() => props.legend?.map((item) => item.key).join(), fitLegend);

// Compact cards grow with their name; the measured height wins once the card has rendered.
const heights = ref<Record<string, number>>({});
const estimatedH = (card: UnfoldCard) => {
  const perLine = Math.floor((cardW.value - 1.25) / NAME_CHAR_W);
  const lines = String(card.title).length > perLine ? 2 : 1;
  return COMPACT_BASE_H + lines * NAME_LINE_H + (card.strip ? STRIP_H : 0);
};
const heightOf = (card: UnfoldCard) =>
  props.compact ? (heights.value[card.id] ?? estimatedH(card)) : geometry.value.cardH;

let cardObserver: ResizeObserver | null = null;
const cardIds = new Map<Element, string>();
const readHeights = (entries: ResizeObserverEntry[]) => {
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const next = { ...heights.value };
  let changed = false;
  for (const entry of entries) {
    const id = cardIds.get(entry.target);
    const h = (entry.target as HTMLElement).offsetHeight / remPx;
    if (!id || !h || Math.abs((next[id] ?? 0) - h) < 0.01) continue;
    next[id] = h;
    changed = true;
  }
  if (changed) heights.value = next;
};
const measure = (id: string, el: unknown) => {
  if (!(el instanceof HTMLElement) || typeof ResizeObserver === "undefined") return;
  if (cardIds.get(el) === id) return;
  cardIds.set(el, id);
  cardObserver ??= new ResizeObserver(readHeights);
  cardObserver.observe(el);
};
// A card that left the graph is no longer observed, and its height is dropped.
watch(
  () => props.cards.map((card) => card.id).join(),
  () => {
    const shown = new Set(props.cards.map((card) => card.id));
    for (const [el, id] of cardIds) {
      if (shown.has(id) && el.isConnected) continue;
      cardObserver?.unobserve(el);
      cardIds.delete(el);
    }
    const kept = Object.entries(heights.value).filter(([id]) => shown.has(id));
    if (kept.length !== Object.keys(heights.value).length) heights.value = Object.fromEntries(kept);
  },
  { flush: "post" },
);
// The cued canvas mirrors in RTL so time runs toward the inline end; text inside flips back.
const unmirror = computed(() => (props.scrollCue ? "rtl:-scale-x-100" : ""));

const iconOf = (card: UnfoldCard): IconName =>
  card.kind === "outcome" ? OUTCOME_ICON[card.outcome ?? "open"] : KIND_ICON[card.kind];

// A live issue's outcome in a stream's lane reads like its other cards; your team's keeps two title lines.
const teamOutcome = (card: UnfoldCard) =>
  card.kind === "outcome" && !(props.liveIssue && card.lane !== null);

const laneName = (lane: string | null) =>
  lane === null ? t("autoobserve.unfold.team") : raw(lane);

// The parent is the card named in `after`, else the latest card in the same lane, else the one before.
const parentOf = (card: UnfoldCard, placed: PlacedCard[]) => {
  if (card.after) return placed.find((p) => p.card.id === card.after);
  const sameLane = placed.filter((p) => p.card.lane === card.lane);
  return sameLane[sameLane.length - 1] ?? placed[placed.length - 1];
};

const gapLabel = (from: UnfoldCard, to: UnfoldCard): I18nText | undefined => {
  if (to.via) return to.via;
  if (from.minute === null || to.minute === null || to.minute < from.minute) return undefined;
  const gap = to.minute - from.minute;
  if (gap === 0) return t("autoobserve.unfold.sameMinute");
  if (gap < 60) return t("autoobserve.unfold.plusMinutes", { count: gap });
  if (!props.compact || gap < 24 * 60) {
    const key = props.liveIssue
      ? "autoobserve.issueLive.unfold.plusHours"
      : "autoobserve.unfold.plusHours";
    return t(key, { hours: Math.floor(gap / 60), minutes: gap % 60 });
  }
  const hours = Math.floor(gap / 60);
  return t("autoobserve.unfold.plusDays", { days: Math.floor(hours / 24), hours: hours % 24 });
};

const lanesOf = (cards: UnfoldCard[]) => {
  const services = [...new Set(cards.filter((c) => c.lane !== null).map((c) => c.lane))];
  return cards.some((c) => c.lane === null) ? [...services, null] : services;
};

// With columnMinutes, a card joins the open column when it starts soon after it, in a free lane, and not after a card in it.
const joinsColumn = (card: UnfoldCard, column: PlacedCard[], placed: PlacedCard[]) => {
  const window = props.columnMinutes;
  const head = column[0]?.card;
  if (window === undefined || !head || card.kind === "outcome") return false;
  if (head.minute === null || card.minute === null || card.minute - head.minute > window)
    return false;
  if (column.some((p) => p.card.lane === card.lane || p.card.kind === "outcome")) return false;
  const after = card.after ? placed.find((p) => p.card.id === card.after) : undefined;
  return !column.some((p) => p === after);
};

// A card sharing a column links from its own predecessor, never from the card beside it.
const sharedParent = (card: UnfoldCard, placed: PlacedCard[], col: number) => {
  if (card.after) return placed.find((p) => p.card.id === card.after);
  const earlier = placed.filter((p) => p.col < col);
  const sameLane = earlier.filter((p) => p.card.lane === card.lane);
  return sameLane[sameLane.length - 1] ?? earlier[earlier.length - 1];
};

// Same-minute cards in different lanes share a column, and the first word to your team drops right under its signal.
const place = (cards: UnfoldCard[], lanes: (string | null)[], laneTops: number[]) => {
  const placed: PlacedCard[] = [];
  let col = -1;
  for (const card of cards) {
    const column = placed.filter((p) => p.col === col);
    const joins = joinsColumn(card, column, placed);
    const parent = joins ? sharedParent(card, placed, col) : parentOf(card, placed);
    const laneFree = !column.some((p) => p.card.lane === card.lane);
    const dropsBelow = card.kind === "outcome" && parent?.col === col && laneFree;
    // On a live issue a same-minute card in a free lane stacks under its parent instead of starting a staircase.
    const concurrent =
      joins ||
      (props.columnMinutes === undefined &&
        column.length > 0 &&
        card.kind !== "change" &&
        column[0].card.kind !== "change" &&
        column[0].card.minute === card.minute &&
        laneFree &&
        (parent?.col !== col || (!!props.liveIssue && parent?.card.minute === card.minute)));
    if (!dropsBelow && !concurrent) col += 1;
    const row = lanes.indexOf(card.lane);
    placed.push({
      card,
      col,
      row,
      x: PAD_X + col * (cardW.value + colGap.value),
      y: laneTops[row] + geometry.value.laneLabel,
      h: heightOf(card),
      // Live cards that happened together run side by side; a link between them would read as a sequence.
      parent:
        props.liveIssue && concurrent && !card.after && parent?.col === col ? undefined : parent,
    });
  }
  if (props.step !== undefined) stepColumns(placed, props.step);
  return placed;
};

// A stepped column starts `step` after the previous one, or later when its lane still holds a card.
const stepColumns = (placed: PlacedCard[], step: number) => {
  const rightInRow = new Map<number, number>();
  let x = PAD_X - step;
  const columns = Math.max(...placed.map((p) => p.col), -1) + 1;
  for (let col = 0; col < columns; col += 1) {
    const inCol = placed.filter((p) => p.col === col);
    x = Math.max(
      x + step,
      ...inCol.map((p) => (rightInRow.get(p.row) ?? -Infinity) + STEPPED_LANE_GAP),
    );
    for (const p of inCol) {
      p.x = x;
      rightInRow.set(p.row, x + cardW.value);
    }
  }
};

// Each lane is as tall as its tallest card.
const laneTopsOf = (cards: UnfoldCard[], lanes: (string | null)[]) => {
  const { laneLabel, laneH, laneGap } = geometry.value;
  const tops = [0];
  lanes.forEach((lane, i) => {
    const tallest = Math.max(0, ...cards.filter((c) => c.lane === lane).map(heightOf));
    tops.push(tops[i] + (props.compact ? laneLabel + tallest + laneGap : laneH));
  });
  return tops;
};

const selectedId = ref("");

const isFreeRow = (row: number, from: number, to: number, taken: Set<string>) => {
  for (let col = from + 1; col < to; col += 1) if (taken.has(`${row}:${col}`)) return false;
  return true;
};

// Runs along the source's lane when it is free up to the target, else along the target's lane, turning in a column gap.
const routedEdge = (from: PlacedCard, to: PlacedCard, taken: Set<string>) => {
  const start = { x: from.x + cardW.value, y: from.y + from.h / 2 };
  const end = { x: to.x, y: to.y + to.h / 2 };
  const lanes = Math.abs(to.row - from.row);
  const half = COL_GAP / 2;
  const alongSource =
    isFreeRow(from.row, from.col, to.col, taken) || !isFreeRow(to.row, from.col, to.col, taken);
  if (alongSource) {
    const turn = end.x - COL_GAP;
    const toward = Math.sign(end.y - start.y);
    const mid =
      lanes === 0
        ? { x: (start.x + end.x) / 2, y: start.y }
        : lanes === 1
          ? { x: end.x - half, y: (start.y + end.y) / 2 }
          : { x: end.x - half, y: end.y - toward * (to.h / 2 + 0.75) };
    return {
      d: `M${start.x},${start.y} L${turn},${start.y} C${turn + half},${start.y} ${end.x - half},${end.y} ${end.x},${end.y}`,
      end,
      mid,
    };
  }
  const turn = start.x + COL_GAP;
  return {
    d: `M${start.x},${start.y} C${start.x + half},${start.y} ${turn - half},${end.y} ${turn},${end.y} L${end.x},${end.y}`,
    end,
    mid:
      lanes >= 2 ? { x: end.x - half, y: end.y } : { x: start.x + half, y: (start.y + end.y) / 2 },
  };
};

// Under an overlapping card a link drops from its source's start edge, then turns into the target.
const elbowEdge = (from: PlacedCard, to: PlacedCard, laneTops: number[]) => {
  const below = to.row > from.row;
  const x = from.x + ELBOW_X;
  const startY = below ? from.y + from.h : from.y;
  const end = { x: to.x, y: to.y + to.h / 2 };
  const r = Math.min(0.5, Math.max(0, to.x - x));
  const turnY = end.y - (below ? r : -r);
  return {
    d: `M${x},${startY} L${x},${turnY} Q${x},${end.y} ${x + r},${end.y} L${end.x},${end.y}`,
    end,
    mid: { x, y: below ? laneTops[to.row] + geometry.value.laneLabel / 2 : (startY + end.y) / 2 },
  };
};

// A live issue's link between lanes turns beside the cards and crosses in the target lane's label strip, never under a card.
const crossPath = (
  from: PlacedCard,
  to: PlacedCard,
  start: Point,
  end: Point,
  laneTops: number[],
) => {
  const leave = from.x + cardW.value + TURN_INSET;
  const arrive = to.x - TURN_INSET;
  if (to.col <= from.col + 1) return `M${start.x},${start.y} H${leave} V${end.y} H${end.x}`;
  const strip = laneTops[to.row] + geometry.value.laneLabel / 2;
  return `M${start.x},${start.y} H${leave} V${strip} H${arrive} V${end.y} H${end.x}`;
};

// A link within one column runs down from the card above; every other link runs left to right.
const edgeOf = (from: PlacedCard, to: PlacedCard, taken: Set<string>, laneTops: number[]) => {
  const W = cardW.value;
  const down = from.col === to.col;
  const start = down
    ? { x: from.x + W / 2, y: from.y + from.h }
    : { x: from.x + W, y: from.y + from.h / 2 };
  const end = down ? { x: to.x + W / 2, y: to.y } : { x: to.x, y: to.y + to.h / 2 };
  const c1 = down
    ? { x: start.x, y: (start.y + end.y) / 2 }
    : { x: (start.x + end.x) / 2, y: start.y };
  const c2 = down ? { x: end.x, y: c1.y } : { x: c1.x, y: end.y };
  const stepped = props.step !== undefined && !down && to.row !== from.row && to.x < from.x + W;
  const across = !!props.liveIssue && !down && from.row !== to.row && to.col > from.col;
  const path = stepped
    ? elbowEdge(from, to, laneTops)
    : props.routeAround && !down
      ? routedEdge(from, to, taken)
      : {
          d: across
            ? crossPath(from, to, start, end, laneTops)
            : `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`,
          end,
          mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        };
  // A stepped lane's gap is narrower than its label, so the label sits on the lane's label row.
  if (props.step !== undefined && to.row === from.row) {
    path.mid = { x: path.mid.x, y: laneTops[to.row] + geometry.value.laneLabel / 2 };
  }
  return {
    id: `${from.card.id}>${to.card.id}`,
    ...path,
    // On a live issue only a link inside one lane has room for its gap; the cards' own times carry the rest.
    label:
      props.liveIssue && (down || from.row !== to.row) ? undefined : gapLabel(from.card, to.card),
    dashed: !!to.card.dependency || to.card.kind === "unwatched" || to.card.kind === "forecast",
    active: selectedId.value === to.card.id || selectedId.value === from.card.id,
  };
};

const layout = computed(() => {
  const lanes = lanesOf(props.cards);
  const laneTops = laneTopsOf(props.cards, lanes);
  const nodes = place(props.cards, lanes, laneTops);
  const columns = Math.max(...nodes.map((n) => n.col), 0) + 1;
  const taken = new Set(nodes.map((n) => `${n.row}:${n.col}`));
  const edges = nodes.flatMap((node) =>
    node.parent ? [edgeOf(node.parent, node, taken, laneTops)] : [],
  );
  const cue = props.scrollCue ? COL_GAP : 0;
  return {
    lanes,
    laneTops,
    // A stepped service lane names itself where its first card starts, clear of the links dropping
    // past; your team's lane is last, so it keeps the lane's start edge.
    laneLeft: lanes.map((lane, row) =>
      props.step === undefined || lane === null ? undefined : nodes.find((n) => n.row === row)?.x,
    ),
    nodes,
    edges,
    width:
      props.step === undefined
        ? PAD_X * 2 + columns * cardW.value + (columns - 1) * colGap.value + cue
        : Math.max(PAD_X, ...nodes.map((n) => n.x + cardW.value)) + PAD_X,
    height: laneTops[lanes.length],
  };
});

const heldSelection = (cards: UnfoldCard[], previous: UnfoldCard[] | undefined) => {
  const id = selectedId.value;
  if (cards.some((c) => c.id === id)) return id;
  const unfolded = previous?.find((c) => c.id === id)?.folded?.[0]?.id;
  return cards.find((c) => c.id === unfolded)?.id;
};

const select = (id: string) => {
  selectedId.value = id;
  emit("update:selection", id);
};

watch(
  () => props.selection,
  (id) => {
    if (id !== undefined) selectedId.value = id ?? "";
  },
  { immediate: true },
);

watch(
  [() => props.cards, () => props.focusId],
  ([cards, focusId], previous) => {
    if (props.selection !== undefined) {
      const held = heldSelection(cards, previous?.[0]) ?? "";
      if (held !== selectedId.value) select(held);
      return;
    }
    selectedId.value = cards.find((c) => c.id === focusId)?.id ?? cards[0]?.id ?? "";
  },
  { immediate: true },
);

// RTL scrollLeft runs from 0 to negative values (positive in older engines), so only its size counts.
const scroller = ref<HTMLElement | null>(null);
const moreLater = ref(false);
const updateCue = () => {
  const el = scroller.value;
  moreLater.value =
    !!props.scrollCue && !!el && Math.abs(el.scrollLeft) + el.clientWidth < el.scrollWidth - 1;
};
let resizeObserver: ResizeObserver | null = null;
let legendObserver: ResizeObserver | null = null;
onMounted(() => {
  void fitLegend();
  if (props.compact && legendList.value && typeof ResizeObserver !== "undefined") {
    legendObserver = new ResizeObserver(() => void fitLegend());
    legendObserver.observe(legendList.value);
  }
  if (!props.scrollCue || !scroller.value) return;
  updateCue();
  if (typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(updateCue);
  resizeObserver.observe(scroller.value);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  legendObserver?.disconnect();
  cardObserver?.disconnect();
});
// In a right-to-left layout later cards lie toward negative scrollLeft.
const scrollLater = () => {
  const el = scroller.value;
  if (!el) return;
  const rtl = getComputedStyle(el).direction === "rtl";
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  el.scrollBy({ left: el.clientWidth * 0.8 * (rtl ? -1 : 1), behavior: still ? "auto" : "smooth" });
};
watch(layout, () => void nextTick(updateCue));

onMounted(() => {
  if (!props.focusId) return;
  document
    .querySelector(`[data-test="autoobserve-unfold-card-${props.focusId}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "center" });
});

const selected = computed(() => props.cards.find((c) => c.id === selectedId.value));

const facts = computed(() => {
  const card = selected.value;
  if (!card) return [];
  if (card.facts) return card.facts;
  const rows: { key: string; label: I18nText; value: I18nText | undefined }[] = card.times
    ? [
        { key: "first", label: t("autoobserve.unfold.firstFired"), value: raw(card.times[0]) },
        {
          key: "last",
          label: t("autoobserve.unfold.lastFired"),
          value: raw(card.times[card.times.length - 1]),
        },
        {
          key: "count",
          label: t("autoobserve.unfold.firings"),
          value: raw(String(card.count ?? card.times.length)),
        },
        { key: "peak", label: t("autoobserve.unfold.peak"), value: card.peak },
        { key: "normal", label: t("autoobserve.unfold.normal"), value: card.threshold },
        { key: "detector", label: t("autoobserve.unfold.detector"), value: card.detail },
      ]
    : [{ key: "when", label: t("autoobserve.unfold.when"), value: raw(card.at) }];
  return rows.filter((r) => r.value);
});
</script>
