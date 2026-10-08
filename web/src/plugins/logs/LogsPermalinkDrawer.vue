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

<!-- The shared line's drawer while the results grid is not mounted (errored, guard-blocked or unsent first search, 4c C5 step 5). -->
<template>
  <ODrawer
    bleed
    lazy
    data-test="logs-permalink-detail-dialog"
    :open="open"
    :width="85"
    :title="t('search.rowDetail')"
    @update:open="onOpenChange"
  >
    <DetailTable
      v-if="record"
      :model-value="record"
      :stream-type="searchObj.data.stream.streamType"
      :current-index="-1"
      :total-length="0"
      :nav-disabled-reason="searchObj.loading ? 'loading' : 'notInPage'"
      :highlight-query="searchObj.data.highlightQuery"
      class="rounded-default"
      @add:searchterm="onAddSearchTerm"
      @search:timeboxed="onSearchAround"
      @close="clearPermalink"
      @closeTable="clearPermalink"
      @view-trace="onViewTrace"
      @sendToAiChat="onSendToAiChat"
    />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import DetailTable from "@/plugins/logs/DetailTable.vue";
import { searchState } from "@/composables/useLogs/searchState";
import { traceDetailsLocation } from "@/composables/useLogs/useViewTraceAction";
import {
  clearPermalink,
  searchResultMounts,
  sharedLineRecord,
} from "@/composables/useLogs/useLogPermalink";

const emit = defineEmits<{
  "search-around": [params: { key: unknown; size: number; body: Record<string, unknown> }];
  "add-search-term": [field: string | number, value: string | number | boolean, action: string];
  "send-to-ai-chat": [value: unknown, append?: boolean];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const { searchObj } = searchState();

const record = computed(() => sharedLineRecord.value);
const open = computed(() => !!record.value && searchResultMounts.value === 0);

const onOpenChange = (value: boolean) => {
  if (!value) clearPermalink();
};

const onAddSearchTerm = (
  field: string | number,
  value: string | number | boolean,
  action: string,
) => emit("add-search-term", field, value, action);

const onSearchAround = (params: { key: unknown; size: number; body: Record<string, unknown> }) => {
  clearPermalink();
  emit("search-around", params);
};

const onViewTrace = () => {
  if (!record.value) return;
  router.push(traceDetailsLocation(record.value, store.state, searchObj.meta.selectedTraceStream));
};

const onSendToAiChat = (value: unknown, append?: boolean) => emit("send-to-ai-chat", value, append);
</script>
