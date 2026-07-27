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
<!--
  VersionCompareView — the compare-mode body for LLM Insights. Wraps the
  useVersionCompare orchestrator wiring and renders, in order:
    VersionCompareBar → VersionCompareBanner → 2x VersionWindowCard →
    VersionDeltaStrip → VersionOverlayChart.

  Extracted out of LLMInsightsDashboard.vue (which is already large) so the
  compare surfaces + their wiring have their own testable unit. The dashboard
  still owns the `compareMode` toggle ref and the "Compare versions…" entry —
  this component only renders the body once compare mode is ON and a version
  list is available.

  Manual override (align === "manual"): each version picker's window slot swaps
  its "auto:" caption for the app-standard DateTime picker (same as the page
  header). Changing one calls `run()` with that arm's window pinned to the
  chosen value. The slot is a fixed h-8 line so toggling modes never shifts the
  layout.
-->
<template>
  <div class="flex flex-col gap-2.5" data-test="version-compare-view">
    <!-- Compare bar. The per-arm Manual date windows live INSIDE the bar, under
         each version picker (via the window-a/window-b slots) — so switching to
         Manual swaps a caption for an editable picker in place, with no separate
         full-width row appearing and shoving the metrics/chart down. -->
    <VersionCompareBar
      :versions="versionOptions"
      :a="selectedA"
      :b="selectedB"
      :align="align"
      @update:a="onSelectA"
      @update:b="onSelectB"
      @update:align="onAlignChange"
      @exit="emit('exit')"
    >
      <!-- Fixed-height (h-8) slot so switching Since↔Manual never changes the row
           height: the app-standard DateTime picker and the "auto:" caption both
           occupy the same 2rem line, eliminating the layout shift. -->
      <template #window-a>
        <div class="flex h-8 w-full items-center">
          <DateTime
            v-if="align === 'manual'"
            auto-apply
            disable-relative
            :default-type="'absolute'"
            :default-absolute-time="manualDefaultA"
            class="h-8 w-full"
            data-test="version-compare-manual-a-window"
            @on:date-change="(v: unknown) => onManualDateChange('a', v)"
          />
          <span
            v-else-if="autoWindowA"
            class="px-1 text-xs text-text-muted"
            data-test="version-compare-auto-window-a"
          >
            {{ autoWindowA }}
          </span>
        </div>
      </template>
      <template #window-b>
        <div class="flex h-8 w-full items-center">
          <DateTime
            v-if="align === 'manual'"
            auto-apply
            disable-relative
            :default-type="'absolute'"
            :default-absolute-time="manualDefaultB"
            class="h-8 w-full"
            data-test="version-compare-manual-b-window"
            @on:date-change="(v: unknown) => onManualDateChange('b', v)"
          />
          <span
            v-else-if="autoWindowB"
            class="px-1 text-xs text-text-muted"
            data-test="version-compare-auto-window-b"
          >
            {{ autoWindowB }}
          </span>
        </div>
      </template>
    </VersionCompareBar>

    <OContent class="flex flex-col gap-2.5">
      <VersionCompareBanner
        v-if="windows"
        :overlap="windows.overlap"
        :enough-sample="result?.enoughSample ?? true"
        :n-a="result?.nA ?? 0"
        :n-b="result?.nB ?? 0"
        :delta-hours="deltaHours"
      />

      <!-- Comparison caption: two compact inline identity chips (version · window
           · N traces) in one row, reading as a caption for the metrics below
           rather than two oversized boxes. -->
      <div
        v-if="windows"
        class="flex flex-wrap items-center gap-x-6 gap-y-1"
        data-test="version-compare-arm-summary"
      >
        <VersionWindowCard
          arm="a"
          :env="armAMeta?.env ?? ''"
          :version="armAMeta?.version ?? ''"
          :window="windows.a"
          :trace-count="result?.nA ?? 0"
          :limited-by="windows.limitedBy"
          :delta-hours="deltaHours"
        />
        <VersionWindowCard
          arm="b"
          :env="armBMeta?.env ?? ''"
          :version="armBMeta?.version ?? ''"
          :window="windows.b"
          :trace-count="result?.nB ?? 0"
          :limited-by="windows.limitedBy"
          :delta-hours="deltaHours"
        />
      </div>

      <!-- Delta strip waits on the raw-sample bootstrap (slowest queries); show a
           card-shaped skeleton row while loading so it never looks frozen. -->
      <div
        v-if="loading && !result"
        class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
        data-test="version-compare-strip-skeleton"
      >
        <OSkeleton
          v-for="n in 6"
          :key="n"
          type="rect"
          class="h-20 rounded-surface"
        />
      </div>
      <VersionDeltaStrip v-else-if="result" :result="result" />
      <VersionErrorDiff
        v-if="result"
        :error-diff="props.errorDiff ?? null"
        :version-a="armAMeta?.version ?? selectedA"
        :version-b="armBMeta?.version ?? selectedB"
      />
      <span
        v-if="sampledNote"
        class="text-xs text-text-muted"
        data-test="version-compare-sampled-note"
      >
        {{ sampledNote }}
      </span>

      <OSkeleton
        v-if="loading && !windows"
        type="rect"
        class="h-55 w-full rounded-surface"
        data-test="version-compare-chart-skeleton"
      />
      <!-- A line needs >=2 points per series. In sameWallClock mode a wide page
           window can collapse a short-lived version into a single coarse
           histogram bucket (one point → nothing to draw), so guide the user to
           narrow the range instead of showing a blank grid. -->
      <div
        v-else-if="windows && !chartPlottable"
        class="flex h-55 items-center justify-center rounded-surface border border-border-default bg-surface-panel px-4 text-center"
        data-test="version-overlay-chart-lowres"
      >
        <span class="text-xs text-text-muted">{{ t("aiObservability.overlayChart.lowResolution") }}</span>
      </div>
      <VersionOverlayChart
        v-else-if="windows"
        :series-a="overlaySeriesA"
        :series-b="overlaySeriesB"
        :mode="overlayMode"
        :x-unit="overlayXUnit.key"
        :version-a="armAMeta?.version ?? selectedA"
        :version-b="armBMeta?.version ?? selectedB"
        class="h-55"
      />
    </OContent>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OContent from "@/lib/core/Content/OContent.vue";
import DateTime from "@/components/DateTime.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import VersionCompareBar from "./VersionCompareBar.vue";
import VersionCompareBanner from "./VersionCompareBanner.vue";
import VersionWindowCard from "./VersionWindowCard.vue";
import VersionDeltaStrip from "./VersionDeltaStrip.vue";
import VersionErrorDiff from "./VersionErrorDiff.vue";
import VersionOverlayChart, { type OverlayPoint, type OverlayMode } from "./VersionOverlayChart.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import type { AlignMode, CompareWindows } from "@/plugins/traces/versionCompare/windows";
import type { CompareResult } from "@/plugins/traces/versionCompare/compareResult";
import { formatDuration } from "@/plugins/traces/versionCompare/formatDuration";
import type { LLMSparklineSeries } from "@/plugins/traces/composables/useLLMInsights";
import type { ErrorDiff } from "@/services/gen-ai-agent-mapping.service";

defineOptions({ name: "VersionCompareView" });

const props = defineProps<{
  /** All versions of the current agent (across env), wide-window enumerated. */
  versionList: GenAiAgentListItem[];
  stream: string;
  windows: CompareWindows | null;
  result: CompareResult | null;
  errorDiff?: ErrorDiff | null;
  sparklinesA: LLMSparklineSeries | null;
  sparklinesB: LLMSparklineSeries | null;
  sampledNote?: string | null;
  /** Either arm's queries are in flight — drives the results skeleton. */
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "exit"): void;
  /** Fired whenever the pair/align/manual window changes and a run() is needed. */
  (
    e: "run",
    payload: {
      a: GenAiAgentListItem;
      b: GenAiAgentListItem;
      align: AlignMode;
      manual?: { a?: { start: number; end: number }; b?: { start: number; end: number } };
    },
  ): void;
}>();

const { t } = useI18n();

const align = ref<AlignMode>("sinceRollout");

// Version A/B selections are keyed by version string (VersionCompareBar's
// contract) — resolved back to a concrete GenAiAgentListItem via versionList.
const selectedA = ref<string>("");
const selectedB = ref<string>("");

// `listVersionsForCompare` returns one row per version PER time-bucket, so a
// version that was active across N windows appears N times. Collapse to one
// entry per version string (keeping the earliest first_seen — a version's true
// rollout time is its first appearance, not the latest bucket's). Both the
// dropdown options and the default-seed logic MUST work off this deduped set:
// without it, `sorted[0]`/`sorted[1]` can land on two duplicates of the SAME
// version, seeding A === B, which gates `run()` off and leaves the compare body
// blank forever (reads to the user as "panels never load").
const uniqueVersions = computed<GenAiAgentListItem[]>(() => {
  const byVersion = new Map<string, GenAiAgentListItem>();
  for (const v of props.versionList) {
    if (v.version == null) continue;
    const key = v.version as string;
    const existing = byVersion.get(key);
    if (!existing || (v.first_seen ?? Infinity) < (existing.first_seen ?? Infinity)) {
      byVersion.set(key, v);
    }
  }
  return [...byVersion.values()];
});

const versionOptions = computed<SelectOption[]>(() =>
  uniqueVersions.value.map((v) => ({ label: v.version as string, value: v.version as string })),
);

// Default: B = the immediately-previous version, A = current (latest). Sort the
// DEDUPED versions by first_seen desc so "current" and "previous" are two
// distinct versions regardless of how many buckets each spanned.
function seedDefaults() {
  if (selectedA.value && selectedB.value) return;
  const sorted = [...uniqueVersions.value].sort(
    (x, y) => (y.first_seen ?? 0) - (x.first_seen ?? 0),
  );
  if (sorted.length >= 2) {
    selectedA.value = sorted[0].version as string;
    selectedB.value = sorted[1].version as string;
    requestRun();
  } else if (sorted.length === 1) {
    selectedA.value = sorted[0].version as string;
  }
}
// NOTE: the `{ immediate: true }` watch that drives seedDefaults is registered
// AFTER requestRun()/armAMeta/armBMeta are defined (below) — seedDefaults calls
// requestRun(), which reads armAMeta.value, so an immediate watch here would hit
// a temporal-dead-zone `Cannot access 'armAMeta' before initialization` crash.

const armAMeta = computed<GenAiAgentListItem | null>(
  () => props.versionList.find((v) => v.version === selectedA.value) ?? null,
);
const armBMeta = computed<GenAiAgentListItem | null>(
  () => props.versionList.find((v) => v.version === selectedB.value) ?? null,
);

// Short "auto:" caption for a resolved window, shown under each version picker in
// non-manual modes so the Manual date-picker slot reserves its space (no layout
// shift) and the user sees which window is in effect without opening anything.
function autoWindowLabel(win?: { start: number; end: number }): string {
  if (!win) return "";
  return t("aiObservability.versionCompare.bar.autoWindow", {
    duration: formatDuration((win.end - win.start) / 3_600_000_000),
  });
}
const autoWindowA = computed(() => autoWindowLabel(props.windows?.a));
const autoWindowB = computed(() => autoWindowLabel(props.windows?.b));

const deltaHours = computed(() =>
  props.windows ? Math.max(0, props.windows.deltaMicros / 3_600_000_000) : 0,
);

// Manual joins sameWallClock on the REAL-TIME axis: the user explicitly picked
// each window, so the chart must honour their actual temporal relationship (a
// later-rolled-out version starts further right), not rebase both to x=0. Only
// "since each rollout" rebases each series to its own t₀ for an early-life
// overlay.
const overlayMode = computed<OverlayMode>(() =>
  align.value === "sinceRollout" ? "sinceRollout" : "sameWallClock",
);

// Overlay x-axis unit. The rebased x used to be raw fractional HOURS, so a
// short-lived version rendered axis ticks like "0.0395787h" — unreadable and
// meaningless. Instead pick a human unit from the largest arm span: minutes for
// sub-2h data (the common short-rollout case), hours for sub-2d, else days. Both
// arms share one unit so their x-values stay comparable on the same axis.
type XUnit = { key: "minutes" | "hours" | "days"; perHour: number };
function winHours(win?: { start: number; end: number }): number {
  if (!win) return 0;
  return Math.max(0, (win.end - win.start) / 3_600_000_000);
}
const overlayXUnit = computed<XUnit>(() => {
  const maxHours = Math.max(winHours(props.windows?.a), winHours(props.windows?.b));
  if (maxHours < 2) return { key: "minutes", perHour: 60 };
  if (maxHours < 48) return { key: "hours", perHour: 1 };
  return { key: "days", perHour: 1 / 24 };
});

// Shared origin for the wall-clock axis: the earlier of the two window starts.
// A version whose window starts later is offset to the RIGHT by that real gap,
// so the chart shows their true temporal relationship. Null in sinceRollout,
// where each series is rebased to its own t₀ instead.
const wallClockOrigin = computed<number | null>(() => {
  if (overlayMode.value === "sinceRollout") return null;
  const a = props.windows?.a.start;
  const b = props.windows?.b.start;
  if (a == null && b == null) return null;
  return Math.min(a ?? Infinity, b ?? Infinity);
});

// Map an arm's sparkline buckets to overlay points. Sparklines carry no per-
// bucket timestamp, so buckets are evenly distributed across the window.
//   - sinceRollout (origin=null): x = elapsed since THIS window's start (both
//     series begin at x=0 — an apples-to-apples early-life overlay).
//   - wall-clock (origin set): x = elapsed since the SHARED origin, so a later
//     window sits further right — the real timeline the user picked.
function toOverlayPoints(
  series: LLMSparklineSeries | null,
  win: { start: number; end: number } | undefined,
  unit: XUnit,
  origin: number | null,
): OverlayPoint[] {
  if (!series || !win) return [];
  const values = series.cost;
  if (!values.length) return [];
  const span = winHours(win) * unit.perHour;
  // Wall-clock: how far THIS window's start sits past the shared origin.
  const offset =
    origin == null ? 0 : Math.max(0, (win.start - origin) / 3_600_000_000) * unit.perHour;
  return values.map((y, i) => ({
    // Round x to 2 decimals: the axis is a value type, so an unrounded value
    // renders as a full-precision float tick (e.g. "2.1920511627906976").
    x:
      values.length > 1
        ? Math.round((offset + (i / (values.length - 1)) * span) * 100) / 100
        : Math.round(offset * 100) / 100,
    y,
  }));
}

const overlaySeriesA = computed(() =>
  toOverlayPoints(props.sparklinesA, props.windows?.a, overlayXUnit.value, wallClockOrigin.value),
);
const overlaySeriesB = computed(() =>
  toOverlayPoints(props.sparklinesB, props.windows?.b, overlayXUnit.value, wallClockOrigin.value),
);

// A line chart needs >=2 points on at least one series to draw anything. When
// both arms collapse to a single bucket (common in sameWallClock over a wide
// page window), there's nothing to plot — render the low-resolution note
// instead of a blank grid.
const chartPlottable = computed(
  () => overlaySeriesA.value.length >= 2 || overlaySeriesB.value.length >= 2,
);

function requestRun(manual?: { a?: { start: number; end: number }; b?: { start: number; end: number } }) {
  const a = armAMeta.value;
  const b = armBMeta.value;
  if (!a || !b) return;
  emit("run", { a, b, align: align.value, manual });
}

// Registered here (not at seedDefaults' definition) so requestRun/armAMeta/
// armBMeta are initialized before the immediate fire — avoids a TDZ crash.
watch(() => props.versionList, seedDefaults, { immediate: true });

function onSelectA(v: string) {
  selectedA.value = v;
  requestRun();
}
function onSelectB(v: string) {
  selectedB.value = v;
  requestRun();
}
function onAlignChange(v: AlignMode) {
  align.value = v;
  // Manual mode keeps the last good comparison on entry — the pickers are seeded
  // to each arm's current auto window, and we only re-run when the user actually
  // edits a picker (onManualDateChange). Running here (or on the DateTime's
  // mount-time emit) would query half-initialized windows and render NaN/0.
  if (v === "manual") {
    // Each DateTime fires ONE `on:date-change` on mount (auto-apply seeding its
    // default). Arm those two mount-emits to be swallowed so entering Manual
    // doesn't trigger a run — DateTime's own `userChangedValue` is unreliable
    // here (it's `true` on the mount emit, not `false`).
    ignoreNextEmitA.value = true;
    ignoreNextEmitB.value = true;
    return;
  }
  requestRun();
}

// ── Manual override ────────────────────────────────────────────────────────
// Per-arm manual windows (epoch µs), captured from the app-standard DateTime
// component's `on:date-change` payload — the SAME picker the page header and the
// rest of the app use, so the Manual controls look/behave consistently.
const manualWinA = ref<{ start: number; end: number } | null>(null);
const manualWinB = ref<{ start: number; end: number } | null>(null);
// Swallow each picker's one mount-time `on:date-change` (the seeding emit) so
// entering Manual never auto-runs with a half-initialized window.
const ignoreNextEmitA = ref(false);
const ignoreNextEmitB = ref(false);

// DateTime emits { startTime, endTime } already in epoch µs (see its
// getConsumableDateTime). Seed both pickers to each arm's resolved auto window so
// the popup opens on a sensible range rather than an arbitrary default.
const manualDefaultA = computed(() => ({
  startTime: props.windows?.a.start ?? 0,
  endTime: props.windows?.a.end ?? 0,
}));
const manualDefaultB = computed(() => ({
  startTime: props.windows?.b.start ?? 0,
  endTime: props.windows?.b.end ?? 0,
}));

function onManualDateChange(arm: "a" | "b", payload: unknown) {
  const p = payload as { startTime?: number; endTime?: number };
  if (p?.startTime == null || p?.endTime == null) return;
  // Swallow the one mount-time seeding emit per picker (armed on entering Manual)
  // so it doesn't trigger a run with a half-initialized window → NaN. Still record
  // the seeded window so a later edit of the OTHER arm pins this one correctly.
  const seedWin = { start: p.startTime, end: p.endTime };
  if (arm === "a" && ignoreNextEmitA.value) { ignoreNextEmitA.value = false; manualWinA.value = seedWin; return; }
  if (arm === "b" && ignoreNextEmitB.value) { ignoreNextEmitB.value = false; manualWinB.value = seedWin; return; }
  const win = { start: p.startTime, end: p.endTime };
  if (arm === "a") manualWinA.value = win;
  else manualWinB.value = win;

  // Re-run with BOTH arms pinned — include the other arm's already-chosen (or
  // seeded auto) window so a single edit never leaves the untouched arm querying
  // an empty window (the NaN bug). Falls back to the auto default when unedited.
  const winA = arm === "a" ? win : (manualWinA.value ?? { start: manualDefaultA.value.startTime, end: manualDefaultA.value.endTime });
  const winB = arm === "b" ? win : (manualWinB.value ?? { start: manualDefaultB.value.startTime, end: manualDefaultB.value.endTime });
  requestRun({ a: winA, b: winB });
}

defineExpose({ align });
</script>
