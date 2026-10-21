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
    :key="`${meterKey}-${activeSection?.id ?? ''}`"
    class="animate-in fade-in flex h-full min-h-0 flex-col"
    data-test="billings-usagemeterbreakdown-root"
  >
    <OEmptyState
      v-if="streamMissing"
      size="inline"
      :title="t('billing.usageTrends.waitingTitle')"
      :description="t('billing.usageTrends.waitingForData')"
      data-test="billings-usagemeterbreakdown-stream-missing"
    />

    <div v-else class="flex min-h-0 flex-1 flex-col">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="name"
        pagination="none"
        sorting="none"
        :show-global-filter="false"
        class="min-h-0 flex-1"
        :loading="loading && !rows.length"
        :streaming="loading && rows.length > 0"
        :error="error"
        show-index
        :default-columns="false"
        :column-visibility="columnVisibility"
        data-test="billings-usagemeterbreakdown-table"
      >
        <template #cell-share="{ row }">
          <div
            class="grid w-full min-w-32 grid-cols-[minmax(2.5rem,1fr)_2.75rem] items-center gap-2.5"
          >
            <OProgressBar :value="row.share / 100" :color="meterColorFor(meterKey)" />
            <span>{{ formatShare(row.share) }}</span>
          </div>
        </template>
        <!-- In #pagination-bar rather than a column footer: a footer only reaches the pane's edge while rows overflow. -->
        <template v-if="rows.length" #pagination-bar>
          <div
            class="bg-table-header-bg border-table-header-border text-text-body flex flex-col gap-1 border-t py-2 text-xs"
            data-test="billings-usagemeterbreakdown-total"
          >
            <div
              v-if="rest > 0"
              class="text-text-secondary grid italic"
              :style="{ gridTemplateColumns: gridTemplate }"
            >
              <span />
              <span class="px-2">{{ t("billing.usageV2.everythingElse") }}</span>
              <span v-if="!isMobile" class="px-2">{{ formatQuantity(rest) }}</span>
              <span v-if="!volumeOnly" class="px-2">{{
                isRetention ? EM_DASH : formatCost(rest * rate)
              }}</span>
              <span class="grid grid-cols-[minmax(2.5rem,1fr)_2.75rem] items-center gap-2.5 px-2">
                <OProgressBar :value="restShare / 100" />
                <span>{{ formatShare(restShare) }}</span>
              </span>
            </div>
            <div class="grid font-semibold" :style="{ gridTemplateColumns: gridTemplate }">
              <span />
              <span class="px-2">{{ t("billing.usageV2.colTotal") }}</span>
              <span v-if="!isMobile" class="px-2">{{ formatQuantity(total) }}</span>
              <span v-if="!volumeOnly" class="px-2">{{
                isRetention ? EM_DASH : formatCost(total * rate)
              }}</span>
              <span />
            </div>
          </div>
        </template>
        <template #error>
          <div class="flex flex-col items-center gap-2 p-4">
            <span class="text-text-secondary text-sm">
              {{ t("billing.usageV2.drilldownFailed") }}
            </span>
            <OButton
              variant="outline"
              size="sm-action"
              data-test="billings-usagemeterbreakdown-retry"
              @click="retry"
            >
              {{ t("billing.usageV2.retry") }}
            </OButton>
          </div>
        </template>
      </OTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useOrgId } from "@/composables/query/useOrgId";
import { queryClient } from "@/composables/query/queryClient";
import { pipelinesQuery } from "@/services/pipelines.queries";
import { syntheticsMonitorsQuery } from "@/services/synthetics.queries";
import { streamNameListQuery, streamSchemaQuery } from "@/services/stream.queries";
import { formatSizeFromMB } from "@/utils/formatters";
import {
  effectiveRate,
  formatCost,
  METERS,
  type MeterKey,
  type MeteringDetails,
} from "./meteringModel";
import {
  availableSections,
  DRILLDOWNS,
  DRILLDOWN_LIMIT,
  meterTotalSql,
  USAGE_STREAM_NAME,
  type DrilldownSection,
} from "./usageQueries";
import { CHART_TOP, meterColorFor } from "./usageCharts";
import { useUsageSearch } from "./useUsageSearch";
import { totalsGridTemplate } from "./totalsBar";

interface BreakdownRow {
  name: string;
  volume: number;
  cost: number;
  share: number;
  /** Days; 0 means the stream follows the org default. Retention rows only. */
  retentionDays?: number;
}

interface RawRow {
  name: string;
  volume: number;
  retentionDays?: number;
}

const RETENTION_STREAM_TYPES = ["logs", "metrics", "traces"];

const props = defineProps<{
  meterKey: MeterKey;
  details: MeteringDetails;
  group?: string;
  /** Bumped by the page's Refresh, which must reach the server for every read here. */
  refreshToken: number;
  scopeOrgId?: string;
  /** Price per unit to use instead of the bill's, so a member's rows add up to its share. */
  rate?: number;
  /** An org with no bill: volume and share only, with no cost column. */
  volumeOnly?: boolean;
}>();
/** Every grouping the meter offers; `unavailable` lists those this org has never recorded. */
type SectionsPayload = {
  sections: DrilldownSection[];
  unavailable: string[];
  activeId: string | undefined;
};

const emit = defineEmits<{
  "update:group": [group: string];
  "top-names": [payload: { section: DrilldownSection | null; names: string[] }];
  /** The page renders the group-by control in the pane header, so the table starts at the same place in both views. */
  sections: [payload: SectionsPayload];
}>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const store = useStore();
/** The org whose usage this breakdown counts. */
const usageOrgId = computed(() => props.scopeOrgId ?? orgId.value);
const { isMobile } = useBreakpoint();

const rows = ref<BreakdownRow[]>([]);
/** Volume past the top rows; it lives in the footer so rank numbers cover real entities only. */
const rest = ref(0);
const total = ref(0);
/** Starts true: the schema read runs before the first query, and an idle empty table would flash "no data". */
const loading = ref(true);
const error = ref<string | null>(null);
const streamMissing = ref(false);
const schemaFields = ref<Set<string>>(new Set());
/** Set once the schema read settles, so the group-by control never shows a list it then greys out. */
const schemaRead = ref(false);

const isRetention = computed(() => props.meterKey === "retention");

const meterDef = computed(() => METERS.find((entry) => entry.key === props.meterKey));

const meter = computed(() => props.details[props.meterKey]);

const meterLabel = computed(() =>
  meterDef.value ? t(meterDef.value.labelKey) : raw(props.meterKey),
);

const allSections = computed<DrilldownSection[]>(() => DRILLDOWNS[props.meterKey] ?? []);

/** The groupings that can be queried: a field the stream never recorded would fail the SQL. */
const sections = computed<DrilldownSection[]>(() =>
  availableSections(allSections.value, schemaFields.value),
);

let shown = true;

/** All groupings every time, so the control does not change shape; the ones with no data are disabled. */
const emitSections = () => {
  // Nothing until the schema is read: the chart starts its query from these, and the control must not change shape.
  if (!shown || (!isRetention.value && !schemaRead.value)) return;
  const available = new Set(sections.value.map((item) => item.id));
  emit("sections", {
    sections: allSections.value,
    unavailable: allSections.value.filter((item) => !available.has(item.id)).map((item) => item.id),
    activeId: activeSection.value?.id,
  });
};

const activeSection = computed(
  () => sections.value.find((item) => item.id === props.group) ?? sections.value[0],
);

/** AI credit rows count credits; every other section counts megabytes. */
const isCount = computed(() => activeSection.value?.unit === "count");

const formatQuantity = (value: number): I18nText =>
  isCount.value ? raw(String(Math.round(value))) : raw(formatSizeFromMB(value));

const groupLabel = computed(() => t(activeSection.value?.columnKey ?? "billing.usageV2.colStream"));

function formatShare(value: number): I18nText {
  return raw(`${value.toFixed(1)}%`);
}

const formatRetention = (days: number | undefined) =>
  days
    ? t("billing.usageV2.retentionDaysValue", { days })
    : t("billing.usageV2.orgDefaultRetention");

/** Volume is the first column a phone drops; share still carries the ranking. */
const columnVisibility = computed(() => ({ volume: !isMobile.value }));

const restShare = computed(() => (total.value > 0 ? (rest.value / total.value) * 100 : 0));

const rate = computed(() => props.rate ?? effectiveRate(meter.value));

const EM_DASH = raw("—");

const columns = computed<OTableColumnDef<BreakdownRow>[]>(() => {
  const name: OTableColumnDef<BreakdownRow> = {
    id: "name",
    header: isRetention.value ? t("billing.usageV2.colStream") : groupLabel.value,
    accessorKey: "name",
    meta: { isName: true, autoWidth: true },
    minSize: 160,
  };
  const volume: OTableColumnDef<BreakdownRow> = {
    id: "volume",
    header: isRetention.value
      ? t("billing.usageV2.colCurrentSize")
      : isCount.value && activeSection.value?.quantityKey
        ? t(activeSection.value.quantityKey)
        : t("billing.usageV2.colVolume"),
    accessorFn: (row: BreakdownRow) => formatQuantity(row.volume),
    size: 104,
  };
  const share: OTableColumnDef<BreakdownRow> = {
    id: "share",
    header: isRetention.value
      ? t("billing.usageV2.colStorageShare")
      : t("billing.usageV2.shareOfMeter", { meter: meterLabel.value }),
    accessorKey: "share",
    size: 160,
  };
  const third: OTableColumnDef<BreakdownRow> = isRetention.value
    ? {
        id: "retentionDays",
        header: t("billing.usageV2.colRetentionPeriod"),
        accessorFn: (row: BreakdownRow) => formatRetention(row.retentionDays),
        size: 136,
      }
    : {
        id: "cost",
        header: t("billing.usageV2.colEstCost"),
        accessorFn: (row: BreakdownRow) => formatCost(row.cost),
        size: 88,
      };
  return props.volumeOnly && !isRetention.value
    ? [name, volume, share]
    : [name, volume, third, share];
});

/** OTable drops the index column on a phone, so the bar drops it too. */
const gridTemplate = computed(() =>
  totalsGridTemplate(columns.value, columnVisibility.value, !isMobile.value),
);

const toRows = (raws: RawRow[], sum: number): BreakdownRow[] => {
  const shown = raws.reduce((acc, entry) => acc + entry.volume, 0);
  const remainder = Math.max(sum - shown, 0);
  rest.value = sum > 0 && remainder / sum > 0.0005 ? remainder : 0;
  return raws.map((entry) => ({
    name: entry.name,
    volume: entry.volume,
    retentionDays: entry.retentionDays,
    cost: entry.volume * rate.value,
    share: sum > 0 ? Math.min((entry.volume / sum) * 100, 100) : 0,
  }));
};

/** Forces a cached read back to the server, as the refresh rule requires. */
const cachedRead = async <T,>(options: { queryKey: readonly unknown[] }, force: boolean) => {
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  return queryClient.fetchQuery(options as never) as Promise<T>;
};

const { search } = useUsageSearch();

/** Keyed, so switching meter or group stops the superseded query on the server. */
const runSearch = (
  sql: string,
  size: number,
  key: string,
  onRows?: (rows: Record<string, unknown>[]) => void,
) =>
  search(sql, {
    start: props.details.cycle_start * 1_000_000,
    end: props.details.cycle_end * 1_000_000,
    size,
    key,
    onRows,
  });

const loadRetention = async (force: boolean) => {
  const lists = await Promise.all(
    RETENTION_STREAM_TYPES.map((type) =>
      cachedRead<any[]>(streamNameListQuery(orgId.value, type), force).catch(() => []),
    ),
  );
  const all = lists.flat().map((stream: any) => ({
    name: String(stream?.name ?? ""),
    volume: Number(stream?.stats?.storage_size) || 0,
    retentionDays: Number(stream?.settings?.data_retention) || 0,
  }));
  const sum = all.reduce((acc, stream) => acc + stream.volume, 0);
  return { raws: all.sort((a, b) => b.volume - a.volume).slice(0, DRILLDOWN_LIMIT), sum };
};

type Labeler = (raws: RawRow[]) => RawRow[];

const keepNames: Labeler = (raws) => raws;

const canReadNames = computed(
  () =>
    usageOrgId.value === orgId.value ||
    (store.state.organizations ?? []).some((org: any) => org.identifier === usageOrgId.value),
);

/** Pipeline and synthetics usage is recorded by id; a deleted entity keeps its id with a suffix. */
const nameLabeler = async (force: boolean): Promise<Labeler> => {
  const source =
    props.meterKey === "pipeline"
      ? {
          options: pipelinesQuery(usageOrgId.value),
          idOf: (pipeline: any) => String(pipeline?.pipeline_id ?? pipeline?.id),
          missingKey: "billing.usageV2.unknownPipeline" as I18nKey,
        }
      : props.meterKey === "synthetics_browser" || props.meterKey === "synthetics_protocol"
        ? {
            options: syntheticsMonitorsQuery(usageOrgId.value),
            idOf: (check: any) => String(check?.id),
            missingKey: "billing.usageV2.unknownCheck" as I18nKey,
          }
        : null;
  if (!source || !canReadNames.value) return keepNames;
  try {
    const list = await cachedRead<any[]>(source.options, force);
    const names = new Map<string, string>(
      list.map((item: any) => [source.idOf(item), String(item?.name ?? "")]),
    );
    return (raws) =>
      raws.map((entry) => ({
        ...entry,
        name: names.get(entry.name) || `${entry.name} (${t(source.missingKey)})`,
      }));
  } catch {
    return keepNames;
  }
};

const toRaws = (hits: Record<string, unknown>[]): RawRow[] =>
  hits.map((hit) => ({ name: String(hit.name ?? ""), volume: Number(hit.volume) || 0 }));

/** Both queries stream running aggregates; `onPartial` gets the latest of each as they land. */
const loadSection = async (
  spec: DrilldownSection,
  onPartial: (raws: RawRow[], sum: number) => void,
) => {
  let partialRaws: RawRow[] = [];
  let partialSum = 0;
  const [hits, totals] = await Promise.all([
    runSearch(spec.sql(usageOrgId.value), DRILLDOWN_LIMIT, "rows", (rows) => {
      partialRaws = toRaws(rows);
      onPartial(partialRaws, partialSum);
    }),
    runSearch(meterTotalSql(usageOrgId.value, [spec.event]), 1, "total", (rows) => {
      partialSum = Number(rows[0]?.total) || 0;
      onPartial(partialRaws, partialSum);
    }),
  ]);
  return { raws: toRaws(hits), sum: Number(totals[0]?.total) || 0 };
};

const isStreamMissing = (e: any) => {
  const message = String(e?.response?.data?.message ?? e?.message ?? "").toLowerCase();
  return message.includes("stream not found") && message.includes(USAGE_STREAM_NAME);
};

type TopNames = { section: DrilldownSection | null; names: string[] };

/** The last names sent up, re-sent when a kept-alive breakdown is shown again so the chart can find its view. */
let lastTopNames: TopNames | null = null;

const emitTopNames = (payload: TopNames) => {
  lastTopNames = payload;
  if (shown) emit("top-names", payload);
};

onDeactivated(() => {
  shown = false;
});
onActivated(() => {
  shown = true;
  emitSections();
  if (lastTopNames) emit("top-names", lastTopNames);
});

/** A counter drops a slow earlier response that lands after the user switched meters. */
let latestLoad = 0;

const load = async (force = false) => {
  const loadId = ++latestLoad;
  loading.value = true;
  error.value = null;
  streamMissing.value = false;
  // Cleared, so streamed rows never sit under another group's header.
  rows.value = [];
  total.value = 0;
  rest.value = 0;
  // Resolved alongside the queries, so a partial render never shows a raw id.
  let labeler: Labeler | null = null;
  const labelerReady = nameLabeler(force).then((resolved) => (labeler = resolved));
  const showPartial = (raws: RawRow[], sum: number) => {
    if (loadId !== latestLoad || !labeler) return;
    total.value = sum;
    rows.value = toRows(labeler(raws), sum);
  };
  try {
    const result = isRetention.value
      ? await loadRetention(force)
      : activeSection.value
        ? await loadSection(activeSection.value, showPartial)
        : { raws: [], sum: 0 };
    if (loadId !== latestLoad) return;
    // Final only: the chart colours its bands by this ranking, and a partial one would reshuffle them.
    emitTopNames({
      section: isRetention.value ? null : (activeSection.value ?? null),
      names: result.raws.slice(0, CHART_TOP).map((entry) => entry.name),
    });
    const label = await labelerReady;
    if (loadId !== latestLoad) return;
    total.value = result.sum;
    rows.value = toRows(label(result.raws), result.sum);
  } catch (e: any) {
    if (loadId !== latestLoad) return;
    rows.value = [];
    total.value = 0;
    rest.value = 0;
    emitTopNames({ section: null, names: [] });
    if (isStreamMissing(e)) streamMissing.value = true;
    else error.value = String(e?.message ?? t("billing.usageV2.drilldownFailed"));
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
};

/** An empty set keeps every section, so a failed schema read degrades to trying the queries. */
const loadSchema = async (force: boolean) => {
  try {
    const schema = await cachedRead<any>(
      streamSchemaQuery(orgId.value, USAGE_STREAM_NAME, "logs"),
      force,
    );
    schemaFields.value = new Set(
      (schema?.schema ?? []).map((field: { name: string }) => field.name),
    );
  } catch {
    schemaFields.value = new Set();
  } finally {
    schemaRead.value = true;
  }
};

const retry = () => load(true);

watch(
  () => props.meterKey,
  async () => {
    // Drop the previous meter's rows, or they read as this meter's until the query lands.
    loading.value = true;
    rows.value = [];
    total.value = 0;
    rest.value = 0;
    if (!isRetention.value && !schemaFields.value.size) await loadSchema(false);
    load();
  },
  { immediate: true },
);

watch([sections, () => activeSection.value?.id, schemaRead], emitSections, { immediate: true });

watch(
  () => activeSection.value?.id,
  (value, previous) => {
    if (value && previous && value !== previous) load();
  },
);

watch(
  () => props.refreshToken,
  async () => {
    loading.value = true;
    if (!isRetention.value) await loadSchema(true);
    load(true);
  },
);
</script>
