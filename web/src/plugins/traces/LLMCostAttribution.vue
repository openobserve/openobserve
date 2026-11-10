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

<!-- Spans with no value land in an Unattributed row so the shares add up. -->
<template>
  <LLMPanelCard
    :title="t('llmAttribution.title')"
    :subtitle="summary || undefined"
    data-test="llm-cost-attribution"
  >
    <template #actions>
      <OToggleGroup :model-value="dim" @update:model-value="(v) => (dim = v as FilterDim)">
        <OToggleGroupItem
          v-for="d in DIMS"
          :key="d"
          :value="d"
          size="sm"
          :tooltip="about(d)"
          :data-test="`llm-cost-attribution-tab-${d}`"
        >
          {{ t(`llmAttribution.dims.${d}`) }}
        </OToggleGroupItem>
      </OToggleGroup>
    </template>

    <div
      v-if="!columnPresent || noneAttributed"
      class="flex flex-col items-start gap-2 p-3"
      data-test="llm-cost-attribution-unset"
    >
      <span class="text-compact text-text-body" data-test="llm-cost-attribution-about">{{
        about(dim)
      }}</span>
      <span class="text-compact text-text-secondary">
        {{
          t(columnPresent ? "llmAttribution.noneInWindow" : "llmAttribution.unset", {
            attribute: ATTRIBUTES[dim],
          })
        }}
      </span>
      <!-- A model comes from the instrumentation; there is no field to map. -->
      <OButton
        v-if="dim !== 'model'"
        variant="outline"
        size="sm"
        data-test="llm-cost-attribution-map-link"
        @click="openMapping"
      >
        {{ t("llmAttribution.mapLink", { attribute: ATTRIBUTES[dim] }) }}
      </OButton>
    </div>
    <template v-else>
      <!-- Part-to-whole; the table below is its legend. Unattributed is the empty track. -->
      <div v-if="segments.length" class="px-3 pt-3 pb-1" data-test="llm-cost-attribution-bar">
        <OSegmentedBar :segments="segments" size="md" :label="summary || undefined" />
      </div>
      <OTable
        :data="tableRows"
        :columns="columns"
        row-key="key"
        :loading="loading"
        :show-global-filter="false"
        :fill-height="false"
        pagination="none"
        :empty-message="failed ? t('llmAttribution.loadFailed') : t('llmAttribution.empty')"
        data-test="llm-cost-attribution-table"
        :row-class="(row: Row) => (row.kind === 'value' ? '' : '!cursor-default')"
        @row-click="onRowClick"
      >
        <template #cell-value="{ row }">
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="rounded-default size-2 shrink-0"
              :class="swatchClass(row)"
              :style="row.kind === 'value' ? seriesSwatch(seriesSlot(row.value)) : undefined"
              aria-hidden="true"
            />
            <span
              class="truncate"
              :class="row.kind === 'value' ? 'text-text-body' : 'text-text-secondary italic'"
            >
              {{ row.label }}
            </span>
          </span>
        </template>
        <template #cell-cost="{ row }">
          <LLMCostCell
            :cost="row.cost"
            :tokens="row.tokens"
            :unpriced-tokens="row.unpriced"
            scope="row"
            :stream="stream"
            :time-window="{ start: startTime, end: endTime }"
            :format="(c: number) => `$${formatCost(c)}`"
          />
        </template>
        <template #cell-share="{ row }">
          <span class="text-text-secondary">{{ `${(row.share * 100).toFixed(0)}%` }}</span>
        </template>
        <template #cell-tokens="{ row }">{{ formatTokens(row.tokens) }}</template>
      </OTable>
    </template>
  </LLMPanelCard>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import {
  SEGMENT_SWATCH,
  seriesSwatch,
  type SegmentedBarSegment,
} from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import LLMPanelCard from "./LLMPanelCard.vue";
import useStreams from "@/composables/useStreams";
import { formatCost, formatTokens } from "@/utils/llmUtils";
import LLMCostCell from "./LLMCostCell.vue";
import { costKind } from "./llmDataTrust.utils";
import {
  classicColorPaletteLightTheme,
  getDistinctSeriesColors,
} from "@/utils/dashboard/colorPalette";
import { useLLMStreamQuery } from "./composables/useLLMStreamQuery";
import {
  ATTRIBUTION_ATTRIBUTES,
  costByDimensionSql,
  costByModelSql,
  toAttributionRows,
  type AttributionTotals,
} from "./llmAttribution";
import { FILTER_COLUMNS, type FilterDim } from "./llmInsightsDrill";
import { PARENT_SPAN_FIELD } from "./config/llmInsightsPanels";

const props = defineProps<{
  stream: string;
  /** The page's bare scope predicate (agent + filters). */
  scope: string;
  startTime: number;
  endTime: number;
}>();
const emit = defineEmits<{ (e: "filter", dim: FilterDim, value: string): void }>();

// Model first: every LLM call carries one, so the view is never empty.
const DIMS: FilterDim[] = ["model", "user", "tenant", "feature"];
const ATTRIBUTES: Record<FilterDim, string> = {
  model: "gen_ai.response.model",
  ...ATTRIBUTION_ATTRIBUTES,
};

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const org = () => store.state.selectedOrganization?.identifier ?? "";
const { getStream } = useStreams(t);
const { executeQuery, cancelAll } = useLLMStreamQuery();

const dim = ref<FilterDim>("model");
const schemaColumns = ref<Set<string>>(new Set());
const hits = ref<any[]>([]);
const totals = ref<AttributionTotals | null>(null);
const loading = ref(false);
const failed = ref(false);
let seq = 0;

const columnPresent = computed(() => schemaColumns.value.has(FILTER_COLUMNS[dim.value]));
const result = computed(() => toAttributionRows(hits.value, totals.value));
// Spend in the window, none of it carrying a value: only an Unattributed row.
const noneAttributed = computed(
  () =>
    !loading.value &&
    !failed.value &&
    hits.value.length > 0 &&
    result.value.rows.length === 0 &&
    !result.value.more,
);

const about = (d: FilterDim) => t(`llmAttribution.about.${d}`, { attribute: ATTRIBUTES[d] });

function openMapping() {
  router.push({
    name: "genAiAgentMapping",
    query: { org_identifier: org() },
    hash: "#cost-attribution",
  });
}

type Row = {
  key: string;
  kind: "value" | "more" | "none";
  label: I18nText;
  value: string;
  cost: number;
  share: number;
  tokens: number;
  traces: number;
  unpriced: number;
};
const tableRows = computed<Row[]>(() => {
  const r = result.value;
  return [
    ...r.rows.map((x) => ({
      ...x,
      key: `v:${x.value}`,
      kind: "value" as const,
      label: raw(x.value),
    })),
    ...(r.more
      ? [
          {
            ...r.more,
            key: "more",
            kind: "more" as const,
            label: t("llmAttribution.more", { n: r.more.value }),
          },
        ]
      : []),
    ...(r.unattributed
      ? [
          {
            ...r.unattributed,
            key: "none",
            kind: "none" as const,
            label: t("llmAttribution.unattributed"),
          },
        ]
      : []),
  ];
});

// Colour follows the value, not rank, so it stays stable across windows and filters.
const seriesSlot = computed(() => {
  const colors = getDistinctSeriesColors(
    result.value.rows.map((r) => r.value),
    classicColorPaletteLightTheme,
  );
  return (value: string) => classicColorPaletteLightTheme.indexOf(colors.get(value) ?? "") + 1;
});
// "N more" is the muted grey; Unattributed is the bar's empty track, so its dot is the track colour.
const swatchClass = (row: Row) =>
  row.kind === "more"
    ? SEGMENT_SWATCH.muted
    : row.kind === "none"
      ? "bg-border-default"
      : undefined;
const segments = computed<SegmentedBarSegment[]>(() =>
  tableRows.value
    .filter((r) => r.kind !== "none" && r.share > 0)
    .map((r) => ({
      id: r.key,
      pct: r.share * 100,
      ...(r.kind === "value"
        ? { series: seriesSlot.value(r.value) }
        : { variant: "muted" as const }),
    })),
);

// The total reads as a lower bound ("≥ $x") or unknown when some tokens had no price.
const totalText = computed(() => {
  const total = `$${formatCost(result.value.total)}`;
  const kind = costKind(
    result.value.total,
    Number(totals.value?.tokens) || 0,
    Number(totals.value?.unpriced) || 0,
  );
  if (kind === "partial") return t("llmDataTrust.cost.atLeast", { cost: total });
  if (kind === "unknown") return t("llmDataTrust.cost.unknown");
  return total;
});
const summary = computed(() =>
  hits.value.length
    ? t("llmAttribution.summary", {
        total: totalText.value,
        share: (result.value.attributedShare * 100).toFixed(0),
        dim: t(`llmAttribution.dims.${dim.value}`).toLowerCase(),
      })
    : "",
);

const columns: OTableColumnDef[] = [
  { id: "value", header: t("llmAttribution.value"), meta: { align: "left", flex: true } },
  { id: "cost", header: t("llmAttribution.cost"), size: COL.price, meta: { align: "right" } },
  { id: "share", header: t("llmAttribution.share"), size: COL.type, meta: { align: "left" } },
  { id: "tokens", header: t("llmAttribution.tokens"), size: COL.count, meta: { align: "right" } },
  {
    id: "traces",
    header: t("llmAttribution.traces"),
    accessorKey: "traces",
    size: COL.count,
    meta: { align: "right" },
  },
];

function onRowClick(row: Row) {
  if (row.kind === "value") emit("filter", dim.value, row.value);
}

async function loadSchema() {
  if (!props.stream) return;
  try {
    const s = await getStream(props.stream, "traces", true);
    schemaColumns.value = new Set((s?.schema ?? []).map((f: any) => f.name));
  } catch {
    schemaColumns.value = new Set();
  }
}

async function load() {
  const column = FILTER_COLUMNS[dim.value];
  const cols = {
    hasCostStatus: schemaColumns.value.has("gen_ai_usage_cost_status"),
    hasParentSpan: schemaColumns.value.has(PARENT_SPAN_FIELD),
  };
  // Bump first, so a query still in flight for the previous dimension cannot land.
  const mine = ++seq;
  if (!props.stream || !schemaColumns.value.has(column)) {
    hits.value = [];
    totals.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  failed.value = false;
  try {
    const sql =
      dim.value === "model"
        ? costByModelSql(props.stream, props.scope, cols)
        : costByDimensionSql(props.stream, column, props.scope, cols);
    const [rows, sums] = (await Promise.all([
      executeQuery(sql.rows, props.startTime, props.endTime),
      executeQuery(sql.totals, props.startTime, props.endTime),
    ])) as [any[], AttributionTotals[]];
    if (mine === seq) {
      hits.value = rows;
      totals.value = sums[0] ?? null;
    }
  } catch (e) {
    if (mine !== seq) return;
    hits.value = [];
    totals.value = null;
    failed.value = true;
    console.error("[LLM cost attribution] fetch error", e);
  } finally {
    if (mine === seq) loading.value = false;
  }
}

watch(
  () => props.stream,
  async () => {
    await loadSchema();
    await load();
  },
  { immediate: true },
);
watch(() => [dim.value, props.scope, props.startTime, props.endTime], load);
defineExpose({ cancelAll });
</script>
