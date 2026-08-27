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

<!-- A 24-hour UTC day strip with the given recurring windows filled in — the
     at-a-glance view of a peak / off-peak pricing tier's active hours. A window
     whose start is after its end wraps past midnight and renders as two runs. -->
<template>
  <div class="flex flex-col gap-1" data-test="utc-hours-bar">
    <div
      class="bg-surface-subtle border-card-glass-border relative h-2 overflow-hidden rounded-full border"
    >
      <div
        v-for="(seg, i) in segments"
        :key="i"
        class="bg-accent absolute inset-y-0"
        :style="{ left: seg.left, width: seg.width }"
        :data-test="`utc-hours-bar-segment-${i}`"
      >
        <OTooltip side="top" :side-offset="6" :content="raw(seg.label)" />
      </div>
    </div>
    <div class="text-3xs flex justify-between font-mono opacity-45">
      <span v-for="tick in TICKS" :key="tick">{{ tick }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { minuteOfDayToHhmm } from "@/utils/formatters";

export interface UtcHoursWindow {
  start_minute: number;
  end_minute: number;
}

const props = defineProps<{ windows: UtcHoursWindow[] }>();

const MINUTES_PER_DAY = 1440;

const TICKS = Array.from({ length: 5 }, (_, i) => minuteOfDayToHhmm(i * 360));

function pct(minute: number): string {
  return `${((minute / MINUTES_PER_DAY) * 100).toFixed(4)}%`;
}

interface Segment {
  left: string;
  width: string;
  label: string;
}

function pushRun(out: Segment[], from: number, to: number, label: string) {
  if (to <= from) return;
  out.push({ left: pct(from), width: pct(to - from), label });
}

const segments = computed<Segment[]>(() => {
  const out: Segment[] = [];
  for (const win of props.windows ?? []) {
    const start =
      ((Math.round(win.start_minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const end =
      ((Math.round(win.end_minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    if (start === end) continue; // degenerate — rejected upstream, never drawn
    const label = `${minuteOfDayToHhmm(start)} – ${minuteOfDayToHhmm(end)} UTC`;
    if (start < end) {
      pushRun(out, start, end, label);
    } else {
      // Wraps past midnight: tail of the day + head of the next.
      pushRun(out, start, MINUTES_PER_DAY, label);
      pushRun(out, 0, end, label);
    }
  }
  return out;
});
</script>
