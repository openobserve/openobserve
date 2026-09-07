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
  MonitorStatusTimeline — HTML/CSS Status Timeline.

  Each segment = one logical run (grouped by runId) with three-color aggregate.
  Smooth scroll navigation with arrow buttons.
  OTooltip hover shows per-execution (location·browser·device) breakdown.
-->
<template>
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col overflow-hidden border"
    data-test="monitor-status-timeline"
  >
    <div class="flex items-center gap-2 px-3.5 pt-2.5 pb-2">
      <span class="text-text-heading text-xs font-bold">
        {{ t("synthetics.timeline.title") }}
      </span>
      <span class="flex-1" />
      <span class="text-text-secondary inline-flex items-center gap-1.5 text-xs">
        <span class="bg-badge-error-solid-bg h-[0.4375rem] w-[0.4375rem] rounded-full" />
        {{ failCount }} {{ t("synthetics.timeline.failed") }}
      </span>
      <span class="text-text-secondary inline-flex items-center gap-1.5 text-xs">
        <span class="bg-badge-orange-solid-bg h-[0.4375rem] w-[0.4375rem] rounded-full" />
        {{ mixedCount }} {{ t("synthetics.timeline.warning") }}
      </span>
      <span class="text-text-secondary inline-flex items-center gap-1.5 text-xs">
        <span class="bg-badge-success-solid-bg h-[0.4375rem] w-[0.4375rem] rounded-full" />
        {{ passCount }} {{ t("synthetics.timeline.passed") }}
      </span>
    </div>
    <div class="border-border-default border-t" />
    <div class="flex flex-col gap-1 px-3.5 py-2">
      <div class="flex items-center gap-1">
        <OButton
          variant="ghost"
          size="icon-xs"
          :disabled="!canScrollLeft"
          data-test="synthetics-timeline-scroll-left-btn"
          :aria-label="t('synthetics.timeline.scrollLeft')"
          @click="scrollTimeline('left')"
        >
          <OIcon name="chevron-left" size="xs" />
        </OButton>
        <!-- One label per lane; row heights mirror the cells beside them. -->
        <div
          v-if="isLaned"
          class="flex shrink-0 flex-col gap-0.5"
          data-test="synthetics-timeline-lane-labels"
        >
          <span
            v-for="lane in lanes"
            :key="lane.label"
            class="text-3xs text-text-secondary h-3 max-w-24 truncate pr-1 text-right font-mono leading-3"
          >
            {{ lane.label }}
          </span>
        </div>
        <div
          ref="scrollRef"
          :class="['rounded-default flex flex-1 gap-0.5 overflow-hidden', isLaned ? '' : 'h-6.5']"
          @scroll="onScroll"
        >
          <div
            v-for="col in columns"
            :key="col.key"
            :class="['flex min-w-[0.1875rem] shrink-0 flex-col gap-0.5', isLaned ? '' : 'h-full']"
            :style="{ width: segmentWidthPct }"
          >
            <div
              v-for="(cell, ci) in col.cells"
              :key="ci"
              :class="[
                isLaned ? 'h-3' : 'h-full',
                cell.seg
                  ? cell.seg.color +
                    ' cursor-pointer transition-all duration-100 hover:scale-y-[1.35]'
                  : 'bg-border-default/40',
              ]"
            >
              <OTooltip v-if="cell.seg" side="top" :delay="0" :max-width="'auto'">
                <template #content>
                  <div class="min-w-50 py-0.5">
                    <div
                      v-if="cell.laneLabel"
                      class="text-text-secondary px-1 pb-0.5 font-mono text-xs font-semibold"
                    >
                      {{ cell.laneLabel }}
                    </div>
                    <!-- Passed · Warning · Failed always sum to the execution
                       count. `error` aggregates into failed rather than falling
                       out of both buckets, which is what used to make a run of
                       [pass, fail, error] read as "1 passed · 1 failed". -->
                    <div
                      class="text-text-secondary mb-1.5 flex flex-wrap items-center gap-1.5 border-b px-1 pb-1 text-xs font-semibold"
                    >
                      <span class="bg-badge-success-solid-bg h-2 w-2 shrink-0 rounded-full" />
                      <span class="text-text-secondary">{{
                        t("synthetics.timeline.tooltipPassed", { count: cell.seg.tally.passed })
                      }}</span>
                      <template v-if="cell.seg.tally.warning > 0">
                        <span class="bg-badge-warning-solid-bg h-2 w-2 shrink-0 rounded-full" />
                        <span class="text-text-secondary">{{
                          t("synthetics.timeline.tooltipWarning", { count: cell.seg.tally.warning })
                        }}</span>
                      </template>
                      <span class="bg-badge-error-solid-bg h-2 w-2 shrink-0 rounded-full" />
                      <span class="text-text-secondary">{{
                        t("synthetics.timeline.tooltipFailed", { count: cell.seg.tally.failed })
                      }}</span>
                    </div>
                    <template
                      v-for="(group, gIdx) in groupedByLocation(cell.seg.executions)"
                      :key="gIdx"
                    >
                      <div class="mt-1 mb-0.5 flex items-center gap-1.5 px-1 first:mt-0">
                        <span
                          class="h-2 w-2 shrink-0 rounded-full"
                          :class="{
                            'bg-badge-success-solid-bg': group.status === 'all-pass',
                            'bg-badge-warning-solid-bg':
                              group.status === 'mixed' || group.status === 'all-warning',
                            'bg-badge-error-solid-bg': group.status === 'all-fail',
                          }"
                        />
                        <span class="text-text-secondary text-xs font-semibold">
                          {{ group.location }}
                        </span>
                      </div>
                      <!--
                      Per-execution detail rows: only rendered for browser monitors
                      where each execution carries a browser engine + device.
                      Non-browser monitors only have locations — the group header
                      above (dot + location name) is the full summary.
                    -->
                      <template v-if="isBrowser">
                        <div
                          v-for="(exec, eIdx) in group.executions"
                          :key="eIdx"
                          class="flex items-center gap-1.5 py-0.5 pl-4"
                        >
                          <span
                            class="h-2 w-2 shrink-0 rounded-full"
                            :class="{
                              'bg-badge-success-solid-bg': exec.status === 'pass',
                              'bg-badge-warning-solid-bg': exec.status === 'warning',
                              'bg-badge-error-solid-bg':
                                exec.status === 'fail' || exec.status === 'error',
                            }"
                          />
                          <img
                            v-if="browserIconUrl(exec.browserEngine)"
                            :src="browserIconUrl(exec.browserEngine)"
                            class="h-3.5 w-3.5"
                            alt=""
                          />
                          <span class="text-text-secondary text-xs">{{ exec.device }}</span>
                        </div>
                      </template>
                    </template>
                  </div>
                </template>
              </OTooltip>
            </div>
          </div>
        </div>
        <OButton
          variant="ghost"
          size="icon-xs"
          :disabled="!canScrollRight"
          data-test="synthetics-timeline-scroll-right-btn"
          :aria-label="t('synthetics.timeline.scrollRight')"
          @click="scrollTimeline('right')"
        >
          <OIcon name="chevron-right" size="xs" />
        </OButton>
      </div>
      <div class="text-3xs text-text-secondary flex justify-between font-mono tabular-nums">
        <span>{{ endLabel }}</span>
        <span>{{ rangeLabel }}</span>
        <span>{{ startLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import chromiumSvgUrl from "@/assets/images/synthetics/chromium.svg";
import firefoxSvgUrl from "@/assets/images/synthetics/firefox.svg";
import webkitSvgUrl from "@/assets/images/synthetics/webkit.svg";
import {
  rollUpStatus,
  type AggregateStatus,
  type ExecutionStatus,
  type StatusTally,
} from "@/utils/synthetics/rollUpStatus";

defineOptions({ name: "MonitorStatusTimeline" });

const { t } = useI18nTyped();

const MAX_VISIBLE = 30;

/**
 * Width-per-segment as a percentage string.
 * :style binding is required because the width is a fractional percentage
 * computed from MAX_VISIBLE, not a fixed class value.
 */
const segmentWidthPct = computed(() => `${100 / MAX_VISIBLE}%`);

interface TimelineExecution {
  location: string;
  browserEngine: string;
  device: string;
  status: ExecutionStatus;
  errorSnippet: string | null;
}

interface TimelineSegment {
  runId: string;
  status: AggregateStatus;
  color: string;
  title: I18nText;
  /** Epoch ms of the first execution in this logical run. */
  timestampMs: number;
  executions: TimelineExecution[];
  /** Bucket counts, computed by the parent alongside `title` so the tooltip
   * header and the segment title cannot report the same run differently. */
  tally: StatusTally;
}

interface TimelineLane {
  label: string;
  /** Aligned with `segments` by index; null = this run never touched the lane's
   *  environment, rendered as an empty slot so columns stay comparable. */
  segments: (TimelineSegment | null)[];
}

interface Props {
  segments: TimelineSegment[];
  /** One strip per environment; null/empty keeps the single blended strip. */
  lanes?: TimelineLane[] | null;
  failCount: string;
  passCount: string;
  mixedCount: string;
  startLabel: string;
  endLabel: string;
  isBrowser?: boolean;
  /** The runs query hit its row cap, so these segments are the most recent
   * slice of the window rather than all of it. */
  truncated?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  lanes: null,
  isBrowser: true,
  truncated: false,
});

const isLaned = computed(() => (props.lanes?.length ?? 0) > 0);

interface TimelineCell {
  seg: TimelineSegment | null;
  laneLabel: string | null;
}

/** One column per logical run; single mode is just the one-cell case. */
const columns = computed<{ key: string; cells: TimelineCell[] }[]>(() =>
  isLaned.value
    ? props.segments.map((seg, i) => ({
        key: seg.runId,
        cells: props.lanes!.map((lane) => ({
          seg: lane.segments[i] ?? null,
          laneLabel: lane.label,
        })),
      }))
    : props.segments.map((seg) => ({ key: seg.runId, cells: [{ seg, laneLabel: null }] })),
);

const browserIconUrl = (name: string): string => {
  switch (name) {
    case "Chromium":
      return chromiumSvgUrl;
    case "Firefox":
      return firefoxSvgUrl;
    case "WebKit":
      return webkitSvgUrl;
    default:
      return "";
  }
};

interface ExecGroup {
  location: string;
  status: AggregateStatus;
  executions: TimelineExecution[];
}

function groupedByLocation(execs: TimelineExecution[]): ExecGroup[] {
  const map = new Map<string, TimelineExecution[]>();
  for (const exec of execs) {
    const list = map.get(exec.location);
    if (list) list.push(exec);
    else map.set(exec.location, [exec]);
  }
  return Array.from(map, ([location, executions]) => ({
    location,
    // Same roll-up as the segment above it. Inlining a second copy here is what
    // let the location dot stay green on a location that warned.
    status: rollUpStatus(executions.map((e) => e.status)),
    executions,
  }));
}

// ── Scroll state ────────────────────────────────────────────────────────
const scrollRef = ref<HTMLElement | null>(null);
const scrollLeft = ref(0);

const canScrollLeft = computed(() => scrollLeft.value > 1);
const canScrollRight = computed(() => {
  const el = scrollRef.value;
  if (!el) return false;
  return el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
});

const rangeLabel = computed(() => {
  const total = props.segments.length;
  const page = Math.round(scrollLeft.value / (scrollRef.value?.clientWidth ?? 1));
  const start = page * MAX_VISIBLE + 1;
  const end = Math.min((page + 1) * MAX_VISIBLE, total);
  const range = t("synthetics.timeline.rangeLabel", { start, end, total });
  // The KPI cards above aggregate the whole window; these segments come from a
  // capped list query. Say so, rather than letting a truncated set read as the
  // complete picture and leave the two silently disagreeing.
  return props.truncated ? `${range} · ${t("synthetics.timeline.mostRecent")}` : range;
});

function scrollTimeline(direction: "left" | "right") {
  const el = scrollRef.value;
  if (!el) return;
  const pageWidth = el.clientWidth;
  const target =
    direction === "left"
      ? Math.max(0, el.scrollLeft - pageWidth)
      : Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + pageWidth);
  el.scrollTo({ left: target, behavior: "smooth" });
}

function onScroll(event: Event) {
  scrollLeft.value = (event.target as HTMLElement).scrollLeft;
}
</script>
