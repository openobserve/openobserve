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
  <AnnouncementBar
    v-for="banner in banners"
    :key="banner.id"
    :variant="banner.variant"
    :text-size="banner.text_size"
    :colors="banner.colors"
    :icon="banner.icon"
    :mode="isDark ? 'dark' : 'light'"
    :message="banner.message"
    :data-test="`announcement-banner-${banner.variant}`"
  >
    <template v-if="banner.ctas.length || banner.dismissible" #actions>
      <div class="flex flex-wrap items-center gap-3">
        <OButton
          v-for="(cta, position) in banner.ctas"
          :key="position"
          as="a"
          :href="cta.url"
          target="_blank"
          rel="noopener noreferrer"
          variant="banner-dismiss"
          size="sm"
          class="text-[length:inherit]!"
          :data-test="`announcement-banner-cta-${banner.id}-${position}`"
        >
          {{ cta.text }}
        </OButton>

        <OButton
          v-if="banner.dismissible"
          variant="banner-dismiss"
          size="sm"
          class="text-[length:inherit]!"
          :aria-label="t('announcements.dismissAriaLabel')"
          :data-test="`announcement-banner-dismiss-${banner.id}`"
          @click="dismiss(banner.id)"
        >
          {{ t("announcements.dismiss") }}
        </OButton>
      </div>
    </template>
  </AnnouncementBar>
</template>

<script setup lang="ts">
import { onMounted } from "vue";

import { useAnnouncementBanners } from "@/composables/useAnnouncementBanners";
import { useTheme } from "@/composables/useTheme";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import AnnouncementBar from "./AnnouncementBar.vue";

const { t } = useI18nTyped();
const { isDark } = useTheme();
const { banners, dismiss, start } = useAnnouncementBanners();

onMounted(start);
</script>
