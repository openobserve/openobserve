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
    ref="canvasEl"
    class="bg-surface-panel bg-dot-grid relative h-full min-h-0 touch-none overflow-hidden select-none"
    :class="drag ? 'cursor-grabbing' : 'cursor-grab'"
    data-test="query-profile-canvas"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
  >
    <div
      class="absolute start-0 top-0 origin-top-left"
      :style="{
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
        width: `${layout.width}px`,
        height: `${layout.height}px`,
      }"
      data-test="query-profile-world"
    >
      <div
        v-for="s in stageBoxes"
        :key="s.stageId"
        class="border-border-strong bg-surface-base/40 rounded-surface absolute border border-dashed"
        :style="{ left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${s.h}px` }"
        :data-test="`query-profile-stage-${s.stageId}`"
      />
      <OTruncatedText
        v-for="v in variantLabels"
        :key="v.variantId"
        as="div"
        class="text-text-secondary text-2xs absolute"
        :style="{ left: `${v.x}px`, top: `${v.y}px`, width: `${v.w}px` }"
        :data-test="`query-profile-variant-${v.variantId}`"
        >{{ v.text }}</OTruncatedText
      >
      <svg
        class="pointer-events-none absolute start-0 top-0 overflow-visible"
        :width="layout.width"
        :height="layout.height"
      >
        <path
          v-for="e in edges"
          :key="e.key"
          :d="e.path"
          fill="none"
          stroke-linecap="round"
          :stroke="e.hot ? 'var(--color-accent)' : 'var(--color-border-strong)'"
          :stroke-width="e.width"
          :opacity="e.on ? 1 : 0.35"
        />
      </svg>
      <span
        v-for="e in labelledEdges"
        :key="`label-${e.key}`"
        class="bg-surface-base text-2xs absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-1.5 font-mono whitespace-nowrap"
        :class="e.hot ? 'border-accent text-accent' : 'border-border-default text-text-secondary'"
        :style="{ left: `${e.labelX}px`, top: `${e.labelY}px` }"
        >{{ e.label }}</span
      >
      <div
        v-for="e in chipEdges"
        :key="`chip-${e.key}`"
        class="bg-surface-base rounded-default absolute -translate-x-1/2 -translate-y-1/2"
        :style="{ left: `${e.labelX}px`, top: `${e.labelY}px` }"
        data-profile-card
      >
        <OButton
          variant="outline"
          size="xs"
          icon-left="swap-horiz"
          :aria-label="t('search.queryProfile.showFolded', { op: e.chipTitle })"
          :data-test="`query-profile-chip-${e.key}`"
          @click.stop="showFolded(e)"
          >{{ e.chipText }}</OButton
        >
      </div>
      <div
        v-for="s in stageBoxes"
        :key="`pill-${s.stageId}`"
        class="bg-surface-panel border-border-strong text-text-secondary absolute flex -translate-y-1/2 items-center gap-1 rounded-full border py-px ps-2 pe-0.5 text-xs whitespace-nowrap"
        :style="{ left: `${s.x + 12}px`, top: `${s.y}px` }"
        data-profile-card
      >
        <span class="text-text-heading font-semibold">{{ s.title }}</span>
        <span>{{ s.meta }}</span>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="unfold-less"
          :aria-label="t('search.queryProfile.collapseStage', { index: s.index })"
          :data-test="`query-profile-collapse-stage-${s.stageId}`"
          @click.stop="collapseStage(s.stageId)"
        />
      </div>
      <ProfileFoldCard
        v-for="f in layout.folds"
        :key="f.key"
        :model="model"
        :fold="f"
        @open="emitFold({ type: 'open', fold: f }, [f.ownerId])"
      />
      <ProfileOperatorCard
        v-for="c in layout.cards"
        :key="c.opId"
        :model="model"
        :op="model.operators[c.opId]"
        :scope="scope"
        :selected="c.opId === selectedId"
        :x="c.x"
        :y="c.y"
        :branch="c.branch"
        :refold="c.refold"
        @select="emit('select', $event)"
        @fold="onCardFold(c.opId, $event)"
      />
    </div>

    <div
      v-if="notice"
      class="bg-surface-base border-border-default rounded-default absolute bottom-3 z-10 flex items-center gap-2 border py-1 ps-2.5 pe-1 text-xs shadow-sm"
      :style="{ left: `${leftInset}px`, maxWidth: `calc(100% - ${leftInset + noticeRightGap}px)` }"
      data-canvas-overlay
      data-test="query-profile-fold-notice"
    >
      <span class="text-text-body min-w-0">{{ notice.text }}</span>
      <OButton
        variant="ghost"
        size="xs"
        data-test="query-profile-fold-notice-action"
        @click="onNotice"
        >{{ notice.action }}</OButton
      >
    </div>

    <div
      class="bg-surface-base border-border-default rounded-default absolute end-3 bottom-3 z-10 flex flex-col border shadow-sm max-lg:hidden"
      data-canvas-overlay
    >
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="zoom-in"
        :aria-label="t('search.queryProfile.zoomIn')"
        data-test="query-profile-zoom-in"
        @click="zoomBy(ZOOM_STEP)"
      >
        <OTooltip side="left" :content="t('search.queryProfile.zoomIn')" />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="zoom-out"
        :aria-label="t('search.queryProfile.zoomOut')"
        data-test="query-profile-zoom-out"
        @click="zoomBy(1 / ZOOM_STEP)"
      >
        <OTooltip side="left" :content="t('search.queryProfile.zoomOut')" />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="fit-screen"
        :aria-label="t('search.queryProfile.fitView')"
        data-test="query-profile-zoom-fit"
        @click="fit"
      >
        <OTooltip side="left" :content="t('search.queryProfile.fitView')" />
      </OButton>
      <div class="border-border-default mx-1 border-t" />
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="compress"
        :aria-label="t('search.queryProfile.foldPlumbing')"
        :aria-pressed="plumbing"
        :class="plumbing ? 'text-accent' : ''"
        data-test="query-profile-fold-plumbing"
        @click="emitFold({ type: 'plumbing' }, selectedAnchor())"
      >
        <OTooltip side="left" :content="t('search.queryProfile.foldPlumbing')" />
      </OButton>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="unfold-more"
        :aria-label="t('search.queryProfile.expandAll')"
        data-test="query-profile-expand-all"
        @click="emitFold({ type: 'expandAll' })"
      >
        <OTooltip side="left" :content="t('search.queryProfile.expandAll')" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useI18nTyped } from "@/types/i18n";
import {
  CARD_H,
  CARD_W,
  formatBytes,
  formatRows,
  scopedValue,
  type LayoutEdge,
  type ProfileLayout,
  type ProfileModel,
  type StageScope,
} from "@/utils/queryProfile";
import type { FoldAction } from "@/utils/queryProfileFold";
import ProfileFoldCard from "./ProfileFoldCard.vue";
import ProfileOperatorCard from "./ProfileOperatorCard.vue";
import type { FoldNotice } from "./profileStyles";
import { operatorTitle, variantLabel } from "./profileText";

// World coordinates are screen pixels at zoom 1, so pointer pan and zoom map one to one.
const ZOOM_STEP = 1.2;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const FIT_MARGIN = 24;
const FIT_OVERLAY_W = 56;
// Below this a fitted card is unreadable; the graph is top-aligned instead and the rest is panned to.
const MIN_FIT_ZOOM = 0.85;
// Fitting a very wide plan never shrinks cards past this; the overflow is panned to instead.
const MIN_READABLE_ZOOM = 0.6;

const props = defineProps<{
  model: ProfileModel;
  layout: ProfileLayout;
  scope: StageScope;
  selectedId: string | null;
  leftInset: number;
  plumbing?: boolean;
  notice?: FoldNotice | null;
}>();

const emit = defineEmits<{
  select: [opId: string];
  fold: [action: FoldAction];
  "notice-action": [];
}>();

const { t } = useI18nTyped();
const { isDesktop } = useBreakpoint();

const canvasEl = ref<HTMLElement | null>(null);
const view = reactive({ x: 0, y: 0, k: 1 });
const size = reactive({ w: 0, h: 0 });
const drag = ref<{ x: number; y: number; vx: number; vy: number; id: number } | null>(null);
let observer: ResizeObserver | null = null;
let lastModel = props.model;
// what the next layout change should do to the view: keep a card where it was, or refit
let pending: { ids: string[]; sx: number; sy: number } | "fit" | null = null;

const noticeRightGap = computed(() => (isDesktop.value ? FIT_OVERLAY_W + 12 : 12));

const stageBoxes = computed(() =>
  props.layout.stages.map((box) => {
    const stage = props.model.stageById[box.stageId];
    const nodes = t(
      "search.queryProfile.nodesCount",
      { count: stage.nodes.length },
      stage.nodes.length,
    );
    const shapes = t(
      "search.queryProfile.planShapes",
      { count: stage.variants.length },
      stage.variants.length,
    );
    return {
      ...box,
      index: stage.index,
      title: t("search.queryProfile.stage", { index: stage.index }),
      meta: props.model.planOnly
        ? ` · ${t("search.queryProfile.stageRunsEverywhere")}`
        : ` · ${[stage.cluster, nodes, shapes].filter(Boolean).join(" · ")}`,
    };
  }),
);

const variantLabels = computed(() =>
  (props.model.planOnly ? [] : props.layout.variantLabels).map((v) => {
    const variant = props.model.variantById[v.variantId];
    const label = variantLabel(t, variant);
    return { ...v, text: `${label} · ${variant.nodeKeys.length}` };
  }),
);

const edges = computed(() =>
  props.layout.edges.map((e) => {
    const hot = (!!e.fromId && e.fromId === props.selectedId) || e.parentId === props.selectedId;
    if (props.model.planOnly || !e.childId) return { ...e, on: true, hot, width: 1.5, label: "" };
    const child = props.model.operators[e.childId];
    const value = scopedValue(child, props.scope);
    const rows = child.remoteStageId ? child.totalRows : value.rows;
    const bytes = child.remoteStageId
      ? props.model.stageById[child.remoteStageId].nodes.reduce(
          (a, n) => a + (n.remote.output_bytes || 0),
          0,
        )
      : 0;
    return {
      ...e,
      on: value.on,
      hot,
      width: Math.max(1.5, Math.min(8, Math.log10(Math.max(10, rows)) * 1.1)),
      label: !value.on
        ? "—"
        : bytes
          ? `${formatRows(rows)} · ${formatBytes(bytes)}`
          : formatRows(rows),
    };
  }),
);

const labelledEdges = computed(() => edges.value.filter((e) => e.label && !e.folded.length));

const chipEdges = computed(() =>
  edges.value
    .filter((e) => e.folded.length)
    .map((e) => {
      const chipTitle = operatorTitle(t, props.model.operators[e.folded[0]]);
      const more = e.folded.length > 1 ? ` +${e.folded.length - 1}` : "";
      const rows = e.label ? ` · ${e.label}` : "";
      return { ...e, chipTitle, chipText: `${chipTitle}${more}${rows}` };
    }),
);

function cardAt(opId: string) {
  return props.layout.cards.find((c) => c.opId === opId);
}

function selectedAnchor(): string[] {
  return props.selectedId ? [props.selectedId] : [];
}

/** Keeps the first of `anchorIds` still on screen where it was once the fold re-lays the plan. */
function emitFold(action: FoldAction, anchorIds: string[] = []) {
  const anchor = anchorIds.map(cardAt).find(Boolean);
  pending = anchor
    ? { ids: anchorIds, sx: anchor.x * view.k + view.x, sy: anchor.y * view.k + view.y }
    : "fit";
  emit("fold", action);
}

function onCardFold(opId: string, kind: "branch" | "refold") {
  if (kind === "branch") return emitFold({ type: "branch", opId }, [opId]);
  const below: string[] = [];
  for (
    let id = props.model.operators[opId].childIds[0];
    id;
    id = props.model.operators[id].childIds[0]
  ) {
    below.push(id);
  }
  const parent = props.model.operators[opId].parentId;
  emitFold({ type: "refold", opId }, [...below, ...(parent ? [parent] : [])]);
}

function showFolded(e: LayoutEdge) {
  emitFold({ type: "show", opIds: e.folded }, e.fromId ? [e.fromId] : [e.parentId]);
}

function collapseStage(stageId: string) {
  emitFold({ type: "stage", stageId }, [props.model.stageById[stageId].remoteOpId]);
}

function onNotice() {
  if (!props.notice?.keepView) pending = "fit";
  emit("notice-action");
}

function restoreAnchor(anchor: { ids: string[]; sx: number; sy: number }) {
  const card = anchor.ids.map(cardAt).find(Boolean);
  if (!card) return fit();
  view.x = anchor.sx - card.x * view.k;
  view.y = anchor.sy - card.y * view.k;
}

function onLayout() {
  const next = pending;
  pending = null;
  if (props.model !== lastModel) {
    lastModel = props.model;
    return fit();
  }
  if (next === "fit") return fit();
  if (next) return restoreAnchor(next);
  ensureVisible(props.selectedId);
}

function clampZoom(k: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

function zoomAt(k2: number, px: number, py: number) {
  const k = clampZoom(k2);
  view.x = px - ((px - view.x) * k) / view.k;
  view.y = py - ((py - view.y) * k) / view.k;
  view.k = k;
}

function zoomBy(factor: number) {
  zoomAt(view.k * factor, size.w / 2, size.h / 2);
}

function fit() {
  const right = isDesktop.value ? FIT_OVERLAY_W : FIT_MARGIN;
  const availW = Math.max(1, size.w - props.leftInset - right);
  const availH = Math.max(1, size.h - 2 * FIT_MARGIN);
  // the width fits so the overlays never hide cards; only the height, or a very wide plan, scrolls
  const k = clampZoom(
    Math.max(
      MIN_READABLE_ZOOM,
      Math.min(
        availW / props.layout.width,
        Math.max(MIN_FIT_ZOOM, availH / props.layout.height),
        1.05,
      ),
    ),
  );
  view.k = k;
  const spare = availW - props.layout.width * k;
  const root = cardAt(props.model.rootId);
  // a plan wider than the canvas keeps its root, where reading starts, in the middle
  const x =
    spare >= 0 || !root
      ? Math.max(0, spare / 2)
      : Math.min(0, Math.max(spare, availW / 2 - (root.x + CARD_W / 2) * k));
  view.x = props.leftInset + x;
  view.y = FIT_MARGIN;
}

function isOverlay(target: EventTarget | null) {
  return target instanceof Element && !!target.closest("[data-canvas-overlay],[data-profile-card]");
}

function onPointerDown(e: PointerEvent) {
  if (isOverlay(e.target) || e.button !== 0) return;
  drag.value = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, id: e.pointerId };
  canvasEl.value?.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!drag.value) return;
  view.x = drag.value.vx + e.clientX - drag.value.x;
  view.y = drag.value.vy + e.clientY - drag.value.y;
}

function onPointerUp() {
  if (drag.value) canvasEl.value?.releasePointerCapture?.(drag.value.id);
  drag.value = null;
}

function onWheel(e: WheelEvent) {
  if (e.target instanceof Element && e.target.closest("[data-canvas-overlay]")) return;
  const rect = canvasEl.value?.getBoundingClientRect();
  if (!rect) return;
  e.preventDefault();
  zoomAt(view.k * Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
}

function centerOn(wx: number, wy: number) {
  view.x = size.w / 2 - wx * view.k;
  view.y = size.h / 2 - wy * view.k;
}

function ensureVisible(opId: string | null) {
  const card = props.layout.cards.find((c) => c.opId === opId);
  if (!card || !size.w) return;
  const sx = card.x * view.k + view.x;
  const sy = card.y * view.k + view.y;
  const outside =
    sx < props.leftInset ||
    sy < 0 ||
    sx + CARD_W * view.k > size.w ||
    sy + CARD_H * view.k > size.h;
  if (outside) centerOn(card.x + CARD_W / 2, card.y + CARD_H / 2);
}

function measure() {
  const rect = canvasEl.value?.getBoundingClientRect();
  if (!rect) return;
  size.w = rect.width;
  size.h = rect.height;
}

onMounted(() => {
  measure();
  fit();
  if (typeof ResizeObserver !== "undefined" && canvasEl.value) {
    observer = new ResizeObserver(() => {
      measure();
      fit();
    });
    observer.observe(canvasEl.value);
  }
});

onBeforeUnmount(() => observer?.disconnect());

watch(
  () => props.layout,
  () => nextTick(onLayout),
);

watch(
  () => [props.leftInset, isDesktop.value],
  () => nextTick(fit),
);

watch(
  () => props.selectedId,
  (id) => nextTick(() => ensureVisible(id)),
);
</script>
