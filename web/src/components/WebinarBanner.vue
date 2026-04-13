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
  <!-- Header variant: single button; hover shows interactive popover -->
  <div
    v-if="webinarData && !isExpired && variant === 'header'"
    class="webinar-btn-wrap"
    @mouseenter="openMenu"
    @mouseleave="scheduleClose"
    data-test="webinar-header-banner"
  >
    <q-btn
      no-caps
      dense
      size="sm"
      color="secondary"
      class="webinar-register-btn"
      :href="webinarData.primaryButton?.link"
      target="_blank"
      rel="noopener noreferrer"
      data-test="webinar-header-register-btn"
    >
      <q-icon name="videocam" size="0.9rem" class="q-mr-xs" />
      {{ webinarData.tag }}
    </q-btn>

    <!-- Hover popover — stays open while cursor is inside -->
    <div
      v-if="menuOpen"
      class="webinar-popover"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <div class="webinar-popover-title">{{ webinarData.title }}</div>
      <div v-if="webinarData.date" class="webinar-popover-date">
        <q-icon name="event" size="0.8rem" class="q-mr-xs" />{{ formattedDate }}
      </div>
      <q-btn
        v-if="webinarData.primaryButton"
        no-caps
        color="secondary"
        size="sm"
        class="webinar-popover-btn"
        :href="webinarData.primaryButton.link"
        target="_blank"
        rel="noopener noreferrer"
        data-test="webinar-popover-register-link"
      >
        {{ webinarData.primaryButton.text }}
        <q-icon name="arrow_forward" size="0.8rem" class="q-ml-xs" />
      </q-btn>
    </div>
  </div>

  <!-- Home variant: larger banner -->
  <div
    v-else-if="webinarData && !isExpired && variant === 'home'"
    class="webinar-home-banner q-mb-md row items-center justify-between"
    data-test="webinar-home-banner"
  >
    <div class="row items-center no-wrap tw:gap-3">
      <span class="webinar-home-tag">{{ webinarData.tag }}</span>
      <div class="column">
        <span class="webinar-home-title">{{ webinarData.title }}</span>
        <span v-if="webinarData.date" class="webinar-home-date">{{ formattedDate }}</span>
      </div>
    </div>
    <q-btn
      v-if="webinarData.primaryButton"
      no-caps
      color="secondary"
      class="webinar-home-register-btn"
      :href="webinarData.primaryButton.link"
      target="_blank"
      rel="noopener noreferrer"
      data-test="webinar-home-register-btn"
    >
      {{ webinarData.primaryButton.text }}
      <q-icon name="arrow_forward" class="q-ml-xs" size="1rem" />
    </q-btn>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";

defineProps<{
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
const menuOpen = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const openMenu = () => {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  menuOpen.value = true;
};

const scheduleClose = () => {
  closeTimer = setTimeout(() => {
    menuOpen.value = false;
  }, 150);
};

const cancelClose = () => {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
};

const isExpired = computed(() => {
  if (!webinarData.value?.date) return false;
  return new Date(webinarData.value.date) < new Date();
});

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
/* ── Header variant ─────────────────────────────────────── */
.webinar-btn-wrap {
  position: relative;
  align-self: center;
  flex-shrink: 0;
  margin: 0 0.5rem;
}

.webinar-register-btn {
  border-radius: 0.25rem !important;
  font-size: 0.75rem !important;
  padding: 0 0.625rem !important;
  height: 1.75rem !important;
  min-height: 1.75rem !important;
}

.webinar-popover {
  position: absolute;
  top: calc(100% + 0.375rem);
  right: 0;
  z-index: 9999;
  min-width: 16rem;
  max-width: 22rem;
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
  border: 1px solid var(--o2-border);
  background: var(--o2-card-background, var(--o2-primary-background));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.webinar-popover-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--o2-text-primary);
  line-height: 1.4;
  white-space: normal;
}

.webinar-popover-date {
  font-size: 0.75rem;
  color: var(--o2-text-secondary);
  display: flex;
  align-items: center;
}

.webinar-popover-btn {
  margin-top: 0.25rem;
  align-self: flex-start;
  border-radius: 0.25rem !important;
}

/* ── Home variant ───────────────────────────────────────── */
.webinar-home-banner {
  border-radius: 0.5rem;
  padding: 0.875rem 1.25rem;
  border: 1px solid var(--o2-border);
  background: var(--o2-primary-background);
  flex-wrap: wrap;
  gap: 0.75rem;
}

.webinar-home-tag {
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  padding: 0.25rem 0.625rem;
  border-radius: 0.25rem;
  background: var(--q-secondary);
  color: #fff;
  flex-shrink: 0;
}

.webinar-home-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--o2-text-primary);
  line-height: 1.4;
}

.webinar-home-date {
  font-size: 0.8125rem;
  color: var(--o2-text-secondary);
  margin-top: 0.125rem;
}

.webinar-home-register-btn {
  flex-shrink: 0;
  border-radius: 0.25rem !important;
  font-size: 0.875rem !important;
  padding: 0 1rem !important;
  height: 2.25rem !important;
  min-height: 2.25rem !important;
}
</style>
