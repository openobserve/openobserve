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
  <RecentSearchesDrawer ref="drawerRef" v-model:open="open" source="metrics" @restore="restore" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useOrgId } from "@/composables/query/useOrgId";
import type { HistoryStatus, QueryHistoryEntry } from "@/services/query_history";
import type { SelectedDate } from "@/utils/dashboard/urlTimeParams";
import { metricsRestore } from "@/utils/queryHistory/metrics";
import { openRecentOnItsPage } from "@/utils/queryHistory/routes";
import type { RestoreTime } from "@/utils/queryHistory/recentSearches";
import RecentSearchesDrawer from "@/components/queryHistory/RecentSearchesDrawer.vue";

const emit = defineEmits<{
  load: [entry: { metricsData: string; timeRange: SelectedDate; run: boolean }];
}>();

const open = defineModel<boolean>("open", { default: false });

const router = useRouter();
const orgId = useOrgId();
const drawerRef = ref<InstanceType<typeof RecentSearchesDrawer> | null>(null);

/** Applies a row here, or opens another page's row on that page. */
const restore = (entry: QueryHistoryEntry, when: RestoreTime, run: boolean) => {
  if (entry.source !== "metrics") {
    void openRecentOnItsPage(router, entry, when, orgId.value, run);
    return;
  }
  const loaded = metricsRestore(entry, when);
  if (loaded) emit("load", { ...loaded, run });
};

const show = (status: HistoryStatus | null = null) => drawerRef.value?.show(status);

defineExpose({ show, restore });
</script>
