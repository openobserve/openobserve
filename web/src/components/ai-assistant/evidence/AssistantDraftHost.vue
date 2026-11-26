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
  <AddToDashboard
    v-if="draft"
    :open="true"
    :dashboard-panel-data="panelData"
    data-test="assistant-dashboard-draft"
    @update:open="(open: boolean) => !open && close()"
    @save="onSave"
  />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useStore } from "vuex";

import { assistantDashboardDraft, clearDashboardDraft } from "@/composables/assistant";
import { getDefaultDashboardPanelData } from "@/composables/dashboard/useDashboardPanelDefaults";
import { trackAssistant } from "@/services/assistantAnalytics";
import { streamTypeOf } from "@/utils/assistant/explorerRoutes";

// The picker is the dashboards module's own; it loads only when a draft asks for it.
const AddToDashboard = defineAsyncComponent(() => import("@/plugins/metrics/AddToDashboard.vue"));

const store = useStore();

const draft = computed(() => assistantDashboardDraft.value);

// A table of the SQL's own columns, or a line of the PromQL: the query is kept verbatim.
const panelData = computed(() => {
  const query = draft.value?.query;
  const base = getDefaultDashboardPanelData(store);
  if (!query) return base;
  const promql = query.language === "promql";
  const slot = base.data.queries[0];
  return {
    ...base,
    data: {
      ...base.data,
      type: promql ? "line" : "table",
      queryType: promql ? "promql" : "sql",
      queries: [
        {
          ...slot,
          query: query.text,
          customQuery: true,
          fields: {
            ...slot.fields,
            stream: query.stream ?? "",
            stream_type: streamTypeOf(query.streamType) ?? (promql ? "metrics" : "logs"),
          },
        },
      ],
    },
  };
});

function close(): void {
  clearDashboardDraft();
}

function onSave(): void {
  const origin = draft.value?.originTurnId;
  if (origin)
    trackAssistant("ai_downstream_saved", { object: "dashboard", origin_turn_id: origin });
  close();
}
</script>
