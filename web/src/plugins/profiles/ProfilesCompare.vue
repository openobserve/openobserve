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

<!-- Compare view: two values of one label, as a diff flame graph, two flame graphs or a diff table. -->
<template>
  <div class="flex flex-col md:min-h-0 md:flex-1" data-test="profiles-compare">
    <div
      class="border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
    >
      <OSelect
        :model-value="state.label ?? ''"
        :options="labels"
        :label="t('profiles.compareLabel')"
        label-position="inside"
        size="sm"
        width="sm"
        data-test="profiles-compare-label"
        @update:model-value="setLabel"
      />
      <OSelect
        :model-value="state.baseline ?? ''"
        :options="baselineOptions"
        :loading="valuesLoading"
        :label="t('profiles.compareFrom')"
        label-position="inside"
        size="sm"
        width="sm"
        data-test="profiles-compare-baseline"
        @update:model-value="(value) => setSide('baseline', value)"
      />
      <OButton
        variant="ghost"
        size="icon-toolbar"
        icon-left="swap-horiz"
        :aria-label="t('profiles.compareSwap')"
        :disabled="!state.baseline || !state.comparison"
        data-test="profiles-compare-swap"
        @click="swapSides"
      >
        <OTooltip :content="t('profiles.compareSwap')" />
      </OButton>
      <OSelect
        :model-value="state.comparison ?? ''"
        :options="comparisonOptions"
        :loading="valuesLoading"
        :label="t('profiles.compareTo')"
        label-position="inside"
        size="sm"
        width="sm"
        data-test="profiles-compare-comparison"
        @update:model-value="(value) => setSide('comparison', value)"
      />

      <div class="ms-auto flex flex-wrap items-center gap-3">
        <OToggleGroup
          :model-value="state.display"
          data-test="profiles-compare-display"
          @update:model-value="setDisplay"
        >
          <OToggleGroupItem value="flame" size="sm" data-test="profiles-compare-display-flame">
            {{ t("profiles.diffFlameGraph") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="sides" size="sm" data-test="profiles-compare-display-sides">
            {{ t("profiles.compareSideBySide") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="table" size="sm" data-test="profiles-compare-display-table">
            {{ t("profiles.diffTable") }}
          </OToggleGroupItem>
        </OToggleGroup>
        <div class="flex items-center gap-2 text-xs" data-test="profiles-compare-legend">
          <span
            v-for="item in legend"
            :key="item.label"
            class="text-text-secondary flex items-center gap-1 whitespace-nowrap"
          >
            <span
              class="rounded-default inline-block size-2.5"
              :style="{ backgroundColor: item.color }"
              aria-hidden="true"
            />{{ item.label }}
          </span>
          <OTooltip
            :content="
              t(
                state.display === 'sides'
                  ? 'profiles.diffLegendHelpSides'
                  : 'profiles.diffLegendHelp',
                sideNames,
              )
            "
          />
        </div>
      </div>
    </div>

    <div
      v-if="loading || valuesLoading"
      class="flex flex-col gap-1.5 p-3"
      data-test="profiles-compare-skeleton"
    >
      <OSkeleton
        v-for="width in SKELETON_WIDTHS"
        :key="width"
        type="rect"
        class="rounded-default h-6"
        :class="width"
      />
    </div>
    <p
      v-else-if="message"
      class="text-text-secondary p-6 text-center text-sm"
      data-test="profiles-compare-message"
    >
      {{ message }}
    </p>
    <div
      v-else-if="state.display === 'flame' && result"
      class="overflow-auto p-3 md:min-h-0 md:flex-1"
    >
      <CommonFlameGraph
        :root="result.root"
        :diff-baseline-total="result.baseline_total"
        :diff-labels="sideNames"
        :summary-label="sideNames.comparison"
        :summary-value="valueFormatter(result.comparison_total)"
        :unit-label="unitLabel"
        :value-formatter="valueFormatter"
        :search-query="searchQuery"
        :empty-label="t('profiles.noResults')"
        data-test="profiles-compare-flame"
      />
    </div>
    <div
      v-else-if="state.display === 'sides' && result"
      class="grid grid-cols-1 gap-3 overflow-auto p-3 md:min-h-0 md:flex-1 md:grid-cols-2"
      data-test="profiles-compare-sides"
    >
      <CommonFlameGraph
        v-for="side in sideTrees"
        :key="side.key"
        :root="side.root"
        :summary-label="side.name"
        :summary-value="valueFormatter(side.total)"
        :diff-baseline-total="result.baseline_total"
        :diff-comparison-total="result.comparison_total"
        :diff-labels="sideNames"
        :unit-label="unitLabel"
        :value-formatter="valueFormatter"
        :search-query="searchQuery"
        :empty-label="t('profiles.noResults')"
        :data-test="`profiles-compare-side-${side.key}`"
      />
    </div>
    <OTable
      v-else-if="result"
      :data="tableRows"
      :columns="columns"
      :default-columns="false"
      row-key="name"
      sorting="client"
      pagination="none"
      virtual-scroll
      :show-global-filter="false"
      :frame="false"
      :fill-height="!isMobile"
      class="md:min-h-0 md:flex-1"
      :row-height="28"
      :enable-column-resize="true"
      data-test="profiles-compare-table"
    >
      <template #cell-name="{ row }">
        <span class="text-text-body min-w-0 truncate font-mono text-xs">{{ row.name }}</span>
      </template>
      <template v-for="cell in VALUE_CELLS" :key="cell" #[`cell-${cell}`]="{ row }">
        <span class="text-text-body font-mono text-xs">{{
          cell === "before" || cell === "after"
            ? valueFormatter(row[cell])
            : `${row[cell].toFixed(2)}%`
        }}</span>
      </template>
      <template #cell-change="{ row }">
        <span class="text-text-body flex items-center justify-end gap-1.5 font-mono text-xs">
          <span
            class="inline-block size-2 shrink-0 rounded-full"
            :style="{ backgroundColor: changeColor(row.change) }"
            aria-hidden="true"
          />{{ formatPoints(row.change) }}
        </span>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import CommonFlameGraph from "@/components/common/FlameGraphView.vue";
import profilesService, {
  type ProfilesDiffNode,
  type ProfilesDiffResponse,
  type ProfilesTreeNode,
  type ProfilesQueryBody,
} from "@/services/profiles";
import { useThemeRevision } from "@/composables/useTheme";
import { cssToken } from "@/utils/theme";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";

export type CompareState = {
  label: string | null;
  baseline: string | null;
  comparison: string | null;
  display: "flame" | "sides" | "table";
};
type SelectOption = { label: I18nText; value: string };
type Side = "baseline" | "comparison";

const props = defineProps<{
  orgIdentifier: string;
  stream: string;
  /** The run on screen: its window, service, type and filters. */
  payload: ProfilesQueryBody;
  /** Labels a side can pick a value of. */
  labels: SelectOption[];
  searchQuery: string;
  unitLabel: string;
  valueFormatter: (value: number) => string;
}>();
const state = defineModel<CompareState>("state", { required: true });

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();

const SKELETON_WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-3/5", "w-2/5", "w-1/4"];
const VALUE_CELLS = ["before", "after", "beforePercent", "afterPercent"] as const;
// Changes under a tenth of a point read as no change, as in the diff flame graph.
const CHANGE_FLOOR = 0.1;
const themeRevision = useThemeRevision();
// Token values change with the theme, so they are re-read whenever it switches.
const diffColors = computed(() => {
  void themeRevision.value;
  return {
    more: cssToken("--color-status-negative", ""),
    less: cssToken("--color-chart-series-1", ""),
    same: cssToken("--color-flame-grouped-fill", ""),
  };
});

const values = ref<string[]>([]);
const valuesLoading = ref(false);
const result = ref<ProfilesDiffResponse | null>(null);
const loading = ref(false);
const error = ref("");
let valuesSeq = 0;
let diffSeq = 0;
let diffAbort: AbortController | null = null;

const legend = computed(() => [
  { label: t("profiles.diffLess"), color: diffColors.value.less },
  { label: t("profiles.diffSame"), color: diffColors.value.same },
  { label: t("profiles.diffMore"), color: diffColors.value.more },
]);

const valueOption = (value: string): SelectOption => ({ label: raw(value), value });
// Each side lists every value but the other side's, so the two sides never match.
const baselineOptions = computed(() =>
  values.value.filter((value) => value !== state.value.comparison).map(valueOption),
);
const comparisonOptions = computed(() =>
  values.value.filter((value) => value !== state.value.baseline).map(valueOption),
);

/** Each side is named by its value, as in "v1.4.0". */
const sideNames = computed(() => ({
  baseline: raw(state.value.baseline ?? ""),
  comparison: raw(state.value.comparison ?? ""),
}));

/** A frame of one side's graph, with both sides' totals so it is coloured by the change. */
type SideNode = ProfilesTreeNode & {
  before_total: number;
  after_total: number;
  children: SideNode[];
};
/** One side of the diff tree as its own flame tree; frames that side never ran are dropped. */
const sideTree = (node: ProfilesDiffNode, side: Side): SideNode | null => {
  const total = side === "baseline" ? node.before_total : node.total;
  if (total <= 0) return null;
  const children = (node.children ?? [])
    .map((child) => sideTree(child, side))
    .filter((child): child is SideNode => child !== null);
  return {
    name: node.name,
    total,
    self: side === "baseline" ? node.before_self : node.self,
    before_total: node.before_total,
    after_total: node.total,
    children,
  };
};
const sideTrees = computed(() => {
  const diff = result.value;
  if (!diff) return [];
  return (["baseline", "comparison"] as const).map((key) => ({
    key,
    name: sideNames.value[key],
    total: key === "baseline" ? diff.baseline_total : diff.comparison_total,
    root: sideTree(diff.root, key),
  }));
});

const otherFilters = (label: string | null) =>
  (props.payload.filters ?? []).filter((filter) => filter.key !== label);

/** Version-like values sort as numbers, so v1.10.0 comes after v1.9.0. */
const naturalSort = (list: string[]) =>
  [...list].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/** The values of the side label in the run's window; picks sides the run filter or the latest two. */
const loadValues = async () => {
  const label = state.value.label;
  if (!label) {
    values.value = [];
    return;
  }
  const seq = ++valuesSeq;
  valuesLoading.value = true;
  try {
    const response = await profilesService.tagValues(props.orgIdentifier, props.stream, {
      start_time: props.payload.start_time,
      end_time: props.payload.end_time,
      service_name: props.payload.service_name,
      profile_type: props.payload.profile_type,
      profile_unit: props.payload.profile_unit,
      filters: otherFilters(label),
      tag: label,
    });
    if (seq !== valuesSeq) return;
    values.value = naturalSort(response.data.values ?? []);
  } catch {
    if (seq !== valuesSeq) return;
    values.value = [];
  } finally {
    if (seq === valuesSeq) valuesLoading.value = false;
  }
  pickDefaultSides();
};

const pickDefaultSides = () => {
  const list = values.value;
  const { baseline, comparison, label } = state.value;
  if (list.includes(baseline ?? "") && list.includes(comparison ?? "") && baseline !== comparison) {
    return;
  }
  const filtered = (props.payload.filters ?? []).find((filter) => filter.key === label)?.value;
  const next = list.includes(filtered ?? "") ? filtered! : list[list.length - 1];
  const nextIndex = list.indexOf(next);
  const before = nextIndex > 0 ? list[nextIndex - 1] : list.find((value) => value !== next);
  if (state.value.baseline === (before ?? null) && state.value.comparison === (next ?? null))
    return;
  state.value = { ...state.value, baseline: before ?? null, comparison: next ?? null };
};

const sideBody = (side: Side): ProfilesQueryBody | null => {
  const { label } = state.value;
  const value = state.value[side];
  if (!label || !value) return null;
  return {
    ...props.payload,
    filters: [...otherFilters(label), { key: label, op: "=", value }],
  };
};

const message = computed(() => {
  if (error.value) return raw(error.value);
  if (!valuesLoading.value) {
    if (!state.value.label) return t("profiles.compareNeedsLabel");
    if (values.value.length < 2) return t("profiles.compareNeedsTwoValues");
  }
  if (result.value && (!result.value.baseline_total || !result.value.comparison_total)) {
    return t("profiles.diffNoData");
  }
  return "";
});

const loadDiff = async () => {
  const baseline = sideBody("baseline");
  const comparison = sideBody("comparison");
  diffAbort?.abort();
  const seq = ++diffSeq;
  error.value = "";
  if (!baseline || !comparison) {
    result.value = null;
    loading.value = false;
    return;
  }
  const abort = (diffAbort = new AbortController());
  loading.value = true;
  try {
    const response = await profilesService.diff(
      props.orgIdentifier,
      props.stream,
      { baseline, comparison, max_nodes: 4096 },
      { signal: abort.signal },
    );
    if (seq !== diffSeq) return;
    result.value = response.data;
  } catch (err) {
    if (seq !== diffSeq || abort.signal.aborted) return;
    const failure = err as { response?: { data?: { message?: string } }; message?: string };
    error.value = failure.response?.data?.message || failure.message || "";
    result.value = null;
  } finally {
    if (seq === diffSeq) loading.value = false;
  }
};

const percent = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0);
const tableRows = computed(() => {
  const diff = result.value;
  if (!diff) return [];
  const needle = props.searchQuery.trim().toLowerCase();
  return diff.top
    .filter((row) => !needle || row.name.toLowerCase().includes(needle))
    .map((row) => {
      const beforePercent = percent(row.before_total, diff.baseline_total);
      const afterPercent = percent(row.after_total, diff.comparison_total);
      return {
        name: row.name,
        before: row.before_total,
        after: row.after_total,
        beforePercent,
        afterPercent,
        change: afterPercent - beforePercent,
      };
    });
});

const columns = computed<OTableColumnDef[]>(() => {
  const right = { align: "right" as const };
  return [
    {
      id: "name",
      header: t("profiles.functions"),
      accessorKey: "name",
      size: 320,
      meta: { align: "left" as const, fillRemaining: true },
    },
    {
      id: "before",
      header: sideNames.value.baseline,
      accessorKey: "before",
      sortable: true,
      size: 120,
      meta: right,
    },
    {
      id: "after",
      header: sideNames.value.comparison,
      accessorKey: "after",
      sortable: true,
      size: 120,
      meta: right,
    },
    {
      id: "beforePercent",
      header: t("profiles.diffSidePercent", { side: sideNames.value.baseline }),
      accessorKey: "beforePercent",
      sortable: true,
      size: 110,
      meta: right,
    },
    {
      id: "afterPercent",
      header: t("profiles.diffSidePercent", { side: sideNames.value.comparison }),
      accessorKey: "afterPercent",
      sortable: true,
      size: 110,
      meta: right,
    },
    {
      id: "change",
      header: t("profiles.diffChange"),
      accessorKey: "change",
      sortable: true,
      size: 120,
      meta: right,
    },
  ];
});

const changeColor = (change: number) => {
  const { more, less, same } = diffColors.value;
  return Math.abs(change) < CHANGE_FLOOR ? same : change > 0 ? more : less;
};
const formatPoints = (change: number) =>
  t("profiles.diffPoints", {
    value: `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(2)}`,
  });

const setDisplay = (value: unknown) => {
  if (value === "flame" || value === "sides" || value === "table") {
    state.value = { ...state.value, display: value };
  }
};
const setLabel = (value: unknown) => {
  const label = typeof value === "string" && value ? value : null;
  state.value = { ...state.value, label, baseline: null, comparison: null };
};
const setSide = (side: Side, value: unknown) => {
  state.value = { ...state.value, [side]: typeof value === "string" && value ? value : null };
};
const swapSides = () => {
  state.value = {
    ...state.value,
    baseline: state.value.comparison,
    comparison: state.value.baseline,
  };
};

// The first label the page offers when the URL names none, with the version label first.
watch(
  () => props.labels,
  (labels) => {
    if (state.value.label && labels.some((option) => option.value === state.value.label)) return;
    const preferred = labels.find((option) => option.value === "service_version") ?? labels[0];
    if (preferred) state.value = { ...state.value, label: preferred.value };
  },
  { immediate: true },
);

// Array sources compare each value, so a state write that keeps them equal reloads nothing.
watch([() => props.payload, () => state.value.label], () => loadValues(), { immediate: true });

watch(
  [
    () => props.payload,
    () => state.value.label,
    () => state.value.baseline,
    () => state.value.comparison,
  ],
  () => loadDiff(),
  { immediate: true },
);
</script>
