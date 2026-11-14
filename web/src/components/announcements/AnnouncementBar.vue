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
  <OBanner
    :tone="customColors ? 'neutral' : bannerTone(variant)"
    :icon="bannerIcon(variant, icon)"
    :style="customColors"
    :data-test="dataTest"
  >
    <div :class="TEXT_SIZE_CLASS[textSize ?? DEFAULT_TEXT_SIZE]">
      <slot>
        <!-- eslint-disable-next-line vue/no-v-html -- renderBannerMessage sanitizes to inline emphasis and http(s) links -->
        <span class="announcement-message" v-html="html" />
      </slot>
      <div v-if="$slots.footer" class="mt-1">
        <slot name="footer" />
      </div>
    </div>

    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
    <template v-else-if="inertActions?.links.length || inertActions?.dismissible" #actions>
      <div class="flex flex-wrap items-center gap-3 font-bold underline" aria-hidden="true">
        <span v-for="(link, position) in inertActions.links" :key="position">{{ raw(link) }}</span>
        <span v-if="inertActions.dismissible">{{ t("announcements.dismiss") }}</span>
      </div>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  DEFAULT_TEXT_SIZE,
  bannerColorsFor,
  bannerIcon,
  bannerTone,
  type BannerColors,
  type BannerTextSize,
  type BannerThemeMode,
} from "@/utils/announcementAppearance";
import { renderBannerMessage } from "@/utils/announcementMarkdown";

const props = defineProps<{
  /** Operator-authored limited markdown. */
  message: string;
  variant?: string;
  textSize?: BannerTextSize;
  colors?: BannerColors;
  icon?: string;
  /** Which of the authored colours to paint; the live bar passes the app's current mode. */
  mode: BannerThemeMode;
  /** Draws the button text and Dismiss as they will appear, without making them clickable. */
  inertActions?: { links: string[]; dismissible: boolean };
  dataTest?: string;
}>();

const { t } = useI18nTyped();

const TEXT_SIZE_CLASS: Record<BannerTextSize, string> = {
  small: "text-xs",
  medium: "text-compact",
  large: "text-base",
};

// Operator-chosen colours are data, so they repaint the neutral tone's tokens on this banner only.
const customColors = computed(() => {
  const colors = bannerColorsFor(props.colors, props.mode);
  return colors
    ? {
        "--color-banner-default-bg": colors.background,
        "--color-banner-default-text": colors.text,
      }
    : undefined;
});

const html = computed(() => renderBannerMessage(props.message));
</script>
