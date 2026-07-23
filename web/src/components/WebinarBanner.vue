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
  <!-- Header variant: w-full top bar above the toolbar -->
  <div
    v-if="webinarData && !isExpired && !isDismissed && variant === 'header'"
    class="webinar-top-bar bg-promo-webinar-accent text-promo-webinar-text w-full"
    data-test="webinar-header-banner"
    role="banner"
  >
    <div
      class="webinar-top-bar-content relative flex flex-wrap items-center justify-center gap-2 px-4 py-[0.2rem]"
    >
      <span class="webinar-top-bar-text text-compact text-promo-webinar-text text-center font-bold">
        <strong>{{ webinarData.tag }}:</strong> {{ webinarData.title }}
        <span v-if="webinarData.date" class="webinar-top-bar-date font-medium">
          {{ formattedDate }}
        </span>
      </span>

      <a
        v-if="webinarData.primaryButton"
        :href="webinarData.primaryButton.link"
        target="_blank"
        rel="noopener noreferrer"
        class="webinar-top-bar-link text-compact text-promo-webinar-link hover:text-promo-webinar-link-hover font-bold whitespace-nowrap underline"
        data-test="webinar-top-bar-register-link"
      >
        {{ webinarData.primaryButton.text }}
      </a>

      <span
        class="webinar-top-bar-sep text-promo-webinar-sep font-normal opacity-60 select-none"
        aria-hidden="true"
        >|</span
      >

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
    class="webinar-home-banner rounded-default relative mb-3 overflow-hidden border border-[color-mix(in_srgb,var(--color-promo-webinar-accent)_35%,transparent)] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--color-promo-webinar-accent)_14%,var(--color-surface-base))_0%,var(--color-surface-base)_55%,color-mix(in_srgb,var(--color-promo-webinar-accent)_7%,var(--color-surface-base))_100%)]"
    data-test="webinar-home-banner"
  >
    <!-- Decorative blobs -->
    <div
      class="bg-promo-webinar-accent pointer-events-none absolute top-[-3rem] left-[-2rem] h-40 w-40 rounded-full opacity-[0.18] blur-[2.5rem]"
      aria-hidden="true"
    />
    <div
      class="bg-promo-webinar-accent pointer-events-none absolute right-24 bottom-[-2.5rem] h-32 w-32 rounded-full opacity-[0.18] blur-[2.5rem]"
      aria-hidden="true"
    />

    <!-- Content row -->
    <div
      class="webinar-home-content relative z-[1] flex flex-wrap items-center justify-between gap-3 p-4 pr-[1.375rem]"
    >
      <div class="webinar-home-left flex flex-col gap-[0.3rem]">
        <!-- Live badge -->
        <div
          class="webinar-home-badge text-2xs text-promo-webinar-accent-text inline-flex items-center gap-1.5 font-bold tracking-[0.06em] uppercase"
        >
          <span
            class="webinar-home-badge-dot bg-promo-webinar-accent h-2 w-2 shrink-0 rounded-full"
          />
          {{ webinarData.tag }}
        </div>

        <div
          class="webinar-home-title text-text-heading max-w-[36rem] text-base leading-[1.35] font-bold"
        >
          {{ webinarData.title }}
        </div>

        <div
          v-if="webinarData.date"
          class="webinar-home-meta text-compact text-text-secondary flex items-center gap-[0.3rem] leading-none"
        >
          <OIcon name="schedule" size="xs" />
          <span class="[line-height:1]">{{ formattedDate }}</span>
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
        <OIcon name="arrow-forward" size="sm" class="ml-2" />
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
  import.meta.env.VITE_WEBINAR_JSON_URL ?? "https://openobserve.ai/webinar.json";

const webinarData = ref<WebinarData | null>(null);
const isDismissed = ref(false);

const isExpired = computed(() => {
  if (!webinarData.value?.date) return false;
  return new Date(webinarData.value.date) < new Date();
});

const isBannerVisible = computed(
  () => props.variant === "header" && !!webinarData.value && !isExpired.value && !isDismissed.value,
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

<style scoped>
/* keep(keyframes): the "live" badge dot pulse is used only by this banner. The
   `animation` is declared here, not as a template `[animation:…]` utility, so
   Vue's scoped compiler renames the keyframe and this reference together. */
.webinar-home-badge-dot {
  animation: badge-pulse 1.8s ease-in-out infinite;
}

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
