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
  What drives one meter's cost, shown beside the meter list on Overview.

  Cost and share are computed here rather than in the SQL: the rate belongs to
  the metering API, and a price baked into a query is a second place for it to
  go stale. Retention has no `usage` event at all, so it reads stream storage
  and shows share of storage rather than an invented price.
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

    <div v-else class="border-border-default flex min-h-0 flex-1 flex-col border-t">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="name"
        pagination="none"
        sorting="none"
        :show-global-filter="false"
        class="min-h-0 flex-1"
        :loading="loading"
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
        <!-- In #bottom rather than a column footer: a footer only reaches the pane's edge while rows overflow. -->
        <template v-if="rows.length" #bottom>
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
              <span class="px-2">{{ isRetention ? EM_DASH : formatCost(rest * rate) }}</span>
              <span class="grid grid-cols-[minmax(2.5rem,1fr)_2.75rem] items-center gap-2.5 px-2">
                <OProgressBar :value="restShare / 100" />
                <span>{{ formatShare(restShare) }}</span>
              </span>
            </div>
            <div class="grid font-semibold" :style="{ gridTemplateColumns: gridTemplate }">
              <span />
              <span class="px-2">{{ t("billing.usageV2.colTotal") }}</span>
              <span v-if="!isMobile" class="px-2">{{ formatQuantity(total) }}</span>
              <span class="px-2">{{ isRetention ? EM_DASH : formatCost(total * rate) }}</span>
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
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useOrgId } from "@/composables/query/useOrgId";
import { queryClient } from "@/composables/query/queryClient";
import searchService from "@/services/search";
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
import { meterColorFor } from "./usageCharts";
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

const CHART_TOP = 5;

const RETENTION_STREAM_TYPES = ["logs", "metrics", "traces"];

const props = defineProps<{
  meterKey: MeterKey;
  details: MeteringDetails;
  group?: string;
  /** Bumped by the page's Refresh, which must reach the server for every read here. */
  refreshToken: number;
  /**
   * A super org's member to break down. The search still runs in the super org, whose
   * stream holds every member's usage; only the `org_id` filter and name lookups change.
   */
  scopeOrgId?: string;
}>();
const emit = defineEmits<{
  "update:group": [group: string];
  "top-names": [payload: { section: DrilldownSection | null; names: string[] }];
  /** The page renders the group-by control in the pane header, so the table starts at the same place in both views. */
  sections: [payload: { sections: DrilldownSection[]; activeId: string | undefined }];
}>();

const { t } = useI18nTyped();
const orgId = useOrgId();
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

const isRetention = computed(() => props.meterKey === "retention");

const meterDef = computed(() => METERS.find((entry) => entry.key === props.meterKey));

const meter = computed(() => props.details[props.meterKey]);

const meterLabel = computed(() =>
  meterDef.value ? t(meterDef.value.labelKey) : raw(props.meterKey),
);

const sections = computed<DrilldownSection[]>(() =>
  availableSections(DRILLDOWNS[props.meterKey] ?? [], schemaFields.value),
);

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

const rate = computed(() => effectiveRate(meter.value));

const EM_DASH = raw("—");

const columns = computed<OTableColumnDef<BreakdownRow>[]>(() => {
  const name: OTableColumnDef<BreakdownRow> = {
    id: "name",
    header: isRetention.value ? t("billing.usageV2.colStream") : groupLabel.value,
    accessorKey: "name",
    // The elastic column: it takes whatever width the fixed columns leave.
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
  return [name, volume, third, share];
});

/** OTable drops the index column on a phone, so the bar drops it too. */
const gridTemplate = computed(() =>
  totalsGridTemplate(columns.value, columnVisibility.value, !isMobile.value),
);

const toRows = (raws: RawRow[], sum: number): BreakdownRow[] => {
  const rate = effectiveRate(meter.value);
  const shown = raws.reduce((acc, entry) => acc + entry.volume, 0);
  const remainder = Math.max(sum - shown, 0);
  rest.value = sum > 0 && remainder / sum > 0.0005 ? remainder : 0;
  return raws.map((entry) => ({
    name: entry.name,
    volume: entry.volume,
    retentionDays: entry.retentionDays,
    cost: entry.volume * rate,
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

/** Log search is never cached by house rule, so these go to the service directly. */
const runSearch = async (sql: string, size: number) => {
  const response = await searchService.search({
    org_identifier: orgId.value,
    page_type: "logs",
    query: {
      query: {
        sql,
        start_time: props.details.cycle_start * 1_000_000,
        end_time: props.details.cycle_end * 1_000_000,
        from: 0,
        size,
      },
    },
  });
  return (response?.data?.hits ?? []) as Record<string, unknown>[];
};

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

/** Keyed by id; a deleted entity keeps its id and reads with a suffix rather than vanishing. */
const resolveNames = async (
  raws: RawRow[],
  force: boolean,
  options: { queryKey: readonly unknown[] },
  idOf: (item: any) => string,
  missingKey: I18nKey,
) => {
  try {
    const list = await cachedRead<any[]>(options, force);
    const names = new Map<string, string>(
      list.map((item: any) => [idOf(item), String(item?.name ?? "")]),
    );
    return raws.map((entry) => ({
      ...entry,
      name: names.get(entry.name) || `${entry.name} (${t(missingKey)})`,
    }));
  } catch {
    return raws;
  }
};

/** Pipeline and synthetics usage is recorded by id, so the table swaps each id for its name. */
const labelRows = (raws: RawRow[], force: boolean) => {
  if (props.meterKey === "pipeline") {
    return resolveNames(
      raws,
      force,
      pipelinesQuery(usageOrgId.value),
      (pipeline) => String(pipeline?.pipeline_id ?? pipeline?.id),
      "billing.usageV2.unknownPipeline",
    );
  }
  if (props.meterKey === "synthetics_browser" || props.meterKey === "synthetics_protocol") {
    return resolveNames(
      raws,
      force,
      syntheticsMonitorsQuery(usageOrgId.value),
      (check) => String(check?.id),
      "billing.usageV2.unknownCheck",
    );
  }
  return Promise.resolve(raws);
};

const loadSection = async (spec: DrilldownSection) => {
  const [hits, totals] = await Promise.all([
    runSearch(spec.sql(usageOrgId.value), DRILLDOWN_LIMIT),
    runSearch(meterTotalSql(usageOrgId.value, [spec.event]), 1),
  ]);
  const raws = hits.map((hit) => ({
    name: String(hit.name ?? ""),
    volume: Number(hit.volume) || 0,
  }));
  return { raws, sum: Number(totals[0]?.total) || 0 };
};

const isStreamMissing = (e: any) => {
  const message = String(e?.response?.data?.message ?? e?.message ?? "").toLowerCase();
  return message.includes("stream not found") && message.includes(USAGE_STREAM_NAME);
};

/** A counter drops a slow earlier response that lands after the user switched meters. */
let latestLoad = 0;

const load = async (force = false) => {
  const loadId = ++latestLoad;
  loading.value = true;
  error.value = null;
  streamMissing.value = false;
  try {
    const result = isRetention.value
      ? await loadRetention(force)
      : activeSection.value
        ? await loadSection(activeSection.value)
        : { raws: [], sum: 0 };
    if (loadId !== latestLoad) return;
    // The chart bands by the raw grouping value, so take names before ids become labels.
    emit("top-names", {
      section: isRetention.value ? null : (activeSection.value ?? null),
      names: result.raws.slice(0, CHART_TOP).map((entry) => entry.name),
    });
    const raws = await labelRows(result.raws, force);
    if (loadId !== latestLoad) return;
    total.value = result.sum;
    rows.value = toRows(raws, result.sum);
  } catch (e: any) {
    if (loadId !== latestLoad) return;
    rows.value = [];
    total.value = 0;
    rest.value = 0;
    emit("top-names", { section: null, names: [] });
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

watch(
  [sections, () => activeSection.value?.id],
  () => emit("sections", { sections: sections.value, activeId: activeSection.value?.id }),
  { immediate: true },
);

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
