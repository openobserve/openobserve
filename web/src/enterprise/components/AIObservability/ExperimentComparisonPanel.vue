<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="flex h-full min-h-0 flex-col" data-test="ai-experiment-comparison">
    <!-- A fixed tile set: cost and latency are one each, and the score-dimension
         tiles summarise every configured dimension in constant space. -->
    <KpiCardRow v-if="tiles.length" class="px-page-edge shrink-0 py-2.5">
      <KpiCard
        v-for="tile in tiles"
        :key="tile.key"
        :label="tile.label"
        :icon="tile.icon"
        :data-test="tile.dataTest"
      >
        <template #value>
          <span class="text-text-secondary text-2xl leading-none font-bold">
            {{ tile.primary }}
          </span>
          <template v-if="tile.secondary">
            <OIcon name="arrow-right-alt" size="sm" class="text-text-tertiary" />
            <span class="text-text-secondary text-2xl leading-none font-bold">
              {{ tile.secondary }}
            </span>
          </template>
          <span
            v-if="tile.unit"
            class="text-compact text-text-secondary font-semibold"
            :data-test="`${tile.dataTest}-unit`"
          >
            {{ tile.unit }}
          </span>
          <OTag
            v-if="tile.delta"
            size="sm"
            icon=""
            :variant="tile.delta.variant"
            :label="tile.delta.label"
            :data-test="`${tile.dataTest}-delta`"
          />
        </template>
        <template #footer>
          <span v-if="tile.caption" class="text-3xs text-text-tertiary font-medium">
            {{ tile.caption }}
          </span>
          <span
            v-if="tile.warning"
            class="text-3xs text-warning font-medium"
            :data-test="`${tile.dataTest}-warning`"
          >
            {{ tile.warning }}
          </span>
        </template>
      </KpiCard>
    </KpiCardRow>

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
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import KpiCard from "@/components/common/KpiCard.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem, StatTone } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import {
  dimensionIdentity,
  dimensionLabel,
  dimensionSideValue,
  durationUnit,
  formatDuration,
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

interface Tile {
  key: string;
  label: I18nText;
  /** Chip glyph, top-right — the same icons the Experiment detail cards use. */
  icon: IconName;
  /** Small suffix after the value, e.g. "ms". */
  unit?: I18nText;
  /** The large value. For a pair tile this is the baseline side. */
  primary: I18nText;
  /** Present only on pair tiles — renders after the arrow. */
  secondary?: I18nText;
  delta?: { label: I18nText; variant: BadgeVariant };
  /** Single caption under the value — what the number measures or covers. */
  caption?: I18nText;
  warning?: I18nText;
  dataTest: string;
}

const scoreDimensions = computed(() =>
  props.comparison.dimensions.filter((dimension) => dimension.kind === "score"),
);

const regressedDimensionCount = computed(
  () => scoreDimensions.value.filter((dimension) => dimension.assignment === "regressed").length,
);

// `orientedDelta` is a fraction of the configured range for some dimensions and raw
// units for others, so ranking across both would compare unlike numbers. Rank
// inside the normalized set whenever there is one.
const weakestDimension = computed(() => {
  const ranked = scoreDimensions.value.filter((dimension) => dimension.orientedDelta !== null);
  if (!ranked.length) return null;
  const normalized = ranked.filter((dimension) => dimension.normalized);
  const pool = normalized.length ? normalized : ranked;
  return pool.reduce((worst, dimension) =>
    (dimension.orientedDelta ?? 0) < (worst.orientedDelta ?? 0) ? dimension : worst,
  );
});

/** Cost and latency, rendered whether or not the run recorded them — a missing
 *  cost is itself worth seeing, and a tile that vanishes says nothing. */
const INTRINSIC_ICONS: Record<"cost" | "latency", IconName> = {
  cost: "payments",
  latency: "speed",
};

function money(value: number) {
  return `$${format(value)}`;
}

function intrinsicTile(kind: "cost" | "latency", label: I18nText, dataTest: string): Tile {
  const icon = INTRINSIC_ICONS[kind];
  const dimension = props.comparison.dimensions.find((entry) => entry.kind === kind);
  if (!dimension) {
    return { key: kind, label, icon, primary: raw("—"), dataTest };
  }
  const unit = durationUnit(dimension.baseline, dimension.candidate);
  const show = (value: number | null) =>
    value === null ? raw("—") : raw(kind === "cost" ? money(value) : formatDuration(value, unit));
  const showDelta = (value: number) =>
    raw(
      kind === "cost"
        ? `${value > 0 ? "+" : "-"}${money(Math.abs(value))}`
        : `${value > 0 ? "+" : "-"}${formatDuration(Math.abs(value), unit)}`,
    );
  return {
    key: kind,
    label,
    icon,
    unit: kind === "latency" ? raw(unit) : undefined,
    primary: show(dimension.baseline),
    secondary: show(dimension.candidate),
    delta:
      dimension.delta === null
        ? undefined
        : { label: showDelta(dimension.delta), variant: deltaVariant(dimension) },
    caption: t("aiObservability.experiments.comparePage.panel.measurePerRow"),
    warning:
      dimension.baselineOnlyRowCount || dimension.candidateOnlyRowCount
        ? t("aiObservability.experiments.comparePage.panel.oneSidedCoverage", {
            baseline: dimension.baselineOnlyRowCount,
            candidate: dimension.candidateOnlyRowCount,
          })
        : undefined,
    dataTest,
  };
}

const tiles = computed<Tile[]>(() => {
  const list: Tile[] = [];

  // Quality leads: score dimensions are what the run is judged on. Cost sits last.
  if (scoreDimensions.value.length) {
    const total = scoreDimensions.value.length;
    list.push({
      key: "score-dimensions-regressed",
      label: t("aiObservability.experiments.comparePage.panel.tileScoreDimensionsRegressed"),
      icon: "error-outline",
      primary: raw(String(regressedDimensionCount.value)),
      caption: t("aiObservability.experiments.comparePage.panel.ofScoreDimensions", { total }),
      dataTest: "ai-experiment-tile-score-dimensions-regressed",
    });

    const weakest = weakestDimension.value;
    list.push({
      key: "weakest-score-dimension",
      label: t("aiObservability.experiments.comparePage.panel.tileWeakestScoreDimension"),
      icon: "trending-down",
      primary: weakest ? dimensionLabel(weakest) : raw("—"),
      delta: weakest
        ? { label: signed(weakest.orientedDelta), variant: deltaVariant(weakest) }
        : undefined,
      caption: weakest
        ? undefined
        : t("aiObservability.experiments.comparePage.panel.noScoreDimensionMoved"),
      dataTest: "ai-experiment-tile-weakest-score-dimension",
    });
  }

  list.push(
    intrinsicTile(
      "latency",
      t("aiObservability.experiments.comparePage.panel.tileLatency"),
      "ai-experiment-tile-latency",
    ),
    intrinsicTile(
      "cost",
      t("aiObservability.experiments.comparePage.panel.tileCost"),
      "ai-experiment-tile-cost",
    ),
  );
  return list;
});

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
  ...props.comparison.dimensions.map((dimension) => ({
    id: dimensionColumnId(dimension),
    header: dimensionLabel(dimension),
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
