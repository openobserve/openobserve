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
  The per-metric function picker.

  Every candidate variant for the card's kind is offered as a radio tile that
  charts its OWN live preview, so the choice is made by looking at the data
  rather than by reading PromQL. Tiles are independent: one failing query
  degrades a single tile, never the dialog.

  The dialog owns no query transport of its own — it calls the `runPreview`
  function prop, which the parent routes through the shared 6-slot scheduler at
  DIALOG priority. Real cancellation therefore lives in the parent; here a
  monotonic "generation" counter is all that is needed to make sure a resolution
  from a previous open never lands on a tile of the current one.
-->
<template>
  <ODialog
    :open="modelValue"
    :title="card.name"
    size="xl"
    data-test="metrics-fn-config"
    @update:open="$emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <span
          class="font-mono text-sm font-semibold truncate"
          :title="card.name"
          data-test="metrics-fn-metric"
          >{{ card.name }}</span
        >
        <!-- The registry's metricType group — same badge the card footer shows. -->
        <OTag
          type="metricType"
          :value="card.typeFilterBucket"
          class="shrink-0"
          data-test="metrics-fn-badge"
        />
        <span class="truncate text-xs text-text-secondary">
          {{ t("metrics.explorer.fn.subtitle") }}
        </span>
      </div>
    </template>

    <!-- The ⚙ is never offered for a non-configurable card; this is the
         defensive branch for one that is somehow opened anyway. -->
    <div
      v-if="!variants.length"
      class="flex flex-col items-center gap-2 py-8 text-xs text-text-secondary"
      data-test="metrics-fn-empty"
    >
      <OIcon name="settings" size="md" />
      <span>{{ t("metrics.explorer.fn.nothingToConfigure") }}</span>
    </div>

    <ORadioGroup
      v-else
      :model-value="selectedId"
      orientation="horizontal"
      :label="t('metrics.explorer.fn.variantsAria', { name: card.name })"
      data-test="metrics-fn-variants"
      @update:model-value="select"
    >
      <div
        v-for="variant in variants"
        :key="variant.id"
        class="flex grow basis-[17.5rem] max-w-full min-w-0 cursor-pointer flex-col gap-1 rounded-default border p-2"
        :class="
          variant.id === selectedId
            ? 'border-primary-600 ring-1 ring-primary-600'
            : 'border-border-default hover:border-border-default'
        "
        :data-test="`metrics-fn-variant-${variant.id}`"
        @click="select(variant.id)"
      >
        <ORadio
          size="xs"
          :value="variant.id"
          :label="variant.label"
          :data-test="`metrics-fn-radio-${variant.id}`"
        />

        <div
          class="truncate font-mono text-3xs text-text-secondary"
          :title="exprOf(variant)"
          :data-test="`metrics-fn-expr-${variant.id}`"
        >
          {{ exprOf(variant) }}
        </div>

        <div class="relative h-30">
          <div
            v-if="previewOf(variant).status === 'error'"
            class="flex h-full flex-col items-center justify-center gap-1 text-xs text-text-secondary"
            :title="previewOf(variant).error"
            :data-test="`metrics-fn-error-${variant.id}`"
          >
            <OIcon name="error" size="sm" class="text-error-600" />
            <span>{{ t("metrics.explorer.queryFailed") }}</span>
            <OButton
              variant="ghost-primary"
              size="xs"
              :data-test="`metrics-fn-retry-${variant.id}`"
              @click.stop="load(variant)"
            >
              {{ t("metrics.explorer.retry") }}
            </OButton>
          </div>

          <div
            v-else-if="previewOf(variant).status === 'unavailable'"
            class="flex h-full items-center justify-center text-xs text-text-secondary"
            :data-test="`metrics-fn-nopreview-${variant.id}`"
          >
            {{ t("metrics.explorer.fn.noPreview") }}
          </div>

          <div
            v-else-if="previewOf(variant).status === 'done' && isEmpty(variant)"
            class="flex h-full items-center justify-center rounded-default text-xs text-text-secondary"
            :data-test="`metrics-fn-nodata-${variant.id}`"
          >
            {{ t("metrics.explorer.noData") }}
          </div>

          <!-- @error: a conversion throw lands the tile in the SAME error state
               a failed query does — without it the tile is a blank region with
               no message. -->
          <MetricCardChart
            v-else-if="previewOf(variant).results.length"
            :results="previewOf(variant).results"
            :queries="queriesOf(variant)"
            :chart-type="variant.chartType || defaults.chartType"
            :unit="unitOf(variant).unit"
            :unit-custom="unitOf(variant).unitCustom"
            :bucket-unit="bucketUnitOf(variant).unit"
            :bucket-unit-custom="bucketUnitOf(variant).unitCustom"
            :color="color"
            :data-test="`metrics-fn-chart-${variant.id}`"
            @error="onRenderError(variant, $event)"
          />

          <OSkeleton
            v-else
            class="h-full"
            animation="wave"
            :data-test="`metrics-fn-loading-${variant.id}`"
          />
        </div>

        <!-- Percentile variants carry a checkbox group. The set may never go
             empty: the last checked box is disabled rather than silently
             re-checked, so the constraint is visible before it is hit. -->
        <div
          v-if="variant.options && variant.options.percentiles"
          class="flex flex-wrap gap-x-3 gap-y-1"
          :data-test="`metrics-fn-percentiles-${variant.id}`"
        >
          <OCheckbox
            v-for="p in variant.availablePercentiles || []"
            :key="p"
            size="xs"
            :model-value="isChecked(variant, p)"
            :label="`p${p}`"
            :disabled="isOnlyChecked(variant, p)"
            :data-test="`metrics-fn-percentile-${variant.id}-${p}`"
            @update:model-value="togglePercentile(variant, p)"
          />
        </div>
      </div>
    </ORadioGroup>

    <template #footer>
      <div class="flex items-center justify-between gap-2">
        <OButton
          variant="ghost"
          size="sm-action"
          data-test="metrics-fn-restore"
          @click="onRestore"
        >
          {{ t("metrics.explorer.fn.resetToDefault") }}
        </OButton>

        <div class="flex items-center gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="metrics-fn-cancel"
            @click="close"
          >
            {{ t("metrics.explorer.fn.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :disabled="!isDirty"
            data-test="metrics-fn-apply"
            @click="onApply"
          >
            {{ t("metrics.explorer.fn.apply") }}
          </OButton>
        </div>
      </div>
    </template>
  </ODialog>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import MetricCardChart from "./MetricCardChart.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toO2Unit } from "@/utils/metrics/metricDefaults";
import { isCancelled } from "@/composables/metrics/useMetricsPreviewQueue";
import { parseSearchError } from "@/utils/query/searchError";
import type { MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import {
  hasSamples,
  type FnOverride,
} from "@/composables/metrics/useMetricsExplorerGrid";

type TileStatus = "idle" | "loading" | "done" | "error" | "unavailable";

interface TilePreview {
  status: TileStatus;
  results: any[];
  error: string;
}

const IDLE: TilePreview = { status: "idle", results: [], error: "" };

/** The legend a percentile query carries, e.g. `p99`. */
const PERCENTILE_LEGEND = /^p(\d+)$/;

const sortedNumbers = (values: any[]): number[] =>
  [...values].map(Number).sort((a, b) => a - b);

const sameNumbers = (a: number[] | null, b: number[] | null) => {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((value, i) => value === b[i]);
};

export default defineComponent({
  name: "FunctionConfigDialog",
  components: {
    MetricCardChart,
    ODialog,
    OButton,
    OIcon,
    OSkeleton,
    ORadioGroup,
    ORadio,
    OCheckbox,
    OTag,
  },
  props: {
    modelValue: { type: Boolean, default: false },
    card: { type: Object as PropType<MetricCardModel>, required: true },
    /**
     * A `getMetricDefaults()` result whose queries the PARENT has already
     * resolved against the current filters and rate window — so every
     * `variant.queries[].expr` here is executable as-is.
     */
    defaults: { type: Object as PropType<any>, default: null },
    override: { type: Object as PropType<FnOverride | null>, default: null },
    color: { type: String, required: true },
    /**
     * Runs one preview query. The parent routes it through the shared scheduler
     * at DIALOG priority and may reject with a cancellation error, which is
     * swallowed rather than shown.
     */
    runPreview: {
      type: Function as PropType<(expr: string) => Promise<any>>,
      required: true,
    },
  },
  emits: ["update:modelValue", "apply", "restore"],
  setup(props, { emit }) {
    const { t } = useI18n();

    const variants = computed<any[]>(() => props.defaults?.variants ?? []);
    const variantById = (id: string) =>
      variants.value.find((v) => v.id === id) ?? null;

    /* ----------------------------------------------------------- selection */

    const selectedId = ref("");
    /** Checked percentiles, per percentile-variant id. */
    const percentiles = ref<Record<string, number[]>>({});

    /** The rule-set-or-override percentile set a variant opens with. */
    const baselinePercentilesOf = (variant: any): number[] | null => {
      if (!variant?.options?.percentiles) return null;
      const fromOverride =
        props.override?.variantId === variant.id
          ? props.override?.options?.percentiles
          : null;
      const picked =
        Array.isArray(fromOverride) && fromOverride.length
          ? fromOverride
          : variant.options.percentiles;
      return sortedNumbers(picked);
    };

    const resetSelection = () => {
      selectedId.value =
        props.override?.variantId && variantById(props.override.variantId)
          ? props.override.variantId
          : (variants.value[0]?.id ?? "");

      const next: Record<string, number[]> = {};
      for (const variant of variants.value) {
        const baseline = baselinePercentilesOf(variant);
        if (baseline) next[variant.id] = baseline;
      }
      percentiles.value = next;
    };

    const select = (id: any) => {
      selectedId.value = String(id);
    };

    /* --------------------------------------------------------- percentiles */

    const checkedOf = (variant: any): number[] =>
      percentiles.value[variant.id] ?? [];

    const isChecked = (variant: any, p: number) =>
      checkedOf(variant).includes(Number(p));

    /** The last remaining checkbox is disabled — the set may never go empty. */
    const isOnlyChecked = (variant: any, p: number) => {
      const checked = checkedOf(variant);
      return checked.length === 1 && checked[0] === Number(p);
    };

    const togglePercentile = (variant: any, p: number) => {
      const value = Number(p);
      const checked = checkedOf(variant);
      const next = checked.includes(value)
        ? checked.filter((n) => n !== value)
        : sortedNumbers([...checked, value]);

      // Belt and braces: the box is already disabled, but a programmatic uncheck
      // of the last one must not be able to empty the set either.
      if (!next.length) return;

      percentiles.value = { ...percentiles.value, [variant.id]: next };
      // The tile's queries changed, so its preview is now for the wrong set.
      void load(variant);
    };

    /* -------------------------------------------------------- tile queries */

    /**
     * The queries a tile renders. Percentile variants are filtered down to the
     * checked set with exactly the rule `resolveVariant` uses, so what a tile
     * charts is what the card will chart once applied.
     */
    const queriesOf = (variant: any): any[] => {
      const picked = percentiles.value[variant.id];
      if (!variant?.options?.percentiles || !picked?.length) {
        return variant?.queries ?? [];
      }
      const wanted = new Set(picked.map(Number));
      const subset = (variant.queries ?? []).filter((query: any) => {
        const match = PERCENTILE_LEGEND.exec(query.legendTemplate ?? "");
        return match ? wanted.has(Number(match[1])) : true;
      });
      return subset.length ? subset : variant.queries;
    };

    const exprOf = (variant: any) =>
      queriesOf(variant)
        .map((query: any) => query.expr)
        .join("  |  ");

    const unitOf = (variant: any) =>
      toO2Unit(variant?.unit ?? props.defaults?.unit);

    const bucketUnitOf = (variant: any) =>
      (variant?.chartType ?? props.defaults?.chartType) === "heatmap" &&
      props.defaults?.bucketUnit
        ? toO2Unit(props.defaults.bucketUnit)
        : { unit: null, unitCustom: null };

    /* ------------------------------------------------------------ previews */

    const previews = ref<Record<string, TilePreview>>({});
    const previewOf = (variant: any): TilePreview =>
      previews.value[variant.id] ?? IDLE;

    /**
     * Resolutions from a previous open — or from a tile whose percentile set has
     * since changed — must never land. Real cancellation is the parent's job; the
     * counter is what makes a late resolution harmless here.
     */
    let generation = 0;

    /**
     * Per-tile load sequence. A percentile toggle re-loads ONE tile; bumping the
     * dialog-wide generation for that would silently strand every other tile
     * still in flight from `loadAll`. This lets a tile supersede only itself:
     * without it, toggling p99 then p95 raced two loads for the same tile, and
     * whichever resolved LAST painted — often the stale set, since the newer
     * query is typically the cache hit.
     */
    const tileSeq: Record<string, number> = {};

    const isEmpty = (variant: any) => {
      const preview = previewOf(variant);
      if (preview.status !== "done") return false;
      // The same reader the cards use, so "empty" means the same thing on a
      // tile as on the card behind it.
      return !preview.results.some(hasSamples);
    };

    const load = async (variant: any) => {
      const queries = queriesOf(variant);
      if (variant?.previewable === false || !queries.length) {
        previews.value = {
          ...previews.value,
          [variant.id]: { status: "unavailable", results: [], error: "" },
        };
        return;
      }

      const mine = generation;
      const seq = (tileSeq[variant.id] = (tileSeq[variant.id] ?? 0) + 1);
      previews.value = {
        ...previews.value,
        [variant.id]: { status: "loading", results: [], error: "" },
      };

      try {
        const results = await Promise.all(
          queries.map((query: any) => props.runPreview(query.expr)),
        );
        if (mine !== generation || seq !== tileSeq[variant.id]) return;
        previews.value = {
          ...previews.value,
          [variant.id]: { status: "done", results, error: "" },
        };
      } catch (error: any) {
        if (mine !== generation || seq !== tileSeq[variant.id]) return;
        // A cancelled tile belongs to a dialog the user has already closed. It is
        // not an error, and must not paint one.
        if (isCancelled(error)) return;

        previews.value = {
          ...previews.value,
          [variant.id]: {
            status: "error",
            results: [],
            // Through the same reader the cards use, so a tile shows the same
            // message as the card behind it.
            error: parseSearchError(error).message,
          },
        };
      }
    };

    /**
     * A conversion throw from the chart child. The tile's queries SUCCEEDED —
     * its preview is "done" — so only this hands the failure to the same error
     * state a failed query uses (message + Retry) instead of a blank tile.
     */
    const onRenderError = (variant: any, error: any) => {
      previews.value = {
        ...previews.value,
        [variant.id]: {
          status: "error",
          results: [],
          error: String(error || t("metrics.functionConfigDialog.failedToRenderChart")),
        },
      };
    };

    /**
     * Tiles load lazily on open, selected-first: the tile the user is already
     * looking at takes the scheduler's first slot and the rest queue behind it.
     * Each is awaited independently, so one failure cannot block the others.
     */
    const loadAll = () => {
      const ordered = [
        ...variants.value.filter((v) => v.id === selectedId.value),
        ...variants.value.filter((v) => v.id !== selectedId.value),
      ];
      for (const variant of ordered) void load(variant);
    };

    watch(
      () => props.modelValue,
      (open) => {
        // Both edges bump the generation: opening abandons the previous open's
        // stragglers, closing abandons this one's.
        generation += 1;
        previews.value = {};
        if (!open) return;
        resetSelection();
        loadAll();
      },
      { immediate: true },
    );

    /* --------------------------------------------------------------- state */

    const baselineVariantId = computed(
      () =>
        (props.override?.variantId && variantById(props.override.variantId)
          ? props.override.variantId
          : variants.value[0]?.id) ?? "",
    );

    /** Apply is offered only when it would actually change something. */
    const isDirty = computed(() => {
      if (!selectedId.value) return false;
      if (selectedId.value !== baselineVariantId.value) return true;

      const variant = variantById(selectedId.value);
      if (!variant?.options?.percentiles) return false;
      return !sameNumbers(
        sortedNumbers(checkedOf(variant)),
        baselinePercentilesOf(variant),
      );
    });

    const close = () => emit("update:modelValue", false);

    const onApply = () => {
      const variant = variantById(selectedId.value);
      if (!variant) return;
      const picked = variant.options?.percentiles
        ? sortedNumbers(checkedOf(variant))
        : null;
      emit("apply", {
        variantId: variant.id,
        ...(picked?.length ? { options: { percentiles: picked } } : {}),
      });
    };

    const onRestore = () => emit("restore");

    return {
      t,
      variants,
      selectedId,
      select,
      isChecked,
      isOnlyChecked,
      togglePercentile,
      queriesOf,
      exprOf,
      unitOf,
      bucketUnitOf,
      previewOf,
      isEmpty,
      load,
      onRenderError,
      isDirty,
      close,
      onApply,
      onRestore,
    };
  },
});
</script>
