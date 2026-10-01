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
    v-for="banner in banners"
    :key="banner.id"
    bar
    :variant="bannerVariant(banner)"
    :icon="bannerIcon(banner)"
    :data-test="`announcement-banner-${banner.variant}`"
  >
    {{ banner.message }}

    <template v-if="isDowntime(banner) && banner.remaining_secs !== null" #meta>
      <span
        class="text-xs font-medium whitespace-nowrap tabular-nums"
        :data-test="`announcement-banner-countdown-${banner.id}`"
      >
        {{ countdownText(banner.remaining_secs, t) }}
      </span>
    </template>

    <template v-if="banner.counts?.length" #footer>
      <div class="flex flex-wrap gap-1" :data-test="`announcement-banner-counts-${banner.id}`">
        <OTag
          v-for="c in banner.counts"
          :key="c.module"
          type="downtimeTarget"
          :value="c.module"
          :label="countChipLabel(c, t)"
        />
      </div>
    </template>

    <template v-if="banner.cta || banner.dismissible" #actions>
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
  </OBanner>
</template>

<script setup lang="ts">
import { onMounted } from "vue";

import {
  useAnnouncementBanners,
  type Banner,
  type RenderedBanner,
} from "@/composables/useAnnouncementBanners";
import OTag from "@/lib/core/Badge/OTag.vue";
import { countChipLabel, countdownText } from "@/utils/downtimes/banner";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const { banners, dismiss, start } = useAnnouncementBanners();

// Generated per org and per window by the announcements endpoint (D19).
const isDowntime = (banner: RenderedBanner) => banner.id.startsWith("downtime:");

/** Our severities are operator-facing; OBanner's variants are visual. */
const bannerVariant = (banner: Banner) => {
  switch (banner.variant) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default:
      return "default";
  }
};

const bannerIcon = (banner: Banner) => {
  switch (banner.variant) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "promo":
      return "campaign";
    default:
      return "info";
  }
};

onMounted(start);
</script>
