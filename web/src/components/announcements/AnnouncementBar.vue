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
    bar
    :variant="bannerVariant(variant)"
    :icon="bannerIcon(variant, icon)"
    :text-size="textSize ?? DEFAULT_TEXT_SIZE"
    :colors="bannerColorsFor(colors, mode)"
    :data-test="dataTest"
  >
    <!-- eslint-disable-next-line vue/no-v-html -- renderBannerMessage sanitizes to inline emphasis and http(s) links -->
    <span class="announcement-message" v-html="html" />

    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
    <template v-else-if="inertActions?.ctaText || inertActions?.dismissible" #actions>
      <div class="flex flex-wrap items-center gap-3 font-bold underline" aria-hidden="true">
        <span v-if="inertActions.ctaText">{{ raw(inertActions.ctaText) }}</span>
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
  bannerVariant,
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
  inertActions?: { ctaText: string; dismissible: boolean };
  dataTest?: string;
}>();

const { t } = useI18nTyped();

const html = computed(() => renderBannerMessage(props.message));
</script>
