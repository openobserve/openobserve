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
    v-for="banner in banners"
    :key="banner.id"
    :banner="banner"
    :mode="mode"
    @dismiss="dismiss(banner.id)"
  />
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useStore } from "vuex";

import { useAnnouncementBanners } from "@/composables/useAnnouncementBanners";
import type { ThemeMode } from "@/utils/announcementAppearance";
import AnnouncementBannerStrip from "./AnnouncementBannerStrip.vue";

const store = useStore();
const { banners, dismiss, start } = useAnnouncementBanners();

const mode = computed<ThemeMode>(() => (store.state.theme === "dark" ? "dark" : "light"));

onMounted(start);
</script>
