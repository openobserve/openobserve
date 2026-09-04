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
  Where this error concentrates — browser, OS, release and page, each as a
  share of the issue's total events. This is the panel that turns a stack trace
  into a lead: "94% Safari 17" or "100% v2.4.1" is the fix, the stack trace is
  only the symptom.
-->
<template>
  <section
    class="rounded-default border-border-default bg-card-glass-bg border p-3"
    data-test="rum-error-facet-breakdown"
  >
    <h4>{{ t("rum.errorDetail.breakdownTitle") }}</h4>
    <small class="mb-2 block">{{ t("rum.errorDetail.breakdownHint") }}</small>

    <div v-if="loading" class="flex flex-col gap-3" data-test="rum-error-facet-breakdown-loading">
      <OSkeleton v-for="index in 4" :key="index" variant="text" />
    </div>

    <p
      v-else-if="!populatedFacets.length"
      class="text-text-muted"
      data-test="rum-error-facet-breakdown-empty"
    >
      {{ t("rum.errorDetail.breakdownEmpty") }}
    </p>

    <template v-else>
      <OBanner
        v-if="dominant"
        variant="error-soft"
        dense
        icon="lightbulb"
        class="mb-3"
        data-test="rum-error-facet-breakdown-insight"
      >
        {{
          t("rum.errorDetail.dominantInsight", {
            share: Math.round(dominant.value.share * 100),
            dimension: dominant.label,
            value: dominant.value.value,
          })
        }}
      </OBanner>

      <dl class="m-0 flex flex-col gap-3">
        <div
          v-for="facet in populatedFacets"
          :key="facet.key"
          :data-test="`rum-error-facet-${facet.key}`"
        >
          <dt class="text-text-label text-xs font-medium tracking-wide uppercase">
            {{ facet.label }}
          </dt>
          <dd class="m-0 mt-1 flex flex-col gap-1.5">
            <div v-for="entry in facet.values" :key="entry.value" class="flex flex-col gap-0.5">
              <div class="flex min-w-0 items-baseline justify-between gap-2">
                <span
                  class="text-text-body min-w-0 truncate"
                  :title="entry.value"
                  :data-test="`rum-error-facet-${facet.key}-value`"
                  >{{ entry.value }}</span
                >
                <span
                  class="text-text-secondary shrink-0 tabular-nums"
                  :data-test="`rum-error-facet-${facet.key}-share`"
                  >{{ percentLabel(entry.share) }}</span
                >
              </div>
              <OProgressBar :value="entry.share" size="xs" variant="danger" />
            </div>
          </dd>
        </div>
      </dl>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { FacetKey, FacetValue } from "@/utils/rum/errorDetailQueries";

const props = defineProps<{
  facets: Record<FacetKey, FacetValue[]>;
  loading?: boolean;
}>();

const { t } = useI18nTyped();

/** A single value owning this much of the traffic is the actionable signal. */
const DOMINANT_SHARE = 0.8;

const FACET_ORDER: FacetKey[] = ["browser", "os", "release", "page"];

const facetLabel = (key: FacetKey) => {
  if (key === "browser") return t("rum.errorDetail.facetBrowser");
  if (key === "os") return t("rum.errorDetail.facetOs");
  if (key === "release") return t("rum.errorDetail.facetRelease");
  return t("rum.errorDetail.facetPage");
};

const populatedFacets = computed(() =>
  FACET_ORDER.filter((key) => props.facets[key]?.length).map((key) => ({
    key,
    label: facetLabel(key),
    values: props.facets[key],
  })),
);

/**
 * The strongest single concentration across all facets — surfaced as a hint so
 * the reader does not have to compare four bar groups by eye. Suppressed when
 * the facet has only one distinct value, where "100% Chrome" says nothing more
 * than "we only have Chrome data".
 */
const dominant = computed(() => {
  let best: { label: I18nText; value: FacetValue } | null = null;
  for (const facet of populatedFacets.value) {
    if (facet.values.length < 2) continue;
    const top = facet.values[0];
    if (top.share < DOMINANT_SHARE) continue;
    if (!best || top.share > best.value.share) best = { label: facet.label, value: top };
  }
  return best;
});

const percentLabel = (share: number) => raw(`${Math.round(share * 100)}%`);
</script>
