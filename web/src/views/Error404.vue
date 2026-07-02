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
  <div class="tw:rounded-md tw:flex tw:items-center tw:justify-center tw:min-h-[inherit] tw:bg-(--o2-primary-background)">
    <div class="tw:flex tw:flex-col tw:items-center tw:text-center tw:max-w-md tw:p-8">
      <div class="tw:mb-8">
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="100" cy="100" r="90" class="tw:fill-none tw:stroke-(--o2-border) tw:stroke-2" />
          <text
            x="100"
            y="115"
            text-anchor="middle"
            class="tw:text-[3.5rem] tw:font-bold tw:fill-(--o2-primary-color) tw:font-[inherit]"
          >
            404
          </text>
        </svg>
      </div>

      <h1 class="tw:text-2xl tw:font-semibold tw:text-(--o2-text-primary) tw:m-0 tw:mb-3">Page not found</h1>

      <p class="tw:text-[0.9375rem] tw:text-(--o2-text-secondary) tw:m-0 tw:mb-8 tw:leading-normal">
        The page you're looking for doesn't exist or has been moved.
      </p>

      <div class="tw:flex tw:gap-3 tw:mb-8">
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

      <p class="tw:text-[0.8125rem] tw:text-(--o2-text-secondary) tw:opacity-70 tw:m-0">
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
