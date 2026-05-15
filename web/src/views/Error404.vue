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
  <q-page class="error-404-page">
    <div class="error-404-content">
      <div class="error-404-illustration">
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="100" cy="100" r="90" class="error-404-circle" />
          <text
            x="100"
            y="115"
            text-anchor="middle"
            class="error-404-number"
          >
            404
          </text>
        </svg>
      </div>

      <h1 class="error-404-title">Page not found</h1>

      <p class="error-404-description">
        The page you're looking for doesn't exist or has been moved.
      </p>

      <div class="error-404-actions">
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

      <p class="error-404-redirect">
        {{ t('common.redirectingHome', { countdown }) }}
      </p>
    </div>
  </q-page>
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

<style lang="scss" scoped>
.error-404-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: inherit;
  background: var(--o2-primary-background);
}

.error-404-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 28rem;
  padding: 2rem;
}

.error-404-illustration {
  margin-bottom: 2rem;
}

.error-404-circle {
  fill: none;
  stroke: var(--o2-border);
  stroke-width: 2;
}

.error-404-number {
  font-size: 3.5rem;
  font-weight: 700;
  fill: var(--o2-primary-color);
  font-family: inherit;
}

.error-404-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--o2-text-primary);
  margin: 0 0 0.75rem;
}

.error-404-description {
  font-size: 0.9375rem;
  color: var(--o2-text-secondary);
  margin: 0 0 2rem;
  line-height: 1.5;
}

.error-404-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.error-404-home-btn {
  padding: 0.5rem 1.5rem;
}

.error-404-back-btn {
  padding: 0.5rem 1.5rem;
}

.error-404-redirect {
  font-size: 0.8125rem;
  color: var(--o2-text-secondary);
  opacity: 0.7;
  margin: 0;
}
</style>
