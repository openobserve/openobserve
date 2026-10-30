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
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="text-text-secondary text-xs">{{ t("autoobserve.unfold.hint") }}</span>
      <ul
        class="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1"
        :aria-label="t('autoobserve.unfold.legend')"
      >
        <li
          v-for="item in LEGEND"
          :key="item.kind"
          class="text-text-secondary flex items-center gap-1 text-xs"
        >
          <OIcon :name="KIND_ICON[item.kind]" size="xs" />
          <span>{{ t(item.key) }}</span>
        </li>
      </ul>
    </div>

    <div
      class="border-border-default bg-surface-subtle rounded-surface shrink-0 overflow-x-auto border bg-[radial-gradient(var(--color-border-default)_0.0625rem,transparent_0.0625rem)] bg-size-[1.25rem_1.25rem] bg-local"
    >
      <div
        class="relative min-w-full"
        :style="{ width: rem(layout.width), height: rem(layout.height) }"
      >
        <div
          v-for="(_, i) in layout.lanes.slice(1)"
          :key="i"
          class="border-border-default absolute inset-x-0 border-t border-dashed"
          :style="{ top: rem(laneTop(i + 1)) }"
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
            fill="none"
            stroke="currentColor"
            :stroke-width="edge.active ? 2 : 1.5"
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
          class="text-text-body bg-surface-subtle rounded-default absolute px-1 text-xs font-medium"
          :style="{ left: rem(PAD_X), top: rem(laneTop(i) + 0.4) }"
        >
          {{ lane ?? t("autoobserve.unfold.team") }}
        </span>

        <span
          v-for="edge in layout.edges.filter((e) => e.label)"
          :key="`${edge.id}-label`"
          class="bg-surface-base border-border-subtle text-text-secondary absolute max-w-18 -translate-1/2 rounded-full border px-1.5 text-center text-xs leading-tight"
          :class="edge.active ? 'text-accent border-accent' : ''"
          :style="{ left: rem(edge.mid.x), top: rem(edge.mid.y) }"
        >
          {{ edge.label }}
        </span>

        <button
          v-for="node in layout.nodes"
          :key="node.card.id"
          type="button"
          class="bg-surface-base rounded-surface focus-visible:outline-accent absolute flex flex-col gap-0.5 overflow-hidden border py-2 ps-3.5 pe-2.5 text-start shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="[
            DASHED.includes(node.card.kind) ? 'border-dashed' : '',
            node.card.id === selectedId
              ? 'border-accent ring-accent ring-2'
              : 'border-border-default hover:border-border-strong',
          ]"
          :style="{
            left: rem(node.x),
            top: rem(node.y),
            width: rem(CARD_W),
            height: rem(CARD_H),
          }"
          :aria-pressed="node.card.id === selectedId"
          :data-test="`autoobserve-unfold-card-${node.card.id}`"
          @click="selectedId = node.card.id"
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
            :class="node.card.kind === 'outcome' ? 'line-clamp-2' : 'truncate'"
            >{{ node.card.title }}</span
          >
          <span class="text-text-body w-full truncate text-xs">{{
            node.card.peak ?? node.card.detail
          }}</span>
          <span
            v-if="node.card.kind !== 'outcome'"
            class="text-text-secondary w-full truncate text-xs"
            >{{ laneName(node.card.lane) }}</span
          >
        </button>
      </div>
    </div>

    <OCard v-if="selected" variant="glass" class="shrink-0" data-test="autoobserve-unfold-detail">
      <OCardSection role="header" dense>
        <OIcon :name="iconOf(selected)" size="sm" :class="TONE[selected.tone].ink" />
        <OText variant="panel-title">{{ selected.title }}</OText>
        <OTag v-if="selected.tag" variant="primary-soft" size="sm" :label="t(selected.tag)" />
        <span class="text-text-secondary ms-auto text-xs">{{ laneName(selected.lane) }}</span>
      </OCardSection>
      <OCardSection role="body" dense class="flex items-start gap-6 max-md:flex-col">
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <p v-if="!selected.count && selected.detail" class="text-text-body text-sm">
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
        </div>
        <div v-if="selected.points" class="flex w-full shrink-0 flex-col gap-1 md:w-64">
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
import { computed, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import {
  sparkPoints,
  type UnfoldCard,
  type UnfoldKind,
  type UnfoldOutcome,
  type UnfoldTone,
} from "./fixtures";

interface PlacedCard {
  card: UnfoldCard;
  col: number;
  row: number;
  x: number;
  y: number;
  parent?: PlacedCard;
}

const props = defineProps<{ cards: UnfoldCard[]; focusId?: string }>();

const { t } = useI18nTyped();

// Layout units are rem, so the SVG viewBox and the HTML cards share one coordinate space.
const CARD_W = 11;
const CARD_H = 6;
const COL_GAP = 3.75;
const LANE_LABEL = 1.75;
const LANE_H = LANE_LABEL + CARD_H + 0.75;
const PAD_X = 1;

const DASHED: UnfoldKind[] = ["change", "unwatched", "forecast"];

const KIND_ICON: Record<Exclude<UnfoldKind, "outcome">, IconName> = {
  metric: "show-chart",
  log: "article",
  trace: "account-tree",
  change: "tune",
  unwatched: "visibility-off",
  forecast: "trending-up",
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
};

const rem = (n: number) => `${n}rem`;
const laneTop = (row: number) => row * LANE_H;

const iconOf = (card: UnfoldCard): IconName =>
  card.kind === "outcome" ? OUTCOME_ICON[card.outcome ?? "open"] : KIND_ICON[card.kind];

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
  return t("autoobserve.unfold.plusHours", { hours: Math.floor(gap / 60), minutes: gap % 60 });
};

const lanesOf = (cards: UnfoldCard[]) => {
  const services = [...new Set(cards.filter((c) => c.lane !== null).map((c) => c.lane))];
  return cards.some((c) => c.lane === null) ? [...services, null] : services;
};

// Same-minute cards in different lanes share a column, and the first word to your team drops right under its signal.
const place = (cards: UnfoldCard[], lanes: (string | null)[]) => {
  const placed: PlacedCard[] = [];
  let col = -1;
  for (const card of cards) {
    const parent = parentOf(card, placed);
    const column = placed.filter((p) => p.col === col);
    const laneFree = !column.some((p) => p.card.lane === card.lane);
    const dropsBelow = card.kind === "outcome" && parent?.col === col && laneFree;
    const concurrent =
      column.length > 0 &&
      card.kind !== "change" &&
      column[0].card.kind !== "change" &&
      column[0].card.minute === card.minute &&
      laneFree &&
      parent?.col !== col;
    if (!dropsBelow && !concurrent) col += 1;
    const row = lanes.indexOf(card.lane);
    placed.push({
      card,
      col,
      row,
      x: PAD_X + col * (CARD_W + COL_GAP),
      y: laneTop(row) + LANE_LABEL,
      parent,
    });
  }
  return placed;
};

const selectedId = ref("");

// A link within one column runs down from the card above; every other link runs left to right.
const edgeOf = (from: PlacedCard, to: PlacedCard) => {
  const down = from.col === to.col;
  const start = down
    ? { x: from.x + CARD_W / 2, y: from.y + CARD_H }
    : { x: from.x + CARD_W, y: from.y + CARD_H / 2 };
  const end = down ? { x: to.x + CARD_W / 2, y: to.y } : { x: to.x, y: to.y + CARD_H / 2 };
  const c1 = down
    ? { x: start.x, y: (start.y + end.y) / 2 }
    : { x: (start.x + end.x) / 2, y: start.y };
  const c2 = down ? { x: end.x, y: c1.y } : { x: c1.x, y: end.y };
  return {
    id: `${from.card.id}>${to.card.id}`,
    d: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`,
    end,
    mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    label: gapLabel(from.card, to.card),
    dashed: to.card.kind === "unwatched" || to.card.kind === "forecast",
    active: selectedId.value === to.card.id || selectedId.value === from.card.id,
  };
};

const layout = computed(() => {
  const lanes = lanesOf(props.cards);
  const nodes = place(props.cards, lanes);
  const columns = Math.max(...nodes.map((n) => n.col), 0) + 1;
  const edges = nodes.flatMap((node) => (node.parent ? [edgeOf(node.parent, node)] : []));
  return {
    lanes,
    nodes,
    edges,
    width: PAD_X * 2 + columns * CARD_W + (columns - 1) * COL_GAP,
    height: lanes.length * LANE_H,
  };
});

watch(
  [() => props.cards, () => props.focusId],
  ([cards, focusId]) =>
    (selectedId.value = cards.find((c) => c.id === focusId)?.id ?? cards[0]?.id ?? ""),
  { immediate: true },
);

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
