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
  <div
    class="flex border-b border-border-default cursor-pointer hover:bg-hover-gray relative py-1.5 gap-3 transition-colors duration-150 ease-in-out"
    :class="wrap ? 'items-start' : 'items-center'"
    @click="$emit('click', pattern, index)"
    :data-test="`pattern-card-${index}`"
  >
    <!-- Status level left border (colored via currentColor from the severity class) -->
    <div class="absolute left-0 inset-y-0 w-1 z-10 bg-current" :class="severityClass" />

    <!-- Count + share bar -->
    <div class="w-28 flex-shrink-0 pl-3 pr-1">
      <div
        class="text-sm font-bold tabular-nums text-text-body"
        :data-test="`pattern-card-${index}-frequency`"
        :title="
          volumeCount !== null
            ? t('logs.patternList.exactCountTooltip', { count: volumeCount.toLocaleString() })
            : undefined
        "
      >
        {{ countLabel }}
      </div>
      <div
        class="text-2xs text-text-secondary tabular-nums"
        :data-test="`pattern-card-${index}-percentage`"
      >
        {{ percentageLabel }}
      </div>
      <div class="mt-1 h-1 rounded-full bg-card-glass-border overflow-hidden">
        <div
          class="h-full rounded-full bg-current opacity-60"
          :class="[severityClass, shareWidthClass]"
        />
      </div>
    </div>

    <!-- Volume sparkline -->
    <div class="w-44 flex-shrink-0 flex items-center">
      <PatternVolumeCell :pattern="pattern" :color-class="severityClass" @volume="onVolume" />
    </div>

    <!-- Status -->
    <div class="w-20 flex-shrink-0 flex items-center gap-1.5">
      <span class="w-2 h-2 rounded-full bg-current shrink-0" :class="severityClass" />
      <span
        class="text-xs font-medium truncate"
        :class="severityClass"
        :data-test="`pattern-card-${index}-status`"
      >
        {{ statusLabel }}
      </span>
    </div>

    <!-- Service -->
    <div
      class="w-32 flex-shrink-0 flex items-center gap-1 min-w-0"
      :data-test="`pattern-card-${index}-service`"
    >
      <template v-if="pattern.service">
        <span class="text-xs text-text-secondary truncate">{{ pattern.service }}</span>
        <span
          v-if="pattern.service_other_count > 0"
          class="text-2xs text-text-secondary bg-card-glass-solid border border-solid border-border-default rounded-default px-1 shrink-0"
        >
          +{{ pattern.service_other_count }}
          <OTooltip
            :content="t('logs.patternList.serviceOthers', { count: pattern.service_other_count })"
          />
        </span>
      </template>
      <span v-else class="text-2xs text-text-muted">—</span>
    </div>

    <!-- Message: badges row + tokenized template -->
    <div class="flex-1 min-w-0" :class="wrap ? '' : 'overflow-hidden'">
      <!-- Trend / rarity / anomaly badges -->
      <div
        v-if="badges.length || pattern.is_anomaly"
        class="flex items-center gap-1 mb-1 flex-wrap"
      >
        <span
          v-for="badge in badges"
          :key="badge.key"
          class="inline-flex items-center rounded-default px-1 text-2xs font-bold uppercase tracking-wide cursor-help"
          :class="badge.class"
          :data-test="`pattern-card-${index}-badge-${badge.key}`"
        >
          {{ badge.label }}
          <OTooltip :content="badge.desc" />
        </span>
        <span
          v-if="pattern.is_anomaly"
          class="inline-flex items-center rounded-default px-1 text-2xs font-bold uppercase tracking-wide text-status-error-text bg-status-error-bg cursor-help"
          :data-test="`pattern-card-${index}-anomaly-badge`"
        >
          {{ t("search.anomalyLabel") }}
          <OTooltip :content="anomalyExplanationText" max-width="22rem" />
        </span>
      </div>

      <!-- Continuous message line with variable segments highlighted inline
           (amber), no pill; constant text stays plain. -->
      <div
        class="font-mono text-xs w-full text-text-secondary"
        :class="
          wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-hidden text-ellipsis'
        "
        :data-test="`pattern-card-${index}-template`"
      >
        <template v-for="(tok, i) in templateTokens" :key="i">
          <span v-if="tok.kind === 'text'">
            <template v-for="(seg, si) in highlightLevels(tok.value)" :key="si">
              <span v-if="seg.colorClass" :class="seg.colorClass" class="font-bold">{{
                seg.text
              }}</span>
              <span v-else>{{ seg.text }}</span>
            </template>
          </span>
          <span
            v-else
            class="rounded-default px-0.5 bg-pattern-var-bg text-pattern-var-text"
            data-test="pattern-card-wildcard-chip"
            @mouseenter="onMouseEnter(tok.value, tok.sampleValues, $event)"
            @mouseleave="onMouseLeave"
            >{{ tok.mask ?? wildcardLabel(tok.value, tok.sampleValues) }}</span
          >
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import PatternVolumeCell from "./PatternVolumeCell.vue";
import {
  tokenizeTemplate,
  wildcardLabel,
  anomalyExplanation,
} from "@/composables/useLogs/useTemplateTokenizer";
import {
  patternSeverityKeyForPattern,
  severityTextClass,
  patternTrendBadge,
  levelColorClass,
  compactCount,
  LEVEL_KEYWORD_PATTERN,
  PATTERN_BADGES,
  type PatternSeverityKey,
} from "./patternUtils";
import useWildcardHover from "./useWildcardHover";

const props = defineProps<{
  pattern: any;
  index: number;
  wrap?: boolean;
  /** Highest display count across the (filtered) pattern set — scales the share bar. */
  maxFrequency?: number;
}>();

defineEmits<{
  (e: "click", pattern: any, index: number): void;
}>();

const { t } = useI18n();
const { onMouseEnter, onMouseLeave } = useWildcardHover();

const templateTokens = computed(() =>
  tokenizeTemplate(props.pattern.template ?? "", props.pattern.wildcard_values ?? []),
);

const anomalyExplanationText = computed(() => anomalyExplanation(props.pattern, t));

// Window-wide occurrences for this pattern, reported by the volume cell once
// its lazy query resolves. Until then we show the extraction sample's count.
//
// Marked `~` because it counts logs matching the template's constant text via
// match_all(), which is a superset of the pattern's own logs — a real magnitude
// for THIS pattern, but not a slice of a partition, so it is never summed.
const volumeCount = ref<number | null>(null);
const volumeBuckets = ref<number[] | null>(null);
// null clears both — on a re-run the cell reports null before the new volume
// arrives, so the row falls back to the sample count and drops its trend badge
// instead of displaying figures from the previous query window.
const onVolume = (volume: { total: number; buckets: number[] } | null) => {
  volumeCount.value = volume?.total ?? null;
  volumeBuckets.value = volume?.buckets ?? null;
};

const countLabel = computed(() =>
  volumeCount.value !== null
    ? `~${compactCount(volumeCount.value)}`
    : (props.pattern.frequency ?? 0).toLocaleString(),
);

// Share of the analyzed sample — a clean partition (every analyzed log belongs
// to exactly one pattern), so these percentages sum to ~100%.
const percentageLabel = computed(() => `${(props.pattern.percentage ?? 0).toFixed(2)}%`);

const severityKey = computed<PatternSeverityKey>(() => patternSeverityKeyForPattern(props.pattern));
const severityClass = computed(() => severityTextClass(severityKey.value));

const STATUS_LABEL_KEY: Record<PatternSeverityKey, string> = {
  error: "logs.patternList.statusError",
  warning: "logs.patternList.statusWarning",
  info: "logs.patternList.statusInfo",
  debug: "logs.patternList.statusDebug",
  uncategorized: "logs.patternList.statusUncategorized",
};
const statusLabel = computed(() => t(STATUS_LABEL_KEY[severityKey.value]));

// Share bar width: snap the frequency-vs-max ratio to twelfths (rem-free,
// no inline style). Zero when there's no max to compare against.
const SHARE_WIDTHS = [
  "w-1/12",
  "w-2/12",
  "w-3/12",
  "w-4/12",
  "w-5/12",
  "w-6/12",
  "w-7/12",
  "w-8/12",
  "w-9/12",
  "w-10/12",
  "w-11/12",
];
const shareWidthClass = computed(() => {
  const max = props.maxFrequency ?? 0;
  const freq = props.pattern.frequency ?? 0;
  if (max <= 0 || freq <= 0) return "w-0";
  const twelfths = Math.min(12, Math.max(1, Math.round((freq / max) * 12)));
  return twelfths >= 12 ? "w-full" : SHARE_WIDTHS[twelfths - 1];
});

// Trend + rarity badges, sourced from the shared PATTERN_BADGES definitions.
// Each carries a `desc` shown as a hover tooltip (replacing the standalone
// legend), so the meaning is available in-context on every instance.
const badges = computed(() => {
  const out: { key: string; label: string; class: string; desc: string }[] = [];
  const pushBadge = (key: string) => {
    const def = PATTERN_BADGES[key];
    out.push({ key, label: t(def.labelKey), class: def.class, desc: t(def.descKey) });
  };
  // Trend comes from the fetched histogram — TRUE volume over the window — not
  // from `pattern.time_buckets`. Those are the extraction sample, and the
  // sampler deliberately gives every time slice a roughly equal row quota, so a
  // real traffic spike flattens out and quiet slices are over-weighted. Reading
  // them as volume made 78 of 115 patterns claim "drop" on the same data.
  // No badge until the volume lands: silence beats a confident wrong signal.
  const trend = patternTrendBadge(volumeBuckets.value);
  if (trend) {
    pushBadge(trend);
  }
  if ((props.pattern.percentage ?? 100) < 1) {
    pushBadge("rare");
  }
  return out;
});

interface HighlightSegment {
  text: string;
  colorClass: string | null;
}

// Color level keywords inside constant text. Both the keyword list and the
// color mapping come from patternUtils, so they can't drift from the status
// column / severity chips (a fresh regex per call keeps lastIndex clean).
function highlightLevels(text: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(`\\b(${LEVEL_KEYWORD_PATTERN})\\b`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), colorClass: null });
    }
    segments.push({
      text: match[0],
      colorClass: levelColorClass(match[0]),
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), colorClass: null });
  }
  return segments;
}
</script>
