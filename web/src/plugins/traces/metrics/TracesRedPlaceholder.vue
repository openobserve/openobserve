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
import { useI18nTyped } from "@/types/i18n";
import useTraces from "@/composables/useTraces";
import metrics from "./metrics.json";
import TracesRedPanelPlaceholder from "./TracesRedPanelPlaceholder.vue";

const { t } = useI18nTyped();
const { searchObj } = useTraces();

// Titles come from the charts' own definition, so the placeholder names the panels that replace it.
const chartPanels = computed(() =>
  metrics.tabs[0].panels.map((panel) => ({
    title: panel.title,
    meta:
      panel.title === "Rate"
        ? searchObj.meta.searchMode === "spans"
          ? t("traces.metrics.perSecond.spans")
          : t("traces.metrics.perSecond.traces")
        : "",
  })),
);
</script>

<template>
  <div class="flex h-full gap-2 ps-2.25 pe-2.25 pt-1.5 pb-2.25" data-test="traces-red-placeholder">
    <div
      v-for="panel in chartPanels"
      :key="panel.title"
      class="border-border-default rounded-default flex min-w-0 flex-1 flex-col overflow-hidden border"
    >
      <TracesRedPanelPlaceholder :title="panel.title" :meta="panel.meta" />
    </div>
  </div>
</template>
