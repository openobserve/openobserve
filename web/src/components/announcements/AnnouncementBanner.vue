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
  <AnnouncementBannerStrip
    v-for="banner in shown"
    :key="banner.id"
    :banner="banner"
    :mode="mode"
    :draft-tag="banner.id === DRAFT_ID ? t('announcements.editor.draftTag') : ''"
    @dismiss="dismiss(banner.id)"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import { useAnnouncementBanners, type Banner } from "@/composables/useAnnouncementBanners";
import { useAnnouncementDraftPreview } from "@/composables/useAnnouncementDraftPreview";
import type { ThemeMode } from "@/utils/announcementAppearance";
import { orderBanners } from "@/utils/announcementOrder";
import AnnouncementBannerStrip from "./AnnouncementBannerStrip.vue";

const DRAFT_ID = "draft-preview";

const { t } = useI18n();
const store = useStore();
const { banners, dismiss, start, refresh } = useAnnouncementBanners();
const { draft, replaces, configVersion } = useAnnouncementDraftPreview();

const mode = computed<ThemeMode>(() => (store.state.theme === "dark" ? "dark" : "light"));

// The editor's draft takes its real place in the stack, standing in for the banner it edits.
const shown = computed<Banner[]>(() => {
  if (!draft.value) return banners.value;
  const live = banners.value.filter((banner) => banner.message !== replaces.value);
  return orderBanners([...live, { ...(draft.value as Banner), id: DRAFT_ID }]);
});

onMounted(start);
watch(configVersion, () => void refresh());
</script>
