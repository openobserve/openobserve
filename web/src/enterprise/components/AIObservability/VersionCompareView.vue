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

  Manual override (align === "manual"): reveals two per-arm ODateTimeRange
  controls. Changing one calls `run()` with that arm's window pinned to the
  caller-supplied value — kept intentionally minimal (two range pickers, no
  extra chrome) per the plan's "don't over-engineer" note.
-->
<template>
  <div class="flex flex-col gap-2.5" data-test="version-compare-view">
    <VersionCompareBar
      :versions="versionOptions"
      :a="selectedA"
      :b="selectedB"
      :align="align"
      @update:a="onSelectA"
      @update:b="onSelectB"
      @update:align="onAlignChange"
      @exit="emit('exit')"
    />

    <!-- Manual override: two per-arm windows, visible only in manual mode. -->
    <OContent v-if="align === 'manual'">
      <OCard class="border border-border-default bg-surface-panel" data-test="version-compare-manual-override">
        <OCardSection role="body" class="flex items-center gap-3">
          <ODateTimeRange
            mode="absolute"
            disable-relative
            with-seconds
            :label="t('aiObservability.versionCompare.manual.windowA')"
            :start-date="manualStartDateA"
            :start-time="manualStartTimeA"
            :end-date="manualEndDateA"
            :end-time="manualEndTimeA"
            data-test="version-compare-manual-a-window"
            @change="(v) => onManualRangeChange('a', v)"
          />
          <ODateTimeRange
            mode="absolute"
            disable-relative
            with-seconds
            :label="t('aiObservability.versionCompare.manual.windowB')"
            :start-date="manualStartDateB"
            :start-time="manualStartTimeB"
            :end-date="manualEndDateB"
            :end-time="manualEndTimeB"
            data-test="version-compare-manual-b-window"
            @change="(v) => onManualRangeChange('b', v)"
          />
        </OCardSection>
      </OCard>
    </OContent>

    <OContent class="flex flex-col gap-2.5">
      <VersionCompareBanner
        v-if="windows"
        :overlap="windows.overlap"
        :enough-sample="result?.enoughSample ?? true"
        :n-a="result?.nA ?? 0"
        :n-b="result?.nB ?? 0"
        :delta-hours="deltaHours"
      />

      <div v-if="windows" class="flex flex-wrap gap-3">
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

      <VersionDeltaStrip v-if="result" :result="result" />
      <span
        v-if="sampledNote"
        class="text-xs text-text-muted"
        data-test="version-compare-sampled-note"
      >
        {{ sampledNote }}
      </span>

      <VersionOverlayChart
        v-if="windows"
        :series-a="overlaySeriesA"
        :series-b="overlaySeriesB"
        :mode="overlayMode"
        class="h-55"
      />
    </OContent>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OContent from "@/lib/core/Content/OContent.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import type { DateTimeRangeAbsoluteValue } from "@/lib/forms/DateTimeRange/ODateTimeRange.types";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import VersionCompareBar from "./VersionCompareBar.vue";
import VersionCompareBanner from "./VersionCompareBanner.vue";
import VersionWindowCard from "./VersionWindowCard.vue";
import VersionDeltaStrip from "./VersionDeltaStrip.vue";
import VersionOverlayChart, { type OverlayPoint, type OverlayMode } from "./VersionOverlayChart.vue";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import type { AlignMode, CompareWindows } from "@/plugins/traces/versionCompare/windows";
import type { CompareResult } from "@/plugins/traces/versionCompare/compareResult";
import type { LLMSparklineSeries } from "@/plugins/traces/composables/useLLMInsights";

defineOptions({ name: "VersionCompareView" });

const props = defineProps<{
  /** All versions of the current agent (across env), wide-window enumerated. */
  versionList: GenAiAgentListItem[];
  stream: string;
  windows: CompareWindows | null;
  result: CompareResult | null;
  sparklinesA: LLMSparklineSeries | null;
  sparklinesB: LLMSparklineSeries | null;
  sampledNote?: string | null;
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

const versionOptions = computed<SelectOption[]>(() =>
  props.versionList
    .filter((v) => v.version != null)
    .map((v) => ({ label: v.version as string, value: v.version as string })),
);

// Default: B = the immediately-previous version, A = current (latest). The
// list arrives in the service's first-seen order; sort by first_seen desc so
// "current" and "previous" are well-defined regardless of API ordering.
function seedDefaults() {
  if (selectedA.value && selectedB.value) return;
  const sorted = [...props.versionList]
    .filter((v) => v.version != null)
    .sort((x, y) => (y.first_seen ?? 0) - (x.first_seen ?? 0));
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

const deltaHours = computed(() =>
  props.windows ? Math.max(0, props.windows.deltaMicros / 3_600_000_000) : 0,
);

const overlayMode = computed<OverlayMode>(() => (align.value === "sameWallClock" ? "sameWallClock" : "sinceRollout"));

// Overlay series: rebase each arm's sparkline buckets onto elapsed hours
// across its resolved window (sinceRollout/manual) or onto the shared
// wall-clock window (sameWallClock) — sparklines carry no per-bucket
// timestamp, so buckets are evenly distributed across the window duration.
function toOverlayPoints(series: LLMSparklineSeries | null, win: { start: number; end: number } | undefined): OverlayPoint[] {
  if (!series || !win) return [];
  const values = series.cost;
  if (!values.length) return [];
  const hours = Math.max(0, (win.end - win.start) / 3_600_000_000);
  return values.map((y, i) => ({
    x: values.length > 1 ? (i / (values.length - 1)) * hours : 0,
    y,
  }));
}

const overlaySeriesA = computed(() => toOverlayPoints(props.sparklinesA, props.windows?.a));
const overlaySeriesB = computed(() => toOverlayPoints(props.sparklinesB, props.windows?.b));

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
  requestRun();
}

// ── Manual override ────────────────────────────────────────────────────────
// Each arm is an ODateTimeRange in absolute mode — date/time strings (no
// timezone) converted to epoch microseconds on change. Kept minimal per the
// plan: no persistence, no validation beyond "both start/end present for an
// arm".
const manualStartDateA = ref("");
const manualStartTimeA = ref("");
const manualEndDateA = ref("");
const manualEndTimeA = ref("");
const manualStartDateB = ref("");
const manualStartTimeB = ref("");
const manualEndDateB = ref("");
const manualEndTimeB = ref("");

function toMicros(date: string, time: string): number | null {
  if (!date || !time) return null;
  const ms = new Date(`${date}T${time}`).getTime();
  return Number.isNaN(ms) ? null : ms * 1000;
}

function onManualRangeChange(arm: "a" | "b", value: DateTimeRangeAbsoluteValue) {
  if (arm === "a") {
    manualStartDateA.value = value.startDate;
    manualStartTimeA.value = value.startTime;
    manualEndDateA.value = value.endDate;
    manualEndTimeA.value = value.endTime;
  } else {
    manualStartDateB.value = value.startDate;
    manualStartTimeB.value = value.startTime;
    manualEndDateB.value = value.endDate;
    manualEndTimeB.value = value.endTime;
  }

  const aStart = toMicros(manualStartDateA.value, manualStartTimeA.value);
  const aEnd = toMicros(manualEndDateA.value, manualEndTimeA.value);
  const bStart = toMicros(manualStartDateB.value, manualStartTimeB.value);
  const bEnd = toMicros(manualEndDateB.value, manualEndTimeB.value);

  const manual: { a?: { start: number; end: number }; b?: { start: number; end: number } } = {};
  if (arm === "a" && aStart != null && aEnd != null) manual.a = { start: aStart, end: aEnd };
  if (arm === "b" && bStart != null && bEnd != null) manual.b = { start: bStart, end: bEnd };
  if (!manual.a && !manual.b) return;
  requestRun(manual);
}

defineExpose({ align });
</script>
