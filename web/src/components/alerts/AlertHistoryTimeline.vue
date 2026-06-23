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
  <div class="tw:flex tw:flex-col tw:gap-1.5 tw:w-full tw:shrink-0 tw:px-1 tw:py-2">
    <!-- Header row: oldest … legend … newest -->
    <div class="tw:flex tw:items-center tw:justify-between tw:px-1">
      <span class="tw:text-[11px] tw:tabular-nums" style="color: var(--color-text-caption)">
        {{ oldestLabel }}
      </span>

      <div class="tw:flex tw:items-center tw:gap-3">
        <span v-if="firingCount > 0" class="tw:flex tw:items-center tw:gap-1 tw:text-[11px]">
          <span class="tw:inline-block tw:w-2 tw:h-2 tw:rounded-sm" style="background: var(--color-badge-error-solid-bg)" />
          <span class="tw:font-medium" style="color: var(--color-badge-error-soft-text)">{{ firingCount }} Firing</span>
        </span>
        <span class="tw:flex tw:items-center tw:gap-1 tw:text-[11px]" style="color: var(--color-text-secondary)">
          <span class="tw:inline-block tw:w-2 tw:h-2 tw:rounded-sm" style="background: var(--color-badge-success-solid-bg)" />
          {{ okCount }} Ok
        </span>
        <span v-if="skippedCount > 0" class="tw:flex tw:items-center tw:gap-1 tw:text-[11px]" style="color: var(--color-text-muted)">
          <span class="tw:inline-block tw:w-2 tw:h-2 tw:rounded-sm" style="background: var(--color-border-default)" />
          {{ skippedCount }} Skipped
        </span>
        <span v-if="hasFlappingZone" class="tw:flex tw:items-center tw:gap-1 tw:text-[11px] tw:font-semibold" style="color: #7c3aed; filter: brightness(0.9)">
          <span class="tw:inline-block tw:w-2 tw:h-2 tw:rounded-sm" style="background: #7c3aed" />
          Flapping
        </span>
      </div>

      <span class="tw:text-[11px] tw:tabular-nums" style="color: var(--color-text-caption)">
        {{ newestLabel }}
      </span>
    </div>

    <!-- Timeline strip + transition labels -->
    <div class="tw:flex tw:flex-col tw:gap-[3px] tw:w-full tw:px-1">

    <!-- Strip -->
    <div class="tw:flex tw:gap-[2px] tw:w-full tw:h-6 tw:items-stretch">
      <template v-for="(seg, i) in segments" :key="i">
        <!-- Flapping zone segment -->
        <div
          v-if="seg.type === 'flapping'"
          class="tw:flex tw:items-center tw:justify-center tw:rounded-sm tw:cursor-default tw:relative tw:transition-opacity tw:duration-100 hover:tw:opacity-80 tw:overflow-clip"
          :style="{ flex: seg.weight, minWidth: '12px', background: '#7c3aed' }"
          @mouseenter="hoveredIndex = i"
          @mouseleave="hoveredIndex = null"
        >
          <span class="tw:text-[11px] tw:select-none tw:font-semibold tw:leading-none tw:tracking-wide tw:px-1 tw:truncate" style="color: #fff">⚡ Flapping</span>
          <div v-if="hoveredIndex === i" class="o2-timeline-tooltip">
            <div class="tw:font-semibold tw:flex tw:items-center tw:gap-1">
              <span>⚡ Flapping Zone</span>
            </div>
            <div class="tw:opacity-70 tw:mt-0.5">{{ seg.startLabel }} – {{ seg.endLabel }}</div>
            <div class="tw:opacity-60 tw:text-[10px] tw:mt-0.5">{{ seg.count }} transitions</div>
          </div>
        </div>

        <!-- Normal block -->
        <div
          v-else
          class="tw:flex-1 tw:rounded-sm tw:min-w-[4px] tw:cursor-default tw:relative tw:transition-opacity tw:duration-100 hover:tw:opacity-75"
          :style="{ flex: seg.weight, background: blockColor(seg.status) }"
          @mouseenter="hoveredIndex = i"
          @mouseleave="hoveredIndex = null"
        >
          <div v-if="hoveredIndex === i" class="o2-timeline-tooltip">
            <div class="tw:font-semibold tw:capitalize tw:flex tw:items-center tw:gap-1.5">
              <span
                class="tw:inline-block tw:w-2 tw:h-2 tw:rounded-sm tw:shrink-0"
                :style="{ background: blockColor(seg.status) }"
              />
              {{ normalizeStatus(seg.status) }}
            </div>
            <div class="tw:opacity-60 tw:mt-0.5">{{ seg.startLabel }}</div>
            <div v-if="seg.count > 1" class="tw:opacity-50 tw:text-[10px]">{{ seg.count }} evaluations</div>
          </div>
        </div>
      </template>
    </div><!-- /strip -->

    <!-- Transition tick labels — one label per segment boundary (skip first = oldestLabel) -->
    <div class="tw:flex tw:w-full tw:relative tw:h-[14px]">
      <template v-for="(seg, i) in segments" :key="i">
        <div :style="{ flex: seg.weight, minWidth: 0, position: 'relative' }">
          <!-- Show label at the left edge of every segment except the first -->
          <span
            v-if="i > 0"
            class="tw:absolute tw:left-0 tw:top-0 tw:text-[10px] tw:tabular-nums tw:whitespace-nowrap tw:translate-x-[-50%]"
            style="color: var(--color-text-caption)"
          >
            {{ seg.startLabel }}
          </span>
        </div>
      </template>
    </div><!-- /tick labels -->

    </div><!-- /strip + labels wrapper -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{
  history: Array<{ status: string; timestamp: number }>;
}>();

const hoveredIndex = ref<number | null>(null);

// ── Status helpers ──────────────────────────────────────────────────────────

function isFiring(s: string) {
  const v = s?.toLowerCase();
  return v === "firing" || v === "error" || v === "anomaly" || v === "completed";
}

function isOk(s: string) {
  const v = s?.toLowerCase();
  return v === "ok" || v === "success" || v === "normal" || v === "condition_not_satisfied";
}

function normalizeStatus(s: string): string {
  const v = s?.toLowerCase();
  if (isFiring(v)) return "Firing";
  if (isOk(v)) return "Ok";
  if (v === "skipped") return "Skipped";
  return s?.replace(/_/g, " ") ?? "Unknown";
}

function blockColor(status: string): string {
  if (isFiring(status)) return "var(--color-badge-error-solid-bg)";
  if (isOk(status)) return "var(--color-badge-success-solid-bg)";
  return "var(--color-border-default)";
}

// ── Sorted rows ─────────────────────────────────────────────────────────────

const sorted = computed(() =>
  [...props.history].sort((a, b) => a.timestamp - b.timestamp),
);

// ── Stats ───────────────────────────────────────────────────────────────────

const firingCount = computed(() => props.history.filter((r) => isFiring(r.status)).length);
const okCount     = computed(() => props.history.filter((r) => isOk(r.status)).length);
const skippedCount = computed(() =>
  props.history.filter((r) => !isFiring(r.status) && !isOk(r.status)).length,
);

// ── Flapping detection ───────────────────────────────────────────────────────
const MIN_WINDOW      = 4;
const MIN_TRANSITIONS = 3;
const MAX_STABLE_TAIL = 2;

type RowState = "firing" | "ok" | "other";
function rowState(s: string): RowState {
  if (isFiring(s)) return "firing";
  if (isOk(s)) return "ok";
  return "other";
}

const flappingMask = computed<boolean[]>(() => {
  const rows = sorted.value;
  const n = rows.length;
  const mask = new Array(n).fill(false);

  let i = 0;
  while (i < n) {
    let transitions = 0;
    let prev = rowState(rows[i].status);
    let windowEnd = -1;
    for (let j = i + 1; j < Math.min(i + MIN_WINDOW + 10, n); j++) {
      const cur = rowState(rows[j].status);
      if (cur !== "other" && prev !== "other" && cur !== prev) transitions++;
      if (cur !== "other") prev = cur;
      if (transitions >= MIN_TRANSITIONS) { windowEnd = j; break; }
    }
    if (windowEnd === -1) { i++; continue; }

    let zoneEnd = windowEnd;
    let stableTail = 0;
    let lastState = rowState(rows[zoneEnd].status);
    for (let j = zoneEnd + 1; j < n; j++) {
      const cur = rowState(rows[j].status);
      if (cur === "other") { zoneEnd = j; stableTail = 0; continue; }
      if (cur !== lastState) {
        lastState = cur; zoneEnd = j; stableTail = 0;
      } else {
        stableTail++;
        if (stableTail >= MAX_STABLE_TAIL) break;
        zoneEnd = j;
      }
    }
    // trim stable tail
    while (zoneEnd > windowEnd && rowState(rows[zoneEnd].status) === rowState(rows[zoneEnd - 1].status)) {
      zoneEnd--;
    }

    for (let k = i; k <= zoneEnd; k++) mask[k] = true;
    i = zoneEnd + 1;
  }
  return mask;
});

const hasFlappingZone = computed(() => flappingMask.value.some(Boolean));

// ── Build display segments ───────────────────────────────────────────────────
// Merge consecutive rows of same type (flapping / normal-status) into one segment.
// Weight = number of rows in segment (proportional width).

type Segment =
  | { type: "flapping"; weight: number; count: number; startLabel: string; endLabel: string }
  | { type: "normal";   weight: number; count: number; status: string; startLabel: string };

const MAX_BLOCKS = 60;

const segments = computed<Segment[]>(() => {
  const rows = sorted.value;
  if (!rows.length) return [];

  // If too many rows, bucket first (preserving flapping mask per bucket)
  let displayRows: Array<{ status: string; timestamp: number; flapping: boolean }>;

  if (rows.length <= MAX_BLOCKS) {
    displayRows = rows.map((r, i) => ({
      status: r.status,
      timestamp: r.timestamp,
      flapping: flappingMask.value[i],
    }));
  } else {
    const bucketSize = rows.length / MAX_BLOCKS;
    displayRows = Array.from({ length: MAX_BLOCKS }, (_, b) => {
      const start = Math.floor(b * bucketSize);
      const end   = Math.min(Math.floor((b + 1) * bucketSize), rows.length);
      const bucket = rows.slice(start, end);
      const bucketFlapping = flappingMask.value.slice(start, end).some(Boolean);
      // worst status in bucket
      const status = bucket.some((r) => isFiring(r.status))
        ? "firing"
        : bucket.some((r) => isOk(r.status))
          ? "ok"
          : "skipped";
      return { status, timestamp: bucket[0].timestamp, flapping: bucketFlapping };
    });
  }

  // Merge consecutive same-type runs
  const segs: Segment[] = [];
  let i = 0;
  while (i < displayRows.length) {
    const cur = displayRows[i];
    if (cur.flapping) {
      let j = i;
      while (j < displayRows.length && displayRows[j].flapping) j++;
      segs.push({
        type: "flapping",
        weight: j - i,
        count: j - i,
        startLabel: formatTimestamp(displayRows[i].timestamp),
        endLabel: formatTimestamp(displayRows[j - 1].timestamp),
      });
      i = j;
    } else {
      const status = cur.status;
      let j = i;
      while (j < displayRows.length && !displayRows[j].flapping && displayRows[j].status === status) j++;
      segs.push({
        type: "normal",
        weight: j - i,
        count: j - i,
        status,
        startLabel: formatTimestamp(displayRows[i].timestamp),
      });
      i = j;
    }
  }
  return segs;
});

// ── Labels ───────────────────────────────────────────────────────────────────

const oldestLabel = computed(() =>
  sorted.value.length ? formatTimestamp(sorted.value[0].timestamp) : "",
);
const newestLabel = computed(() =>
  sorted.value.length ? formatTimestamp(sorted.value[sorted.value.length - 1].timestamp) : "",
);

function formatTimestamp(ts: number): string {
  if (!ts) return "";
  const ms = ts > 1e12 ? ts / 1000 : ts;
  return new Date(ms).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
</script>

<style scoped>
.o2-timeline-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  white-space: nowrap;
  border-radius: var(--radius-md);
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.4;
  box-shadow: var(--shadow-md);
  pointer-events: none;
  background: var(--color-surface-overlay);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-body);
}
</style>
