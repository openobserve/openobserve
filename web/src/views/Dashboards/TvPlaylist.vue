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
  <div class="bg-surface-base h-full" data-test="dashboard-tv-playlist">
    <template v-if="config">
      <PlaylistPlayer
        :key="runKey"
        :config="config"
        :hold="editOpen"
        :timezone="store.state.timezone"
        :interval-adjusted="runKey === 0 && intervalAdjusted"
        @slide="onSlide"
        @fallback="onFallback"
        @edit="openEdit"
        @exit="exit"
      />
      <PlaylistDialog
        v-model:open="editOpen"
        mode="edit"
        :entries="editEntries"
        :settings="config"
        :timezone="config.timezone"
        @open="applyEdit"
      />
    </template>
    <div v-else class="flex h-full items-center justify-center" data-test="dashboard-tv-invalid">
      <OEmptyState
        icon="tv"
        :title="t('dashboard.playlist.invalidTitle')"
        :description="t('dashboard.playlist.invalidDescription')"
        :action-label="t('dashboard.playlist.backToDashboards')"
        @action="exit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import PlaylistPlayer from "@/components/dashboards/kiosk/PlaylistPlayer.vue";
import PlaylistDialog from "@/components/dashboards/kiosk/PlaylistDialog.vue";
import { applyKioskTheme, clearKioskTheme } from "@/composables/dashboard/useKioskDisplay";
import { useI18nTyped } from "@/types/i18n";
import { parseKioskTheme } from "@/utils/dashboard/kiosk";
import {
  PLAYLIST_VIEW_PATH,
  buildPlaylistQuery,
  buildSlideQuery,
  isPlaylistIntervalAdjusted,
  parsePlaylistQuery,
  type PlaylistConfig,
  type PlaylistDialogEntry,
} from "@/utils/dashboard/playlist";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const parsed = parsePlaylistQuery(route.query);
const config = shallowRef<PlaylistConfig | null>(
  parsed ? { ...parsed, org: parsed.org || store.state.selectedOrganization?.identifier } : null,
);
const runKey = ref(0);
const intervalAdjusted = isPlaylistIntervalAdjusted(route.query.interval);
const editOpen = ref(false);
const editEntries = ref<PlaylistDialogEntry[]>([]);

// Set before the first render so the app chrome never flashes on a TV.
if (config.value) {
  store.dispatch("setKioskMode", true);
  applyKioskTheme(store, parseKioskTheme(config.value.theme));
}

const replaceQuery = (next: PlaylistConfig) =>
  router.replace({ path: route.path, query: buildPlaylistQuery(next) });

// Kept in the URL so a reload or a reboot resumes on the same slide.
const onSlide = (index: number) => {
  if (config.value) void replaceQuery({ ...config.value, slideIndex: index });
};

const onFallback = (index: number) => {
  if (!config.value) return;
  const href = router.resolve({
    path: PLAYLIST_VIEW_PATH,
    query: buildSlideQuery(config.value, index, "page"),
  }).href;
  window.location.replace(window.location.origin + href);
};

const openEdit = (titles: (string | null)[]) => {
  if (!config.value) return;
  editEntries.value = config.value.entries.map((entry, i) => ({
    ...entry,
    title: titles[i] ?? null,
  }));
  editOpen.value = true;
};

const applyEdit = (next: PlaylistConfig) => {
  config.value = { ...next, timezone: config.value?.timezone ?? next.timezone };
  applyKioskTheme(store, parseKioskTheme(next.theme));
  runKey.value++;
  void replaceQuery(config.value);
};

const exit = () => {
  router.replace({
    path: "/dashboards",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};

onBeforeUnmount(() => {
  if (store.state.kioskMode) store.dispatch("setKioskMode", false);
  clearKioskTheme(store);
});
</script>
