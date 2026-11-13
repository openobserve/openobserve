<template>
  <div class="flex flex-col gap-1.5" data-test="svcver-summary-tiles">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-text-secondary inline-flex items-center gap-1" data-test="svcver-legend"
        ><template v-if="baseline"
          ><span :class="swatch.before" /><span>{{
            t("serviceVersions.compare.before", { version: armLabels.b })
          }}</span
          ><span class="text-text-muted">→</span></template
        ><span :class="swatch.after" /><span>{{
          t("serviceVersions.compare.after", { version: armLabels.a })
        }}</span></span
      ><span v-if="baseline" class="text-text-secondary" data-test="svcver-legend-rule">{{
        t("serviceVersions.compare.legend")
      }}</span
      ><OToggleGroup
        v-if="signals.length > 1"
        class="ms-auto"
        :model-value="signal"
        data-test="svcver-signal"
        @update:model-value="(value) => selectSignal(value as Signal)"
        ><OToggleGroupItem
          v-for="item in signals"
          :key="item"
          :value="item"
          size="sm"
          :data-test="`svcver-signal-${item}`"
          >{{ t(`serviceVersions.compare.${item}`) }}</OToggleGroupItem
        ></OToggleGroup
      >
    </div>
    <InfoNotice v-if="signal === 'rum' && rumAbsent" data-test="svcver-rum-not-collected">{{
      t("serviceVersions.compare.drill.reasons.fieldAbsent")
    }}</InfoNotice>
    <div
      v-else
      class="grid grid-cols-2 gap-2"
      :class="tiles.length > 4 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'"
    >
      <component
        :is="charted(tile.key) ? 'button' : 'div'"
        v-for="tile in tiles"
        :key="tile.key"
        :type="charted(tile.key) ? 'button' : undefined"
        :aria-pressed="charted(tile.key) ? metric === tile.key : undefined"
        class="rounded-surface bg-surface-panel flex min-w-0 flex-col gap-0.5 border px-2.5 py-2 text-start"
        :class="[
          charted(tile.key) && metric === tile.key
            ? 'border-accent ring-accent ring-1'
            : 'border-border-default',
          tile.tone === 'waiting' ? 'border-dashed' : '',
        ]"
        :data-test="`svcver-metric-${tile.key}`"
        @click="charted(tile.key) && (metric = tile.key)"
      >
        <span class="text-text-secondary text-2xs">{{ tileLabel(tile.key) }}</span>
        <span
          class="text-text-heading inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap"
          ><template v-if="baseline"
            ><span :class="swatch.before" /><span>{{ tile.before }}</span
            ><span class="text-text-muted font-normal">→</span></template
          ><span :class="swatch.after" /><span :data-test="`svcver-value-${tile.key}`">{{
            tile.after
          }}</span></span
        >
        <span
          v-if="tile.delta"
          class="text-sm"
          :class="toneClass[tile.tone]"
          :data-test="`svcver-delta-${tile.key}`"
          >{{ tile.delta }}</span
        >
        <span
          v-if="bands[tile.key]"
          class="text-2xs flex flex-wrap items-center gap-1"
          :data-test="`svcver-tile-band-${tile.key}`"
          :data-crossed="bands[tile.key]?.crossed ? 'true' : undefined"
          ><OTag
            type="cwvBand"
            :value="bands[tile.key]?.before"
            :label="bandLabel(bands[tile.key]?.before)"
            size="sm" /><span class="text-text-secondary">→</span
          ><OTag
            type="cwvBand"
            :value="bands[tile.key]?.after"
            :label="bandLabel(bands[tile.key]?.after)"
            size="sm" /><span
            v-if="
              tile.key === 'inp_p75' ||
              (bands[tile.key]?.crossed && bands[tile.key]?.after !== 'good')
            "
            class="inline-flex items-center gap-1 whitespace-nowrap"
            ><span
              v-if="tile.key === 'inp_p75'"
              class="text-text-secondary"
              data-test="svcver-tile-band-limit-inp_p75"
              >{{ t("serviceVersions.compare.drill.inpGoodLimit") }}</span
            ><OIcon
              v-if="bands[tile.key]?.crossed && bands[tile.key]?.after !== 'good'"
              name="warning"
              size="xs"
              class="text-warning-600"
              :aria-label="t('serviceVersions.compare.drill.bandCrossed')"
              data-test="svcver-tile-band-crossed" /></span
        ></span>
        <span
          v-if="tile.detail"
          class="text-text-secondary text-2xs break-words"
          :data-test="
            tile.tone === 'waiting' ? `svcver-floor-${tile.key}` : `svcver-ci-${tile.key}`
          "
          >{{ tile.detail }}</span
        >
      </component>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import InfoNotice from "@/components/shared/InfoNotice.vue";
import type { CompareResponse, Signal } from "@/services/service_versions";
import {
  buildTiles,
  hasBaseline,
  CHART_METRICS,
  type TileMetric,
  type TileTone,
} from "./VersionSummaryTiles.format";
import { compareArmLabels, leadingVerdict, verdictCode } from "./verdictText";
const props = withDefaults(
  defineProps<{ result: CompareResponse; selectable?: boolean; rumAbsent?: boolean }>(),
  { selectable: false, rumAbsent: false },
);
const signal = defineModel<Signal>("signal", { default: "traces" });
const metric = defineModel<TileMetric>("metric", { default: "error_rate" });
const { t } = useI18nTyped();
const signals = computed(() => (["traces", "rum"] as const).filter((item) => props.result[item]));
const leading = computed(() => leadingVerdict(props.result));
// Default to the higher-volume signal.
watch(
  () => `${props.result.service}|${props.result.arms.a.version}|${props.result.arms.b.version}`,
  () => {
    const value = props.result;
    const rum = value.rum?.views?.a ?? 0;
    const traces = value.traces?.requests?.a ?? 0;
    const preferred: Signal =
      !value.traces || (value.rum && rum > traces && !props.rumAbsent) ? "rum" : "traces";
    selectSignal(preferred);
  },
  { immediate: true },
);
// A RUM drawer opens on the vital the verdict leads with, else INP.
function selectSignal(value: Signal) {
  signal.value = value;
  if (CHART_METRICS[value].includes(metric.value)) return;
  const headline = leading.value?.headline?.metric as TileMetric | undefined;
  if (value === "traces") metric.value = "error_rate";
  else metric.value = headline && CHART_METRICS.rum.includes(headline) ? headline : "inp_p75";
}
const charted = (key: TileMetric) => props.selectable && CHART_METRICS[signal.value].includes(key);
const RUM_ONLY_TILES = new Set<TileMetric>(["js_errors", "sessions"]);
const tileLabel = (key: TileMetric) =>
  t(
    (RUM_ONLY_TILES.has(key)
      ? `serviceVersions.compare.drill.tile.${key}`
      : `serviceVersions.compare.tile.${key}`) as I18nKey,
  );
const baseline = computed(() => hasBaseline(props.result));
const armLabels = computed(() => compareArmLabels(props.result, t));
const swatch = {
  before: "bg-accent inline-block size-2 rounded-xs align-middle",
  after: "bg-ai-accent inline-block size-2 rounded-xs align-middle",
};
const tiles = computed(() =>
  buildTiles(
    props.result,
    signal.value,
    t,
    Boolean(leading.value && verdictCode(leading.value) === "watch"),
  ),
);
const VITALS = ["lcp_p75", "inp_p75", "cls_p75"] as const;
// Core Web Vitals bands read baseline then new, the same order as the before/after values.
const bands = computed(() => {
  const out: Partial<Record<string, { before: string; after: string; crossed: boolean }>> = {};
  for (const key of VITALS) {
    const vital = props.result.rum?.[key];
    if (vital?.band_a && vital.band_b)
      out[key] = {
        before: vital.band_b,
        after: vital.band_a,
        crossed: Boolean(vital.band_crossed ?? vital.band_a !== vital.band_b),
      };
  }
  return out;
});
const bandLabel = (band?: string) =>
  band === "needs_improvement" ? t("serviceVersions.compare.drill.bandNiShort") : undefined;
const toneClass: Record<TileTone, string> = {
  crit: "text-error-600 font-semibold",
  warn: "text-warning-600 font-semibold",
  good: "text-success-600 font-semibold",
  neutral: "text-text-secondary font-semibold",
  waiting: "text-text-secondary font-medium",
};
</script>
