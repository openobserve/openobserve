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

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableSortParams } from "@/lib/core/Table/OTable.types";
import { useTableColumnPersistence } from "@/lib/core/Table/composables/useTableColumnPersistence";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ContainerSquares from "./ContainerSquares.vue";
import K8sListHeader from "./K8sListHeader.vue";
import type { View } from "./kubernetesQueries";
import {
  TONE_TEXT_CLASS,
  filterRows,
  formatAge,
  severityOf,
  usageBarVariant,
  warningLabel,
  type AnyRow,
  type Warning,
} from "./kubernetesModel";
import type { EventRow } from "./kubernetesEvents";
import {
  HIDDEN_BY_DEFAULT,
  columnsFor,
  defaultSort,
  detailsOf,
  eventTarget,
  type K8sColumn,
} from "./kubernetesColumns";
import type { DetailsRef, K8sUrlState } from "./kubernetesUrlState";

type ListView = Exclude<View, "cluster" | "map" | "workloads">;

const props = defineProps<{
  view: ListView;
  rows: any[];
  state: K8sUrlState;
  endUs: number;
  cluster: string | null;
  eventLinks: boolean;
  namespaceOptions: string[];
  loading: boolean;
  forbidden: boolean;
  anchorMissing: string | null;
  capped: boolean;
  chip?: I18nText;
  lastUpdatedAt: number | null;
}>();

const emit = defineEmits<{
  open: [details: DetailsRef];
  update: [patch: Partial<K8sUrlState>];
  refresh: [];
}>();

const VIEW_TITLE: Record<ListView, I18nKey> = {
  nodes: "infra.k8s2.viewNodes",
  pods: "infra.k8s2.viewPods",
  deployments: "infra.k8s2.viewDeployments",
  daemonsets: "infra.k8s2.viewDaemonSets",
  statefulsets: "infra.k8s2.viewStatefulSets",
  replicasets: "infra.k8s2.viewReplicaSets",
  jobs: "infra.k8s2.viewJobs",
  cronjobs: "infra.k8s2.viewCronJobs",
  pvcs: "infra.k8s2.viewPvcs",
  hpas: "infra.k8s2.viewHpas",
  namespaces: "infra.k8s2.viewNamespaces",
  events: "infra.k8s2.viewEvents",
};

const { t } = useI18nTyped();

const tableRef = ref<{ applyColumnVisibility: (v: Record<string, boolean>) => void } | null>(null);

const title = computed(() => t(VIEW_TITLE[props.view]));

const tableId = computed(() => `k8s2-${props.view}`);

// Namespaces and nodes have no namespace; Lens hides the select there.
const namespaced = computed(() => props.view !== "nodes" && props.view !== "namespaces");

const columns = computed<K8sColumn[]>(() =>
  columnsFor(props.view, {
    t,
    endUs: props.endUs,
    eventLinks: props.eventLinks,
    cluster: props.cluster,
  }),
);

const defaultVisibility = computed(() =>
  Object.fromEntries((HIDDEN_BY_DEFAULT[props.view] ?? []).map((id) => [id, false])),
);

const eventMatches = (e: EventRow, needle: string) =>
  [e.note, e.reason, e.object.name].some((v) => v.toLowerCase().includes(needle));

const filtered = computed<any[]>(() => {
  const needle = props.state.search.trim().toLowerCase();
  if (props.view === "events") {
    return needle ? props.rows.filter((e: EventRow) => eventMatches(e, needle)) : props.rows;
  }
  const namespaces = namespaced.value ? props.state.namespaces : [];
  return filterRows(props.rows as AnyRow[], { cluster: null, namespaces }, props.state.search);
});

const narrowed = computed(() => !!props.state.search || props.state.namespaces.length > 0);

const sortBy = computed(() => props.state.sort ?? defaultSort(props.view).sort);

const sortOrder = computed(() =>
  (props.state.sort ? props.state.desc : defaultSort(props.view).desc) ? "desc" : "asc",
);

const onSort = ({ column, order }: OTableSortParams) => {
  const fallback = defaultSort(props.view);
  const isDefault = !column || (column === fallback.sort && (order === "desc") === fallback.desc);
  emit(
    "update",
    isDefault ? { sort: null, desc: false } : { sort: column, desc: order === "desc" },
  );
};

const targetOf = (row: any): DetailsRef | null =>
  props.view === "events"
    ? eventTarget(row as EventRow, { eventLinks: props.eventLinks, cluster: props.cluster })
    : detailsOf(row as AnyRow);

const onRow = (row: any) => {
  const target = targetOf(row);
  if (target) emit("open", target);
};

const clear = () => emit("update", { search: "", namespaces: [] });

const setNamespace = (namespace: string) => {
  if (namespace) emit("update", { namespaces: [namespace] });
};

const persistence = computed(() =>
  useTableColumnPersistence({ tableId: tableId.value, enabled: true }),
);

// A link that sorts by a hidden column must show the values it ranks, without rewriting storage.
const applySortVisibility = () => {
  const base = { ...defaultVisibility.value, ...(persistence.value.loadColumnVisibility() ?? {}) };
  const sort = props.state.sort;
  const forced = sort && columns.value.some((c) => c.id === sort) ? { [sort]: true } : {};
  tableRef.value?.applyColumnVisibility({ ...base, ...forced });
};

onMounted(() => nextTick(applySortVisibility));
watch(
  () => [props.view, props.state.sort],
  () => nextTick(applySortVisibility),
);

const warnLines = (warnings: Warning[]) =>
  raw(
    [...warnings.map((w) => warningLabel(w, t, props.endUs)), t("infra.k8s2.warnFooter")].join(
      "\n",
    ),
  );

const kindLabel = computed(() =>
  props.view === "events" ? t("infra.k8s2.viewEvents") : title.value,
);

const searchPlaceholder = computed<I18nText>(() =>
  t("infra.k8s2.searchKind", { kind: kindLabel.value }),
);

const namespaceOf = (row: any): string =>
  props.view === "events" ? (row as EventRow).object.namespace : (row as AnyRow).namespace;
</script>

<template>
  <OTable
    ref="tableRef"
    :data="filtered"
    :columns="columns"
    row-key="key"
    dense
    :row-height="32"
    sticky-header
    virtual-scroll
    :overscan="10"
    pagination="none"
    sorting="client"
    :sort-by="sortBy"
    :sort-order="sortOrder"
    :frame="false"
    :show-global-filter="false"
    persist-columns
    :table-id="tableId"
    :column-visibility="defaultVisibility"
    :forbidden="forbidden"
    :loading="loading"
    fill-height
    :data-test="`k8s2-table-${view}`"
    @sort-change="onSort"
    @row-click="onRow"
  >
    <template #toolbar>
      <K8sListHeader
        :title="title"
        :count="filtered.length"
        :total="rows.length"
        :capped="capped"
        :chip="chip"
        :namespaced="namespaced"
        :namespace-options="namespaceOptions"
        :namespaces="state.namespaces"
        :search="state.search"
        :search-placeholder="searchPlaceholder"
        @update:namespaces="(namespaces: string[]) => emit('update', { namespaces })"
        @update:search="(search: string) => emit('update', { search })"
        @clear="clear"
      />
    </template>
    <template #toolbar-trailing>
      <ORefreshButton
        :last-run-at="lastUpdatedAt"
        :loading="loading"
        data-test="k8s2-refresh"
        @click="emit('refresh')"
      />
    </template>

    <template v-for="c in columns" :key="c.id" #[`cell-${c.id}`]="{ row }">
      <span
        v-if="c.meta.render === 'name'"
        class="truncate font-medium"
        :data-test="`k8s2-name-${row.key}`"
        >{{ c.meta.text?.(row) }}</span
      >
      <span
        v-else-if="c.meta.render === 'warn'"
        class="inline-flex"
        :data-test="`k8s2-warn-${row.key}`"
      >
        <template v-if="row.warnings.length">
          <OIcon
            :name="severityOf(row.warnings) === 'error' ? 'error' : 'warning'"
            size="sm"
            :class="
              severityOf(row.warnings) === 'error'
                ? 'text-status-error-text'
                : 'text-status-warning-text'
            "
          />
          <OTooltip :content="warnLines(row.warnings)" content-class="whitespace-pre-line" />
        </template>
      </span>
      <template v-else-if="c.meta.render === 'namespace'">
        <OButton
          v-if="namespaceOf(row)"
          variant="ghost-primary"
          size="xs"
          :data-test="`k8s2-namespace-${row.key}`"
          @click.stop="setNamespace(namespaceOf(row))"
          >{{ raw(namespaceOf(row)) }}</OButton
        >
      </template>
      <span v-else-if="c.meta.render === 'link'" class="flex min-w-0 flex-wrap items-center gap-1">
        <template v-for="link in c.meta.links?.(row) ?? []" :key="link.label">
          <OButton
            v-if="link.target"
            variant="ghost-primary"
            size="xs"
            :data-test="`k8s2-link-${c.id}-${row.key}`"
            @click.stop="emit('open', link.target)"
            >{{ link.label }}<OTooltip v-if="link.tip" :content="link.tip"
          /></OButton>
          <span v-else class="truncate"
            >{{ link.label }}<OTooltip v-if="link.tip" :content="link.tip"
          /></span>
        </template>
        <span v-if="!(c.meta.links?.(row) ?? []).length">{{ raw("—") }}</span>
      </span>
      <span v-else-if="c.meta.render === 'age'" class="tabular-nums">{{
        raw(formatAge(c.meta.at?.(row) == null ? null : endUs - (c.meta.at?.(row) as number)))
      }}</span>
      <span v-else-if="c.meta.render === 'bar'" class="flex w-full min-w-0 items-center">
        <template v-if="c.meta.bar?.(row).pct != null">
          <OProgressBar
            size="xs"
            class="min-w-0 flex-1"
            :value="Math.min(c.meta.bar?.(row).pct ?? 0, 100) / 100"
            :variant="usageBarVariant(c.meta.bar?.(row).pct ?? null)"
            :data-test="`k8s2-bar-${c.id}-${row.key}`"
          />
          <OTooltip :content="c.meta.bar?.(row).tip" />
        </template>
        <span v-else>{{ raw("—") }}</span>
      </span>
      <span
        v-else-if="c.meta.render === 'badges'"
        class="flex min-w-0 flex-wrap items-center gap-1"
      >
        <template v-if="c.meta.badges?.(row)?.length">
          <OTag
            v-for="badge in c.meta.badges?.(row)"
            :key="badge.text"
            size="xs"
            :variant="badge.variant"
            >{{ badge.text }}</OTag
          >
        </template>
        <span v-else>{{ raw("—") }}</span>
      </span>
      <span
        v-else-if="c.meta.render === 'conditions'"
        class="flex min-w-0 flex-wrap items-center gap-x-2"
        :data-test="`k8s2-conditions-${row.key}`"
      >
        <span
          v-for="word in c.meta.words?.(row)"
          :key="word.text"
          :class="TONE_TEXT_CLASS[word.tone]"
          >{{ word.text }}</span
        >
        <OTooltip
          v-if="c.meta.tip?.(row)"
          :content="c.meta.tip?.(row) ?? undefined"
          content-class="whitespace-pre-line"
        />
      </span>
      <ContainerSquares v-else-if="c.meta.render === 'containers'" :containers="row.containers" />
      <span
        v-else
        class="truncate"
        :class="c.meta.tone?.(row) ? TONE_TEXT_CLASS[c.meta.tone?.(row) ?? 'neutral'] : ''"
        :data-test="`k8s2-cell-${c.id}-${row.key}`"
        >{{ c.meta.text?.(row)
        }}<OTooltip
          v-if="c.meta.tip?.(row)"
          :content="c.meta.tip?.(row) ?? undefined"
          content-class="whitespace-pre-line"
      /></span>
    </template>

    <template #empty>
      <OEmptyState
        v-if="anchorMissing"
        preset="no-data"
        size="inline"
        :title="t('infra.k8s2.noKindData', { kind: kindLabel })"
        :description="t('infra.k8s2.needsMetric', { stream: raw(anchorMissing) })"
        hide-action
        data-test="k8s2-empty-anchor"
      />
      <OEmptyState
        v-else
        size="inline"
        :filtered="narrowed"
        :title="t('infra.k8s2.noKindFound', { kind: kindLabel })"
        :hide-action="!narrowed"
        data-test="k8s2-empty"
        @action="clear"
      />
    </template>
  </OTable>
</template>
