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
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import K8sHexMap from "./K8sHexMap.vue";
import K8sListHeader from "./K8sListHeader.vue";
import { shortGroupNames } from "./hexLayout";
import { groupCard } from "./hoverCard";
import { detailKindOf } from "./kubernetesEvents";
import { chipLabel, filterRows, rowKey, type NodeRow, type PodRow } from "./kubernetesModel";
import type { BuiltinGroup, MapEntity, MapGroup } from "./kubernetesQueries";
import {
  DEFAULT_GROUP,
  ENTITY_FILLS,
  MAP_GROUPS,
  isLabelGroup,
  labelGroupKey,
  withView,
  type DetailsRef,
  type K8sUrlState,
  type MapFill,
} from "./kubernetesUrlState";
import {
  FILL_LABEL,
  bucketRanges,
  fillClass,
  groupRows,
  legendClasses,
  listTarget,
  noLabelCounts,
  statusCounts,
  type FillClass,
  type GroupHeader,
  type MapRow,
  type RowGroup,
  type StatusClass,
} from "./mapFill";
import {
  applyFilter,
  filterOptions,
  groupLabelOptions,
  labelIndex,
  splitTerm,
  type MapObjects,
} from "./mapFilter";

const props = defineProps<{
  state: K8sUrlState;
  pods: PodRow[];
  nodes: NodeRow[];
  namespaceOptions: string[];
  anchorMissing: string | null;
  objects: MapObjects;
  forbidden: boolean;
  loading: boolean;
  lastUpdatedAt: number | null;
}>();

const emit = defineEmits<{
  update: [patch: Partial<K8sUrlState>];
  open: [details: DetailsRef];
  navigate: [state: K8sUrlState];
  refresh: [];
}>();

const MAX_GROUP_LINKS = 50;

const MAX_GROUP_MEMBERS = 50;

// "=" can never be a label term, so the disabled row is never emitted as a filter value.
const STATE_ROW = "=";

const GROUP_LABEL: Record<BuiltinGroup, I18nKey> = {
  node: "infra.k8s2.mapGroupNode",
  namespace: "infra.k8s2.mapGroupNamespace",
  workload: "infra.k8s2.mapGroupWorkload",
  none: "infra.k8s2.mapGroupNone",
};

const STATUS_LABEL: Partial<Record<FillClass, I18nKey>> = {
  ok: "infra.k8s2.mapStatusOk",
  warning: "infra.k8s2.mapStatusWarning",
  error: "infra.k8s2.mapStatusError",
  noData: "infra.k8s2.mapNoData",
};

const SWATCH: Record<FillClass, string> = {
  b1: "bg-map-seq-1",
  b2: "bg-map-seq-2",
  b3: "bg-map-seq-3",
  b4: "bg-map-seq-4",
  b5: "bg-map-seq-5",
  ok: "bg-status-positive",
  warning: "bg-status-warning-text",
  error: "bg-status-negative",
  noData: "bg-surface-subtle border border-border-default",
};

const NOT_OK_TEXT: Record<string, I18nKey> = {
  noStream: "infra.k8s2.mapLabelsNoStream",
  unscoped: "infra.k8s2.mapLabelsUnscoped",
  anchor: "infra.k8s2.mapLabelsNoData",
  loading: "infra.k8s2.mapLabelsLoading",
  failed: "infra.k8s2.mapLabelsFailed",
};

const { t } = useI18nTyped();

const highlight = ref<FillClass[]>([]);

const isPods = computed(() => props.state.entity === "pods");

const allRows = computed<MapRow[]>(() => (isPods.value ? props.pods : props.nodes));

const scope = computed(() => ({
  cluster: null,
  namespaces: isPods.value ? props.state.namespaces : [],
}));

// Picker options come from the namespace scope only, so adding a term never empties the menu.
const scopedRows = computed(() => filterRows(allRows.value, scope.value, ""));

const labelsOk = computed(() => props.objects.state === "ok");

const index = computed(() => labelIndex(scopedRows.value));

const labelKey = computed(() => labelGroupKey(props.state.group));

const rows = computed<MapRow[]>(() => {
  const searched = filterRows(allRows.value, scope.value, props.state.search);
  return labelsOk.value ? applyFilter(searched, props.state.filter) : searched;
});

const grouped = computed(() => groupRows(rows.value, props.state.group));

const groups = computed(() => grouped.value.groups);

const labelsInUse = computed(() => props.state.filter.length > 0 || labelKey.value != null);

const filterUnavailable = computed(() => labelsInUse.value && !labelsOk.value);

const filtered = computed(
  () =>
    !!props.state.search ||
    props.state.filter.length > 0 ||
    (isPods.value && props.state.namespaces.length > 0),
);

const nodesByName = computed(() => new Map(props.nodes.map((n) => [n.name, n])));

const countLabel = computed(() => countOf(rows.value.length));

const countSuffix = computed(() => {
  const { observed, total } = index.value;
  if (!labelsOk.value || !labelsInUse.value || observed >= total) return undefined;
  return t("infra.k8s2.mapLabelsSeen", { k: observed, n: total });
});

const labelsHeader = computed(() => {
  const params = { k: index.value.observed, n: index.value.total };
  return isPods.value
    ? t("infra.k8s2.mapLabelsHeaderPods", params)
    : t("infra.k8s2.mapLabelsHeaderNodes", params);
});

// One disabled row says why labels cannot be offered; null once they can.
const labelsState = computed<I18nText | null>(() => {
  const o = props.objects;
  if (o.state !== "ok") return t(NOT_OK_TEXT[o.reason ?? o.state]);
  if (index.value.observed > 0) return null;
  return isPods.value
    ? t("infra.k8s2.mapLabelsNoneSeenPods")
    : t("infra.k8s2.mapLabelsNoneSeenNodes");
});

const stateRow = (label: I18nText): SelectOption => ({ label, value: STATE_ROW, disabled: true });

const pickerOptions = computed<SelectOption[]>(() =>
  labelsState.value
    ? [stateRow(labelsState.value)]
    : filterOptions(index.value, labelsHeader.value),
);

const fillOptions = computed(() =>
  ENTITY_FILLS[props.state.entity].map((fill) => ({ label: t(FILL_LABEL[fill]), value: fill })),
);

const groupOptions = computed<SelectOption[]>(() => {
  const builtins = MAP_GROUPS[props.state.entity].map((group) => ({
    label: t(GROUP_LABEL[group]),
    value: group,
  }));
  if (labelsState.value) return [...builtins, stateRow(labelsState.value)];
  return [
    ...builtins,
    { label: labelsHeader.value, header: true },
    ...groupLabelOptions(index.value),
  ];
});

const filterTrigger = computed(() =>
  props.state.filter.length
    ? t("infra.k8s2.mapFilterCount", { count: props.state.filter.length })
    : t("infra.k8s2.mapFilter"),
);

const legend = computed(() => {
  const fill = props.state.fill;
  const ranges = fill === "status" ? [] : bucketRanges(fill);
  const counts = new Map<FillClass, number>();
  for (const row of rows.value) {
    const cls = fillClass(row, fill);
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return legendClasses(fill).map((cls, i) => ({
    cls,
    label: STATUS_LABEL[cls] ? t(STATUS_LABEL[cls]) : raw(ranges[i]),
    count: counts.get(cls) ?? 0,
  }));
});

const shortNames = computed(() => {
  const shortenable = props.state.group === "node" || labelKey.value != null;
  const regular = groups.value.filter((g) => !g.special);
  const names = regular.map((g) => g.name);
  const short = shortenable ? shortGroupNames(names) : names;
  return new Map(regular.map((g, i) => [g.id, short[i]]));
});

const headers = computed<GroupHeader[]>(() =>
  groups.value.map((g) => {
    const summary = statusCounts(g.rows);
    const title = fullTitle(g);
    const count = countOf(g.rows.length);
    const note =
      g.special === "noLabel" ? t("infra.k8s2.mapNoLabelSplit", noLabelCounts(g)) : undefined;
    return {
      title: shortNames.value.get(g.id) ?? title,
      count: String(g.rows.length),
      summary,
      word: props.state.group === "node" && !g.special ? nodeWord(g.name) : null,
      tip: groupCard(title, count, summary, t, note),
      clickable: linkOf(g) != null,
    };
  }),
);

const navGroups = computed(() =>
  props.state.group === "none" ? [] : groups.value.slice(0, MAX_GROUP_LINKS),
);

const selectedKey = computed(() => {
  const d = props.state.details;
  if (!d || d.kind !== (isPods.value ? "pod" : "node")) return null;
  return rowKey(d.kind, d.cluster, d.namespace, d.name);
});

const ariaLabel = computed(() => {
  const count = rows.value.length;
  const fill = t(FILL_LABEL[props.state.fill]);
  const group = props.state.group;
  if (isLabelGroup(group)) {
    const key = raw(labelKey.value);
    return isPods.value
      ? t("infra.k8s2.mapAriaPodsByLabel", { count, key, fill }, count)
      : t("infra.k8s2.mapAriaNodesByLabel", { count, key, fill }, count);
  }
  if (!isPods.value) return t("infra.k8s2.mapAriaNodes", { count, fill }, count);
  if (group === "none") return t("infra.k8s2.mapAriaPodsUngrouped", { count, fill }, count);
  return t("infra.k8s2.mapAriaPods", { count, group: t(GROUP_LABEL[group]), fill }, count);
});

watch(
  () => [props.state.fill, props.state.entity],
  () => {
    highlight.value = [];
  },
);

function countOf(count: number): I18nText {
  return isPods.value
    ? t("infra.k8s2.mapCountPods", { count }, count)
    : t("infra.k8s2.mapCountNodes", { count }, count);
}

function fullTitle(g: RowGroup): string {
  if (g.special === "unscheduled") return t("infra.k8s2.mapUnscheduled");
  if (g.special === "noOwner") return t("infra.k8s2.mapNoOwner");
  if (g.special === "noLabel") return t("infra.k8s2.mapNoLabel", { key: labelKey.value ?? "" });
  if (g.special === "other") return t("infra.k8s2.mapOtherGroups", { count: g.merged ?? 0 });
  return g.name;
}

function nodeWord(name: string): GroupHeader["word"] {
  const node = nodesByName.value.get(name);
  if (node?.ready === "true" && node.pressures.length) {
    return { text: node.pressures.join(", "), tone: "warning" };
  }
  if (!node?.status) return null;
  return { text: chipLabel(node.status, t), tone: toneOf(node.status.variant) };
}

function toneOf(variant: string): StatusClass | null {
  if (variant.startsWith("success")) return "ok";
  if (variant.startsWith("error")) return "error";
  return variant.startsWith("warning") || variant.startsWith("amber") ? "warning" : null;
}

function linkOf(g: RowGroup): (() => void) | null {
  if (g.special || labelKey.value != null) return null;
  const cluster = g.rows[0]?.cluster ?? "";
  const group = props.state.group;
  if (group === "namespace") {
    return () => emit("navigate", { ...withView(props.state, "pods"), namespaces: [g.name] });
  }
  if (group === "node") {
    return () => emit("open", { kind: "node", cluster, namespace: "", name: g.name });
  }
  const kind = g.owner ? detailKindOf(g.owner.kind) : null;
  if (!g.owner || !kind) return null;
  const name = g.owner.name;
  return () => emit("open", { kind, cluster, namespace: g.namespace, name });
}

function onSelect(row: MapRow) {
  emit("open", {
    kind: row.kind,
    cluster: row.cluster,
    namespace: row.kind === "node" ? "" : row.namespace,
    name: row.name,
  });
}

function onHeader(i: number) {
  const g = groups.value[i];
  if (g) linkOf(g)?.();
}

function onFilter(value: unknown) {
  const terms = (Array.isArray(value) ? value : []).map(String).filter((v) => v !== STATE_ROW);
  emit("update", { filter: terms });
}

function removeTerm(term: string) {
  emit("update", { filter: props.state.filter.filter((t) => t !== term) });
}

function clearFilters() {
  emit("update", { namespaces: [], search: "", filter: [] });
}

function clearLabels() {
  const patch: Partial<K8sUrlState> = {};
  if (props.state.filter.length) patch.filter = [];
  if (labelKey.value != null) patch.group = DEFAULT_GROUP[props.state.entity];
  emit("update", patch);
}

function clearLabelsText(): I18nText {
  if (props.state.filter.length && labelKey.value != null) {
    return t("infra.k8s2.mapClearFilterAndGrouping");
  }
  return props.state.filter.length
    ? t("infra.k8s2.mapClearFilter")
    : t("infra.k8s2.mapResetGrouping");
}

function showList() {
  emit("navigate", listTarget(props.state));
}

function linkText(g: RowGroup): I18nText {
  return raw(`${fullTitle(g)} (${g.rows.length})`);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 p-3" data-test="k8s2-map-view">
    <K8sListHeader
      :title="t('infra.k8s2.mapTitle')"
      :count="rows.length"
      :total="allRows.length"
      :count-label="countLabel"
      :count-suffix="countSuffix"
      :filtered="state.filter.length > 0"
      :namespaced="isPods"
      :namespace-options="namespaceOptions"
      :namespaces="state.namespaces"
      :search="state.search"
      :search-placeholder="isPods ? t('infra.k8s2.mapSearchPods') : t('infra.k8s2.mapSearchNodes')"
      @update:namespaces="(namespaces: string[]) => emit('update', { namespaces })"
      @update:search="(search: string) => emit('update', { search })"
      @clear="clearFilters"
    >
      <template #trailing>
        <ORefreshButton
          :last-run-at="lastUpdatedAt"
          :loading="loading"
          data-test="k8s2-map-refresh"
          @click="emit('refresh')"
        />
      </template>
    </K8sListHeader>
    <div class="flex flex-wrap items-center gap-2" data-test="k8s2-map-controls">
      <OToggleGroup
        :model-value="state.entity"
        mobile-dropdown
        data-test="k8s2-map-entity"
        @update:model-value="(v) => emit('update', { entity: v as MapEntity })"
      >
        <OToggleGroupItem value="pods" size="sm" data-test="k8s2-map-entity-pods">
          {{ t("infra.k8s2.mapEntityPods") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="nodes" size="sm" data-test="k8s2-map-entity-nodes">
          {{ t("infra.k8s2.mapEntityNodes") }}
        </OToggleGroupItem>
      </OToggleGroup>
      <OSelect
        width="md"
        size="sm"
        label-position="inside"
        :label="t('infra.k8s2.mapFillBy')"
        :model-value="state.fill"
        :options="fillOptions"
        data-test="k8s2-map-fill"
        @update:model-value="(v) => emit('update', { fill: v as MapFill })"
      />
      <OSelect
        width="sm"
        size="sm"
        searchable
        label-position="inside"
        :label="t('infra.k8s2.mapGroupBy')"
        :model-value="state.group"
        :options="groupOptions"
        data-test="k8s2-map-group"
        @update:model-value="(v) => emit('update', { group: v as MapGroup })"
      />
      <OSelect
        class="max-md:w-full"
        width="md"
        size="sm"
        multiple
        searchable
        :model-value="state.filter"
        :options="pickerOptions"
        data-test="k8s2-map-filter"
        @update:model-value="onFilter"
      >
        <template #icon-left>
          <OIcon name="filter-list" size="sm" />
        </template>
        <template #trigger>{{ filterTrigger }}</template>
      </OSelect>
      <div class="ms-auto flex items-center gap-2">
        <OText
          v-if="state.filter.length"
          tag="span"
          class="text-text-secondary text-xs"
          data-test="k8s2-map-list-note"
        >
          {{ t("infra.k8s2.mapListNote") }}
        </OText>
        <OButton variant="ghost-primary" size="xs" data-test="k8s2-map-show-list" @click="showList">
          {{ t("infra.k8s2.mapShowAsList") }}
        </OButton>
      </div>
    </div>
    <div
      v-if="state.filter.length"
      class="flex flex-wrap items-center gap-1"
      data-test="k8s2-map-filter-chips"
    >
      <ODimensionChip
        v-for="term in state.filter"
        :key="term"
        :dim-key="splitTerm(term)[0]"
        :value="splitTerm(term)[1]"
        removable
        :remove-label="t('infra.k8s2.mapFilterRemove', { term })"
        remove-data-test="k8s2-map-filter-chip-remove"
        @remove="removeTerm(term)"
      />
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="k8s2-map-filter-clear"
        @click="emit('update', { filter: [] })"
      >
        {{ t("infra.k8s2.mapFilterClear") }}
      </OButton>
    </div>
    <OEmptyState
      v-if="anchorMissing"
      preset="no-data"
      :title="isPods ? t('infra.k8s2.mapAnchorPods') : t('infra.k8s2.mapAnchorNodes')"
      :description="t('infra.k8s2.mapAnchorNeeds', { stream: anchorMissing })"
      data-test="k8s2-map-anchor-empty"
    />
    <OEmptyState v-else-if="forbidden" preset="no-access" data-test="k8s2-map-forbidden" />
    <OEmptyState
      v-else-if="filterUnavailable"
      :title="t('infra.k8s2.mapFilterUnavailable')"
      :description="labelsState ?? undefined"
      :action-label="clearLabelsText()"
      data-test="k8s2-map-filter-unavailable"
      @action="clearLabels"
    />
    <OEmptyState
      v-else-if="!loading && rows.length === 0"
      :filtered="filtered"
      :hide-action="!filtered"
      :title="isPods ? t('infra.k8s2.mapNoMatchPods') : t('infra.k8s2.mapNoMatchNodes')"
      data-test="k8s2-map-empty"
      @action="clearFilters"
    />
    <div v-else class="relative flex min-h-0 flex-1 max-md:min-h-96" data-test="k8s2-map-area">
      <K8sHexMap
        :entity="state.entity"
        :group="state.group"
        :fill="state.fill"
        :groups="groups"
        :headers="headers"
        :highlight="highlight"
        :selected-key="selectedKey"
        :label="ariaLabel"
        @select="onSelect"
        @header="onHeader"
      >
        <template #legend>
          <OText tag="span" class="text-text-secondary text-xs">
            {{ t(FILL_LABEL[state.fill]) }}
          </OText>
          <OToggleGroup
            v-model="highlight"
            type="multiple"
            :aria-label="t('infra.k8s2.mapLegendOf', { fill: t(FILL_LABEL[state.fill]) })"
            data-test="k8s2-map-scale"
          >
            <OToggleGroupItem
              v-for="item in legend"
              :key="item.cls"
              :value="item.cls"
              size="sm"
              :data-test="`k8s2-map-legend-${item.cls}`"
            >
              <span class="rounded-default h-3 w-4 shrink-0" :class="SWATCH[item.cls]" />
              <span data-test="k8s2-map-range">{{ item.label }}</span>
              <span class="text-text-secondary" data-test="k8s2-map-count">{{
                raw(item.count)
              }}</span>
            </OToggleGroupItem>
          </OToggleGroup>
        </template>
      </K8sHexMap>
      <nav
        v-if="navGroups.length"
        class="bg-surface-overlay rounded-surface sr-only absolute start-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col items-start gap-1 overflow-y-auto p-2 focus-within:not-sr-only"
        :aria-label="t('infra.k8s2.mapGroups')"
        data-test="k8s2-map-groups"
      >
        <template v-for="g in navGroups" :key="g.id">
          <OButton
            v-if="linkOf(g)"
            variant="ghost-primary"
            size="xs"
            data-test="k8s2-map-group-link"
            @click="linkOf(g)?.()"
          >
            {{ linkText(g) }}
          </OButton>
          <OCollapsible v-else :label="linkText(g)" data-test="k8s2-map-group-disclosure">
            <div class="flex flex-col items-start gap-0.5 ps-2">
              <OButton
                v-for="row in g.rows.slice(0, MAX_GROUP_MEMBERS)"
                :key="row.key"
                variant="ghost-primary"
                size="xs"
                data-test="k8s2-map-group-member"
                @click="onSelect(row)"
              >
                {{ raw(row.name) }}
              </OButton>
              <OText v-if="g.rows.length > MAX_GROUP_MEMBERS" tag="span" class="text-xs">
                {{ t("infra.k8s2.mapMoreUseSearch", { count: g.rows.length - MAX_GROUP_MEMBERS }) }}
              </OText>
            </div>
          </OCollapsible>
        </template>
        <OButton
          v-if="grouped.totalGroups > navGroups.length"
          variant="ghost-primary"
          size="xs"
          data-test="k8s2-map-show-all"
          @click="showList"
        >
          {{ t("infra.k8s2.mapShowAll", { count: grouped.totalGroups }) }}
        </OButton>
      </nav>
    </div>
  </div>
</template>
