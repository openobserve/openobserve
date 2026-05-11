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
  <!-- Header variant: full-width top bar above the toolbar -->
  <div
    v-if="webinarData && !isExpired && !isDismissed && variant === 'header'"
    class="webinar-top-bar"
    data-test="webinar-header-banner"
    role="banner"
  >
    <div class="webinar-top-bar-content">
      <span class="webinar-top-bar-text">
        <strong>{{ webinarData.tag }}:</strong> {{ webinarData.title }}
        <span v-if="webinarData.date" class="webinar-top-bar-date">
          {{ formattedDate }}
        </span>
      </span>

      <a
        v-if="webinarData.primaryButton"
        :href="webinarData.primaryButton.link"
        target="_blank"
        rel="noopener noreferrer"
        class="webinar-top-bar-link"
        data-test="webinar-top-bar-register-link"
      >
        {{ webinarData.primaryButton.text }}
      </a>

      <span class="webinar-top-bar-sep" aria-hidden="true">|</span>

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
    class="webinar-home-banner q-mb-md"
    data-test="webinar-home-banner"
  >
    <!-- Decorative blobs -->
    <div class="webinar-home-blob webinar-home-blob--1" aria-hidden="true" />
    <div class="webinar-home-blob webinar-home-blob--2" aria-hidden="true" />

    <!-- Content row -->
    <div class="webinar-home-content">
      <div class="webinar-home-left">
        <!-- Live badge -->
        <div class="webinar-home-badge">
          <span class="webinar-home-badge-dot" />
          {{ webinarData.tag }}
        </div>

        <div class="webinar-home-title">{{ webinarData.title }}</div>

        <div v-if="webinarData.date" class="webinar-home-meta">
          <q-icon name="schedule" size="0.875rem" />
          <span>{{ formattedDate }}</span>
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
        <q-icon name="arrow_forward" class="q-ml-sm" size="1rem" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";

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

<style scoped lang="scss">
/* ── Top bar (header variant) ───────────────────────────── */
.webinar-top-bar {
  width: 100%;
  background: #fbbf24;
  color: #1a1a1a;
}

.webinar-top-bar-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.2rem 1rem;
  flex-wrap: wrap;
  position: relative;
}

.webinar-top-bar-text {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #1a1a1a;
  text-align: center;

  strong {
    font-weight: 800;
  }
}

.webinar-top-bar-date {
  font-weight: 500;
}

.webinar-top-bar-sep {
  color: #374151;
  font-weight: 400;
  opacity: 0.6;
  user-select: none;
}

.webinar-top-bar-link {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #1e3a8a;
  text-decoration: underline;
  white-space: nowrap;

  &:hover {
    color: #1e40af;
  }
}

.webinar-top-bar-dismiss {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

/* ── Home variant ───────────────────────────────────────── */
.webinar-home-banner {
  position: relative;
  overflow: hidden;
  border-radius: 0.625rem;
  border: 1px solid color-mix(in srgb, var(--q-secondary) 35%, transparent);
  background: linear-gradient(
    120deg,
    color-mix(in srgb, var(--q-secondary) 14%, var(--o2-primary-background)) 0%,
    var(--o2-primary-background) 55%,
    color-mix(in srgb, var(--q-secondary) 7%, var(--o2-primary-background)) 100%
  );
}

/* Decorative background blobs */
.webinar-home-blob {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0.18;
  background: var(--q-secondary);
  filter: blur(2.5rem);
}

.webinar-home-blob--1 {
  width: 10rem;
  height: 10rem;
  top: -3rem;
  left: -2rem;
}

.webinar-home-blob--2 {
  width: 8rem;
  height: 8rem;
  bottom: -2.5rem;
  right: 6rem;
}

/* Inner content sits above blobs */
.webinar-home-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 1rem 1.375rem;
}

.webinar-home-left {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

/* Animated "live" badge */
.webinar-home-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--q-secondary);
}

.webinar-home-badge-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--q-secondary);
  flex-shrink: 0;
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

.webinar-home-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--o2-text-primary);
  line-height: 1.35;
  max-width: 36rem;
}

.webinar-home-meta {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8125rem;
  line-height: 1;
  color: var(--o2-text-secondary);

  .q-icon {
    flex-shrink: 0;
    position: relative;
    top: 0;
  }

  span {
    line-height: 1;
  }
}
</style>
