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
    <div class="announcement-preview-controls">
      <span class="announcement-preview-title">{{ t("announcements.editor.preview") }}</span>
      <q-btn-toggle
        v-model="width"
        class="announcement-preview-toggle"
        toggle-color="primary"
        no-caps
        unelevated
        :options="widthOptions"
        data-test="announcement-editor-preview-width"
      />
    </div>
    <div class="announcement-preview-switches">
      <q-toggle
        v-model="inApp"
        class="announcement-preview-switch"
        :label="t('announcements.editor.inApp')"
        data-test="announcement-editor-preview-in-app"
      />
      <q-toggle
        v-if="others.length"
        v-model="withOthers"
        class="announcement-preview-switch"
        :label="t('announcements.editor.withOthers')"
        data-test="announcement-editor-preview-with-others"
      />
    </div>
    <div class="announcement-preview-caption" data-test="announcement-editor-preview-caption">
      {{
        inApp
          ? t("announcements.editor.inAppCaption")
          : t("announcements.editor.previewLinksDisabled")
      }}
    </div>
    <div
      v-if="hiddenByCritical"
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

    <div ref="paneRef" class="announcement-preview-frames">
      <div v-for="mode in THEME_MODES" :key="mode" class="announcement-preview-frame-wrap">
        <span class="announcement-preview-label">
          {{ t(`announcements.editor.${mode === "light" ? "previewLight" : "previewDark"}`) }}
        </span>
        <div class="announcement-preview-viewport" :style="viewportStyle(mode)">
          <div
            :ref="(el) => (innerRefs[mode] = el as HTMLElement | null)"
            class="announcement-preview-frame"
            :class="`announcement-preview-frame--${mode}`"
            :style="frameStyle"
            :data-test="`announcement-editor-preview-${mode}`"
          >
            <div
              v-for="(entry, position) in stack"
              :key="position"
              :class="{
                'announcement-preview-edited': entry.edited && withOthers,
                'announcement-preview-dimmed': entry.edited && hiddenByCritical,
              }"
              :data-test="entry.edited ? `announcement-editor-preview-${mode}-edited` : undefined"
            >
              <AnnouncementBannerStrip
                :banner="entry.banner"
                :mode="mode"
                :placeholder="entry.edited ? t('announcements.editor.previewEmpty') : ''"
                preview
              />
            </div>
            <div class="announcement-preview-topbar" aria-hidden="true">
              <span class="announcement-preview-logo" />
              <span class="announcement-preview-nav" />
              <span class="announcement-preview-nav" />
              <span class="announcement-preview-avatar" />
            </div>
            <div class="announcement-preview-body" aria-hidden="true">
              <span class="announcement-preview-line" />
              <span class="announcement-preview-line announcement-preview-line--short" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import AnnouncementBannerStrip from "@/components/announcements/AnnouncementBannerStrip.vue";
import { isHexColor, type ThemeMode } from "@/utils/announcementAppearance";
import { orderBanners } from "@/utils/announcementOrder";
import type { PreviewBanner } from "./announcementDrafts";

const props = defineProps<{ banner: PreviewBanner; others: PreviewBanner[] }>();

const THEME_MODES: ThemeMode[] = ["light", "dark"];

const MOBILE_WIDTH_PX = 375;

const { t } = useI18n();

const inApp = defineModel<boolean>("inApp", { default: true });

const width = ref<"panel" | "mobile">("panel");
const withOthers = ref(props.others.length > 0);
const paneRef = ref<HTMLElement | null>(null);
const paneWidth = ref(0);
const innerRefs = reactive<Record<ThemeMode, HTMLElement | null>>({ light: null, dark: null });
const innerHeights = reactive<Record<ThemeMode, number>>({ light: 0, dark: 0 });
let observer: ResizeObserver | null = null;

const widthOptions = computed(() => [
  {
    label: t("announcements.editor.fitPanel"),
    value: "panel",
    attrs: { "data-test": "announcement-editor-preview-panel" },
  },
  {
    label: t("announcements.editor.mobile"),
    value: "mobile",
    attrs: { "data-test": "announcement-editor-preview-mobile" },
  },
]);

const edited = computed(() => ({
  banner: props.banner,
  edited: true,
  variant: props.banner.variant,
}));

const fullStack = computed(() =>
  orderBanners([
    ...props.others.map((banner) => ({ banner, edited: false, variant: banner.variant })),
    edited.value,
  ]),
);

const hiddenByCritical = computed(
  () => withOthers.value && !fullStack.value.some((entry) => entry.edited),
);

// A banner the real stack would hide is still drawn, dimmed, so the author can see what they are editing.
const stack = computed(() => {
  if (!withOthers.value) return [edited.value];
  return hiddenByCritical.value ? [...fullStack.value, edited.value] : fullStack.value;
});

const invalidColor = computed(() =>
  [props.banner.colors.light, props.banner.colors.dark].some(
    (value) => !!value && !isHexColor(value),
  ),
);

// A phone frame keeps its real width and is scaled down only when the pane is narrower.
const scale = computed(() =>
  width.value === "mobile" && paneWidth.value ? Math.min(1, paneWidth.value / MOBILE_WIDTH_PX) : 1,
);

const frameStyle = computed(() => ({
  "--frame-width": width.value === "mobile" ? `${MOBILE_WIDTH_PX}px` : "100%",
  "--frame-scale": String(scale.value),
}));

const viewportStyle = (mode: ThemeMode) =>
  width.value === "mobile" && scale.value < 1 && innerHeights[mode]
    ? {
        "--viewport-width": `${MOBILE_WIDTH_PX * scale.value}px`,
        "--viewport-height": `${innerHeights[mode] * scale.value}px`,
      }
    : undefined;

onMounted(() => {
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(() => {
    paneWidth.value = paneRef.value?.clientWidth ?? 0;
    for (const mode of THEME_MODES) innerHeights[mode] = innerRefs[mode]?.offsetHeight ?? 0;
  });
  if (paneRef.value) observer.observe(paneRef.value);
  for (const mode of THEME_MODES) if (innerRefs[mode]) observer.observe(innerRefs[mode]!);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped lang="scss">
.announcement-preview-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.announcement-preview-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.announcement-preview-title {
  font-size: 0.875rem;
  font-weight: 700;
}

.announcement-preview-toggle {
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
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

.announcement-preview-switch :deep(.q-toggle__label) {
  padding-left: 0.5rem;
}

.announcement-preview-dimmed {
  opacity: 0.4;
}

.announcement-preview-viewport {
  width: var(--viewport-width, auto);
  max-width: 100%;
  height: var(--viewport-height, auto);
  overflow: hidden;
}

.announcement-preview-frames {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.announcement-preview-switches {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1rem;
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
  width: var(--frame-width);
  max-width: none;
  border: 1px solid var(--o2-border-color, rgba(128, 128, 128, 0.3));
  border-radius: 0.375rem;
  overflow: hidden;
  transform: scale(var(--frame-scale));
  transform-origin: top left;
}

.announcement-preview-frame--light {
  background: #ffffff;
  color: #171717;

  --preview-chrome: #f3f4f6;
  --preview-shape: #d1d5db;
}

.announcement-preview-frame--dark {
  background: #1a1a1a;
  color: #e5e7eb;

  --preview-chrome: #262626;
  --preview-shape: #404040;
}

.announcement-preview-edited {
  outline: 2px dashed var(--q-primary);
  outline-offset: -2px;
}

.announcement-preview-topbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.25rem;
  padding: 0 0.75rem;
  background: var(--preview-chrome);
}

.announcement-preview-logo {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 0.25rem;
  background: var(--q-primary);
}

.announcement-preview-nav {
  width: 3rem;
  height: 0.5rem;
  border-radius: 0.25rem;
  background: var(--preview-shape);
}

.announcement-preview-avatar {
  width: 1.25rem;
  height: 1.25rem;
  margin-left: auto;
  border-radius: 50%;
  background: var(--preview-shape);
}

.announcement-preview-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
}

.announcement-preview-line {
  height: 0.5rem;
  border-radius: 0.25rem;
  background: var(--preview-shape);
}

.announcement-preview-line--short {
  width: 60%;
}
</style>
