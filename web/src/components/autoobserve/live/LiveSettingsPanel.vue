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
    :class="inPage && 'p-4'"
    data-test="autoobserve-live-settings-paging-notice"
    retry-test="autoobserve-live-settings-paging-retry"
    @retry="paging.retry()"
  />
  <div
    v-else-if="!paging.loading.value"
    class="flex flex-col gap-3 pb-8"
    :class="inPage && 'max-w-2xl p-4'"
    data-test="autoobserve-live-settings"
  >
    <DrawerSection
      :title="t('autoobserveLive.paging.title')"
      data-test="autoobserve-live-settings-paging"
    >
      <PagingSetting />
    </DrawerSection>
    <p
      class="text-text-secondary flex items-start gap-1.5 text-xs leading-relaxed"
      data-test="autoobserve-live-settings-later"
    >
      <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />
      <span>{{ t("autoobserveLive.paging.later") }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import DrawerSection from "../v2/DrawerSection.vue";
import LiveNoticeState from "./LiveNoticeState.vue";
import LiveSurfaceEmpty from "./LiveSurfaceEmpty.vue";
import { pagingLoadNotice } from "./liveCopy";
import PagingSetting from "./PagingSetting.vue";
import { usePagingSetting } from "./usePagingSetting";

defineProps<{ inPage?: boolean }>();

const emit = defineEmits<{ action: [] }>();

const { t } = useI18nTyped();
const paging = usePagingSetting();

const loadNotice = computed(() =>
  paging.loadFailure.value ? pagingLoadNotice(t, paging.loadFailure.value) : null,
);
</script>
