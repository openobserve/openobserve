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
    <div
      v-if="isDowntime(banner) && banner.ends_at != null"
      class="flex items-center gap-3 max-sm:flex-col max-sm:items-start max-sm:gap-0.5"
      :data-test="`announcement-banner-body-${banner.id}`"
    >
      <span class="min-w-0 flex-1">{{ banner.message }}</span>
      <DowntimeCountdown
        class="shrink-0"
        :ends-at="banner.ends_at"
        :now="serverNowMs"
        :first="bannerRowCount(banner.id) > 1"
        :data-test="`announcement-banner-countdown-${banner.id}`"
      />
    </div>

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

    <template v-if="banner.ctas.length || banner.dismissible" #actions>
      <div class="flex flex-wrap items-center gap-3">
        <template v-for="(cta, position) in banner.ctas" :key="position">
          <OButton
            v-if="isInApp(cta.url)"
            variant="banner-dismiss"
            size="sm"
            class="text-[length:inherit]!"
            :data-test="`announcement-banner-cta-${banner.id}-${position}`"
            @click="openInApp(cta.url)"
          >
            {{ cta.text }}
          </OButton>
          <OButton
            v-else
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
        </template>

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
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { useAnnouncementBanners, type Banner } from "@/composables/useAnnouncementBanners";
import { useTheme } from "@/composables/useTheme";
import OTag from "@/lib/core/Badge/OTag.vue";
import { bannerRowCount, countChipLabel } from "@/utils/downtimes/banner";
import DowntimeCountdown from "@/components/alerts/downtimes/DowntimeCountdown.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import AnnouncementBar from "./AnnouncementBar.vue";

const IN_APP_PREFIX = "/web/";

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const { isDark } = useTheme();
const { banners, dismiss, start, serverNowMs } = useAnnouncementBanners();

// Generated per org and per window by the announcements endpoint (D19).
const isDowntime = (banner: Banner) => banner.id.startsWith("downtime:");

// A link into this app opens in place on the current org; anything else is external.
const isInApp = (url: string) => url.startsWith(IN_APP_PREFIX);

const openInApp = (url: string) => {
  const parsed = new URL(url, window.location.origin);
  void router.push({
    path: parsed.pathname.slice(IN_APP_PREFIX.length - 1),
    query: {
      ...Object.fromEntries(parsed.searchParams),
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
};

onMounted(start);
</script>
