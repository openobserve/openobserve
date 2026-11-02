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
  <div v-if="op" class="flex flex-col pb-6" data-test="query-profile-detail">
    <ProfileDetailHeader
      :model="model"
      :op="op"
      :can-focus="canFocus"
      :focused="focused"
      @select="emit('select', $event)"
      @focus="emit('focus', $event)"
    />

    <div class="flex flex-col gap-4 px-4 pt-3">
      <template v-if="stage">
        <div class="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
          <ProfileStatTile
            :label="t('search.queryProfile.wall')"
            :value="formatNs(stage.maxWallUs * 1000)"
            :sub="t('search.queryProfile.slowestNode')"
          />
          <ProfileStatTile
            :label="t('search.queryProfile.rowsIn')"
            :value="formatRows(op.totalRows)"
            :sub="
              t(
                'search.queryProfile.batches',
                { count: remoteTotals.batches },
                remoteTotals.batches,
              )
            "
          />
          <ProfileStatTile
            :label="t('search.queryProfile.bytesIn')"
            :value="formatBytes(remoteTotals.bytes)"
          />
        </div>

        <section>
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-text-secondary m-0 text-xs font-semibold">
              {{ t("search.queryProfile.perNode") }}
            </h4>
            <OToggleGroup
              type="single"
              :model-value="remoteTab"
              :aria-label="t('search.queryProfile.perNode')"
              @update:model-value="onRemoteTab"
            >
              <OToggleGroupItem
                value="returned"
                size="sm"
                data-test="query-profile-remote-returned"
                >{{ t("search.queryProfile.returnedToLeader") }}</OToggleGroupItem
              >
              <OToggleGroupItem value="read" size="sm" data-test="query-profile-remote-read">{{
                t("search.queryProfile.readFromStorage")
              }}</OToggleGroupItem>
            </OToggleGroup>
          </div>
          <OTable
            v-model:expanded-ids="remoteExpanded"
            :data="remoteTree"
            :columns="remoteTab === 'returned' ? returnedColumns : readColumns"
            row-key="id"
            tree
            pagination="none"
            :show-global-filter="false"
            :fill-height="false"
            dense
            data-test="query-profile-remote-nodes"
            @row-click="onRemoteRow"
          >
            <template #cell-name="{ row }">
              <ProfileNodeName :row="row" />
            </template>
            <template #cell-wall="{ row }">
              <ODataBarCell
                :value="row.wallUs"
                :max="stage.maxWallUs"
                :display="formatNs(row.wallUs * 1000)"
                :variant="row.straggler ? 'danger' : 'default'"
              />
            </template>
          </OTable>
          <div class="mt-2 flex justify-between text-xs">
            <span class="text-text-secondary">{{ t("search.queryProfile.skew") }}</span>
            <span class="text-text-heading font-semibold tabular-nums">{{ remoteSkew }}</span>
          </div>
        </section>
        <div
          v-if="missingPlans"
          class="bg-surface-subtle text-text-secondary rounded-default px-2.5 py-2 text-xs"
        >
          {{ t("search.queryProfile.noPlanNodes", { count: missingPlans }, missingPlans) }}
        </div>
      </template>

      <template v-else>
        <div class="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
          <ProfileStatTile
            :label="computeLabel"
            :value="value.on ? formatNs(value.computeNs) : '—'"
            :sub="t('search.queryProfile.ofTotalCpu', { pct: formatPercent(share) })"
          />
          <ProfileStatTile
            :label="t('search.queryProfile.rowsOut')"
            :value="value.on ? formatRows(value.rows) : '—'"
          />
          <ProfileStatTile
            v-if="bytesScanned"
            :label="t('search.queryProfile.bytesIn')"
            :value="formatBytes(bytesScanned)"
          />
          <ProfileStatTile
            v-else
            :label="t('search.queryProfile.partitions')"
            :value="op.partitions || '—'"
          />
        </div>

        <div>
          <div class="mb-1.5 flex justify-between text-xs">
            <span class="text-text-secondary">{{ t("search.queryProfile.shareOfTotal") }}</span>
            <span class="text-text-heading font-semibold tabular-nums">{{
              formatPercent(share)
            }}</span>
          </div>
          <OProgressBar size="sm" :value="share" :variant="SHARE_BAR[shareTone(share)]" />
        </div>

        <section v-if="nodeRows.length > 1">
          <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">
            {{ t("search.queryProfile.perNode") }}
          </h4>
          <OTable
            v-model:expanded-ids="opExpanded"
            :data="opTree"
            :columns="opColumns"
            row-key="id"
            tree
            pagination="none"
            :show-global-filter="false"
            :fill-height="false"
            dense
            data-test="query-profile-op-nodes"
            @row-click="onOpRow"
          >
            <template #cell-name="{ row }">
              <ProfileNodeName :row="row" />
            </template>
            <template #cell-compute="{ row }">
              <span v-if="row.group" class="font-semibold tabular-nums">{{
                formatNs(row.computeNs)
              }}</span>
              <ODataBarCell
                v-else
                :value="row.computeNs"
                :max="maxNodeCompute"
                :display="formatNs(row.computeNs)"
                :variant="row.straggler ? 'danger' : 'default'"
              />
            </template>
            <template #cell-cache="{ row }">
              <span
                class="tabular-nums"
                :class="row.straggler ? 'text-status-error-text font-semibold' : ''"
                >{{ row.cache === null ? "—" : formatPercent(row.cache) }}</span
              >
            </template>
          </OTable>
          <div class="mt-2 flex justify-between text-xs">
            <span class="text-text-secondary">{{ t("search.queryProfile.skew") }}</span>
            <span
              class="font-semibold tabular-nums"
              :class="
                opSkewValue > STRAGGLER_FACTOR ? 'text-status-error-text' : 'text-text-heading'
              "
              >{{ formatSkew(opSkewValue) }}</span
            >
          </div>
        </section>

        <section v-for="sec in metricBlocks" :key="sec.key">
          <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">{{ sec.title }}</h4>
          <ProfileMetricList
            :metrics="sec.metrics"
            :bar="sec.bar"
            :data-test="`query-profile-metrics-${sec.key}`"
          />
        </section>
      </template>

      <section>
        <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">
          {{ t("search.queryProfile.raw") }}
        </h4>
        <div class="text-text-secondary font-mono text-xs wrap-anywhere">{{ op.detail }}</div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  STRAGGLER_FACTOR,
  findMetric,
  formatBytes,
  formatNs,
  formatPercent,
  formatRows,
  metricSections,
  metricsForScope,
  nodeScope,
  operatorNodeRows,
  scopeNodeKey,
  scopedValue,
  shareOfTotal,
  shareTone,
  skew,
  stageNodeFor,
  type ProfileModel,
  type ProfileMetric,
  type StageNode,
  type StageScope,
} from "@/utils/queryProfile";
import ProfileDetailHeader from "./ProfileDetailHeader.vue";
import ProfileMetricList from "./ProfileMetricList.vue";
import ProfileNodeName from "./ProfileNodeName.vue";
import ProfileStatTile from "./ProfileStatTile.vue";
import { SHARE_BAR, type NodeNameRow } from "./profileStyles";
import { scopeTag } from "./profileText";

const props = defineProps<{
  model: ProfileModel;
  opId: string | null;
  scope: StageScope;
  canFocus?: boolean;
  focused?: boolean;
}>();

const emit = defineEmits<{
  select: [opId: string];
  scope: [scope: StageScope];
  focus: [opId: string | null];
}>();

const { t } = useI18nTyped();

const op = computed(() => (props.opId ? props.model.operators[props.opId] : null));
const stage = computed(() =>
  op.value?.remoteStageId ? props.model.stageById[op.value.remoteStageId] : null,
);
const share = computed(() => (op.value ? shareOfTotal(props.model, op.value) : 0));
const value = computed(() =>
  op.value ? scopedValue(op.value, props.scope) : { computeNs: 0, rows: 0, on: false },
);

const computeLabel = computed<I18nText>(() =>
  op.value?.stageId && op.value.samples.length > 1
    ? raw(`${t("search.queryProfile.compute")} · ${scopeTag(t, props.model, props.scope)}`)
    : t("search.queryProfile.compute"),
);

const scopedMetrics = computed<ProfileMetric[]>(() =>
  op.value ? metricsForScope(op.value, props.scope) : [],
);

const bytesScanned = computed(
  () => Number(findMetric(scopedMetrics.value, "bytes_scanned")?.value) || 0,
);

const metricBlocks = computed(() => {
  const s = metricSections(scopedMetrics.value);
  const blocks: {
    key: string;
    title: I18nText;
    metrics: ProfileMetric[];
    bar: "share" | "fraction" | "none";
  }[] = [
    { key: "timing", title: t("search.queryProfile.timing"), metrics: s.timing, bar: "share" },
    {
      key: "pruning",
      title: t("search.queryProfile.pruning"),
      metrics: s.pruning,
      bar: "fraction",
    },
    { key: "ratios", title: t("search.queryProfile.ratios"), metrics: s.ratios, bar: "fraction" },
    { key: "counters", title: t("search.queryProfile.counters"), metrics: s.counters, bar: "none" },
  ];
  return blocks.filter((b) => b.metrics.length);
});

const activeNode = computed(() => scopeNodeKey(props.scope));

interface OpNodeRow extends NodeNameRow {
  computeNs: number;
  rows: number;
  share: number;
  files: number | null;
  cache: number | null;
  querierFiles: number;
  diskFiles: number;
  group?: boolean;
  children?: OpNodeRow[];
}

interface RemoteRow extends NodeNameRow {
  wallUs: number;
  firstBatch: string;
  decode: string;
  rows: string;
  bytes: string;
  files: number | string;
  memoryCache: string;
  diskCache: string;
  index: string;
  peakMemory: string;
  group?: boolean;
  children?: RemoteRow[];
}

const nodeRows = computed<OpNodeRow[]>(() => {
  const current = op.value;
  if (!current) return [];
  return operatorNodeRows(props.model, current).map((r) => {
    const st = stageNodeFor(props.model, current, r.nodeKey)?.remote.scan_stats;
    return {
      id: r.nodeKey,
      name: r.name,
      cluster: r.cluster,
      role: "",
      straggler: r.straggler,
      active: activeNode.value === r.nodeKey,
      error: "",
      skipped: false,
      computeNs: r.computeNs,
      rows: r.rows,
      share: r.share,
      files: st ? st.files || 0 : null,
      cache: st?.querier_files ? st.querier_disk_cached_files / st.querier_files : null,
      querierFiles: st?.querier_files ?? 0,
      diskFiles: st?.querier_disk_cached_files ?? 0,
    };
  });
});

const opTree = computed<OpNodeRow[]>(() => {
  const clusters = [...new Set(nodeRows.value.map((r) => r.cluster))].sort();
  if (clusters.length < 2) return nodeRows.value;
  return clusters.map((cluster) => {
    const children = nodeRows.value
      .filter((r) => r.cluster === cluster)
      .map((r) => ({ ...r, cluster: "" }));
    const sum = (f: (r: OpNodeRow) => number) => children.reduce((a, r) => a + f(r), 0);
    const querierFiles = sum((r) => r.querierFiles);
    return {
      ...groupName(cluster, children.length),
      straggler: children.some((r) => r.straggler),
      computeNs: sum((r) => r.computeNs),
      rows: sum((r) => r.rows),
      share: sum((r) => r.share),
      files: children.some((r) => r.files !== null) ? sum((r) => r.files ?? 0) : null,
      cache: querierFiles ? sum((r) => r.diskFiles) / querierFiles : null,
      querierFiles,
      diskFiles: sum((r) => r.diskFiles),
      group: true,
      children,
    };
  });
});

const opExpanded = ref<string[]>([]);

const maxNodeCompute = computed(() => Math.max(0, ...nodeRows.value.map((r) => r.computeNs)));
const opSkewValue = computed(() => skew(nodeRows.value.map((r) => r.computeNs)));

function formatSkew(v: number) {
  return Number.isFinite(v) ? `${v.toFixed(1)}×` : "—";
}

function remoteRow(n: StageNode, underCluster = false): RemoteRow {
  const st = n.remote.scan_stats;
  return {
    id: n.key,
    name: n.name,
    cluster: underCluster ? "" : n.cluster,
    role: n.clusterEntry ? "" : n.role,
    straggler: n.straggler,
    active: activeNode.value === n.key,
    error: n.remote.error,
    skipped: n.remote.skipped,
    wallUs: n.wallUs,
    firstBatch: n.firstBatchUs ? formatNs(n.firstBatchUs * 1000) : "—",
    decode: formatNs(n.remote.decode_ns),
    rows: formatRows(n.remote.output_rows),
    bytes: formatBytes(n.remote.output_bytes),
    files: st ? st.files || n.remote.assigned_files || 0 : n.remote.assigned_files || "—",
    memoryCache:
      st && st.querier_files
        ? formatPercent(st.querier_memory_cached_files / st.querier_files)
        : "—",
    diskCache:
      st && st.querier_files ? formatPercent(st.querier_disk_cached_files / st.querier_files) : "—",
    index: st && st.idx_took ? formatNs(st.idx_took * 1e6) : "—",
    peakMemory: formatBytes(Math.max(n.remote.peak_memory || 0, st?.peak_memory_usage || 0)),
  };
}

function groupName(cluster: string, count: number): NodeNameRow {
  return {
    id: `cluster:${cluster}`,
    name: cluster,
    cluster: "",
    role: "",
    count,
    straggler: false,
    active: false,
    error: "",
    skipped: false,
  };
}

/** One cluster's subtotal over its nodes: slowest fetch, summed volume, pooled cache hits. */
function clusterRow(cluster: string, nodes: StageNode[]): RemoteRow {
  const children = nodes.map((n) => remoteRow(n, true));
  const stats = nodes.flatMap((n) => (n.remote.scan_stats ? [n.remote.scan_stats] : []));
  const sum = (f: (n: StageNode) => number) => nodes.reduce((a, n) => a + f(n), 0);
  const querierFiles = stats.reduce((a, st) => a + st.querier_files, 0);
  const cached = (key: "querier_memory_cached_files" | "querier_disk_cached_files") =>
    querierFiles ? formatPercent(stats.reduce((a, st) => a + st[key], 0) / querierFiles) : "—";
  return {
    ...groupName(cluster, nodes.length),
    straggler: children.some((r) => r.straggler),
    wallUs: Math.max(0, ...nodes.map((n) => n.wallUs)),
    firstBatch: "—",
    decode: formatNs(sum((n) => n.remote.decode_ns)),
    rows: formatRows(sum((n) => n.remote.output_rows)),
    bytes: formatBytes(sum((n) => n.remote.output_bytes)),
    files: stats.reduce((a, st) => a + st.files, 0),
    memoryCache: cached("querier_memory_cached_files"),
    diskCache: cached("querier_disk_cached_files"),
    index: "—",
    peakMemory: formatBytes(
      Math.max(
        0,
        ...nodes.map((n) =>
          Math.max(n.remote.peak_memory || 0, n.remote.scan_stats?.peak_memory_usage || 0),
        ),
      ),
    ),
    group: true,
    children,
  };
}

const remoteRows = computed(() => (stage.value?.nodes ?? []).map((n) => remoteRow(n)));

const remoteTree = computed<RemoteRow[]>(() => {
  const current = stage.value;
  if (!current) return [];
  if (current.nodes.some((n) => n.clusterEntry)) {
    // a cluster leader's own nodes sit in the stage below, so they are listed under it
    const below = props.model.stages
      .filter((s) => s.parentStageId === current.id)
      .flatMap((s) => s.nodes.filter((n) => !n.clusterEntry));
    return current.nodes.map((n) => {
      const pods = below.filter((p) => p.remote.cluster === n.name);
      return pods.length
        ? { ...remoteRow(n), count: pods.length, children: pods.map((p) => remoteRow(p, true)) }
        : remoteRow(n);
    });
  }
  const clusters = [...new Set(current.nodes.map((n) => n.cluster))].sort();
  if (clusters.length < 2) return remoteRows.value;
  return clusters.map((c) =>
    clusterRow(
      c,
      current.nodes.filter((n) => n.cluster === c),
    ),
  );
});

const remoteTab = ref<"returned" | "read">("returned");
const remoteExpanded = ref<string[]>([]);

function onRemoteTab(value: unknown) {
  if (value === "returned" || value === "read") remoteTab.value = value;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function onRemoteRow(row: RemoteRow) {
  if (row.group) remoteExpanded.value = toggle(remoteExpanded.value, row.id);
  else emit("scope", nodeScope(row.id));
}

function onOpRow(row: OpNodeRow) {
  if (row.group) opExpanded.value = toggle(opExpanded.value, row.id);
  else emit("scope", nodeScope(row.id));
}

watch(
  () => props.opId,
  () => {
    remoteExpanded.value = remoteTree.value.filter((r) => r.children).map((r) => r.id);
    opExpanded.value = opTree.value.filter((r) => r.children).map((r) => r.id);
  },
  { immediate: true },
);

const remoteTotals = computed(() => ({
  batches: (stage.value?.nodes ?? []).reduce((a, n) => a + (n.remote.output_batches || 0), 0),
  bytes: (stage.value?.nodes ?? []).reduce((a, n) => a + (n.remote.output_bytes || 0), 0),
}));

const remoteSkew = computed(() =>
  formatSkew(skew(remoteRows.value.map((r) => r.wallUs).filter((v) => v > 0))),
);

const missingPlans = computed(
  () => (stage.value?.nodes ?? []).filter((n) => n.planSource === "none").length,
);

const right = { align: "right" as const };
const nameColumn: OTableColumnDef = {
  id: "name",
  header: t("search.queryProfile.node"),
  accessorKey: "name",
  size: 150,
};

const opBaseColumns: OTableColumnDef[] = [
  nameColumn,
  {
    id: "compute",
    header: t("search.queryProfile.compute"),
    accessorKey: "computeNs",
    size: 100,
    meta: right,
  },
  {
    id: "rows",
    header: t("search.queryProfile.rows"),
    accessorFn: (r) => formatRows(r.rows),
    size: 70,
    meta: right,
  },
  {
    id: "share",
    header: t("search.queryProfile.share"),
    accessorFn: (r) => formatPercent(r.share),
    size: 64,
    meta: right,
  },
];

const filesColumn: OTableColumnDef = {
  id: "files",
  header: t("search.queryProfile.files"),
  accessorFn: (r) => (r.files === null ? "—" : formatRows(r.files)),
  size: 56,
  meta: right,
};

const cacheColumn: OTableColumnDef = {
  id: "cache",
  header: t("search.queryProfile.cache"),
  accessorKey: "cache",
  size: 60,
  meta: { ...right, headerTooltip: t("search.queryProfile.cacheTooltip") },
};

const opColumns = computed<OTableColumnDef[]>(() => [
  ...opBaseColumns,
  ...(nodeRows.value.some((r) => r.files !== null) ? [filesColumn] : []),
  ...(nodeRows.value.some((r) => r.cache !== null) ? [cacheColumn] : []),
]);

const returnedColumns: OTableColumnDef[] = [
  nameColumn,
  {
    id: "wall",
    header: t("search.queryProfile.fetch"),
    accessorKey: "wallUs",
    size: 90,
    meta: right,
  },
  {
    id: "firstBatch",
    header: t("search.queryProfile.firstBatch"),
    accessorKey: "firstBatch",
    size: 84,
    meta: right,
  },
  {
    id: "decode",
    header: t("search.queryProfile.decode"),
    accessorKey: "decode",
    size: 72,
    meta: right,
  },
  { id: "rows", header: t("search.queryProfile.rows"), accessorKey: "rows", size: 64, meta: right },
  {
    id: "bytes",
    header: t("search.queryProfile.bytes"),
    accessorKey: "bytes",
    size: 80,
    meta: right,
  },
];

const readColumns: OTableColumnDef[] = [
  nameColumn,
  {
    id: "files",
    header: t("search.queryProfile.files"),
    accessorKey: "files",
    size: 56,
    meta: right,
  },
  {
    id: "memoryCache",
    header: t("search.queryProfile.memoryCache"),
    accessorKey: "memoryCache",
    size: 84,
    meta: right,
  },
  {
    id: "diskCache",
    header: t("search.queryProfile.diskCache"),
    accessorKey: "diskCache",
    size: 76,
    meta: right,
  },
  {
    id: "index",
    header: t("search.queryProfile.indexTook"),
    accessorKey: "index",
    size: 64,
    meta: right,
  },
  {
    id: "peakMemory",
    header: t("search.queryProfile.peakMemory"),
    accessorKey: "peakMemory",
    size: 90,
    meta: right,
  },
];
</script>
