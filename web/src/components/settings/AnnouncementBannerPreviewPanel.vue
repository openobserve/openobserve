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
  <div class="flex flex-col gap-4" :data-test="dataTest">
    <span class="text-text-heading text-sm font-semibold">
      {{ t("announcements.preview.title") }}
    </span>

    <OBanner
      v-if="hidden"
      variant="warning"
      icon="visibility-off"
      dense
      :data-test="`${dataTest}-hidden`"
    >
      {{ t("announcements.preview.hiddenByCritical") }}
    </OBanner>

    <div v-for="mode in MODES" :key="mode" class="flex flex-col gap-1.5">
      <span class="text-text-secondary text-xs">
        {{ mode === "light" ? t("announcements.preview.light") : t("announcements.preview.dark") }}
      </span>
      <!-- data-banner-theme re-declares the light banner tokens, so a light frame stays light in a dark app. -->
      <div
        :class="[
          mode === 'dark' ? 'dark' : '',
          'rounded-surface border-border-default overflow-hidden border',
        ]"
        :data-banner-theme="mode"
        :data-test="`${dataTest}-${mode}`"
      >
        <AnnouncementBar
          :message="banner.message.trim() || `_${t('announcements.preview.empty')}_`"
          :variant="banner.variant"
          :text-size="banner.textSize"
          :colors="{ light: banner.colorLight, dark: banner.colorDark }"
          :icon="banner.icon"
          :mode="mode"
          :inert-actions="{ ctaText: banner.ctaText, dismissible: banner.dismissible }"
        />
      </div>
    </div>

    <span class="text-text-secondary text-xs" :data-test="`${dataTest}-caption`">
      {{ t("announcements.preview.caption") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import AnnouncementBar from "@/components/announcements/AnnouncementBar.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";
import type { BannerThemeMode } from "@/utils/announcementAppearance";
import type { BannerDraft } from "./announcementDrafts";

/** The fields a preview frame paints. */
export type PreviewBanner = Pick<
  BannerDraft,
  | "message"
  | "variant"
  | "textSize"
  | "colorLight"
  | "colorDark"
  | "icon"
  | "ctaText"
  | "dismissible"
>;

defineProps<{
  banner: PreviewBanner;
  /** A promotion that a live critical banner hides from every organization it targets. */
  hidden: boolean;
  dataTest: string;
}>();

const MODES: BannerThemeMode[] = ["light", "dark"];

const { t } = useI18nTyped();
</script>
