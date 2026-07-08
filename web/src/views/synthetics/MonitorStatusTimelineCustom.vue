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
  MonitorStatusTimelineCustom — HTML/CSS version of the Status Timeline.

  Each segment = one logical run (grouped by runId) with three-color aggregate.
  Smooth scroll navigation with arrow buttons.
  OTooltip hover shows per-execution (location·browser·device) breakdown.
-->
<template>
  <div
    class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
    data-test="monitor-status-timeline-custom"
  >
    <div
      class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
    >
      <span class="font-bold text-xs text-text-heading">
        Status Timeline (Custom)
      </span>
      <span class="flex-1" />
      <span
        class="inline-flex items-center gap-1.5 text-xs text-text-secondary"
      >
        <span
          class="w-[7px] h-[7px] rounded-full bg-[var(--o2-status-error-text)]"
        />
        {{ failCount }} Failed
      </span>
      <span
        class="inline-flex items-center gap-1.5 text-xs text-text-secondary"
      >
        <span
          class="w-[7px] h-[7px] rounded-full bg-[var(--o2-status-warning-text)]"
        />
        {{ mixedCount }} Mixed
      </span>
      <span
        class="inline-flex items-center gap-1.5 text-xs text-text-secondary"
      >
        <span
          class="w-[7px] h-[7px] rounded-full bg-[var(--o2-status-success-text)]"
        />
        {{ passCount }} Passed
      </span>
    </div>
    <div class="border-t border-[var(--o2-border-color)]" />
    <div class="flex flex-col gap-1 py-2 px-[0.875rem]">
      <div class="flex items-center gap-1">
        <button
          class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-transparent border-none cursor-pointer text-text-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
          :disabled="!canScrollLeft"
          @click="scrollTimeline('left')"
          aria-label="Scroll timeline left"
        >
          <OIcon name="chevron-left" size="xs" />
        </button>
        <div
          ref="scrollRef"
          class="flex-1 overflow-hidden flex rounded h-[26px] gap-0.5"
          @scroll="onScroll"
        >
          <div
            v-for="seg in segments"
            :key="seg.runId"
            class="shrink-0 h-full min-w-[3px] cursor-pointer transition-all duration-100 hover:scale-y-[1.35]"
            :style="{ width: 100 / MAX_VISIBLE + '%', background: seg.color }"
          >
            <OTooltip side="top" :delay="0" :max-width="'auto'">
              <template #content>
                <div class="px-1 py-0.5 min-w-[200px]">
                  <div
                    class="font-semibold text-text-heading mb-1.5 text-xs"
                  >
                    {{ seg.title }}
                  </div>
                  <div
                    v-for="(exec, eIdx) in seg.executions"
                    :key="eIdx"
                    class="flex items-center gap-2 py-0.5"
                  >
                    <span
                      class="w-2 h-2 rounded-full shrink-0"
                      :class="
                        exec.status === 'pass'
                          ? 'bg-[var(--o2-status-success-text)]'
                          : 'bg-[var(--o2-status-error-text)]'
                      "
                    />
                    <span class="text-text-body">{{ exec.location }}</span>
                    <span class="text-text-secondary">{{
                      exec.browserEngine
                    }}</span>
                    <span class="text-text-secondary">{{
                      exec.device
                    }}</span>
                  </div>
                </div>
              </template>
            </OTooltip>
          </div>
        </div>
        <button
          class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-transparent border-none cursor-pointer text-text-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
          :disabled="!canScrollRight"
          @click="scrollTimeline('right')"
          aria-label="Scroll timeline right"
        >
          <OIcon name="chevron-right" size="xs" />
        </button>
      </div>
      <div
        class="flex justify-between text-[10.5px] font-mono tabular-nums text-text-secondary"
      >
        <span>{{ endLabel }}</span>
        <span>{{ rangeLabel }}</span>
        <span>{{ startLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineOptions({ name: "MonitorStatusTimelineCustom" });

const MAX_VISIBLE = 30;

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
  const page = Math.round(
    scrollLeft.value / (scrollRef.value?.clientWidth ?? 1),
  );
  const start = page * MAX_VISIBLE + 1;
  const end = Math.min((page + 1) * MAX_VISIBLE, total);
  return "Showing " + start + "-" + end + " of " + total + " runs";
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
