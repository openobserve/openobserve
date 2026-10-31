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
  <div>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1 basis-80">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-text-heading text-xl font-bold" data-test="rum-overview-verdict-title">
            {{ heading }}
          </h2>
          <OBadge
            v-if="!hideVerdict && verdict.assessed > 0"
            :variant="verdict.pass ? 'success-soft' : 'warning-soft'"
            data-test="rum-overview-verdict-chip"
          >
            {{
              verdict.pass
                ? t("rum.overviewPage.verdictAllPass")
                : t(
                    "rum.overviewPage.verdictNeedWork",
                    { count: verdict.failing.length, total: verdict.assessed },
                    verdict.failing.length,
                  )
            }}
          </OBadge>
        </div>
        <p class="text-text-secondary mt-1 text-sm" data-test="rum-overview-verdict-lead">
          <span v-for="sentence in sentences" :key="sentence.key" class="me-1">
            {{ sentence.text }}
          </span>
        </p>
      </div>
      <OToggleGroup
        :model-value="percentile"
        :label="t('rum.overviewPage.percentileLabel')"
        data-test="rum-overview-percentile"
        @update:model-value="emit('update:percentile', $event as Percentile)"
      >
        <OToggleGroupItem
          v-for="p in PERCENTILES"
          :key="p"
          :value="p"
          size="sm"
          :data-test="`rum-overview-percentile-${p}`"
        >
          {{ p }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <ul class="mt-4 grid list-none grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4 p-0">
      <li v-for="card in cards" :key="card.key" :data-test="`rum-overview-vital-${card.key}`">
        <OCard variant="outlined" class="p-4">
          <router-link
            :to="sessionsLink(card.filter)"
            class="text-text-heading block no-underline hover:underline focus-visible:underline"
            :aria-label="card.linkLabel"
            :data-test="`rum-overview-vital-${card.key}-link`"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-text-secondary text-sm">
                <b class="text-text-heading">{{ card.code }}</b> {{ percentile }} · {{ card.name }}
              </span>
              <OBadge v-if="card.band" :variant="BAND_BADGE[card.band]" size="sm">
                {{ card.bandText }}
              </OBadge>
            </div>
            <div class="mt-2 flex flex-wrap items-baseline gap-x-2">
              <span class="text-text-heading text-3xl font-bold whitespace-nowrap">
                {{ card.value }}
              </span>
              <span
                class="text-text-secondary text-sm whitespace-nowrap"
                :data-test="`rum-overview-vital-${card.key}-delta`"
              >
                {{ card.deltaText }}
              </span>
            </div>
          </router-link>
          <OSegmentedBar
            class="mt-3"
            :segments="card.segments"
            :label="card.aria"
            :data-test="`rum-overview-vital-${card.key}-bar`"
          />
          <div class="text-text-secondary mt-2 flex flex-wrap justify-between gap-x-2 text-xs">
            <span>{{ t("rum.overviewPage.bandGoodPct", { n: card.pct.good }) }}</span>
            <span>{{ t("rum.overviewPage.bandNeedsPct", { n: card.pct.needs }) }}</span>
            <span>{{ t("rum.overviewPage.bandPoorPct", { n: card.pct.poor }) }}</span>
          </div>
        </OCard>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { VitalsSummary } from "@/utils/rum/performanceOverview";
import {
  PERCENTILES,
  VITAL_KEYS,
  VITAL_THRESHOLDS,
  bandOf,
  bandPercents,
  formatCount,
  formatVital,
  overThresholdPct,
  verdictOf,
  vitalDelta,
  type Band,
  type Percentile,
  type VitalKey,
} from "@/utils/rum/performanceOverview";

const props = defineProps<{
  vitals: VitalsSummary;
  prev: VitalsSummary | null;
  percentile: Percentile;
  hideVerdict: boolean;
  sessions: number | null;
  sessionsLink: (filter: string) => RouteLocationRaw;
}>();
const emit = defineEmits<{ (e: "update:percentile", value: Percentile): void }>();
const { t } = useI18nTyped();

const BAND_BADGE: Record<Band, "success-soft" | "warning-soft" | "error-soft"> = {
  good: "success-soft",
  needs: "warning-soft",
  poor: "error-soft",
};

const NAMES: Record<VitalKey, I18nKey> = {
  lcp: "rum.overviewPage.vitalLcp",
  inp: "rum.overviewPage.vitalInp",
  cls: "rum.overviewPage.vitalCls",
};

const DELTA_KEYS: Record<string, I18nKey> = {
  faster: "rum.overviewPage.deltaFaster",
  slower: "rum.overviewPage.deltaSlower",
  lower: "rum.overviewPage.deltaLower",
  higher: "rum.overviewPage.deltaHigher",
};

const bandLabel = (b: Band) =>
  t(
    b === "good"
      ? "rum.overviewPage.bandGood"
      : b === "needs"
        ? "rum.overviewPage.bandNeeds"
        : "rum.overviewPage.bandPoor",
  );

// The verdict and bands always read p75, whichever percentile is displayed.
const verdict = computed(() =>
  verdictOf({ lcp: props.vitals.lcp.p75, inp: props.vitals.inp.p75, cls: props.vitals.cls.p75 }),
);

// A session count is stated only once it has loaded; page views are not sessions.
const sessionsSentence = computed(() =>
  props.sessions === null
    ? []
    : [
        {
          key: "sessions",
          text: t(
            "rum.overviewPage.verdictSessions",
            { count: formatCount(props.sessions) },
            props.sessions,
          ),
        },
      ],
);

const sentences = computed<{ key: string; text: I18nText }[]>(() => {
  if (verdict.value.assessed === 0) {
    return [
      {
        key: "nodata",
        text: t(
          "rum.overviewPage.verdictNoDataLead",
          { count: formatCount(props.vitals.views) },
          props.vitals.views,
        ),
      },
    ];
  }
  if (props.hideVerdict) return [];
  if (verdict.value.pass) {
    const note =
      props.percentile === "p75"
        ? []
        : [{ key: "note", text: t("rum.overviewPage.verdictP75Note") }];
    return [
      {
        key: "pass",
        text:
          verdict.value.assessed === 3
            ? t("rum.overviewPage.verdictAllThree")
            : t("rum.overviewPage.verdictAllSome", { n: verdict.value.assessed }),
      },
      ...sessionsSentence.value,
      ...note,
    ];
  }
  return [
    ...verdict.value.failing.map((k) => ({
      key: k,
      text: t("rum.overviewPage.verdictOver", {
        vital: k.toUpperCase(),
        threshold: formatVital(k, VITAL_THRESHOLDS[k].good),
        pct: overThresholdPct(props.vitals[`${k}Bands`]),
      }),
    })),
    ...sessionsSentence.value,
    ...(props.prev ? [{ key: "compare", text: t("rum.overviewPage.verdictCompare") }] : []),
    { key: "note", text: t("rum.overviewPage.verdictP75Note") },
  ];
});

const heading = computed(() =>
  verdict.value.assessed === 0
    ? t("rum.overviewPage.verdictNoData")
    : props.hideVerdict
      ? t("rum.overviewPage.verdictNeutral")
      : verdict.value.pass
        ? t("rum.overviewPage.verdictPass")
        : t("rum.overviewPage.verdictFail"),
);

// The band always comes from p75, so any other displayed percentile says so.
const bandText = (b: Band) =>
  props.percentile === "p75"
    ? bandLabel(b)
    : t("rum.overviewPage.bandAtP75", { band: bandLabel(b) });

const deltaText = (key: VitalKey): I18nText => {
  if (!props.prev) return t("rum.overviewPage.deltaNoPrev");
  const d = vitalDelta(key, props.vitals[key][props.percentile], props.prev[key][props.percentile]);
  if (!d) return t("rum.overviewPage.deltaNoPrev");
  if (d.kind === "none") return t("rum.overviewPage.deltaNone");
  return t(DELTA_KEYS[d.kind], { v: raw(d.text) });
};

const cards = computed(() =>
  VITAL_KEYS.filter(
    (k) => props.vitals[k].p75 !== null || props.vitals[k][props.percentile] !== null,
  ).map((key) => {
    const pct = bandPercents(props.vitals[`${key}Bands`]);
    const band = bandOf(key, props.vitals[key].p75);
    const value = raw(formatVital(key, props.vitals[key][props.percentile]));
    return {
      key,
      code: key.toUpperCase(),
      name: t(NAMES[key]),
      value,
      band,
      bandText: band ? bandText(band) : raw(""),
      deltaText: deltaText(key),
      linkLabel: t("rum.overviewPage.vitalLinkFull", {
        vital: key.toUpperCase(),
        percentile: props.percentile,
        value,
        band: band ? bandText(band) : raw(""),
        delta: deltaText(key),
      }),
      pct,
      aria: t("rum.overviewPage.bandAria", { good: pct.good, needs: pct.needs, poor: pct.poor }),
      segments: [
        { id: "good", pct: pct.good, variant: "success" as const },
        { id: "needs", pct: pct.needs, variant: "warning" as const },
        { id: "poor", pct: pct.poor, variant: "danger" as const },
      ],
      filter: `${VITAL_THRESHOLDS[key].column} > ${VITAL_THRESHOLDS[key].good}`,
    };
  }),
);
</script>
