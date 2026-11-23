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
    <h2 class="text-text-heading text-base font-bold">{{ t("rum.overviewPage.diffTitle") }}</h2>
    <div
      class="bg-surface-tint-neutral rounded-surface mt-3 p-3"
      :class="difference ? 'border-border-default border' : ''"
      data-test="rum-overview-difference"
    >
      <template v-if="difference">
        <div class="text-text-heading text-sm font-bold" data-test="rum-overview-difference-title">
          {{
            t("rum.overviewPage.diffSegment", {
              dim: t(LABEL[difference.dim]),
              value: difference.label,
            })
          }}
        </div>
        <div class="text-text-body mt-1 text-sm">
          {{
            t("rum.overviewPage.diffBody", {
              inp: formatVital("inp", difference.inp),
              ratio: difference.ratio.toFixed(1),
            })
          }}
        </div>
        <router-link
          :to="sessionsLink(difference.filter)"
          class="text-text-link mt-2 inline-block text-sm font-bold"
          data-test="rum-overview-difference-link"
        >
          {{ t("rum.overviewPage.diffLink") }} →
        </router-link>
      </template>
      <p v-else class="text-text-secondary text-sm">{{ t("rum.overviewPage.diffNone") }}</p>
    </div>

    <div class="mt-4" @keydown="onKeydown">
      <OTabs
        v-model="active"
        :aria-label="t('rum.overviewPage.segmentLabel')"
        data-test="rum-overview-segment-tabs"
      >
        <OTab
          v-for="d in dims"
          :key="d"
          :name="d"
          :label="t(LABEL[d])"
          :data-test="`rum-overview-segment-tab-${d}`"
        />
      </OTabs>
    </div>
    <OTabPanels v-model="active">
      <OTabPanel v-for="d in dims" :key="d" :name="d">
        <ul
          class="m-0 mt-3 flex list-none flex-col gap-3 p-0"
          :data-test="`rum-overview-segment-panel-${d}`"
        >
          <li v-for="(s, i) in segments[d] ?? []" :key="s.label + i">
            <div class="flex justify-between text-sm">
              <span class="text-text-body">{{ s.label }}</span>
              <span class="font-bold" :class="BAND_TEXT[bandOf('inp', s.inp) ?? 'good']">
                <MarkedValue
                  :band="bandOf('inp', s.inp)"
                  :text="t('rum.overviewPage.segInp', { v: formatVital('inp', s.inp) })"
                />
              </span>
            </div>
            <OSegmentedBar
              class="mt-1"
              :segments="[
                {
                  id: 'share',
                  pct: s.share,
                  variant: bandOf('inp', s.inp) === 'good' ? 'default' : 'warning',
                },
              ]"
              :label="t('rum.overviewPage.segShare', { n: s.share })"
            />
          </li>
          <li v-if="!(segments[d] ?? []).length" class="text-text-secondary text-sm">
            {{ t("rum.overviewPage.segNone") }}
          </li>
        </ul>
      </OTabPanel>
    </OTabPanels>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { RouteLocationRaw } from "vue-router";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import MarkedValue from "@/components/rum/performance/overview/MarkedValue.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import {
  bandOf,
  formatVital,
  type BiggestDifference,
  type Band,
  type SegmentDim,
  type SegmentRow,
} from "@/utils/rum/performanceOverview";

const props = defineProps<{
  segments: Partial<Record<SegmentDim, SegmentRow[]>>;
  difference: BiggestDifference | null;
  sessionsLink: (filter: string) => RouteLocationRaw;
}>();
const { t } = useI18nTyped();

const LABEL: Record<SegmentDim, I18nKey> = {
  browser: "rum.overviewPage.segBrowser",
  device: "rum.overviewPage.segDevice",
  os: "rum.overviewPage.segOs",
  country: "rum.overviewPage.segCountry",
  connection: "rum.overviewPage.segConnection",
};
const BAND_TEXT: Record<Band, string> = {
  good: "text-text-body",
  needs: "text-status-warning-text",
  poor: "text-status-error-text",
};

const dims = computed(() =>
  (Object.keys(LABEL) as SegmentDim[]).filter((d) => d in props.segments),
);
const active = ref<SegmentDim>(dims.value[0] ?? "browser");
watch(dims, (list) => {
  if (list.length && !list.includes(active.value)) active.value = list[0];
});

// The callout names a dimension, so its tab opens with it; a later click by the user still wins.
watch(
  () => props.difference?.dim,
  (dim) => {
    if (!dim || !dims.value.includes(dim)) return;
    active.value = dim;
    void nextTick(() =>
      document
        .querySelector(`[data-test="rum-overview-segment-tab-${dim}"]`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" }),
    );
  },
  { immediate: true },
);

const onKeydown = (e: KeyboardEvent) => {
  const isTab = (e.target as HTMLElement | null)?.getAttribute("role") === "tab";
  const list = dims.value;
  if (!isTab || !list.length) return;
  const i = list.indexOf(active.value);
  const next =
    e.key === "ArrowRight"
      ? (i + 1) % list.length
      : e.key === "ArrowLeft"
        ? (i - 1 + list.length) % list.length
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? list.length - 1
            : -1;
  if (next < 0) return;
  active.value = list[next];
  const tabs = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role=tab]");
  tabs[next]?.focus();
  e.preventDefault();
};
</script>
