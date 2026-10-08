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
    v-for="banner in shown"
    :key="banner.id"
    :variant="banner.variant"
    :text-size="banner.text_size"
    :colors="banner.colors"
    :mode="isDark ? 'dark' : 'light'"
    :message="banner.message"
    :data-test="
      banner.id === DRAFT_ID
        ? 'announcement-banner-draft-preview'
        : `announcement-banner-${banner.variant}`
    "
  >
    <template v-if="banner.id === DRAFT_ID" #actions>
      <div class="flex flex-wrap items-center gap-3">
        <span class="rounded-default border border-current px-1.5 text-xs font-semibold">
          {{ t("announcements.preview.draftTag") }}
        </span>
        <span v-if="banner.cta" class="font-bold underline" aria-hidden="true">
          {{ banner.cta.text }}
        </span>
      </div>
    </template>
    <template v-else-if="banner.cta || banner.dismissible" #actions>
      <div class="flex flex-wrap items-center gap-3">
        <OButton
          v-if="banner.cta"
          as="a"
          :href="banner.cta.url"
          target="_blank"
          rel="noopener noreferrer"
          variant="banner-dismiss"
          size="sm"
          :data-test="`announcement-banner-cta-${banner.id}`"
        >
          {{ banner.cta.text }}
        </OButton>

        <OButton
          v-if="banner.dismissible"
          variant="banner-dismiss"
          size="sm"
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
import { computed, onMounted, watch } from "vue";

import { useAnnouncementBanners, type Banner } from "@/composables/useAnnouncementBanners";
import { useAnnouncementDraftPreview } from "@/composables/useAnnouncementDraftPreview";
import { useTheme } from "@/composables/useTheme";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import { orderBanners } from "@/utils/announcementOrder";
import AnnouncementBar from "./AnnouncementBar.vue";

const { t } = useI18nTyped();
const { isDark } = useTheme();
const { banners, dismiss, start, refresh } = useAnnouncementBanners();
const { draft, replaces, configVersion } = useAnnouncementDraftPreview();

const DRAFT_ID = "draft-preview";

// The editor's draft takes its real place in the stack, standing in for the banner it edits.
const shown = computed<Banner[]>(() => {
  if (!draft.value) return banners.value;
  const live = banners.value.filter((banner) => banner.message !== replaces.value);
  return orderBanners([...live, { ...(draft.value as Banner), id: DRAFT_ID }]);
});

onMounted(start);
watch(configVersion, () => void refresh());
</script>
