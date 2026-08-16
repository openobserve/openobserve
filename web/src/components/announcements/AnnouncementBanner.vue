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
  <div
    v-for="banner in banners"
    :key="banner.id"
    class="announcement-bar"
    :class="`announcement-bar--${banner.variant}`"
    role="status"
    :data-test="`announcement-banner-${banner.variant}`"
  >
    <div class="announcement-bar-content">
      <q-icon :name="bannerIcon(banner)" size="16px" class="announcement-bar-icon" />

      <!-- Operator-authored copy is interpolated as plain text: stored config
           must never be able to become stored markup. -->
      <span class="announcement-bar-text">{{ banner.message }}</span>

      <a
        v-if="banner.cta"
        :href="banner.cta.url"
        target="_blank"
        rel="noopener noreferrer"
        class="announcement-bar-link"
        :data-test="`announcement-banner-cta-${banner.id}`"
      >
        {{ banner.cta.text }}
      </a>

      <span
        v-if="banner.cta && banner.dismissible"
        class="announcement-bar-sep"
        aria-hidden="true"
      >
        |
      </span>

      <button
        v-if="banner.dismissible"
        class="announcement-bar-link announcement-bar-dismiss"
        :aria-label="t('announcements.dismissAriaLabel')"
        :data-test="`announcement-banner-dismiss-${banner.id}`"
        @click="dismiss(banner.id)"
      >
        {{ t("announcements.dismiss") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";

import { useAnnouncementBanners, type Banner } from "@/composables/useAnnouncementBanners";

const { t } = useI18n();
const { banners, dismiss, start } = useAnnouncementBanners();

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

<style scoped lang="scss">
/* A full-bleed strip rather than an inset card: this spans the viewport above
   the toolbar, where soft corners and a 1px box would read as floating debris. */
.announcement-bar {
  width: 100%;
}

.announcement-bar-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.2rem 1rem;
  flex-wrap: wrap;
}

.announcement-bar-icon {
  flex-shrink: 0;
}

.announcement-bar-text {
  font-size: 0.8125rem;
  font-weight: 600;
  text-align: center;
}

.announcement-bar-sep {
  opacity: 0.6;
  font-weight: 400;
  user-select: none;
}

.announcement-bar-link {
  font-size: 0.8125rem;
  font-weight: 700;
  /* Inherits the bar's own text colour so it reads on every variant. */
  color: inherit;
  text-decoration: underline;
  white-space: nowrap;

  &:hover {
    opacity: 0.8;
  }
}

.announcement-bar-dismiss {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

/* Severity fills. Fixed rather than themed: an outage notice has to look the
   same whichever theme the viewer happens to be on. */
.announcement-bar--critical {
  background: #dc2626;
  color: #ffffff;
}

.announcement-bar--warning {
  background: #fbbf24;
  color: #1a1a1a;
}

.announcement-bar--info {
  background: #2563eb;
  color: #ffffff;
}

.announcement-bar--promo {
  background: #7c3aed;
  color: #ffffff;
}
</style>
