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
        :config="config"
        :timezone="store.state.timezone"
        :interval-adjusted="intervalAdjusted"
        @slide="onSlide"
        @fallback="onFallback"
        @exit="exit"
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
import { onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import PlaylistPlayer from "@/components/dashboards/kiosk/PlaylistPlayer.vue";
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
} from "@/utils/dashboard/playlist";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const parsed = parsePlaylistQuery(route.query);
const config: PlaylistConfig | null = parsed
  ? { ...parsed, org: parsed.org || store.state.selectedOrganization?.identifier }
  : null;
const intervalAdjusted = isPlaylistIntervalAdjusted(route.query.interval);

// Set before the first render so the app chrome never flashes on a TV.
if (config) {
  store.dispatch("setKioskMode", true);
  applyKioskTheme(store, parseKioskTheme(config.theme));
}

const replaceQuery = (next: PlaylistConfig) =>
  router.replace({ path: route.path, query: buildPlaylistQuery(next) });

// Kept in the URL so a reload or a reboot resumes on the same slide.
const onSlide = (index: number) => {
  if (config) void replaceQuery({ ...config, slideIndex: index });
};

const onFallback = (index: number) => {
  if (!config) return;
  const href = router.resolve({
    path: PLAYLIST_VIEW_PATH,
    query: buildSlideQuery(config, index, "page"),
  }).href;
  window.location.replace(window.location.origin + href);
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
