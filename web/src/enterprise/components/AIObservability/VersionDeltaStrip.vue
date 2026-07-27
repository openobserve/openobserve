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
  VersionDeltaStrip — one cell per metric in a version-comparison CompareResult.
  Each cell shows the metric label, the dual A/B value (A in --color-accent,
  B in --color-series-b — the same series identity VersionOverlayChart uses),
  and the Δ%
  colored by verdict:
    - "higher" on an up-worse metric (errorRate, p50, p95, cost) = regression = crit.
    - "lower" on an up-worse metric = improvement = good.
    - "nochange", "insufficient", or a non-flagged metric (volume, p99) = neutral.
  P99 is display-only (flagged=false): value + Δ% render but never colored.
  Insufficient-sample cells add an "indicative" label next to the Δ.
  A tooltip on the Δ (when a CI is present) explains the interval + method, and
  phrases the verdict as associative ("higher/lower") or causal
  ("regressed/improved") depending on `associative`.
-->
<template>
  <!-- Even grid (matches the page's KpiCardRow layout + gap-2.5) rather than
       flex-wrap, so the metric cells align in columns instead of stretching. -->
  <div
    class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
    data-test="version-delta-strip"
  >
    <OCard
      v-for="metric in result.metrics"
      :key="metric.key"
      class="rounded-surface! border border-border-default bg-surface-panel"
      :data-test="`version-delta-strip-cell-${metric.key}`"
    >
      <OCardSection role="body" class="flex flex-col gap-1 p-3!">
        <span class="text-xs text-text-secondary">{{ metricLabel(metric.key) }}</span>

        <span class="text-sm text-text-body" :data-test="`version-delta-strip-values-${metric.key}`">
          <span class="text-accent font-medium">{{ formatValue(metric.key, metric.a) }}</span>
          <span class="text-text-muted"> / </span>
          <span class="text-series-b font-medium">{{ formatValue(metric.key, metric.b) }}</span>
        </span>

        <span
          class="inline-flex items-center gap-1 text-sm font-semibold"
          :class="deltaColorClass(metric)"
          :data-test="`version-delta-strip-delta-${metric.key}`"
        >
          <template v-if="metric.ci">
            <OTooltip :content="tooltipText(metric)" side="top">
              <span :data-test="`version-delta-strip-delta-value-${metric.key}`">{{ formatDelta(metric) }}</span>
            </OTooltip>
          </template>
          <template v-else>
            <span :data-test="`version-delta-strip-delta-value-${metric.key}`">{{ formatDelta(metric) }}</span>
          </template>
          <span
            v-if="metric.verdict === 'insufficient'"
            class="text-2xs font-normal text-text-muted"
            :data-test="`version-delta-strip-indicative-${metric.key}`"
          >
            {{ t("aiObservability.deltaStrip.insufficientLabel") }}
          </span>
        </span>
      </OCardSection>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import type { CompareResult, MetricKey, MetricResult } from "@/plugins/traces/versionCompare/compareResult";
import { formatMicros } from "@/plugins/traces/versionCompare/formatDuration";

const props = defineProps<{ result: CompareResult }>();

const { t } = useI18n();

const metricLabel = (key: MetricKey) => t(`aiObservability.deltaStrip.metricLabel.${key}`);

const PERCENT_KEYS: MetricKey[] = ["errorRate"];
const MS_KEYS: MetricKey[] = ["p50", "p95", "p99"];
const COST_KEYS: MetricKey[] = ["cost"];

function formatValue(key: MetricKey, value: number): string {
  if (PERCENT_KEYS.includes(key)) return `${(value * 100).toFixed(2)}%`;
  // p50/p95/p99 arrive in MICROSECONDS (span `duration` unit) — humanize to
  // µs/ms/s/m rather than printing the raw µs count as a giant "ms" number.
  if (MS_KEYS.includes(key)) return formatMicros(value);
  if (COST_KEYS.includes(key)) return `$${value.toFixed(4)}`;
  return value.toFixed(1);
}

function formatDelta(metric: MetricResult): string {
  if (metric.deltaPct === null) return "—";
  const sign = metric.deltaPct > 0 ? "+" : "";
  return `${sign}${metric.deltaPct.toFixed(1)}%`;
}

// Color EVERY metric by the DIRECTION of its change (sign of deltaPct): a rise
// (deltaPct>0) is red, a drop is green. All comparison metrics here read
// "up = worse" (more latency / cost / errors / volume-churn), so the direction
// maps straight to good/bad without needing a per-metric CI verdict. The only
// neutral case is a null delta (no data / no direction to show).
function deltaColorClass(metric: MetricResult): string {
  if (metric.deltaPct === null) return "text-text-secondary";
  if (metric.deltaPct > 0) return "text-error-600"; // rose → worse
  if (metric.deltaPct < 0) return "text-success-600"; // fell → better
  return "text-text-secondary";
}

function tooltipText(metric: MetricResult): string {
  if (!metric.ci) return "";
  const level = 90;
  // Format the CI bounds in the metric's own unit: latency bounds are µs diffs
  // (humanize), cost bounds are dollars, everything else is a plain number.
  const fmtBound = (v: number): string => {
    if (MS_KEYS.includes(metric.key)) return formatMicros(Math.abs(v)) + (v < 0 ? " faster" : " slower");
    if (COST_KEYS.includes(metric.key)) return `$${v.toFixed(4)}`;
    return v.toFixed(4);
  };
  const range = t("aiObservability.deltaStrip.tooltip.ciRange", {
    level,
    lower: fmtBound(metric.ci.lower),
    upper: fmtBound(metric.ci.upper),
  });
  const method = t("aiObservability.deltaStrip.tooltip.method", {
    method:
      metric.key === "errorRate"
        ? t("aiObservability.deltaStrip.tooltip.methodNewcombe")
        : t("aiObservability.deltaStrip.tooltip.methodBootstrap"),
  });
  const verdictText = verdictWording(metric);
  return [verdictText, range, method].filter(Boolean).join(" ");
}

function verdictWording(metric: MetricResult): string {
  if (metric.verdict === "insufficient") return t("aiObservability.deltaStrip.tooltip.insufficient");
  if (metric.verdict === "nochange") return "";
  if (metric.associative) {
    return metric.verdict === "higher"
      ? t("aiObservability.deltaStrip.tooltip.associativeHigher")
      : t("aiObservability.deltaStrip.tooltip.associativeLower");
  }
  return metric.verdict === "higher"
    ? t("aiObservability.deltaStrip.tooltip.causalRegressed")
    : t("aiObservability.deltaStrip.tooltip.causalImproved");
}
</script>
