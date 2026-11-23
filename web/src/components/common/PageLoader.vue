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
    data-test="page-loader"
    role="status"
    aria-busy="true"
    class="grid h-full flex-1 place-items-center overflow-hidden"
    :class="LOADER_REVEAL"
  >
    <div class="flex flex-col items-center gap-4">
      <div class="page-loader__mark relative grid size-[8.25rem] place-items-center">
        <div class="page-loader__glow absolute -inset-10 rounded-full" />
        <div
          class="page-loader__logo bg-surface-base relative z-[1] grid size-[4.75rem] place-items-center overflow-hidden rounded-full"
        >
          <img :src="logo" alt="" class="size-12" />
          <div class="page-loader__scan absolute inset-0" />
        </div>
      </div>
      <p
        class="page-loader__status text-text-secondary text-compact flex h-5 items-center gap-2"
        data-test="page-loader-status"
      >
        <span>{{ slow ? t("common.stillLoadingWorkspace") : t("common.loadingWorkspace") }}</span>
        <span class="page-loader__dots inline-flex gap-[0.1875rem]" aria-hidden="true">
          <i v-for="n in 3" :key="n" class="bg-text-secondary size-1 rounded-full" />
        </span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { LOADER_REVEAL } from "@/lib/styles/motion";
import { getImageURL } from "@/utils/zincutils";
import { useI18nTyped } from "@/types/i18n";
import { useTheme } from "@/composables/useTheme";

const { t } = useI18nTyped();
const { isDark } = useTheme();

// The wording changes once, so a long wait does not look stuck.
const SLOW_WAIT_MS = 5000;
const slow = ref(false);
const slowTimer = setTimeout(() => (slow.value = true), SLOW_WAIT_MS);
onBeforeUnmount(() => clearTimeout(slowTimer));

const logo = computed(() =>
  getImageURL(
    isDark.value
      ? "images/common/openobserve_mark_dark.svg"
      : "images/common/openobserve_mark_light.svg",
  ),
);
</script>

<style scoped>
/* Rise starts after the 300 ms reveal delay, so fast loads never show it. */
.page-loader__mark,
.page-loader__status {
  animation: page-loader-rise 0.7s 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.page-loader__dots i {
  animation: page-loader-dot 1.2s ease-in-out infinite;
}

.page-loader__dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.page-loader__dots i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes page-loader-dot {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}

.page-loader__glow {
  background: radial-gradient(
    closest-side,
    color-mix(in srgb, var(--color-primary-600) 28%, transparent),
    color-mix(in srgb, var(--color-primary-600) 12%, transparent) 55%,
    transparent 75%
  );
  animation: page-loader-glow 2s ease-out infinite;
}

.page-loader__logo {
  box-shadow: 0 0 0 0.0625rem var(--color-border-default);
  animation: page-loader-pop 2s ease-out infinite;
}

/* A soft light band sweeps across the mark once per beat. */
.page-loader__scan {
  pointer-events: none;
  mix-blend-mode: plus-lighter;
}

.page-loader__scan::before {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2.125rem;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-primary-600) 55%, transparent) 45%,
    rgb(255 255 255 / 0.9) 55%,
    transparent
  );
  filter: blur(0.0625rem);
  animation: page-loader-sweep 2s cubic-bezier(0.45, 0, 0.3, 1) infinite;
}

@keyframes page-loader-sweep {
  0% {
    transform: translateX(-2.5rem);
    opacity: 0;
  }
  8% {
    opacity: 1;
  }
  62% {
    transform: translateX(5rem);
    opacity: 1;
  }
  72%,
  100% {
    transform: translateX(5rem);
    opacity: 0;
  }
}

@keyframes page-loader-pop {
  0%,
  34%,
  46%,
  60%,
  100% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.09);
  }
  52% {
    transform: scale(1.05);
  }
}

@keyframes page-loader-glow {
  0%,
  30%,
  100% {
    opacity: 0.5;
    transform: scale(0.95);
  }
  40% {
    opacity: 1;
    transform: scale(1.12);
  }
  55% {
    opacity: 0.6;
    transform: scale(1);
  }
}

@keyframes page-loader-rise {
  from {
    opacity: 0;
    transform: translateY(0.625rem) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-loader__mark,
  .page-loader__status,
  .page-loader__dots i,
  .page-loader__glow,
  .page-loader__logo {
    animation: none;
  }

  .page-loader__scan {
    display: none;
  }
}
</style>
