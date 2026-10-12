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
  <TracesDrillDownPage
    :open="true"
    :title="t('traces.comparison.title')"
    @update:open="(open: boolean) => !open && emit('close')"
  >
    <template #actions>
      <OToggleGroup
        v-if="selection"
        v-model="mode"
        mobile-dropdown
        data-test="traces-comparison-baseline-toggle"
      >
        <OToggleGroupItem
          value="outside"
          size="sm"
          data-test="traces-comparison-baseline-toggle-outside"
        >
          {{ t("traces.comparison.baselineOutside") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="before"
          size="sm"
          data-test="traces-comparison-baseline-toggle-before"
        >
          {{ t("traces.comparison.baselineBefore") }}
        </OToggleGroupItem>
      </OToggleGroup>
    </template>

    <OContent y class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <div v-if="summary" class="text-text-secondary text-sm" data-test="traces-comparison-summary">
        {{ summary }}
      </div>

      <OEmptyState
        v-if="status === 'noSelection'"
        icon="filter-list"
        :title="t('traces.comparison.noSelectionTitle')"
        :description="t('traces.comparison.noSelectionBody')"
        data-test="traces-comparison-no-selection"
      />
      <div
        v-else-if="status === 'loading'"
        class="flex flex-1 flex-col items-center justify-center gap-2 py-12"
        data-test="traces-comparison-loading"
      >
        <OSpinner />
        <span class="text-text-secondary text-sm">{{ t("traces.comparison.loading") }}</span>
      </div>
      <OEmptyState
        v-else-if="status === 'error'"
        icon="error"
        :title="errorTitle"
        :action-label="t('traces.comparison.retry')"
        data-test="traces-comparison-error"
        @action="retry"
      >
        <template v-if="errorLines.length" #description>
          <span
            v-for="(line, i) in errorLines"
            :key="i"
            class="block"
            data-test="traces-comparison-error-line"
          >
            {{ line }}
          </span>
        </template>
      </OEmptyState>
      <OEmptyState
        v-else-if="status === 'emptySelection'"
        icon="filter-list"
        :title="t('traces.comparison.emptySelection')"
        data-test="traces-comparison-empty-selection"
      />
      <OEmptyState
        v-else-if="status === 'emptyBaseline'"
        icon="filter-list"
        :title="t('traces.comparison.emptyBaseline')"
        data-test="traces-comparison-empty-baseline"
      >
        <template #description>
          <span class="block">{{
            t("traces.comparison.emptyBaselineHint", { mode: otherModeLabel })
          }}</span>
          <span v-if="limitNote" class="block">{{ limitNote }}</span>
        </template>
      </OEmptyState>

      <div
        v-else-if="status === 'ready' && result"
        class="flex flex-col gap-3"
        data-test="traces-comparison"
      >
        <div
          class="text-text-secondary flex flex-wrap gap-x-2 text-xs"
          data-test="traces-comparison-sample-note"
        >
          <span>{{ sampleNote }}</span>
          <span v-if="limitNote">{{ limitNote }}</span>
          <span>{{
            t("traces.comparison.noiseNote", { pts: Math.round(result.noiseFloorPts) })
          }}</span>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <TracesComparisonField
            v-for="field in shownFields"
            :key="field.name"
            :field="field"
            :noise-floor-pts="result.noiseFloorPts"
            @apply="(term: string) => emit('apply-filter', term)"
          />
        </div>
        <div v-if="remaining > 0">
          <OButton
            variant="outline"
            size="sm"
            data-test="traces-comparison-show-more"
            @click="shown += CARDS_PAGE"
          >
            {{ t("traces.comparison.showMore", { count: nextPage }, nextPage) }}
          </OButton>
        </div>
        <OCollapsible
          v-if="result.mostlyEmpty.length"
          :label="t('traces.comparison.mostlyEmpty', { count: result.mostlyEmpty.length })"
          data-test="traces-comparison-mostly-empty"
        >
          <div class="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2 xl:grid-cols-3">
            <TracesComparisonField
              v-for="field in result.mostlyEmpty"
              :key="field.name"
              :field="field"
              :noise-floor-pts="result.noiseFloorPts"
              @apply="(term: string) => emit('apply-filter', term)"
            />
          </div>
        </OCollapsible>
        <OCollapsible
          v-if="result.highCardinality.length"
          :label="t('traces.comparison.highCardinality', { count: result.highCardinality.length })"
          data-test="traces-comparison-high-cardinality"
        >
          <ul class="flex flex-col gap-1 pt-2">
            <li
              v-for="field in result.highCardinality"
              :key="field.name"
              class="flex min-w-0 gap-2 text-xs"
            >
              <span class="text-text-body truncate font-mono">{{ raw(field.name) }}</span>
              <span class="text-text-secondary shrink-0">
                {{
                  t("traces.comparison.distinctInSample", { count: field.distinct }, field.distinct)
                }}
              </span>
            </li>
          </ul>
        </OCollapsible>
        <div
          v-if="result.constant.length"
          class="text-text-secondary text-xs"
          data-test="traces-comparison-constant"
        >
          {{
            t(
              "traces.comparison.constantFields",
              { count: result.constant.length },
              result.constant.length,
            )
          }}
        </div>
        <div
          v-if="excluded.length"
          class="text-text-secondary text-xs"
          data-test="traces-comparison-excluded"
        >
          {{ t("traces.comparison.excludedFields", { fields: excluded.join(", ") }) }}
        </div>
      </div>
    </OContent>
  </TracesDrillDownPage>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import searchService from "@/services/search";
import { streamSchemaQuery } from "@/services/stream.queries";
import useTraces from "@/composables/useTraces";
import { timestampToTimezoneDate } from "@/utils/timezone";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import TracesDrillDownPage from "./TracesDrillDownPage.vue";
import TracesComparisonField from "./TracesComparisonField.vue";
import { formatDurationBound } from "./latencyHeatmap";
import {
  CARDS_PAGE,
  SAMPLE_LIMIT,
  SAMPLE_TARGET,
  buildCountSql,
  buildSampleSql,
  compareFields,
  comparisonColumns,
  populations,
  sampleThreshold,
  type BaselineMode,
  type ComparisonResult,
  type ComparisonSelection,
  type Population,
  type SampleRow,
  type SchemaField,
} from "./traceComparison";

const props = defineProps<{ selection: ComparisonSelection | null; streamName: string }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "apply-filter", term: string): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { searchObj } = useTraces();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const schemaQuery = useQuery(() =>
  Object.assign(streamSchemaQuery(org.value, props.streamName, "traces"), {
    enabled: props.selection !== null,
  }),
);
const schemaFields = computed<SchemaField[] | null>(() => schemaQuery.data.value?.schema ?? null);
const columns = computed(() =>
  props.selection && schemaFields.value
    ? comparisonColumns(schemaFields.value, props.selection.kind)
    : [],
);
// A refetched schema arrives as a new array; only a change in the compared columns restarts the comparison.
const columnKey = computed(() =>
  schemaFields.value ? columns.value.map((c) => `${c.name}:${c.type ?? ""}`).join(",") : null,
);
const excluded = computed(() => {
  const kept = new Set(columns.value.map((c) => c.name));
  return (schemaFields.value ?? []).map((f) => f.name).filter((name) => !kept.has(name));
});

// The traces page resolves the stream's (or global) query-range limit onto the datetime at runtime.
const limitHours = computed<number>(
  () =>
    (searchObj.data.datetime as { queryRangeRestrictionInHour?: number })
      .queryRangeRestrictionInHour ?? 0,
);
const limitUs = computed(() => (limitHours.value > 0 ? limitHours.value * 3600 * 1_000_000 : 0));

const mode = ref<BaselineMode>("outside");
const status = ref<
  "noSelection" | "loading" | "error" | "emptySelection" | "emptyBaseline" | "ready"
>(props.selection ? "loading" : "noSelection");
const result = shallowRef<ComparisonResult | null>(null);
const sizes = shallowRef({ selSampled: 0, selTotal: 0, baseSampled: 0, baseTotal: 0 });
const baselineWindow = shallowRef<{
  capped: boolean;
  limited: boolean;
  startUs: number;
  endUs: number;
} | null>(null);
const errorTitle = ref<I18nText>(t("traces.comparison.loadFailed"));
const errorLines = shallowRef<I18nText[]>([]);
const shown = ref(CARDS_PAGE);

const shownFields = computed(() => result.value?.ranked.slice(0, shown.value) ?? []);
const remaining = computed(() => (result.value?.ranked.length ?? 0) - shown.value);
const nextPage = computed(() => Math.min(remaining.value, CARDS_PAGE));
const otherModeLabel = computed(() =>
  mode.value === "outside"
    ? t("traces.comparison.baselineBefore")
    : t("traces.comparison.baselineOutside"),
);

const timeText = (startUs: number, endUs: number) => {
  const at = (us: number, format: string) =>
    timestampToTimezoneDate(us / 1000, store.state.timezone, format);
  // The day boundary is the app zone's, the zone the times are printed in.
  const sameDay = at(startUs, "yyyy-MM-dd") === at(endUs, "yyyy-MM-dd");
  const format = sameDay ? "HH:mm:ss" : "MM-dd HH:mm:ss";
  return `${at(startUs, format)}–${at(endUs, format)}`;
};

const summary = computed<I18nText | null>(() => {
  const sel = props.selection;
  if (!sel) return null;
  const window = timeText(sel.windowStartUs, sel.windowEndUs);
  if (sel.kind === "errors") return t("traces.comparison.summaryErrors", { window });
  if (sel.kind === "rate") return raw(window);
  const { durationLoUs: lo, durationHiUs: hi } = sel;
  const band =
    lo && hi !== null
      ? `${formatDurationBound(lo)}–${formatDurationBound(hi)}`
      : hi !== null
        ? `< ${formatDurationBound(hi)}`
        : lo
          ? `≥ ${formatDurationBound(lo)}`
          : "";
  return band ? t("traces.comparison.summaryBand", { window, band }) : raw(window);
});

const sideNote = (sampled: number, total: number) =>
  total <= SAMPLE_TARGET
    ? t("traces.comparison.sampleNoteAll", { count: total.toLocaleString() }, total)
    : t("traces.comparison.sampleCapped", {
        sampled: sampled.toLocaleString(),
        total: total.toLocaleString(),
      });
const sampleNote = computed(() =>
  t("traces.comparison.sampleNote", {
    selection: sideNote(sizes.value.selSampled, sizes.value.selTotal),
    baseline: sideNote(sizes.value.baseSampled, sizes.value.baseTotal),
  }),
);
const limitNote = computed<I18nText | null>(() => {
  const w = baselineWindow.value;
  const sel = props.selection;
  if (!w || !sel) return null;
  const range = timeText(w.startUs, w.endUs);
  if (w.limited) return t("traces.comparison.baselineLimited", { range, hours: limitHours.value });
  if (w.capped) return t("traces.comparison.baselineCapped", { range });
  return null;
});

class ComparisonError extends Error {
  constructor(
    readonly title: I18nText,
    readonly lines: I18nText[] = [],
  ) {
    super(String(title));
  }
}

const isCanceled = (e: any) =>
  e?.name === "CanceledError" || e?.name === "AbortError" || e?.code === "ERR_CANCELED";

interface Side {
  population: Population;
  controller: AbortController;
  count: Promise<number>;
  rows: Promise<SampleRow[]> | null;
  failed: boolean;
}

// Plain, non-reactive state: a toggle reuses the selection side, and 2,000 rows must not become proxies.
let selectionSide: Side | null = null;
let baselineSide: Side | null = null;
let run = 0;

// Not a TanStack query: search reads are excluded from client caching (ui-architect data-fetching).
async function search(sql: string, startUs: number, endUs: number, signal: AbortSignal) {
  const res: any = await searchService.search({
    org_identifier: org.value,
    query: { query: { sql, start_time: startUs, end_time: endUs, from: 0, size: -1 } },
    page_type: "traces",
    signal,
  });
  const data = res?.data ?? {};
  const moved = data.new_start_time != null && data.new_start_time !== startUs;
  // The server shortens a range it clamps and only flags it; a shortened population is never compared.
  if (data.is_partial || moved) {
    const messages = [...new Set<string>((data.function_error ?? []).map(String))];
    throw new ComparisonError(
      t("traces.comparison.rangeClamped"),
      messages.map((m) => raw(m)),
    );
  }
  return data;
}

const track = <T,>(side: Side, promise: Promise<T>) => {
  promise.catch(() => (side.failed = true));
  return promise;
};

function startSide(population: Population): Side {
  const side: Side = {
    population,
    controller: new AbortController(),
    count: Promise.resolve(0),
    rows: null,
    failed: false,
  };
  const q = buildCountSql(props.streamName, population);
  side.count = track(
    side,
    search(q.sql, q.startTime, q.endTime, side.controller.signal).then((d) =>
      Number(d.hits?.[0]?.n ?? 0),
    ),
  );
  return side;
}

function sample(side: Side, n: number): Promise<SampleRow[]> {
  const q = buildSampleSql(
    props.streamName,
    side.population,
    columns.value.map((c) => c.name),
    sampleThreshold(n),
  );
  side.rows = track(
    side,
    search(q.sql, q.startTime, q.endTime, side.controller.signal).then((d) => {
      const hits: SampleRow[] = d.hits ?? [];
      // About 2,000 rows are expected; a full LIMIT means the count and the sample disagree.
      if (hits.length >= SAMPLE_LIMIT)
        throw new ComparisonError(t("traces.comparison.sampleOverflow"));
      return hits;
    }),
  );
  return side.rows;
}

function fail(e: unknown) {
  status.value = "error";
  if (e instanceof ComparisonError) {
    errorTitle.value = e.title;
    errorLines.value = e.lines;
    return;
  }
  const message = (e as any)?.response?.data?.message ?? (e as any)?.message;
  errorTitle.value = t("traces.comparison.loadFailed");
  errorLines.value = message ? [raw(String(message))] : [];
}

async function compare() {
  const id = ++run;
  const sel = props.selection;
  result.value = null;
  if (!sel) {
    status.value = "noSelection";
    return;
  }
  if (schemaQuery.isError.value) {
    fail(schemaQuery.error.value);
    return;
  }
  status.value = "loading";
  if (!schemaFields.value) return;
  shown.value = CARDS_PAGE;

  const pops = populations(sel, mode.value, limitUs.value);
  if ("error" in pops) {
    fail(new ComparisonError(t("traces.comparison.rangeTooLong", { hours: limitHours.value })));
    return;
  }
  baselineWindow.value = pops.baseline
    ? {
        capped: pops.capped,
        limited: pops.limited,
        startUs: pops.baseline.startUs,
        endUs: pops.baseline.endUs,
      }
    : { capped: false, limited: pops.limited, startUs: sel.windowStartUs, endUs: sel.windowEndUs };

  if (!selectionSide || selectionSide.failed) {
    selectionSide?.controller.abort();
    selectionSide = startSide(pops.selection);
  }
  baselineSide?.controller.abort();
  baselineSide = pops.baseline ? startSide(pops.baseline) : null;
  const s = selectionSide;
  const b = baselineSide;

  try {
    const [ns, nb] = await Promise.all([s.count, b ? b.count : Promise.resolve(0)]);
    if (id !== run) return;
    if (ns === 0) {
      status.value = "emptySelection";
      return;
    }
    if (!b || nb === 0) {
      status.value = "emptyBaseline";
      return;
    }
    const [selRows, baseRows] = await Promise.all([s.rows ?? sample(s, ns), sample(b, nb)]);
    if (id !== run) return;
    result.value = compareFields(selRows, baseRows, columns.value, sel.kind);
    b.rows = null;
    sizes.value = {
      selSampled: selRows.length,
      selTotal: ns,
      baseSampled: baseRows.length,
      baseTotal: nb,
    };
    status.value = "ready";
  } catch (e) {
    if (id !== run || isCanceled(e)) return;
    fail(e);
  }
}

const retry = () => {
  selectionSide?.controller.abort();
  selectionSide = null;
  if (schemaQuery.isError.value) {
    status.value = "loading";
    schemaQuery.refetch();
    return;
  }
  compare();
};

watch(mode, compare);
// A schema failure, each repeat of it, and the recovery from it restart the comparison like a new column list.
watch(
  [
    () => props.selection,
    columnKey,
    () => schemaQuery.isError.value,
    () => schemaQuery.errorUpdatedAt.value,
  ],
  () => {
    selectionSide?.controller.abort();
    selectionSide = null;
    compare();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  run++;
  selectionSide?.controller.abort();
  baselineSide?.controller.abort();
});
</script>
