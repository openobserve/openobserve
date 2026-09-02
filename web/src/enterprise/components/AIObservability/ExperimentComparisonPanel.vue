<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="flex h-full min-h-0 flex-col" data-test="ai-experiment-comparison">
    <div class="min-h-0 flex-1 overflow-hidden">
      <OTable
        :data="visibleRows"
        :columns="comparisonColumns"
        row-key="logicalId"
        pagination="client"
        :page-size="20"
        :default-columns="false"
        :show-global-filter="false"
        data-test="ai-experiment-comparison-rows"
        @row-click="(row: ExperimentComparisonRow) => $emit('inspect', row, visibleRows)"
      >
        <!-- The bucket counts double as the row filter, so the summary and the
             control that acts on it are the same strip rather than two rows. -->
        <template #subheader>
          <div
            class="px-page-edge border-table-row-divider flex flex-wrap items-center gap-3 border-b py-1.5"
            data-test="ai-experiment-counts"
          >
            <div class="min-w-0 flex-1">
              <OStatStrip
                :items="bucketStats"
                compact
                selectable
                :selected-key="bucketFilter"
                @select="selectBucket"
              />
            </div>
            <!-- Label sits outside so the control stays a single line, the same
                 shape as the Baseline / Candidate pickers in the page header. -->
            <div class="flex shrink-0 items-center gap-2">
              <span class="text-text-tertiary text-xs">
                {{ t("aiObservability.experiments.comparePage.panel.threshold") }}
              </span>
              <OSelect
                :model-value="comparison.threshold"
                :options="thresholdOptions"
                :searchable="false"
                size="md"
                width="xs"
                data-test="ai-experiment-comparison-threshold"
                @update:model-value="selectThreshold"
              />
            </div>
          </div>
        </template>

        <template #cell-bucket="{ row }">
          <OTag size="sm" icon="" :variant="bucketVariant(row.bucket)" :label="bucketLabel(row)" />
        </template>

        <template #cell-input="{ row }">
          <span
            class="text-text-body max-w-[32rem] text-xs break-words whitespace-pre-wrap"
            data-test="ai-experiment-comparison-row-input"
          >
            {{ displayRowInput(row.input) }}
          </span>
        </template>

        <template
          v-for="dimension in comparison.dimensions"
          :key="dimensionColumnId(dimension)"
          #[dimensionSlot(dimension)]="{ row }"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-text-body text-xs">{{ rowDimensionValue(row, dimension) }}</span>
            <OTag
              v-if="rowDimension(row, dimension)?.delta != null"
              size="sm"
              icon=""
              :variant="deltaVariant(rowDimension(row, dimension)!)"
              :label="deltaLabel(rowDimension(row, dimension)!)"
            />
          </div>
        </template>
      </OTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem, StatTone } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ExperimentDimensionHeader from "./ExperimentDimensionHeader.vue";
import {
  dimensionIdentity,
  dimensionMovementCounts,
  dimensionSideValue,
} from "./experimentRowContent";
import type {
  ExperimentComparison,
  ExperimentComparisonBucket,
  ExperimentComparisonDimension,
  ExperimentComparisonRow,
} from "@/services/llm-experiments.service";

const props = defineProps<{ comparison: ExperimentComparison }>();
const emit = defineEmits<{
  inspect: [row: ExperimentComparisonRow, siblings: ExperimentComparisonRow[]];
  "apply-threshold": [threshold: number];
}>();

const { t } = useI18nTyped();

// The summary tile, matching the Alerts strip: it clears rather than filters.
const TOTAL = "total";

// Five tiles, not one per bucket. `regressed` / `improved` / `unchanged` are the
// verdicts the run actually produced; the other three buckets all mean "no
// verdict" (nothing gating to compare, or the row exists on one side only), so
// they share a tile. The Outcome column still names the exact bucket per row.
const UNCOMPARED = ["inconclusive", "new", "missing"] as const;
const FILTER_GROUPS = [
  { key: "regressed", buckets: ["regressed"] },
  { key: "improved", buckets: ["improved"] },
  { key: "unchanged", buckets: ["unchanged"] },
  { key: "uncompared", buckets: UNCOMPARED },
] as const satisfies readonly {
  key: string;
  buckets: readonly ExperimentComparisonBucket[];
}[];

const BUCKET_LABELS: Record<ExperimentComparisonBucket, I18nText> = {
  regressed: t("aiObservability.experiments.comparePage.panel.bucketRegressed"),
  improved: t("aiObservability.experiments.comparePage.panel.bucketImproved"),
  unchanged: t("aiObservability.experiments.comparePage.panel.bucketUnchanged"),
  inconclusive: t("aiObservability.experiments.comparePage.panel.bucketInconclusive"),
  new: t("aiObservability.experiments.comparePage.panel.bucketNew"),
  missing: t("aiObservability.experiments.comparePage.panel.bucketMissing"),
};

// Regressions first: what needs attention sits on the left, matching the
// Alerts / Eval Jobs strips.
const FILTER_LABELS: Record<string, I18nText> = {
  regressed: BUCKET_LABELS.regressed,
  improved: BUCKET_LABELS.improved,
  unchanged: BUCKET_LABELS.unchanged,
  uncompared: t("aiObservability.experiments.comparePage.panel.bucketUncompared"),
};

const FILTER_TONES: Record<string, StatTone> = {
  regressed: "error",
  improved: "success",
  unchanged: "neutral",
  uncompared: "warning",
};

const FILTER_ICONS: Record<string, IconName> = {
  regressed: "trending-down",
  improved: "trending-up",
  unchanged: "trending-flat",
  uncompared: "help-outline",
};

// The row chip mirrors the strip's tone. Spelled out rather than derived from
// the tone name — the two vocabularies only mostly overlap (there is no
// `info-soft` badge), and a silent mismatch would show the wrong colour.
const BUCKET_BADGES: Record<ExperimentComparisonBucket, BadgeVariant> = {
  regressed: "error-soft",
  improved: "success-soft",
  unchanged: "default-soft",
  inconclusive: "default-soft",
  new: "blue-soft",
  missing: "warning-soft",
};

/** `null` is "no filter" — the All tile clears rather than being a selection. */
const bucketFilter = ref<string | null>(null);

// A delta smaller than this counts as neutral. Fixed steps rather than a free
// number field — the useful values are few, and a typo like 5 instead of 0.05
// silently reclassifies the whole run.
const THRESHOLD_STEPS = [0.02, 0.05, 0.1, 0.15];

/** Whatever the server is using stays selectable even if it is off the ladder. */
const thresholdOptions = computed(() => {
  const steps = THRESHOLD_STEPS.includes(props.comparison.threshold)
    ? THRESHOLD_STEPS
    : [...THRESHOLD_STEPS, props.comparison.threshold].sort((a, b) => a - b);
  return steps.map((step) => ({ label: raw(step.toFixed(2)), value: step }));
});

function selectThreshold(next: SelectModelValue) {
  if (typeof next === "number" && next !== props.comparison.threshold) {
    emit("apply-threshold", next);
  }
}

/** Rows in either run — what "All" counts. */
const totalRows = computed(
  () =>
    props.comparison.counts.commonRows +
    props.comparison.counts.new +
    props.comparison.counts.missing,
);

// Outcomes first, All last — the same shape as the Alerts / Eval Jobs strips,
// where the total is a summary you land on rather than the first thing you read.
const bucketStats = computed<StatItem[]>(() => [
  ...FILTER_GROUPS.map((group) => ({
    key: group.key,
    label: FILTER_LABELS[group.key],
    value: group.buckets.reduce((sum, bucket) => sum + props.comparison.counts[bucket], 0),
    icon: FILTER_ICONS[group.key],
    tone: FILTER_TONES[group.key],
    max: totalRows.value || undefined,
    dataTest: `ai-experiment-count-${group.key}`,
  })),
  {
    key: TOTAL,
    label: t("aiObservability.experiments.comparePage.panel.bucketTotal"),
    value: totalRows.value,
    icon: "format-list-bulleted" as IconName,
    tone: "primary" as StatTone,
    // Clickable (it clears the filter) but never ringed — the selected key is
    // only ever a real outcome. No bar either: its share of itself is 100%.
    dataTest: "ai-experiment-count-total",
  },
]);

const visibleRows = computed(() => {
  const group = FILTER_GROUPS.find(({ key }) => key === bucketFilter.value);
  if (!group) return props.comparison.rows;
  const buckets = group.buckets as readonly ExperimentComparisonBucket[];
  return props.comparison.rows.filter((row) => buckets.includes(row.bucket));
});

// All clears; any other tile toggles, so re-clicking the active one also gets
// you back to the full set rather than trapping you in a bucket.
function selectBucket(key: string) {
  bucketFilter.value = key === TOTAL || bucketFilter.value === key ? null : key;
}

const comparisonColumns = computed<OTableColumnDef<ExperimentComparisonRow>[]>(() => [
  {
    id: "input",
    header: t("aiObservability.experiments.comparePage.panel.input"),
    accessorFn: (row) => displayRowInput(row.input),
    sortable: true,
  },
  {
    id: "bucket",
    header: t("aiObservability.experiments.comparePage.panel.outcome"),
    accessorKey: "bucket",
    sortable: true,
  },
  // A component header, not a label: the movement counts describe THIS column.
  // `header` already accepts a component, so none of this asks the shared table
  // to change.
  ...props.comparison.dimensions.map((dimension) => ({
    id: dimensionColumnId(dimension),
    header: () =>
      h(ExperimentDimensionHeader, {
        dimension,
        counts: dimensionMovementCounts(props.comparison.rows, dimension),
      }),
    accessorKey: dimensionColumnId(dimension),
  })),
]);

function displayRowInput(input: unknown): string {
  if (input == null) return "—";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input) ?? String(input);
  } catch {
    return String(input);
  }
}

function dimensionColumnId(dimension: ExperimentComparisonDimension) {
  return `dimension:${dimensionIdentity(dimension)}`;
}

function dimensionSlot(dimension: ExperimentComparisonDimension) {
  return `cell-${dimensionColumnId(dimension)}`;
}

function rowDimension(row: ExperimentComparisonRow, dimension: ExperimentComparisonDimension) {
  const identity = dimensionIdentity(dimension);
  return row.dimensions.find((candidate) => dimensionIdentity(candidate) === identity);
}

/** Trailing zeros carry no information — `34.0000` is just `34`. */
function format(value: number) {
  return String(Number(value.toFixed(4)));
}

function signed(value: number | null) {
  if (value === null) return raw("—");
  return raw(`${value > 0 ? "+" : ""}${format(value)}`);
}

function rowDimensionValue(row: ExperimentComparisonRow, dimension: ExperimentComparisonDimension) {
  const found = rowDimension(row, dimension);
  if (!found) return raw("—");
  if (found.delta === null) return t("aiObservability.experiments.comparePage.panel.oneSided");
  return raw(
    `${dimensionSideValue(found, "baseline")} → ${dimensionSideValue(found, "candidate")}`,
  );
}

/** A delta smaller than the trial noise on both sides is a `~`, not a claim. */
function deltaLabel(dimension: ExperimentComparisonDimension) {
  const value = signed(dimension.delta);
  return dimension.withinNoise ? raw(`~${value}`) : value;
}

// Colour follows orientedDelta, never the raw delta: a latency rising by +31 is
// a positive NUMBER but a worse RESULT, and tinting it green would invert the
// one thing this page exists to say.
function deltaVariant(dimension: ExperimentComparisonDimension) {
  const oriented = dimension.orientedDelta;
  if (oriented === null || oriented === 0) return "default-soft" as const;
  return oriented > 0 ? ("success-soft" as const) : ("error-soft" as const);
}

function bucketVariant(bucket: ExperimentComparisonBucket) {
  return BUCKET_BADGES[bucket];
}

function bucketLabel(row: ExperimentComparisonRow) {
  return BUCKET_LABELS[row.bucket];
}
</script>
