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
import { computed } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import K8sHexMap from "./K8sHexMap.vue";
import K8sListHeader from "./K8sListHeader.vue";
import { detailKindOf } from "./kubernetesEvents";
import { chipLabel, filterRows, type NodeRow, type PodRow } from "./kubernetesModel";
import type { MapEntity, MapGroup } from "./kubernetesQueries";
import {
  ENTITY_FILLS,
  MAP_GROUPS,
  withView,
  type DetailsRef,
  type K8sUrlState,
  type MapFill,
} from "./kubernetesUrlState";
import {
  FILL_LABEL,
  bucketRanges,
  groupRows,
  legendClasses,
  listTarget,
  type FillClass,
  type MapRow,
  type RowGroup,
} from "./mapFill";

const props = defineProps<{
  state: K8sUrlState;
  pods: PodRow[];
  nodes: NodeRow[];
  namespaceOptions: string[];
  anchorMissing: string | null;
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

const GROUP_LABEL: Record<MapGroup, I18nKey> = {
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
  noData: "bg-surface-subtle",
};

const { t } = useI18nTyped();

const isPods = computed(() => props.state.entity === "pods");

const allRows = computed<MapRow[]>(() => (isPods.value ? props.pods : props.nodes));

const rows = computed<MapRow[]>(() =>
  filterRows(
    allRows.value,
    { cluster: null, namespaces: isPods.value ? props.state.namespaces : [] },
    props.state.search,
  ),
);

const mapGroup = computed<MapGroup>(() => (isPods.value ? props.state.group : "none"));

const groups = computed(() => groupRows(rows.value, mapGroup.value));

const filtered = computed(
  () => !!props.state.search || (isPods.value && props.state.namespaces.length > 0),
);

const nodesByName = computed(() => new Map(props.nodes.map((n) => [n.name, n])));

const frameLabels = computed(() => groups.value.map((g) => `${groupLabel(g)} (${g.rows.length})`));

const countLabel = computed(() =>
  isPods.value
    ? t("infra.k8s2.mapCountPods", { count: rows.value.length }, rows.value.length)
    : t("infra.k8s2.mapCountNodes", { count: rows.value.length }, rows.value.length),
);

const fillOptions = computed(() =>
  ENTITY_FILLS[props.state.entity].map((fill) => ({ label: t(FILL_LABEL[fill]), value: fill })),
);

const groupOptions = computed(() =>
  MAP_GROUPS.map((group) => ({ label: t(GROUP_LABEL[group]), value: group })),
);

const legend = computed(() => {
  const fill = props.state.fill;
  const ranges = fill === "status" ? [] : bucketRanges(fill);
  return legendClasses(fill).map((cls, i) => ({
    cls,
    label: STATUS_LABEL[cls] ? t(STATUS_LABEL[cls]) : raw(ranges[i]),
  }));
});

const groupLinks = computed(() =>
  mapGroup.value === "none" ? [] : groups.value.slice(0, MAX_GROUP_LINKS),
);

const ariaLabel = computed(() => {
  const count = rows.value.length;
  const fill = t(FILL_LABEL[props.state.fill]);
  if (!isPods.value) return t("infra.k8s2.mapAriaNodes", { count, fill }, count);
  if (mapGroup.value === "none")
    return t("infra.k8s2.mapAriaPodsUngrouped", { count, fill }, count);
  const group = t(GROUP_LABEL[mapGroup.value]);
  return t("infra.k8s2.mapAriaPods", { count, group, fill }, count);
});

function groupLabel(g: RowGroup): string {
  if (g.special === "unscheduled") return t("infra.k8s2.mapUnscheduled");
  if (g.special === "noOwner") return t("infra.k8s2.mapNoOwner");
  if (mapGroup.value !== "node") return g.name;
  const node = nodesByName.value.get(g.name);
  const word =
    node?.ready === "true" && node.pressures.length
      ? node.pressures.join(", ")
      : node?.status
        ? chipLabel(node.status, t)
        : "";
  // The status word leads, because a narrow frame truncates the end of its label.
  return word ? `${word} · ${g.name}` : g.name;
}

function linkOf(g: RowGroup): (() => void) | null {
  if (g.special) return null;
  const cluster = g.rows[0]?.cluster ?? "";
  if (mapGroup.value === "namespace") {
    return () => emit("navigate", { ...withView(props.state, "pods"), namespaces: [g.name] });
  }
  if (mapGroup.value === "node") {
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

function clearFilters() {
  emit("update", { namespaces: [], search: "" });
}

function showList() {
  emit("navigate", listTarget(props.state));
}

function linkText(g: RowGroup): I18nText {
  return raw(`${g.special ? groupLabel(g) : g.name} (${g.rows.length})`);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 p-3" data-test="k8s2-map-view">
    <K8sListHeader
      :title="t('infra.k8s2.mapTitle')"
      :count="rows.length"
      :total="allRows.length"
      :count-label="countLabel"
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
        v-if="isPods"
        width="sm"
        size="sm"
        label-position="inside"
        :label="t('infra.k8s2.mapGroupBy')"
        :model-value="state.group"
        :options="groupOptions"
        data-test="k8s2-map-group"
        @update:model-value="(v) => emit('update', { group: v as MapGroup })"
      />
      <OButton variant="ghost-primary" size="xs" data-test="k8s2-map-show-list" @click="showList">
        {{ t("infra.k8s2.mapShowAsList") }}
      </OButton>
    </div>
    <OEmptyState
      v-if="anchorMissing"
      preset="no-data"
      :title="isPods ? t('infra.k8s2.mapAnchorPods') : t('infra.k8s2.mapAnchorNodes')"
      :description="t('infra.k8s2.mapAnchorNeeds', { stream: anchorMissing })"
      data-test="k8s2-map-anchor-empty"
    />
    <OEmptyState
      v-else-if="!loading && rows.length === 0"
      :filtered="filtered"
      :hide-action="!filtered"
      :title="isPods ? t('infra.k8s2.mapNoMatchPods') : t('infra.k8s2.mapNoMatchNodes')"
      data-test="k8s2-map-empty"
      @action="clearFilters"
    />
    <template v-else>
      <div
        class="flex flex-wrap items-center gap-1"
        :aria-label="t('infra.k8s2.mapLegend')"
        data-test="k8s2-map-legend"
      >
        <OTag
          v-for="item in legend"
          :key="item.cls"
          variant="default-soft"
          size="sm"
          :data-test="`k8s2-map-legend-${item.cls}`"
        >
          <template #icon>
            <span
              class="border-border-default size-2.5 rounded-full border"
              :class="SWATCH[item.cls]"
            />
          </template>
          {{ item.label }}
        </OTag>
      </div>
      <nav
        v-if="groupLinks.length"
        class="flex flex-wrap items-center gap-1"
        :aria-label="t('infra.k8s2.mapGroups')"
        data-test="k8s2-map-groups"
      >
        <template v-for="g in groupLinks" :key="g.id">
          <OButton
            v-if="linkOf(g)"
            variant="ghost-primary"
            size="xs"
            data-test="k8s2-map-group-link"
            @click="linkOf(g)?.()"
          >
            {{ linkText(g) }}
          </OButton>
          <span v-else class="text-text-secondary px-2 text-xs" data-test="k8s2-map-group-text">
            {{ linkText(g) }}
          </span>
        </template>
        <OButton
          v-if="groups.length > groupLinks.length"
          variant="ghost-primary"
          size="xs"
          data-test="k8s2-map-show-all"
          @click="showList"
        >
          {{ t("infra.k8s2.mapShowAll", { count: groups.length }) }}
        </OButton>
      </nav>
      <K8sHexMap
        :entity="state.entity"
        :group="mapGroup"
        :fill="state.fill"
        :groups="groups"
        :frame-labels="frameLabels"
        :label="ariaLabel"
        @select="onSelect"
      />
    </template>
  </div>
</template>
