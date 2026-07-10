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
  <div class="rounded-md flex items-center justify-center min-h-[inherit] bg-(--o2-primary-background)">
    <div class="flex flex-col items-center text-center max-w-md p-8">
      <div class="mb-8">
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="100" cy="100" r="90" class="fill-none stroke-(--o2-border) stroke-2" />
          <text
            x="100"
            y="115"
            text-anchor="middle"
            class="text-[3.5rem] font-bold fill-(--o2-primary-color) font-[inherit]"
          >
            404
          </text>
        </svg>
      </div>

      <h1 class="text-2xl font-semibold text-(--o2-text-primary) m-0 mb-3">Page not found</h1>

      <p class="text-[0.9375rem] text-(--o2-text-secondary) m-0 mb-8 leading-normal">
        The page you're looking for doesn't exist or has been moved.
      </p>

      <div class="flex gap-3 mb-8">
        <OButton
          data-test="error-404-go-home-btn"
          variant="primary"
          size="sm-action"
          to="/"
        >{{ t('common.goHome') }}</OButton>
        <OButton
          data-test="error-404-go-back-btn"
          variant="outline"
          size="sm-action"
          @click="goBack"
        >{{ t('common.goBack') }}</OButton>
      </div>

      <p class="text-[0.8125rem] text-(--o2-text-secondary) opacity-70 m-0">
        {{ t('common.redirectingHome', { countdown }) }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";

const { t } = useI18n();
const router = useRouter();
const countdown = ref(10);
let timer: ReturnType<typeof setInterval>;

const goBack = () => {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push("/");
  }
};

onMounted(() => {
  timer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      clearInterval(timer);
      router.push("/");
    }
  }, 1000);
});

onUnmounted(() => {
  clearInterval(timer);
});
</script>
