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
  <LiveSurfaceEmpty v-if="paging.missing.value" surface="settings" @action="emit('action')" />
  <LiveNoticeState
    v-else-if="loadNotice"
    :notice="loadNotice"
    size="block"
    :busy="paging.retrying.value"
    data-test="autoobserve-live-settings-paging-notice"
    retry-test="autoobserve-live-settings-paging-retry"
    @retry="paging.retry()"
  />
  <div
    v-else-if="paging.loading.value"
    class="flex flex-col gap-2"
    aria-hidden="true"
    data-test="autoobserve-settings-paging-skeleton"
  >
    <OSkeleton animation="none" class="h-5 w-3/4" />
    <OSkeleton animation="none" class="h-4 w-1/2" />
  </div>
  <PagingSetting v-else data-test="autoobserve-live-settings-paging" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import LiveNoticeState from "./live/LiveNoticeState.vue";
import LiveSurfaceEmpty from "./live/LiveSurfaceEmpty.vue";
import PagingSetting from "./live/PagingSetting.vue";
import { pagingLoadNotice } from "./live/liveCopy";
import { usePagingSetting } from "./live/usePagingSetting";

const emit = defineEmits<{ action: [] }>();

const { t } = useI18nTyped();
const paging = usePagingSetting();

const loadNotice = computed(() =>
  paging.loadFailure.value ? pagingLoadNotice(t, paging.loadFailure.value) : null,
);
</script>
