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
    class="card-container tw:rounded-lg tw:flex tw:flex-col tw:bg-[var(--o2-card-bg)] tw:border tw:border-[var(--o2-border-color)] tw:overflow-hidden"
    data-test="monitor-status-timeline-custom"
  >
    <div
      class="tw:flex tw:items-center tw:gap-2 tw:px-[0.875rem] tw:pt-[0.625rem] tw:pb-[0.5rem]"
    >
      <span class="tw:font-bold tw:text-xs tw:text-text-heading">
        Status Timeline (Custom)
      </span>
      <span class="tw:flex-1" />
      <span
        class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-text-secondary"
      >
        <span
          class="tw:w-[7px] tw:h-[7px] tw:rounded-full tw:bg-[var(--o2-status-error-text)]"
        />
        {{ failCount }} Failed
      </span>
      <span
        class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-text-secondary"
      >
        <span
          class="tw:w-[7px] tw:h-[7px] tw:rounded-full tw:bg-[var(--o2-status-warning-text)]"
        />
        {{ mixedCount }} Mixed
      </span>
      <span
        class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-text-secondary"
      >
        <span
          class="tw:w-[7px] tw:h-[7px] tw:rounded-full tw:bg-[var(--o2-status-success-text)]"
        />
        {{ passCount }} Passed
      </span>
    </div>
    <div class="tw:border-t tw:border-[var(--o2-border-color)]" />
    <div class="tw:flex tw:flex-col tw:gap-1 tw:py-2 tw:px-[0.875rem]">
      <div class="tw:flex tw:items-center tw:gap-1">
        <button
          class="tw:shrink-0 tw:inline-flex tw:items-center tw:justify-center tw:w-5 tw:h-5 tw:rounded tw:bg-transparent tw:border-none tw:cursor-pointer tw:text-text-secondary tw:hover:bg-surface-subtle tw:disabled:opacity-30 tw:disabled:cursor-default tw:transition-colors"
          :disabled="!canScrollLeft"
          @click="scrollTimeline('left')"
          aria-label="Scroll timeline left"
        >
          <OIcon name="chevron-left" size="xs" />
        </button>
        <div
          ref="scrollRef"
          class="tw:flex-1 tw:overflow-hidden tw:flex tw:rounded tw:h-[26px] tw:gap-0.5"
          @scroll="onScroll"
        >
          <div
            v-for="seg in segments"
            :key="seg.runId"
            class="tw:shrink-0 tw:h-full tw:min-w-[3px] tw:cursor-pointer tw:transition-all tw:duration-100 hover:tw:scale-y-[1.35]"
            :style="{ width: 100 / MAX_VISIBLE + '%', background: seg.color }"
          >
            <OTooltip side="top" :delay="0" :max-width="'auto'">
              <template #content>
                <div class="tw:px-1 tw:py-0.5 tw:min-w-[200px]">
                  <div
                    class="tw:font-semibold tw:text-text-heading tw:mb-1.5 tw:text-xs"
                  >
                    {{ seg.title }}
                  </div>
                  <div
                    v-for="(exec, eIdx) in seg.executions"
                    :key="eIdx"
                    class="tw:flex tw:items-center tw:gap-2 tw:py-0.5"
                  >
                    <span
                      class="tw:w-2 tw:h-2 tw:rounded-full tw:shrink-0"
                      :class="
                        exec.status === 'pass'
                          ? 'tw:bg-[var(--o2-status-success-text)]'
                          : 'tw:bg-[var(--o2-status-error-text)]'
                      "
                    />
                    <span class="tw:text-text-body">{{ exec.location }}</span>
                    <span class="tw:text-text-secondary">{{
                      exec.browserEngine
                    }}</span>
                    <span class="tw:text-text-secondary">{{
                      exec.device
                    }}</span>
                  </div>
                </div>
              </template>
            </OTooltip>
          </div>
        </div>
        <button
          class="tw:shrink-0 tw:inline-flex tw:items-center tw:justify-center tw:w-5 tw:h-5 tw:rounded tw:bg-transparent tw:border-none tw:cursor-pointer tw:text-text-secondary tw:hover:bg-surface-subtle tw:disabled:opacity-30 tw:disabled:cursor-default tw:transition-colors"
          :disabled="!canScrollRight"
          @click="scrollTimeline('right')"
          aria-label="Scroll timeline right"
        >
          <OIcon name="chevron-right" size="xs" />
        </button>
      </div>
      <div
        class="tw:flex tw:justify-between tw:text-[10.5px] tw:font-mono tw:tabular-nums tw:text-text-secondary"
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
