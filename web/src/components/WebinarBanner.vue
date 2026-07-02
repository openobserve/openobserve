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
  <!-- Header variant: tw:w-full top bar above the toolbar -->
  <div
    v-if="webinarData && !isExpired && !isDismissed && variant === 'header'"
    class="webinar-top-bar tw:w-full tw:bg-amber-400 tw:text-[#1a1a1a]"
    data-test="webinar-header-banner"
    role="banner"
  >
    <div class="webinar-top-bar-content tw:flex tw:items-center tw:justify-center tw:gap-2 tw:py-[0.2rem] tw:px-4 tw:flex-wrap tw:relative">
      <span class="webinar-top-bar-text tw:text-[0.8125rem] tw:font-bold tw:text-[#1a1a1a] tw:text-center">
        <strong>{{ webinarData.tag }}:</strong> {{ webinarData.title }}
        <span v-if="webinarData.date" class="webinar-top-bar-date tw:font-medium">
          {{ formattedDate }}
        </span>
      </span>

      <a
        v-if="webinarData.primaryButton"
        :href="webinarData.primaryButton.link"
        target="_blank"
        rel="noopener noreferrer"
        class="webinar-top-bar-link tw:text-[0.8125rem] tw:font-bold tw:text-[#1e3a8a] tw:underline tw:whitespace-nowrap tw:hover:text-[#1e40af]"
        data-test="webinar-top-bar-register-link"
      >
        {{ webinarData.primaryButton.text }}
      </a>

      <span class="webinar-top-bar-sep tw:text-[#374151] tw:font-normal tw:opacity-60 tw:select-none" aria-hidden="true">|</span>

      <OButton
        variant="webinar-dismiss"
        aria-label="Dismiss webinar banner"
        @click="dismiss"
        data-test="webinar-top-bar-dismiss-btn"
      >
        Dismiss
      </OButton>
    </div>
  </div>

  <!-- Home variant: larger banner -->
  <div
    v-else-if="webinarData && !isExpired && variant === 'home'"
    class="webinar-home-banner tw:mb-3 tw:relative tw:overflow-hidden tw:rounded-[0.625rem] tw:border tw:border-[color-mix(in_srgb,var(--q-secondary)_35%,transparent)] tw:bg-[linear-gradient(120deg,color-mix(in_srgb,var(--q-secondary)_14%,var(--o2-primary-background))_0%,var(--o2-primary-background)_55%,color-mix(in_srgb,var(--q-secondary)_7%,var(--o2-primary-background))_100%)]"
    data-test="webinar-home-banner"
  >
    <!-- Decorative blobs -->
    <div class="tw:absolute tw:rounded-full tw:pointer-events-none tw:opacity-[0.18] tw:bg-(--q-secondary) tw:blur-[2.5rem] tw:w-[10rem] tw:h-[10rem] tw:top-[-3rem] tw:left-[-2rem]" aria-hidden="true" />
    <div class="tw:absolute tw:rounded-full tw:pointer-events-none tw:opacity-[0.18] tw:bg-(--q-secondary) tw:blur-[2.5rem] tw:w-[8rem] tw:h-[8rem] tw:bottom-[-2.5rem] tw:right-[6rem]" aria-hidden="true" />

    <!-- Content row -->
    <div class="webinar-home-content tw:relative tw:z-[1] tw:flex tw:items-center tw:justify-between tw:flex-wrap tw:gap-3 tw:p-4 tw:pr-[1.375rem]">
      <div class="webinar-home-left tw:flex tw:flex-col tw:gap-[0.3rem]">
        <!-- Live badge -->
        <div class="webinar-home-badge tw:inline-flex tw:items-center tw:gap-[0.375rem] tw:text-[0.7rem] tw:font-bold tw:uppercase tw:tracking-[0.06em] tw:text-[var(--q-secondary)]">
          <span class="webinar-home-badge-dot tw:w-[0.5rem] tw:h-[0.5rem] tw:rounded-full tw:bg-(--q-secondary) tw:shrink-0 tw:[animation:badge-pulse_1.8s_ease-in-out_infinite]" />
          {{ webinarData.tag }}
        </div>

        <div class="webinar-home-title tw:text-base tw:font-bold tw:text-[var(--o2-text-primary)] tw:leading-[1.35] tw:max-w-[36rem]">{{ webinarData.title }}</div>

        <div v-if="webinarData.date" class="webinar-home-meta tw:flex tw:items-center tw:gap-[0.3rem] tw:text-[0.8125rem] tw:leading-none tw:text-[var(--o2-text-secondary)]">
          <OIcon name="schedule" size="xs" />
          <span class="tw:[line-height:1]">{{ formattedDate }}</span>
        </div>
      </div>

      <OButton
        v-if="webinarData.primaryButton"
        variant="secondary"
        size="sm"
        as="a"
        :href="webinarData.primaryButton.link"
        target="_blank"
        rel="noopener noreferrer"
        data-test="webinar-home-register-btn"
      >
        {{ webinarData.primaryButton.text }}
        <OIcon name="arrow-forward" size="sm" class="tw:ml-2" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const store = useStore();

const props = defineProps<{
  variant: "header" | "home";
}>();

interface PrimaryButton {
  id: number;
  text: string;
  link: string;
  target: string | null;
  theme: string | null;
}

interface WebinarData {
  id: number;
  documentId: string;
  tag: string;
  title: string;
  date: string;
  primaryButton: PrimaryButton;
}

const WEBINAR_JSON_URL =
  import.meta.env.VITE_WEBINAR_JSON_URL ??
  "https://openobserve.ai/webinar.json";

const webinarData = ref<WebinarData | null>(null);
const isDismissed = ref(false);

const isExpired = computed(() => {
  if (!webinarData.value?.date) return false;
  return new Date(webinarData.value.date) < new Date();
});

const isBannerVisible = computed(
  () =>
    props.variant === "header" &&
    !!webinarData.value &&
    !isExpired.value &&
    !isDismissed.value,
);

watch(isBannerVisible, (visible) => {
  store.dispatch("setIsWebinarBannerVisible", visible);
});

const dismiss = () => {
  isDismissed.value = true;
};

const formattedDate = computed(() => {
  if (!webinarData.value?.date) return "";
  return new Date(webinarData.value.date).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
});

onMounted(async () => {
  try {
    const res = await fetch(WEBINAR_JSON_URL);
    if (!res.ok) return;
    const json = await res.json();
    webinarData.value = json?.data ?? null;
  } catch {
    // silently ignore — banner simply won't show
  }
});
</script>

<style>
@keyframes badge-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }

  50% {
    transform: scale(1.5);
    opacity: 0.5;
  }
}
</style>
