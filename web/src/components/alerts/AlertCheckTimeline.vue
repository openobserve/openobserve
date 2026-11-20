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

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { durationWords } from "@/utils/alerts/alertCopy";
import {
  CAPTION_KEYS,
  checkTimeline,
  scheduleOverlap,
  shortSpan,
} from "@/utils/alerts/scheduleOverlap";
import { calculateWidthText } from "@/utils/dashboard/chartDimensionUtils";

const props = defineProps<{
  /** Minutes between checks. */
  frequency: number;
  /** Minutes of data each check reads. */
  period: number;
  /** A forecast fits a trend over this window, whatever the look back, so gaps do not apply. */
  forecastWindow?: I18nText;
  /** PromQL reads a series' latest value or any crossing, so the window means something else there. */
  queryCondition?: {
    type?: string;
    promql_multi_alert?: boolean;
    promql_rule_mode?: boolean;
  } | null;
  /** Checks run on the clock grid, so equal windows are fixed blocks a burst can straddle. */
  aligned?: boolean;
  /** Set for a cron schedule: the drawing shows its last two runs in this timezone. */
  cron?: string | null;
  timezone?: string | null;
}>();

// One fixed drawing height whatever the values, so nothing below moves as they change.
const HEIGHT = 84;
const INSET = 8;
const LANE_TOP = 24;
const LANE_HEIGHT = 14;
const LANE_GAP = 6;
const LANES_BOTTOM = LANE_TOP + 2 * LANE_HEIGHT + LANE_GAP;
const AXIS_Y = LANES_BOTTOM + 6;
const CALLOUT_Y = 13;
const BRACKET_Y = 17;
const TICK_Y = AXIS_Y + 14;
const LABEL_GAP = 10;
// eslint-disable-next-line local/no-hardcoded-px -- canvas measureText needs the px the text-2xs labels render at
const LABEL_FONT = "11px";
const TICK_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880, 10080];
const MINUTE_MS = 60_000;

const { t } = useI18nTyped();
const patternId = `check-timeline-gap-${useId()}`;
// The sentence says how checks read the data; the drawing opens on request.
const stripOpen = ref(false);
const plotHost = ref<HTMLElement | null>(null);
const width = ref(600);
const nowMs = ref(Date.now());
let resizeObserver: ResizeObserver | null = null;
let clock: ReturnType<typeof setInterval> | null = null;

const promqlLatest = computed(() => {
  const query = props.queryCondition;
  return query?.type === "promql" && !query.promql_rule_mode && !!query.promql_multi_alert;
});
const isCron = computed(() => props.cron != null);
const model = computed(() =>
  checkTimeline(
    {
      frequency: Number(props.frequency),
      period: Number(props.period),
      promqlLatest: promqlLatest.value,
      cron: props.cron,
      timezone: props.timezone,
      nowMs: nowMs.value,
    },
    t,
  ),
);
// Today's rule for cron stays: no row when the expression does not parse.
const shown = computed(() => !isCron.value || model.value !== null);

const caption = computed(() => {
  if (props.forecastWindow)
    return t("alerts.form.schedule.forecast", { window: props.forecastWindow });
  const period = durationWords(props.period, t);
  if (promqlLatest.value) return t("alerts.form.schedule.promqlLatest", { period });
  if (model.value?.cron) return model.value.cron.sentence;
  const overlap = scheduleOverlap(props.period, props.frequency);
  const words = t(CAPTION_KEYS[overlap.kind], {
    period,
    minutes: durationWords(overlap.minutes, t),
  });
  const query = props.queryCondition;
  if (query?.type === "promql" && !query.promql_rule_mode) {
    return t("alerts.form.schedule.promqlAny", { period, overlap: words });
  }
  return props.aligned && overlap.kind === "equal"
    ? t("alerts.form.schedule.alignedBlocks", { period })
    : words;
});

const textWidth = (text: string) => calculateWidthText(text, LABEL_FONT);
const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

const drawing = computed(() => {
  const m = model.value;
  if (!m) return null;
  const plotWidth = Math.max(width.value - 2 * INSET, 1);
  const bars = m.checks.map((end) => [end - m.period, end] as const);
  const first = Math.min(bars[0][0], bars[1][0], m.checks[1]);
  const pad = Math.max(-first, 1) * 0.015;
  const start = first - pad;
  const end = Math.max(0, m.checks[1]) + pad * 0.5;
  const x = (minutes: number) => INSET + ((minutes - start) / (end - start)) * plotWidth;
  const names = [t("alerts.sections.timeline.previous"), t("alerts.sections.timeline.latest")];
  const lanes = bars.map(([from, to], index) => {
    const left = x(from);
    const barWidth = Math.max(x(to) - left, 1);
    return {
      key: index,
      x: left,
      y: LANE_TOP + index * (LANE_HEIGHT + LANE_GAP),
      width: barWidth,
      end: x(to),
      sample: x(to - m.period * 0.08),
      name: names[index],
      nameFits: textWidth(names[index]) + 12 <= barWidth,
    };
  });
  const tinted = m.relation !== "promql" && !props.forecastWindow;
  const [previous, latest] = bars;
  const column =
    tinted && m.relation === "overlap"
      ? { kind: "overlap", from: x(latest[0]), to: x(previous[1]) }
      : tinted && m.relation === "gaps"
        ? { kind: "gaps", from: x(previous[1]), to: x(latest[0]) }
        : null;
  const span =
    m.relation === "promql"
      ? [x(latest[0]), x(latest[1])]
      : m.relation === "equal"
        ? [x(previous[1]), x(previous[1])]
        : column
          ? [column.from, column.to]
          : null;
  const calloutWidth = textWidth(m.bracket);
  const callout =
    span && (tinted || m.relation === "promql")
      ? {
          text: m.bracket,
          kind: m.relation,
          from: span[0],
          to: span[1],
          x: clamp((span[0] + span[1]) / 2 - calloutWidth / 2, 0, width.value - calloutWidth),
        }
      : null;
  return { lanes, column, callout, ticks: ticks(m, start, end, x), nowX: x(0) };
});

function ticks(
  m: NonNullable<typeof model.value>,
  start: number,
  end: number,
  x: (minutes: number) => number,
) {
  const span = end - start;
  const cron = m.cron;
  const frequency = Number(props.frequency);
  const pool = cron ? TICK_STEPS : TICK_STEPS.filter((step) => step % frequency === 0);
  const steps = pool.length ? pool : TICK_STEPS;
  const step = steps.find((s) => span / s <= 5) ?? steps[steps.length - 1];
  const anchor = cron ? cron.nowClock : 0;
  const nowLabel = cron
    ? t("alerts.sections.timeline.nowAt", { time: cron.clockAt(0) })
    : t("alerts.sections.timeline.now");
  const last = end - span * (cron ? 0.17 : 0.08);
  const candidates: { at: number; text: I18nText }[] = [];
  const first = cron
    ? Math.ceil((anchor + start) / step) * step - anchor
    : -Math.floor(-start / step) * step;
  for (let at = first; at < last; at += step) {
    if (at - start < span * 0.06) continue;
    candidates.push({
      at,
      text: cron
        ? cron.clockAt(at)
        : t("alerts.sections.timeline.ago", { span: shortSpan(-at, t) }),
    });
  }
  // Right to left from "Now": a label that would touch its neighbour is dropped.
  let limit = width.value - INSET - textWidth(nowLabel) - LABEL_GAP;
  const kept: { key: number; x: number; text: I18nText }[] = [];
  for (const tick of candidates.reverse()) {
    const w = textWidth(tick.text);
    const left = clamp(x(tick.at) - w / 2, 0, width.value - w);
    if (left + w > limit) continue;
    kept.push({ key: tick.at, x: left, text: tick.text });
    limit = left - LABEL_GAP;
  }
  return { now: nowLabel, list: kept };
}

watch(plotHost, (el) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) return;
  width.value = el.clientWidth || width.value;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(([entry]) => {
      width.value = entry.contentRect.width || width.value;
    });
    resizeObserver.observe(el);
  }
});

// A cron drawing is anchored to the clock, so it follows the minute while open.
watch(
  () => stripOpen.value && isCron.value,
  (live) => {
    if (clock) clearInterval(clock);
    clock = null;
    nowMs.value = Date.now();
    if (live) clock = setInterval(() => (nowMs.value = Date.now()), MINUTE_MS);
  },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (clock) clearInterval(clock);
});
</script>

<template>
  <OSettingRow
    v-if="shown"
    :label="t('alerts.sections.timeline.label')"
    fill
    wide
    data-test="add-alert-check-timeline"
  >
    <!-- Pretty wrapping pulls the sentence's last word down with Show/Hide, so the link is never alone. -->
    <p class="text-text-body m-0 text-sm text-pretty" :class="isCron ? 'min-h-15' : 'min-h-10'">
      <span data-test="add-alert-check-timeline-caption">{{ caption }}</span
      >&nbsp;<OButton
        variant="link"
        :aria-expanded="stripOpen"
        data-test="add-alert-check-timeline-toggle"
        @click="stripOpen = !stripOpen"
      >
        {{ stripOpen ? t("common.hide") : t("common.show") }}
      </OButton>
    </p>
    <div v-if="stripOpen" ref="plotHost" class="mt-2 w-full">
      <svg
        v-if="drawing"
        :width="width"
        :height="HEIGHT"
        class="block"
        aria-hidden="true"
        data-test="add-alert-check-timeline-drawing"
      >
        <defs>
          <pattern
            :id="patternId"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="5" height="5" class="fill-status-warning-bg" />
            <line x1="0" y1="0" x2="0" y2="5" stroke-width="1.5" class="stroke-warning/70" />
          </pattern>
        </defs>
        <rect
          v-if="drawing.column"
          :x="drawing.column.from"
          :y="LANE_TOP - 3"
          :width="Math.max(drawing.column.to - drawing.column.from, 1)"
          :height="LANES_BOTTOM - LANE_TOP + 6"
          :class="drawing.column.kind === 'overlap' ? 'fill-accent/30' : ''"
          :fill="drawing.column.kind === 'gaps' ? `url(#${patternId})` : undefined"
          :data-test="`add-alert-check-timeline-${drawing.column.kind}`"
        />
        <line
          v-if="model?.cron"
          :x1="drawing.nowX"
          :x2="drawing.nowX"
          :y1="LANE_TOP - 3"
          :y2="LANES_BOTTOM + 3"
          stroke-dasharray="3 3"
          class="stroke-border-strong"
        />
        <g v-for="lane in drawing.lanes" :key="lane.key">
          <rect
            :x="lane.x"
            :y="lane.y"
            :width="lane.width"
            :height="LANE_HEIGHT"
            rx="3"
            :stroke-dasharray="model?.relation === 'promql' ? '4 3' : undefined"
            :class="model?.relation === 'promql' ? 'fill-accent/10' : 'fill-accent/25'"
            class="stroke-accent"
          />
          <text
            v-if="lane.nameFits"
            :x="lane.x + 6"
            :y="lane.y + LANE_HEIGHT / 2"
            dominant-baseline="central"
            class="fill-text-body text-2xs"
          >
            {{ lane.name }}
          </text>
          <circle
            v-if="model?.relation === 'promql'"
            :cx="lane.sample"
            :cy="lane.y + LANE_HEIGHT / 2"
            r="2.5"
            class="fill-text-heading"
          />
          <circle
            :cx="lane.end"
            :cy="lane.y + LANE_HEIGHT / 2"
            r="4.5"
            stroke-width="2"
            class="fill-accent stroke-surface-overlay"
          />
        </g>
        <template v-if="drawing.callout">
          <path
            v-if="drawing.callout.kind !== 'equal'"
            :d="`M${drawing.callout.from} ${BRACKET_Y + 5}V${BRACKET_Y}H${drawing.callout.to}V${BRACKET_Y + 5}`"
            fill="none"
            :class="
              drawing.callout.kind === 'gaps'
                ? 'stroke-status-warning-text'
                : drawing.callout.kind === 'overlap'
                  ? 'stroke-accent'
                  : 'stroke-border-strong'
            "
          />
          <line
            v-else
            :x1="drawing.callout.from"
            :x2="drawing.callout.from"
            :y1="BRACKET_Y"
            :y2="LANES_BOTTOM + 3"
            class="stroke-text-secondary"
          />
          <text
            :x="drawing.callout.x"
            :y="CALLOUT_Y"
            class="text-2xs font-medium"
            :class="
              drawing.callout.kind === 'gaps'
                ? 'fill-status-warning-text'
                : drawing.callout.kind === 'overlap'
                  ? 'fill-accent'
                  : 'fill-text-body'
            "
            data-test="add-alert-check-timeline-bracket"
          >
            {{ drawing.callout.text }}
          </text>
        </template>
        <line
          :x1="INSET"
          :x2="width - INSET"
          :y1="AXIS_Y"
          :y2="AXIS_Y"
          class="stroke-border-strong"
        />
        <text
          v-for="tick in drawing.ticks.list"
          :key="tick.key"
          :x="tick.x"
          :y="TICK_Y"
          class="fill-text-secondary text-2xs"
        >
          {{ tick.text }}
        </text>
        <text :x="width - INSET" :y="TICK_Y" text-anchor="end" class="fill-text-secondary text-2xs">
          {{ drawing.ticks.now }}
        </text>
      </svg>
    </div>
  </OSettingRow>
</template>
