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
  <div class="flex min-h-0 flex-col gap-3" data-test="metrics-breakdown">
    <OEmptyState
      v-if="!labels.length"
      size="inline"
      icon="label"
      :title="t('metrics.explorer.detail.breakdown.noLabels')"
      data-test="metrics-breakdown-no-labels"
    />

    <template v-else-if="activeLabel">
      <div>
        <OButton
          variant="ghost"
          size="sm"
          icon-left="arrow-back"
          data-test="metrics-breakdown-back"
          @click="$emit('update:selectedLabel', null)"
        >
          {{ t("metrics.explorer.detail.breakdown.allLabels") }}
        </OButton>
      </div>

      <MetricChartTile
        class="h-60"
        :queries="queriesByLabel[activeLabel]"
        :unit="card.unit"
        :color="color"
        :time-range="timeRange"
        :run-query="runQuery"
        :cancel-queries="cancelQueries"
        legend
        data-test="metrics-breakdown-chart"
      >
        <template #header>
          <span class="truncate">{{
            t(breakdownTitleKey(card.cardKind), { label: activeLabel })
          }}</span>
          <OTag
            v-if="topkByLabel[activeLabel]"
            variant="default-outline"
            size="sm"
            class="shrink-0"
            data-test="metrics-breakdown-topk"
            >{{ t("metrics.explorer.detail.breakdown.topk", { count: TOPK }) }}</OTag
          >
        </template>
      </MetricChartTile>

      <section
        class="border-border-default rounded-surface flex flex-col overflow-hidden border"
        data-test="metrics-breakdown-values"
      >
        <PanelBar class="min-w-0 gap-2">
          <span class="truncate">{{
            t("metrics.explorer.detail.breakdown.valuesOf", { label: activeLabel })
          }}</span>
          <span
            v-if="distinctText(activeLabel)"
            class="text-2xs text-text-secondary shrink-0 font-normal tabular-nums"
            :data-test="`metrics-breakdown-distinct-${activeLabel}`"
            >{{ distinctText(activeLabel) }}</span
          >
        </PanelBar>

        <div class="p-2">
          <OBanner
            v-if="activeCounts.failed"
            variant="error-soft"
            dense
            inline-actions
            :content="
              t('metrics.explorer.detail.breakdown.countsFailed', {
                error: raw(activeCounts.error),
              })
            "
            data-test="metrics-breakdown-values-error"
          >
            <template #actions>
              <OButton
                variant="ghost-primary"
                size="xs"
                data-test="metrics-breakdown-values-retry"
                @click="retryCounts"
              >
                {{ t("metrics.explorer.retry") }}
              </OButton>
            </template>
          </OBanner>

          <OSkeleton
            v-else-if="!activeCounts.ready"
            class="h-16"
            animation="wave"
            data-test="metrics-breakdown-values-loading"
          />

          <p
            v-else-if="!activeValues.length"
            class="text-text-secondary px-1 text-xs"
            data-test="metrics-breakdown-values-empty"
          >
            {{ t("metrics.explorer.noData") }}
          </p>

          <ul v-else class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-6">
            <li
              v-for="entry in activeValues"
              :key="entry.value"
              class="flex min-w-0 items-center gap-2 px-1 py-0.5"
              :data-test="`metrics-breakdown-value-${activeLabel}-${entry.value}`"
            >
              <span
                class="text-text-body min-w-0 flex-1 truncate font-mono text-xs"
                :title="entry.value"
                >{{ entry.value }}</span
              >
              <span class="text-text-secondary text-2xs shrink-0 tabular-nums">{{
                t(
                  "metrics.explorer.detail.breakdown.samples",
                  { count: entry.count.toLocaleString() },
                  entry.count,
                )
              }}</span>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="add-circle-outline"
                :aria-label="
                  t('metrics.explorer.detail.breakdown.addToFilterAria', {
                    label: activeLabel,
                    value: entry.value,
                  })
                "
                :data-test="`metrics-breakdown-add-${activeLabel}-${entry.value}`"
                @click="addFilter(activeLabel, entry.value, '=')"
              >
                <OTooltip :content="t('metrics.explorer.detail.breakdown.addToFilter')" />
              </OButton>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="block"
                :aria-label="
                  t('metrics.explorer.detail.breakdown.excludeAria', {
                    label: activeLabel,
                    value: entry.value,
                  })
                "
                :data-test="`metrics-breakdown-exclude-${activeLabel}-${entry.value}`"
                @click="addFilter(activeLabel, entry.value, '!=')"
              >
                <OTooltip :content="t('metrics.explorer.detail.breakdown.exclude')" />
              </OButton>
            </li>
          </ul>
        </div>
      </section>
    </template>

    <template v-else>
      <OBanner
        v-if="headError"
        variant="error-soft"
        dense
        inline-actions
        :content="t('metrics.explorer.detail.breakdown.countsFailed', { error: raw(headError) })"
        data-test="metrics-breakdown-counts-error"
      >
        <template #actions>
          <OButton
            variant="ghost-primary"
            size="xs"
            data-test="metrics-breakdown-counts-retry"
            @click="retryCounts"
          >
            {{ t("metrics.explorer.retry") }}
          </OButton>
        </template>
      </OBanner>

      <p class="text-text-secondary text-xs">
        {{ t("metrics.explorer.detail.breakdown.selectHint") }}
      </p>

      <div
        class="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1"
        data-test="metrics-breakdown-grid"
      >
        <MetricChartTile
          v-for="label in labels"
          :key="label"
          class="hover:border-primary h-56 cursor-pointer"
          :queries="queriesByLabel[label]"
          :unit="card.unit"
          :color="color"
          :time-range="timeRange"
          :run-query="runQuery"
          :cancel-queries="cancelQueries"
          :data-test="`metrics-breakdown-card-${label}`"
          @click="select(label)"
        >
          <template #header>
            <span class="min-w-0 truncate font-mono" :title="label">{{ label }}</span>
            <span
              v-if="distinctText(label)"
              class="text-2xs text-text-secondary shrink-0 font-normal tabular-nums"
              :data-test="`metrics-breakdown-distinct-${label}`"
              >{{ distinctText(label) }}</span
            >
            <OTag
              v-if="topkByLabel[label]"
              variant="default-outline"
              size="sm"
              class="shrink-0"
              :data-test="`metrics-breakdown-topk-${label}`"
              >{{ t("metrics.explorer.detail.breakdown.topk", { count: TOPK }) }}</OTag
            >
            <div class="flex-1" />
            <OButton
              variant="ghost-primary"
              size="xs"
              class="shrink-0"
              :aria-label="t('metrics.explorer.detail.breakdown.selectAria', { label })"
              :data-test="`metrics-breakdown-select-${label}`"
              @click.stop="select(label)"
            >
              {{ t("metrics.explorer.detail.breakdown.select") }}
            </OButton>
          </template>
        </MetricChartTile>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, watch, type PropType } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import MetricChartTile, { type TileQuery } from "./MetricChartTile.vue";
import PanelBar from "@/components/common/PanelBar.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import streamService from "@/services/stream";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { parseSearchError } from "@/utils/query/searchError";
import {
  baseNameOf,
  breakdownLabelsOf,
  BREAKDOWN_LABEL_LIMIT,
  breakdownTitleKey,
  buildBreakdownQuery,
  CARD_KIND,
} from "@/utils/metrics/metricDefaults";
import { operandStreamsOf, type MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import { labelFiltersToSql } from "@/utils/metrics/labelFilterSql";
import type { LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

/** 21, not 20: a 21st value is how "more than 20" is known. */
const VALUES_SIZE = 21;
/** Series kept for a label with "20+" values — beyond it the chart is a smear. */
const TOPK = 10;

/** One label's value counts, as far as they are known. */
interface LabelCounts {
  /** Its counts have answered, or will never be asked for. */
  ready: boolean;
  /** Its values were requested; past `BREAKDOWN_LABEL_LIMIT` only the selected label's are. */
  counted: boolean;
  failed: boolean;
  error: string;
  values: any[];
}

const PENDING: LabelCounts = { ready: false, counted: true, failed: false, error: "", values: [] };
const UNCOUNTED: LabelCounts = {
  ready: true,
  counted: false,
  failed: false,
  error: "",
  values: [],
};

export default defineComponent({
  name: "MetricBreakdown",
  components: {
    MetricChartTile,
    PanelBar,
    OButton,
    OTag,
    OEmptyState,
    OBanner,
    OSkeleton,
    OTooltip,
  },
  props: {
    card: { type: Object as PropType<MetricCardModel>, required: true },
    labelsByStream: { type: Object as PropType<Record<string, string[]>>, required: true },
    filters: { type: Array as PropType<LabelFilter[]>, required: true },
    /** The Explorer's window, µs. */
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      required: true,
    },
    selectedLabel: { type: String as PropType<string | null>, default: null },
    /** The card's concrete rate window, so the breakdown measures like the card. */
    rateWindow: { type: String, required: true },
    /** The card's own query needed the NaN guard. */
    nanGuard: { type: Boolean, default: false },
    color: { type: String, required: true },
    /** Runs one PromQL query on the detail view's scheduler slot. */
    runQuery: { type: Function as PropType<(expr: string) => Promise<any>>, required: true },
    cancelQueries: { type: Function as PropType<(exprs: string[]) => void>, required: true },
  },
  emits: ["update:selectedLabel", "add-filter"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();

    /** The stream the card's default query reads — `_count` for the exp fallback. */
    const valuesStream = computed(() => operandStreamsOf(props.card)[0]);

    const labels = computed(() => {
      // The exp fallback measures `_count`, whose labels can differ from the card's `_bucket`.
      const measured =
        valuesStream.value === props.card.name
          ? undefined
          : props.labelsByStream[valuesStream.value];
      const own = measured ?? props.card.labels ?? props.labelsByStream[props.card.name];
      // A label on only one side of `_sum / _count` would split half the ratio.
      const alsoOn =
        props.card.cardKind === CARD_KIND.MEAN_PAIR
          ? (props.labelsByStream[`${baseNameOf(props.card.name)}_count`] ?? [])
          : undefined;
      return breakdownLabelsOf(own, alsoOn);
    });

    /** The selected label, if the breakdown offers it: a deep link can name any label. */
    const activeLabel = computed(() =>
      props.selectedLabel && labels.value.includes(props.selectedLabel)
        ? props.selectedLabel
        : null,
    );

    /** SQL rejects a column the stream lacks (PromQL ignores the matcher), so such filters are dropped. */
    const applicableFilters = computed(() => {
      const known =
        props.labelsByStream[valuesStream.value] ??
        (valuesStream.value === props.card.name ? props.card.labels : undefined);
      return known ? props.filters.filter((f) => known.includes(String(f.label))) : props.filters;
    });

    const headLoaded = ref(false);
    const headError = ref("");
    const headCounts = ref<{ fields: string[]; hits: any[] } | null>(null);
    let headGeneration = 0;

    const headLabels = computed(() => labels.value.slice(0, BREAKDOWN_LABEL_LIMIT));

    // Counted on a request of its own, so selecting it never re-scans the labels under the cap.
    const pastCapLabel = computed(() =>
      activeLabel.value && !headLabels.value.includes(activeLabel.value) ? activeLabel.value : null,
    );
    const extraCounts = ref<{
      label: string;
      status: "loading" | "done" | "error";
      values: any[];
      error: string;
    }>({ label: "", status: "done", values: [], error: "" });
    let extraGeneration = 0;

    const fetchValues = (fields: string[]) =>
      streamService.fieldValues({
        org_identifier: store.state.selectedOrganization?.identifier,
        stream_name: valuesStream.value,
        fields,
        size: VALUES_SIZE,
        start_time: props.timeRange.start_time,
        end_time: props.timeRange.end_time,
        type: "metrics",
        query_context:
          b64EncodeUnicode(labelFiltersToSql(valuesStream.value, applicableFilters.value)) ?? "",
      });

    const loadHead = async () => {
      const generation = ++headGeneration;
      const fields = headLabels.value;
      headError.value = "";
      headLoaded.value = false;
      if (!fields.length) {
        headCounts.value = { fields, hits: [] };
        headLoaded.value = true;
        return;
      }
      try {
        const response = await fetchValues(fields);
        if (generation !== headGeneration) return;
        headCounts.value = { fields, hits: response?.data?.hits ?? [] };
      } catch (error: any) {
        if (generation !== headGeneration) return;
        headCounts.value = null;
        headError.value = parseSearchError(error).message;
      } finally {
        if (generation === headGeneration) headLoaded.value = true;
      }
    };

    const loadExtra = async () => {
      const generation = ++extraGeneration;
      const label = pastCapLabel.value;
      if (!label) {
        extraCounts.value = { label: "", status: "done", values: [], error: "" };
        return;
      }
      extraCounts.value = { label, status: "loading", values: [], error: "" };
      try {
        const response = await fetchValues([label]);
        if (generation !== extraGeneration) return;
        const hits: any[] = response?.data?.hits ?? [];
        const values = hits.find((hit) => hit?.field === label)?.values ?? [];
        extraCounts.value = { label, status: "done", values, error: "" };
      } catch (error: any) {
        if (generation !== extraGeneration) return;
        extraCounts.value = {
          label,
          status: "error",
          values: [],
          error: parseSearchError(error).message,
        };
      }
    };

    /** Repeats only the failed request. */
    const retryCounts = () => {
      if (headError.value) loadHead();
      if (extraCounts.value.status === "error") loadExtra();
    };

    // Sources compared one by one: a getter returning a fresh array re-fires on every card rebuild.
    const countSources = [
      valuesStream,
      () => JSON.stringify(applicableFilters.value),
      () => props.timeRange,
    ];
    watch([() => headLabels.value.join(","), ...countSources], loadHead, { immediate: true });
    watch([pastCapLabel, ...countSources], loadExtra, { immediate: true });

    const countsFor = (label: string): LabelCounts => {
      if (label === pastCapLabel.value) {
        const extra = extraCounts.value;
        if (extra.label !== label || extra.status === "loading") return PENDING;
        return {
          ready: true,
          counted: true,
          failed: extra.status === "error",
          error: extra.error,
          values: extra.values,
        };
      }
      if (!headLabels.value.includes(label)) return UNCOUNTED;
      if (!headLoaded.value) return PENDING;
      if (headError.value)
        return { ready: true, counted: true, failed: true, error: headError.value, values: [] };
      const values = headCounts.value?.hits.find((hit) => hit?.field === label)?.values ?? [];
      return { ready: true, counted: true, failed: false, error: "", values };
    };

    const countsByLabel = computed(() =>
      Object.fromEntries(labels.value.map((label) => [label, countsFor(label)])),
    );

    // Without counts a label's cardinality is unknown, so it gets the conservative cap.
    const topkByLabel = computed<Record<string, boolean>>(() =>
      Object.fromEntries(
        Object.entries(countsByLabel.value).map(([label, c]) => [
          label,
          c.ready && (!c.counted || c.failed || c.values.length >= VALUES_SIZE),
        ]),
      ),
    );

    const queriesFor = (label: string): TileQuery[] | null => {
      if (!countsByLabel.value[label].ready) return null;
      const expr = buildBreakdownQuery(
        props.card.cardKind,
        {
          metricName: props.card.name,
          filters: props.filters,
          rateWindow: props.rateWindow,
          applyNanGuard: props.nanGuard,
        },
        label,
        topkByLabel.value[label] ? { topk: TOPK } : undefined,
      );
      return expr ? [{ expr, legendTemplate: `{${label}}` }] : [];
    };

    /** `null` until the label's counts answer: only they know whether to cap at top 10. */
    const queriesByLabel = computed<Record<string, TileQuery[] | null>>(() =>
      Object.fromEntries(labels.value.map((label) => [label, queriesFor(label)])),
    );

    const distinctText = (label: string) => {
      const c = countsByLabel.value[label];
      if (!c?.ready || !c.counted || c.failed) return null;
      return c.values.length >= VALUES_SIZE
        ? t("metrics.explorer.detail.breakdown.distinctMany", { count: VALUES_SIZE - 1 })
        : t(
            "metrics.explorer.detail.breakdown.distinctCount",
            { count: c.values.length },
            c.values.length,
          );
    };

    const activeCounts = computed(() =>
      activeLabel.value ? countsByLabel.value[activeLabel.value] : PENDING,
    );
    const activeValues = computed(() =>
      activeCounts.value.values.slice(0, VALUES_SIZE - 1).map((v) => ({
        value: String(v?.zo_sql_key ?? ""),
        count: Number(v?.zo_sql_num ?? 0),
      })),
    );

    const select = (label: string) => emit("update:selectedLabel", label);

    const addFilter = (label: string, value: string, operator: "=" | "!=") =>
      emit("add-filter", { label: raw(label), operator, value });

    onBeforeUnmount(() => {
      headGeneration += 1;
      extraGeneration += 1;
    });

    return {
      t,
      raw,
      breakdownTitleKey,
      TOPK,
      labels,
      activeLabel,
      headError,
      retryCounts,
      topkByLabel,
      queriesByLabel,
      distinctText,
      activeCounts,
      activeValues,
      select,
      addFilter,
    };
  },
});
</script>
