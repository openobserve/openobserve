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
  <div ref="rootRef" class="flex flex-col gap-4" :data-test="dataTest">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-text-heading text-sm font-semibold">
        {{ t("announcements.preview.title") }}
      </span>
      <div class="flex flex-wrap items-center gap-3">
        <OSwitch
          :model-value="inApp"
          size="sm"
          :label="t('announcements.preview.inApp')"
          :data-test="`${dataTest}-in-app`"
          @update:model-value="$emit('update:inApp', !!$event)"
        />
        <OSwitch
          v-if="otherBanners.length"
          v-model="showOthers"
          size="sm"
          :label="t('announcements.preview.withOthers')"
          :data-test="`${dataTest}-with-others`"
        />
        <OToggleGroup v-model="width" type="single" :data-test="`${dataTest}-width`">
          <OToggleGroupItem
            value="panel"
            size="sm"
            icon-left="computer"
            :data-test="`${dataTest}-width-panel`"
          >
            {{ t("announcements.preview.panel") }}
          </OToggleGroupItem>
          <OToggleGroupItem
            value="mobile"
            size="sm"
            icon-left="smartphone"
            :data-test="`${dataTest}-width-mobile`"
          >
            {{ t("announcements.preview.mobile") }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
    </div>

    <OBanner
      v-if="hiddenByCritical"
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
      <!-- A phone frame keeps its real width and is scaled down, so its line wrapping matches a phone's. -->
      <div class="overflow-hidden" :style="frameBoxStyle">
        <div
          :ref="(el) => (frameRefs[mode] = el as HTMLElement | null)"
          :class="[
            mode === 'dark' ? 'dark' : '',
            width === 'mobile' ? 'w-93.75' : 'w-full',
            'rounded-surface border-border-default bg-surface-base origin-top-left overflow-hidden border',
          ]"
          :style="frameStyle"
          :data-banner-theme="mode"
          :data-test="`${dataTest}-${mode}`"
        >
          <div
            v-for="banner in stack"
            :key="banner.key"
            :class="banner.current && hiddenByCritical ? 'opacity-50' : ''"
            :data-test="banner.current ? `${dataTest}-${mode}-current` : undefined"
          >
            <AnnouncementBar
              :message="banner.message"
              :variant="banner.variant"
              :text-size="banner.textSize"
              :colors="{ light: banner.colorLight, dark: banner.colorDark }"
              :mode="mode"
              :inert-actions="{ ctaText: banner.ctaText, dismissible: banner.dismissible }"
            />
          </div>

          <!-- A stand-in for the app chrome, so the banner is judged where it will actually sit. -->
          <div
            class="border-border-default flex h-10 items-center gap-3 border-b px-3"
            aria-hidden="true"
          >
            <span class="bg-accent size-4 rounded-full opacity-70" />
            <span class="bg-border-strong h-2 w-16 rounded-full" />
            <span class="bg-border-default h-2 w-10 rounded-full" />
            <span class="bg-border-default ms-auto h-2 w-12 rounded-full" />
          </div>
          <div class="flex flex-col gap-2 p-3" aria-hidden="true">
            <span class="bg-border-default h-2 w-3/4 rounded-full" />
            <span class="bg-border-default h-2 w-1/2 rounded-full" />
          </div>
        </div>
      </div>
    </div>

    <span class="text-text-secondary text-xs" :data-test="`${dataTest}-caption`">
      {{ inApp ? t("announcements.preview.inAppCaption") : t("announcements.preview.caption") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, type CSSProperties } from "vue";

import AnnouncementBar from "@/components/announcements/AnnouncementBar.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { useI18nTyped } from "@/types/i18n";
import type { BannerThemeMode } from "@/utils/announcementAppearance";
import { orderBanners } from "@/utils/announcementOrder";
import type { BannerDraft } from "./announcementDrafts";

/** The fields a preview frame paints, for the banner being edited and its neighbours alike. */
export type PreviewBanner = Pick<
  BannerDraft,
  "message" | "variant" | "textSize" | "colorLight" | "colorDark" | "ctaText" | "dismissible"
>;

const props = defineProps<{
  banner: PreviewBanner;
  /** Other banners live right now, to show the stack users will see. */
  otherBanners: PreviewBanner[];
  /** Whether the draft is also showing in the app's real top bar. */
  inApp: boolean;
  dataTest: string;
}>();

defineEmits<{ (_e: "update:inApp", _value: boolean): void }>();

const MODES: BannerThemeMode[] = ["light", "dark"];

/** A phone frame's logical width in rem; it is scaled down only if the pane is narrower. */
const PHONE_REM = 23.4375;

const { t } = useI18nTyped();

const width = ref<"panel" | "mobile">("panel");
const showOthers = ref(props.otherBanners.length > 0);

const hiddenByCritical = computed(
  () =>
    props.banner.variant === "promo" &&
    props.otherBanners.some((banner) => banner.variant === "critical"),
);

const stack = computed(() => {
  const message = props.banner.message.trim();
  const current = {
    ...props.banner,
    message: message || `_${t("announcements.preview.empty")}_`,
    key: "current",
    current: true,
  };
  if (!showOthers.value) return [current];

  const others = props.otherBanners.map((banner, index) => ({
    ...banner,
    key: `other-${index}`,
    current: false,
  }));
  // The edited banner always stays in view, even when the real bar would hide it.
  const ordered = orderBanners([current, ...others]);
  return ordered.includes(current) ? ordered : [current, ...ordered];
});

// ── Fit the real-width frame into the pane ────────────────────────────────

const rootRef = ref<HTMLElement | null>(null);
const frameRefs = reactive<Record<string, HTMLElement | null>>({});
const paneRem = ref<number>(PHONE_REM);
const frameHeightRem = ref(0);

const remPx = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const scale = computed(() =>
  width.value === "mobile" ? Math.min(1, paneRem.value / PHONE_REM) : 1,
);

const frameStyle = computed<CSSProperties>(() => ({ transform: `scale(${scale.value})` }));

const frameBoxStyle = computed<CSSProperties>(() => ({
  height: `${frameHeightRem.value * scale.value}rem`,
}));

const measure = () => {
  const rem = remPx();
  if (rootRef.value) paneRem.value = rootRef.value.clientWidth / rem;
  const frame = frameRefs.light;
  if (frame) frameHeightRem.value = frame.offsetHeight / rem;
};

let observer: ResizeObserver | null = null;

onMounted(() => {
  measure();
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(measure);
  if (rootRef.value) observer.observe(rootRef.value);
  for (const frame of Object.values(frameRefs)) if (frame) observer.observe(frame);
});

onBeforeUnmount(() => observer?.disconnect());
</script>
