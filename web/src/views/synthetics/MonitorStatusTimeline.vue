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
    class="card-container rounded-default flex flex-col bg-surface-base border border-border-default overflow-hidden"
    data-test="monitor-status-timeline"
  >
    <div class="flex items-center gap-2 px-3.5 pt-2.5 pb-2">
      <span class="font-bold text-xs text-text-heading">
        {{ t("synthetics.timeline.title") }}
      </span>
      <span class="flex-1" />
      <span class="inline-flex items-center gap-1.5 text-xs text-text-secondary">
        <span
          class="w-[0.4375rem] h-[0.4375rem] rounded-full bg-[var(--color-badge-error-solid-bg)]"
        />
        {{ failCount }} {{ t("synthetics.timeline.failed") }}
      </span>
      <span class="inline-flex items-center gap-1.5 text-xs text-text-secondary">
        <span
          class="w-[0.4375rem] h-[0.4375rem] rounded-full bg-[var(--color-badge-orange-solid-bg)]"
        />
        {{ mixedCount }} {{ t("synthetics.timeline.warning") }}
      </span>
      <span class="inline-flex items-center gap-1.5 text-xs text-text-secondary">
        <span
          class="w-[0.4375rem] h-[0.4375rem] rounded-full bg-[var(--color-badge-success-solid-bg)]"
        />
        {{ passCount }} {{ t("synthetics.timeline.passed") }}
      </span>
    </div>
    <div class="border-t border-border-default" />
    <div class="flex flex-col gap-1 py-2 px-3.5">
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
        <div
          ref="scrollRef"
          class="flex-1 overflow-hidden flex rounded-default h-6.5 gap-0.5"
          @scroll="onScroll"
        >
          <div
            v-for="seg in segments"
            :key="seg.runId"
            class="shrink-0 h-full min-w-[0.1875rem] cursor-pointer transition-all duration-100 hover:scale-y-[1.35]"
            :style="{ width: segmentWidthPct }"
            :class="seg.color"
          >
            <OTooltip side="top" :delay="0" :max-width="'auto'">
              <template #content>
                <div class="py-0.5 min-w-50">
                  <div
                    class="px-1 font-semibold text-text-secondary mb-1.5 text-xs flex items-center gap-1.5 flex-wrap border-b pb-1"
                  >
                    <span
                      class="w-2 h-2 rounded-full shrink-0 bg-[var(--color-badge-success-solid-bg)]"
                    />
                    <span class="text-text-secondary">{{
                      t("synthetics.timeline.tooltipPassed", {
                        count: passCountLocal(seg.executions),
                      })
                    }}</span>
                    <span
                      class="w-2 h-2 rounded-full shrink-0 bg-[var(--color-badge-error-solid-bg)]"
                    />
                    <span class="text-text-secondary">{{
                      t("synthetics.timeline.tooltipFailed", {
                        count: failCountLocal(seg.executions),
                      })
                    }}</span>
                  </div>
                  <template v-for="(group, gIdx) in groupedByLocation(seg.executions)" :key="gIdx">
                    <div class="px-1 flex items-center gap-1.5 mb-0.5 mt-1 first:mt-0">
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        :class="{
                          'bg-badge-success-solid-bg': group.status === 'all-pass',
                          'bg-color-badge-orange-solid-bg': group.status === 'mixed',
                          'bg-color-badge-error-solid-bg': group.status === 'all-fail',
                        }"
                      />
                      <span class="text-text-secondary text-xs font-semibold">
                        {{ group.location }}
                      </span>
                    </div>
                    <div
                      v-for="(exec, eIdx) in group.executions"
                      :key="eIdx"
                      class="flex items-center gap-1.5 py-0.5 pl-4"
                    >
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        :class="
                          exec.status === 'pass'
                            ? 'bg-[var(--color-badge-success-solid-bg)]'
                            : 'bg-[var(--color-badge-error-solid-bg)]'
                        "
                      />
                      <img
                        v-if="browserIconUrl(exec.browserEngine)"
                        :src="browserIconUrl(exec.browserEngine)"
                        class="w-3.5 h-3.5"
                        alt=""
                      />
                      <span class="text-text-secondary text-xs">{{ exec.device }}</span>
                    </div>
                  </template>
                </div>
              </template>
            </OTooltip>
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
      <div class="flex justify-between text-3xs font-mono tabular-nums text-text-secondary">
        <span>{{ endLabel }}</span>
        <span>{{ rangeLabel }}</span>
        <span>{{ startLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import chromiumSvgUrl from "@/assets/images/synthetics/chromium.svg";
import firefoxSvgUrl from "@/assets/images/synthetics/firefox.svg";
import webkitSvgUrl from "@/assets/images/synthetics/webkit.svg";

defineOptions({ name: "MonitorStatusTimeline" });

const { t } = useI18n();

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
  status: "pass" | "fail";
  errorSnippet: string | null;
}

interface TimelineSegment {
  runId: string;
  status: "all-pass" | "mixed" | "all-fail";
  color: string;
  title: string;
  /** Epoch ms of the first execution in this logical run. */
  timestampMs: number;
  executions: TimelineExecution[];
}

interface Props {
  segments: TimelineSegment[];
  failCount: string;
  passCount: string;
  mixedCount: string;
  startLabel: string;
  endLabel: string;
}
const props = defineProps<Props>();

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
  status: "all-pass" | "mixed" | "all-fail";
  executions: TimelineExecution[];
}

function passCountLocal(execs: TimelineExecution[]): number {
  return execs.filter((e) => e.status === "pass").length;
}
function failCountLocal(execs: TimelineExecution[]): number {
  return execs.filter((e) => e.status === "fail").length;
}

function groupedByLocation(execs: TimelineExecution[]): ExecGroup[] {
  const map = new Map<string, TimelineExecution[]>();
  for (const exec of execs) {
    const list = map.get(exec.location);
    if (list) list.push(exec);
    else map.set(exec.location, [exec]);
  }
  return Array.from(map, ([location, executions]) => {
    const allPass = executions.every((e) => e.status === "pass");
    const allFail = executions.every((e) => e.status === "fail");
    const status = allPass ? "all-pass" : allFail ? "all-fail" : "mixed";
    return { location, status, executions };
  });
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
  return t("synthetics.timeline.rangeLabel", { start, end, total });
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
