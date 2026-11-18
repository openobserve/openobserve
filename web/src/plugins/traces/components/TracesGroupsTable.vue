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
  <div class="bg-card-glass-solid flex flex-col" data-test="traces-groups">
    <QueryErrorState
      v-if="error"
      size="block"
      :error-code="error.code"
      :error-msg="error.message"
      :error-detail="error.detail"
      data-test="traces-groups-error"
    />
    <OContextMenu v-else @update:open="onContextMenuOpenChange">
      <template #trigger>
        <div class="contents" @contextmenu.capture="onTableContextMenu">
          <OTable
            class="h-auto!"
            :columns="columns"
            :data="rows"
            :loading="loading"
            :wrap="wrap"
            sorting="server"
            :sort-by="sort.by"
            :sort-order="sort.order"
            pagination="none"
            :row-height="28"
            :default-columns="false"
            :show-global-filter="false"
            :fill-height="false"
            data-test="traces-groups-table"
            @row-click="(row: GroupRow) => apply(row.value, 'include', true)"
            @sort-change="onSortChange"
            @cell-contextmenu="(params: { row: GroupRow }) => (contextRow = params.row)"
          >
            <template #cell-hover-actions="{ row, column, active }">
              <CellActions
                v-if="active && !contextRow && column.id === 'value'"
                :column="{ id: request.key }"
                :row="row"
                :value="row.value"
                :selected-stream-fields="groupKeyFields"
                :hide-ai="true"
                @copy="copyValue(row.value)"
                @add-search-term="
                  (_field: string, _value: GroupValue, action: 'include' | 'exclude') =>
                    apply(row.value, action, false)
                "
              />
            </template>
            <template #cell-value="{ row }">
              <span
                v-if="isNoValue(row.value)"
                class="text-text-muted italic"
                data-test="traces-groups-no-value"
                >{{ t("traces.groups.noValue") }}</span
              >
              <span v-else class="text-text-heading" data-test="traces-groups-value">{{
                displayValue(row.value)
              }}</span>
            </template>
            <template #cell-spans="{ row }">
              <span class="text-text-body font-mono text-xs">{{
                formatLargeNumber(row.spans)
              }}</span>
            </template>
            <template #cell-errors="{ row }">
              <span
                class="font-mono text-xs"
                :class="row.errors > 0 ? 'text-text-body' : 'text-text-muted'"
                >{{ formatLargeNumber(row.errors) }}</span
              >
            </template>
            <template #cell-error_pct="{ row }">
              <span
                class="font-mono text-xs"
                :class="errorPctClass(row.errorPct)"
                data-test="traces-groups-error-pct"
                >{{ formatErrorPct(row.errorPct) }}</span
              >
            </template>
            <template v-for="p in PERCENTILES" :key="p" #[`cell-${p}`]="{ row }">
              <span class="text-text-body font-mono text-xs">{{
                formatTimeWithSuffix(row[p])
              }}</span>
            </template>
            <template #cell-rate="{ row }">
              <OSparkline
                :points="sparks.get(row.value) ?? []"
                :aria-label="t('traces.groups.rateTooltip')"
              />
            </template>
            <template #empty>
              <div class="text-text-secondary p-4 text-sm" data-test="traces-groups-empty">
                {{ t("traces.groups.empty") }}
              </div>
            </template>
          </OTable>
        </div>
      </template>

      <template v-if="contextRow">
        <OContextMenuLabel data-test="traces-groups-context-field">{{
          request.key
        }}</OContextMenuLabel>
        <OContextMenuSeparator />
        <OContextMenuItem
          data-test="traces-groups-context-include-term"
          @select="apply(contextRow.value, 'include', false)"
        >
          <template #icon-left>
            <OIcon name="" size="sm"><EqualIcon class="size-3" /></OIcon>
          </template>
          {{ t("logs.cellActions.includeTerm") }}
        </OContextMenuItem>
        <OContextMenuItem
          data-test="traces-groups-context-exclude-term"
          @select="apply(contextRow.value, 'exclude', false)"
        >
          <template #icon-left>
            <OIcon name="" size="sm"><NotEqualIcon class="size-3" /></OIcon>
          </template>
          {{ t("logs.cellActions.excludeTerm") }}
        </OContextMenuItem>
        <OContextMenuItem
          icon-left="format-list-bulleted"
          data-test="traces-groups-context-open-traces"
          @select="apply(contextRow.value, 'include', true)"
        >
          {{ t("traces.groups.openTraces") }}
        </OContextMenuItem>
      </template>
    </OContextMenu>

    <div
      v-if="!error && distinct !== null && distinct > rows.length"
      class="text-text-secondary border-border-default border-t px-3 py-2 text-xs"
      data-test="traces-groups-footer"
    >
      {{ t("traces.groups.showingOf", { shown: rows.length, total: formatLargeNumber(distinct) }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import useTraces from "@/composables/useTraces";
import type { TracesGroupsRequest } from "@/composables/useTraces";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OContextMenu from "@/lib/overlay/ContextMenu/OContextMenu.vue";
import OContextMenuItem from "@/lib/overlay/ContextMenu/OContextMenuItem.vue";
import OContextMenuLabel from "@/lib/overlay/ContextMenu/OContextMenuLabel.vue";
import OContextMenuSeparator from "@/lib/overlay/ContextMenu/OContextMenuSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import QueryErrorState from "@/components/common/QueryErrorState.vue";
import CellActions from "@/plugins/logs/data-table/CellActions.vue";
import { copyToClipboard } from "@/utils/clipboard";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { formatLargeNumber, formatTimeWithSuffix } from "@/utils/zincutils";
import { SPAN_KIND_MAP } from "@/utils/traces/constants";
import {
  buildGroupsDistinctSql,
  buildGroupsSparklineSql,
  buildGroupsSql,
  groupTerm,
  GROUPS_LIMIT,
  isGroupsSortKey,
  isNoValue,
  sparklinePlan,
  sparklineSeries,
  toGroupRows,
  type GroupRow,
  type GroupsSort,
  type GroupValue,
} from "@/utils/traces/tracesGroups";

const props = withDefaults(
  defineProps<{
    request: TracesGroupsRequest;
    sort: GroupsSort;
    columns: OTableColumnDef<GroupRow>[];
    wrap?: boolean;
  }>(),
  { wrap: false },
);

const emit = defineEmits<{
  "update:sort": [sort: GroupsSort];
  "open-group": [term: string];
}>();

const { t } = useI18nTyped();
const { searchObj } = useTraces();
const { executeQuery, cancelAll } = useLLMStreamQuery();

const PERCENTILES = ["p50", "p95", "p99"] as const;
// Matches the span list's context menu: a right-click outside a data cell opens no menu.
const DATA_CELL_SELECTOR = "td[data-test^='o2-table-cell-']";
// Error % turns red from here; lower rates stay neutral so a red cell means something.
const ERROR_PCT_ALERT = 5;

const rows = ref<GroupRow[]>([]);
const loading = ref(false);
const error = ref<{ code: number; message: string; detail: string } | null>(null);
const sparks = shallowRef(new Map<GroupValue, number[]>());
const distinct = ref<number | null>(null);
const contextRow = ref<GroupRow | null>(null);

let loadSeq = 0;
let cancelLoad: (() => void) | null = null;

// cancelAll stops the streams but never settles their promises, so each load races its own cancel.
const search = (sql: string, cancelled: Promise<never>) =>
  Promise.race([
    executeQuery(sql, props.request.startTime, props.request.endTime, "traces", {
      replaceStreamingAggs: true,
    }),
    cancelled,
  ]) as Promise<Record<string, unknown>[]>;

const cancel = () => {
  cancelAll();
  cancelLoad?.();
  cancelLoad = null;
};

const loadSparklines = async (seq: number, cancelled: Promise<never>) => {
  const plan = sparklinePlan(props.request.startTime, props.request.endTime);
  const sql = buildGroupsSparklineSql({
    ...props.request,
    values: rows.value.map((row) => row.value),
    plan,
  });
  try {
    const hits = await search(sql, cancelled);
    if (seq === loadSeq) sparks.value = sparklineSeries(hits, plan);
  } catch (e) {
    // The rate column is a hint; the table stands without it.
    if (seq === loadSeq) console.warn("Failed to load group sparklines", e);
  }
};

const loadDistinct = async (seq: number, cancelled: Promise<never>) => {
  try {
    const hits = await search(buildGroupsDistinctSql(props.request), cancelled);
    const n = Number(hits[0]?.n);
    if (seq === loadSeq && Number.isFinite(n)) distinct.value = n;
  } catch (e) {
    if (seq === loadSeq) console.warn("Failed to count group values", e);
  }
};

const load = async () => {
  cancel();
  const seq = ++loadSeq;
  const cancelled = new Promise<never>((_, reject) => {
    cancelLoad = () => reject(new Error("cancelled"));
  });
  cancelled.catch(() => {});
  rows.value = [];
  sparks.value = new Map();
  distinct.value = null;
  error.value = null;
  loading.value = true;
  try {
    const hits = await search(buildGroupsSql({ ...props.request, sort: props.sort }), cancelled);
    if (seq !== loadSeq) return;
    rows.value = toGroupRows(hits);
  } catch (e: any) {
    if (seq !== loadSeq) return;
    error.value = {
      code: Number(e?.code) || 0,
      message: e?.message || t("traces.groups.loadFailed"),
      detail: e?.raw?.content?.error_detail || "",
    };
    return;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
  if (!rows.value.length) return;
  void loadSparklines(seq, cancelled);
  // Fewer rows than the limit means every value is already on screen.
  if (rows.value.length >= GROUPS_LIMIT) void loadDistinct(seq, cancelled);
};

watch(() => [props.request, props.sort], load, { immediate: true });

onBeforeUnmount(() => {
  loadSeq++;
  cancel();
});

const apply = (value: GroupValue, action: "include" | "exclude", toList: boolean) => {
  const term = groupTerm(props.request.key, value, action);
  if (toList) emit("open-group", term);
  else searchObj.data.stream.addToFilter = term;
};

// The group key is filterable by construction, so Include/Exclude show as the context menu does, whatever the schema list holds.
const groupKeyFields = computed(() => [{ name: props.request.key, isSchemaField: true }]);

const copyValue = (value: GroupValue) =>
  copyToClipboard(isNoValue(value) ? "" : String(displayValue(value)), t);

// OTable's server sort cycles asc, desc, then cleared; the Groups table is never unsorted, so cleared flips the order.
const onSortChange = (params: { column: string; order: "asc" | "desc" }) => {
  if (!params.column) {
    emit("update:sort", { by: props.sort.by, order: props.sort.order === "desc" ? "asc" : "desc" });
  } else if (isGroupsSortKey(params.column)) {
    emit("update:sort", { by: params.column, order: params.order });
  }
};

const onTableContextMenu = (event: MouseEvent) => {
  contextRow.value = null;
  const target = event.target;
  if (!(target instanceof Element) || !target.closest?.(DATA_CELL_SELECTOR)) event.preventDefault();
};

const onContextMenuOpenChange = (open: boolean) => {
  if (!open) contextRow.value = null;
};

const errorPctClass = (pct: number) => {
  if (pct === 0) return "text-text-muted";
  return pct >= ERROR_PCT_ALERT ? "text-status-error-text font-semibold" : "text-text-body";
};

// span_kind is stored as its OTLP number; the label is for display only, the filter term keeps the number.
const displayValue = (value: GroupValue) =>
  props.request.key === "span_kind" ? (SPAN_KIND_MAP[String(value)] ?? String(value)) : value;

const formatErrorPct = (pct: number) => (pct === 0 ? "0%" : `${pct.toFixed(1)}%`);
</script>
