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
    class="announcement-bar"
    :class="[
      `announcement-bar--text-${textSize}`,
      colorVars ? 'announcement-bar--custom' : `announcement-bar--${variant}`,
      { 'announcement-bar--preview': preview },
    ]"
    :style="colorVars"
    :role="preview ? undefined : 'status'"
    :data-test="testId"
  >
    <div class="announcement-bar-content">
      <span class="announcement-bar-text">
        <q-icon :name="icon" size="1.15em" class="announcement-bar-icon" />
        <span v-if="messageHtml" data-test="announcement-bar-message" v-html="messageHtml" />
        <span
          v-else-if="placeholder"
          class="announcement-bar-placeholder"
          data-test="announcement-bar-placeholder"
        >
          {{ placeholder }}
        </span>
      </span>

      <span v-if="links.length || dismissible" class="announcement-bar-actions">
        <template v-for="(link, position) in links" :key="position">
          <span v-if="position" class="announcement-bar-sep" aria-hidden="true">|</span>
          <component
            :is="preview ? 'span' : 'a'"
            v-bind="linkAttrs(link, position)"
            class="announcement-bar-link"
          >
            {{ link.text }}
          </component>
        </template>

        <span v-if="links.length && dismissible" class="announcement-bar-sep" aria-hidden="true">
          |
        </span>

        <span v-if="dismissible && preview" class="announcement-bar-link">
          {{ t("announcements.dismiss") }}
        </span>
        <button
          v-else-if="dismissible"
          type="button"
          class="announcement-bar-link announcement-bar-dismiss"
          :aria-label="t('announcements.dismissAriaLabel')"
          :data-test="`announcement-banner-dismiss-${banner.id}`"
          @click="emit('dismiss')"
        >
          {{ t("announcements.dismiss") }}
        </button>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import {
  DEFAULT_TEXT_SIZE,
  bannerColorVars,
  isBannerIcon,
  isTextSize,
  materialIconName,
  type BannerColors,
  type ThemeMode,
} from "@/utils/announcementAppearance";
import { renderBannerMarkdown } from "@/utils/announcementMarkdown";

/** The fields a strip renders; both the wire banner and an authored one fit. */
interface StripBanner {
  id?: string;
  message: string;
  variant?: string;
  dismissible?: boolean;
  cta?: { text: string; url: string } | null;
  ctas?: { text: string; url: string }[] | null;
  text_size?: string;
  colors?: BannerColors | null;
  icon?: string | null;
}

const props = withDefaults(
  defineProps<{
    banner: StripBanner;
    mode: ThemeMode;
    preview?: boolean;
    placeholder?: string;
  }>(),
  { preview: false, placeholder: "" },
);

const emit = defineEmits<{ (_e: "dismiss"): void }>();

const { t } = useI18n();

const variant = computed(() => props.banner.variant ?? "info");

const textSize = computed(() =>
  isTextSize(props.banner.text_size) ? props.banner.text_size : DEFAULT_TEXT_SIZE,
);

// Authored config leaves `dismissible` out when it is the default.
const dismissible = computed(() => props.banner.dismissible !== false);

const colorVars = computed(() => bannerColorVars(props.banner.colors, props.mode));

const testId = computed(() => {
  return props.preview
    ? `announcement-preview-bar-${variant.value}`
    : `announcement-banner-${variant.value}`;
});

const messageHtml = computed(() => renderBannerMarkdown(props.banner.message));

// Older servers send only the single `cta`; newer ones send `ctas`, whose first entry it mirrors.
const links = computed(() => props.banner.ctas ?? (props.banner.cta ? [props.banner.cta] : []));

const linkAttrs = (link: { url: string }, position: number) =>
  props.preview
    ? {}
    : {
        href: link.url,
        target: "_blank",
        rel: "noopener noreferrer",
        "data-test": `announcement-banner-cta-${props.banner.id}-${position}`,
      };

const icon = computed(() => {
  if (isBannerIcon(props.banner.icon)) return materialIconName(props.banner.icon);
  switch (variant.value) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "promo":
      return "campaign";
    default:
      return "info";
  }
});
</script>

<style scoped lang="scss">
.announcement-bar {
  width: 100%;
}

.announcement-bar--text-small {
  font-size: 0.8125rem;
}

.announcement-bar--text-medium {
  font-size: 0.875rem;
}

.announcement-bar--text-large {
  font-size: 1rem;
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
  margin-right: 0.375rem;
  vertical-align: -0.2em;
}

.announcement-bar-text {
  flex: 0 1 auto;
  min-width: min(16rem, 100%);
  font-weight: 600;
  text-align: center;
  overflow-wrap: anywhere;
}

.announcement-bar-placeholder {
  font-style: italic;
  font-weight: 400;
  opacity: 0.75;
}

.announcement-bar-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  white-space: nowrap;
}

.announcement-bar-text :deep(a) {
  color: inherit;
  text-decoration: underline;
}

.announcement-bar-text :deep(code) {
  padding: 0 0.25em;
  border-radius: 0.25rem;
  background: rgba(0, 0, 0, 0.15);
  font-size: 0.9em;
}

.announcement-bar--preview :deep(a),
.announcement-bar[data-test="announcement-banner-draft-preview"] :deep(a) {
  pointer-events: none;
}

.announcement-bar-sep {
  opacity: 0.6;
  font-weight: 400;
  user-select: none;
}

.announcement-bar-link {
  font-size: inherit;
  font-weight: 700;
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

.announcement-bar--custom {
  background: var(--announcement-bg);
  color: var(--announcement-fg);
}

/* Fixed rather than themed: an outage notice has to look the same on either theme. */
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
