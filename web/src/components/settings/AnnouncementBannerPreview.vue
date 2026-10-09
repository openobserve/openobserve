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
  <div class="announcement-preview-panel" data-test="announcement-editor-preview">
    <span class="announcement-preview-title">{{ t("announcements.editor.preview") }}</span>
    <div class="announcement-preview-caption" data-test="announcement-editor-preview-caption">
      {{ t("announcements.editor.previewLinksDisabled") }}
    </div>
    <div
      v-if="hidden"
      class="announcement-preview-callout"
      role="status"
      data-test="announcement-editor-preview-hidden"
    >
      <q-icon name="warning" size="1rem" />
      {{ t("announcements.editor.hiddenByCritical") }}
    </div>
    <div
      v-if="invalidColor"
      class="announcement-preview-caption"
      data-test="announcement-editor-preview-invalid-color"
    >
      {{ t("announcements.editor.colorInvalidPreview") }}
    </div>

    <div class="announcement-preview-frames">
      <div v-for="mode in THEME_MODES" :key="mode" class="announcement-preview-frame-wrap">
        <span class="announcement-preview-label">
          {{ t(`announcements.editor.${mode === "light" ? "previewLight" : "previewDark"}`) }}
        </span>
        <div
          class="announcement-preview-frame"
          :class="`announcement-preview-frame--${mode}`"
          :data-test="`announcement-editor-preview-${mode}`"
        >
          <AnnouncementBannerStrip
            :banner="banner"
            :mode="mode"
            :placeholder="t('announcements.editor.previewEmpty')"
            preview
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import AnnouncementBannerStrip from "@/components/announcements/AnnouncementBannerStrip.vue";
import { isHexColor, type ThemeMode } from "@/utils/announcementAppearance";
import type { PreviewBanner } from "./announcementDrafts";

const props = defineProps<{
  banner: PreviewBanner;
  /** A promotion that a live critical banner hides from every organization it targets. */
  hidden: boolean;
}>();

const THEME_MODES: ThemeMode[] = ["light", "dark"];

const { t } = useI18n();

const invalidColor = computed(() =>
  [props.banner.colors.light, props.banner.colors.dark].some(
    (value) => !!value && !isHexColor(value),
  ),
);
</script>

<style scoped lang="scss">
.announcement-preview-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.announcement-preview-title {
  font-size: 0.875rem;
  font-weight: 700;
}

.announcement-preview-caption {
  font-size: 0.75rem;
  opacity: 0.7;
}

.announcement-preview-callout {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}

.dark-theme .announcement-preview-callout {
  color: #fbbf24;
}

.announcement-preview-frames {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.announcement-preview-frame-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.announcement-preview-label {
  font-size: 0.75rem;
  opacity: 0.7;
}

.announcement-preview-frame {
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 0.375rem;
  overflow: hidden;
}

.announcement-preview-frame--light {
  background: #ffffff;
  color: #171717;
}

.announcement-preview-frame--dark {
  background: #1a1a1a;
  color: #e5e7eb;
}
</style>
