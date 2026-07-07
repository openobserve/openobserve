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
  <div class="flex flex-col gap-1.5 w-full shrink-0 px-1 py-2">
    <!-- Header row: oldest … legend … newest -->
    <div class="flex items-center justify-between px-1">
      <span class="text-[11px] tabular-nums" style="color: var(--color-text-caption)">
        {{ oldestLabel }}
      </span>

      <div class="flex items-center gap-3">
        <span v-if="firingCount > 0" class="flex items-center gap-1 text-[11px]">
          <span class="inline-block w-2 h-2 rounded-sm" style="background: var(--color-badge-error-solid-bg)" />
          <span class="font-medium" style="color: var(--color-badge-error-soft-text)">{{ firingCount }} Firing</span>
        </span>
        <span class="flex items-center gap-1 text-[11px]" style="color: var(--color-text-secondary)">
          <span class="inline-block w-2 h-2 rounded-sm" style="background: var(--color-badge-success-solid-bg)" />
          {{ okCount }} Ok
        </span>
        <span v-if="skippedCount > 0" class="flex items-center gap-1 text-[11px]" style="color: var(--color-text-muted)">
          <span class="inline-block w-2 h-2 rounded-sm" style="background: var(--color-border-default)" />
          {{ skippedCount }} Skipped
        </span>
        <span v-if="hasFlappingZone" class="flex items-center gap-1 text-[11px] font-semibold" style="color: #7c3aed; filter: brightness(0.9)">
          <span class="inline-block w-2 h-2 rounded-sm o2-flap-swatch" />
          Flapping
        </span>
      </div>

      <span class="text-[11px] tabular-nums" style="color: var(--color-text-caption)">
        {{ newestLabel }}
      </span>
    </div>

    <!-- Timeline strip + transition labels -->
    <div class="flex flex-col gap-[3px] w-full px-1">

    <!-- Strip -->
    <div class="flex gap-[2px] w-full h-6 items-stretch" style="overflow: visible">
      <template v-for="(seg, i) in segments" :key="i">
        <!-- Flapping zone — alternating hatched red/green cells + callout pill -->
        <div
          v-if="seg.type === 'flapping'"
          class="flex gap-[2px] items-stretch relative"
          :style="{ flex: seg.weight, minWidth: '12px' }"
          @mouseenter="hoveredIndex = i"
          @mouseleave="hoveredIndex = null"
        >
          <!-- Persistent callout pill above the zone -->
          <div class="o2-flap-pill">
            <span class="font-semibold">⚡ Flapping</span>
            <span class="o2-flap-pill-dot">•</span>{{ seg.flips }} flips
            <span class="o2-flap-pill-dot">•</span>{{ seg.durationLabel }}
          </div>
          <div
            v-for="(cell, c) in seg.cells"
            :key="c"
            class="flex-1 rounded-sm min-w-[6px]"
            :style="flapCellStyle(cell.status)"
          />
        </div>

        <!-- Normal block -->
        <div
          v-else
          class="flex-1 rounded-sm min-w-[4px] cursor-default relative transition-opacity duration-100 hover:opacity-75"
          :style="{ flex: seg.weight, background: blockColor(seg.status) }"
          @mouseenter="hoveredIndex = i"
          @mouseleave="hoveredIndex = null"
        >
          <div v-if="hoveredIndex === i" class="o2-timeline-tooltip">
            <div class="font-semibold capitalize flex items-center gap-1.5">
              <span
                class="inline-block w-2 h-2 rounded-sm shrink-0"
                :style="{ background: blockColor(seg.status) }"
              />
              {{ normalizeStatus(seg.status) }}
            </div>
            <div class="opacity-60 mt-0.5">{{ seg.startLabel }}</div>
            <div v-if="seg.count > 1" class="opacity-50 text-[10px]">{{ seg.count }} evaluations</div>
          </div>
        </div>
      </template>
    </div><!-- /strip -->

    <!-- Transition tick labels — placed by cumulative width; labels that would
         overlap the previously shown one are skipped to keep them readable. -->
    <div class="w-full relative h-[14px]">
      <span
        v-for="(tick, i) in tickLabels"
        :key="i"
        class="absolute top-0 text-[10px] tabular-nums whitespace-nowrap translate-x-[-50%]"
        :style="{ left: tick.leftPct + '%', color: 'var(--color-text-caption)' }"
      >
        {{ tick.label }}
      </span>
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
  | {
      type: "flapping";
      weight: number;
      count: number;
      cells: Array<{ status: string }>;
      flips: number;
      durationLabel: string;
      startLabel: string;
      endLabel: string;
    }
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
      const cells = displayRows.slice(i, j).map((r) => ({ status: r.status }));
      // flips = number of firing<->ok state changes within the zone
      let flips = 0;
      let prevState = rowState(cells[0].status);
      for (let k = 1; k < cells.length; k++) {
        const s = rowState(cells[k].status);
        if (s !== "other" && prevState !== "other" && s !== prevState) flips++;
        if (s !== "other") prevState = s;
      }
      // duration spans from the zone start to the row just after the zone
      // (or the last zone row if the flapping zone ends the timeline).
      const startTs = displayRows[i].timestamp;
      const endTs = displayRows[j]?.timestamp ?? displayRows[j - 1].timestamp;
      segs.push({
        type: "flapping",
        weight: j - i,
        count: j - i,
        cells,
        flips,
        durationLabel: formatDuration(toMs(endTs) - toMs(startTs)),
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

// ── Tick labels ──────────────────────────────────────────────────────────────
// Position each boundary label by cumulative segment weight (% of total) and
// drop any that would sit too close to the previously shown label so they
// never overlap. Endpoints are already shown as oldest/newest in the header.
const MIN_TICK_GAP_PCT = 7;

const tickLabels = computed<Array<{ leftPct: number; label: string }>>(() => {
  const segs = segments.value;
  const total = segs.reduce((sum, s) => sum + s.weight, 0) || 1;
  const out: Array<{ leftPct: number; label: string }> = [];
  let cum = 0;
  let lastShownPct = -Infinity;
  segs.forEach((seg, i) => {
    if (i > 0) {
      const pct = (cum / total) * 100;
      if (pct - lastShownPct >= MIN_TICK_GAP_PCT && pct <= 100 - MIN_TICK_GAP_PCT) {
        out.push({ leftPct: pct, label: seg.startLabel });
        lastShownPct = pct;
      }
    }
    cum += seg.weight;
  });
  return out;
});

// ── Labels ───────────────────────────────────────────────────────────────────

const oldestLabel = computed(() =>
  sorted.value.length ? formatTimestamp(sorted.value[0].timestamp) : "",
);
const newestLabel = computed(() =>
  sorted.value.length ? formatTimestamp(sorted.value[sorted.value.length - 1].timestamp) : "",
);

function toMs(ts: number): number {
  // Timestamps may arrive in microseconds; normalize to milliseconds.
  return ts > 1e12 ? ts / 1000 : ts;
}

function formatTimestamp(ts: number): string {
  if (!ts) return "";
  return new Date(toMs(ts)).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Diagonal-hatch fill for a flapping cell, tinted by its real status colour.
function flapCellStyle(status: string) {
  return {
    background:
      "repeating-linear-gradient(45deg, rgba(255,255,255,0.32) 0, rgba(255,255,255,0.32) 2px, transparent 2px, transparent 6px), " +
      blockColor(status),
    boxShadow: "inset 0 0 0 1px rgba(124, 58, 237, 0.55)",
  };
}
</script>

<style scoped>
/* Hatched purple swatch used in the legend for the flapping key */
.o2-flap-swatch {
  background:
    repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.4) 0,
      rgba(255, 255, 255, 0.4) 1px,
      transparent 1px,
      transparent 3px
    ),
    #7c3aed;
}

/* Persistent purple callout pill above a flapping zone */
.o2-flap-pill {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #7c3aed;
  box-shadow: var(--shadow-md);
  pointer-events: none;
}
.o2-flap-pill-dot {
  opacity: 0.6;
  font-weight: 400;
}
.o2-flap-pill::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: #7c3aed;
}

.o2-timeline-tooltip {
  position: absolute;
  top: calc(100% + 6px);
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
