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
  <div class="rounded-default bg-surface-base flex min-h-[inherit] items-center justify-center">
    <div class="flex max-w-md flex-col items-center p-8 text-center">
      <div class="mb-8">
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="100" cy="100" r="90" class="stroke-border-default fill-none stroke-2" />
          <text
            x="100"
            y="115"
            text-anchor="middle"
            font-size="56"
            class="fill-accent font-[inherit] font-bold"
          >
            {{ "404" }}
          </text>
        </svg>
      </div>

      <h1 class="text-text-heading m-0 mb-3 text-2xl font-semibold">
        {{ t("common.pageNotFound") }}
      </h1>

      <p class="text-text-secondary m-0 mb-8 text-sm leading-normal">
        {{ t("common.pageNotFoundDescription") }}
      </p>

      <div class="mb-8 flex gap-3">
        <OButton data-test="error-404-go-home-btn" variant="primary" size="sm-action" to="/">{{
          t("common.goHome")
        }}</OButton>
        <OButton
          data-test="error-404-go-back-btn"
          variant="outline"
          size="sm-action"
          @click="goBack"
          >{{ t("common.goBack") }}</OButton
        >
      </div>

      <p class="text-compact text-text-secondary m-0 opacity-70">
        {{ t("common.redirectingHome", { countdown }) }}
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
