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
  DbmHistoryPanel — one of the query detail page's two history charts.

  Latency and volume were written twice, verbatim, differing only in which
  schema and which series they handed the renderer. What is worth keeping
  identical between them is the THREE-STATE LADDER, not the chart: a skeleton
  while the read is in flight, a stated "no series" when the read came back
  empty, and the panel itself otherwise — all three at the same height, so the
  two cards stay level and the page does not jump as they resolve.

  The empty state is a sentence rather than an empty axis on purpose. An axis
  with no line reads as "flat", which is a claim about the data; "no series"
  says the honest thing, that nothing was tracked in this window.

  Renders through `PanelSchemaRenderer` — the shared dashboard engine — rather
  than a hand-built ECharts option, so both charts inherit the app's units,
  axes, legend, tooltip, timezone and theming. The series are computed by the
  caller from classified history rather than by a query, so they reach the
  renderer through its pre-fetched-results injection path.
-->
<template>
  <section class="card-container border-border-default rounded-surface flex flex-col border p-3">
    <h3 class="text-text-heading mb-1 text-sm font-medium">{{ title }}</h3>
    <OSkeleton v-if="loading" variant="button" class="h-55 w-full" />
    <div v-else-if="!hasSeries" class="text-text-muted flex h-55 items-center justify-center">
      {{ emptyLabel }}
    </div>
    <div v-else class="h-55 w-full">
      <PanelSchemaRenderer
        :panel-schema="panelSchema"
        :selected-time-obj="selectedTimeObj"
        :variables-data="{}"
        :injected-promql-data="injectedPromqlData"
        :allow-annotations-add="false"
        :allow-annotations-a-p-i="false"
        :data-test="panelDataTest"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";

import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { I18nText } from "@/types/i18n";
import type { buildInjectedHistoryData } from "@/utils/dbm/historyPanelSchema";

const PanelSchemaRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/PanelSchemaRenderer.vue"),
);

defineProps<{
  title: I18nText;
  /** The sentence shown when the window tracked no windows at all. */
  emptyLabel: I18nText;
  /** In flight — the skeleton stands in, at the panel's own height. */
  loading: boolean;
  /** Whether the read returned any points to draw. */
  hasSeries: boolean;
  /** The dashboard panel definition, built by the caller. */
  panelSchema: Record<string, unknown>;
  /** The window the renderer pins the time axis to. */
  selectedTimeObj: { start_time: Date; end_time: Date };
  /**
   * Pre-fetched series, injected rather than queried. `undefined` before the
   * history read lands — the ladder's `hasSeries` is what gates the panel, so
   * the renderer is never mounted without data.
   */
  injectedPromqlData: ReturnType<typeof buildInjectedHistoryData> | undefined;
  /** `data-test` for the rendered panel itself; the card's own comes from the caller. */
  panelDataTest: string;
}>();
</script>
