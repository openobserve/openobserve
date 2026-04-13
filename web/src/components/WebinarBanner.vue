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
  <!-- Header variant -->
  <div
    v-if="webinarData && !isExpired && variant === 'header'"
    class="webinar-header-wrap"
    data-test="webinar-header-banner"
  >
    <!-- Expanded: marquee + Register + Close -->
    <div v-if="!collapsed" class="webinar-marquee-wrap" data-test="webinar-marquee-wrap">
      <!-- Marquee container -->
      <div class="webinar-marquee-outer">
        <div
          class="webinar-marquee-inner"
          :style="{ animationDuration: `${marqueeSpeed}s` }"
          @animationiteration="onIteration"
        >
          <span class="webinar-marquee-tag">{{ webinarData.tag }}</span>
          <span class="webinar-marquee-title">{{ webinarData.title }}</span>
          <span v-if="webinarData.date" class="webinar-marquee-date">
            <q-icon
              name="schedule"
              size="0.7rem"
              class="webinar-marquee-date-icon"
            />
            <span class="webinar-marquee-date-text">{{ formattedDate }}</span>
          </span>
          <!-- Spacer so text doesn't abruptly loop -->
          <span class="webinar-marquee-sep" aria-hidden="true">·</span>
          <span class="webinar-marquee-tag">{{ webinarData.tag }}</span>
          <span class="webinar-marquee-title">{{ webinarData.title }}</span>
          <span v-if="webinarData.date" class="webinar-marquee-date">
            <q-icon
              name="schedule"
              size="0.7rem"
              class="webinar-marquee-date-icon"
            />
            <span class="webinar-marquee-date-text">{{ formattedDate }}</span>
          </span>
          <span class="webinar-marquee-sep" aria-hidden="true">·</span>
        </div>
      </div>

      <!-- Register button -->
      <q-btn
        v-if="webinarData.primaryButton"
        no-caps
        dense
        size="sm"
        color="secondary"
        class="webinar-action-btn q-ml-xs"
        :href="webinarData.primaryButton.link"
        target="_blank"
        rel="noopener noreferrer"
        data-test="webinar-marquee-register-btn"
      >
        {{ webinarData.primaryButton.text }}
        <q-icon name="arrow_forward" size="0.75rem" class="q-ml-xs" />
      </q-btn>

      <!-- Close — collapses to compact button -->
      <q-btn
        flat
        dense
        round
        size="8px"
        icon="close"
        class="webinar-close-btn q-ml-xs"
        @click="collapse"
        data-test="webinar-marquee-close-btn"
      >
        <q-tooltip anchor="top middle" self="bottom middle">Minimize</q-tooltip>
      </q-btn>
    </div>

    <!-- Collapsed: compact button with hover popover (existing behaviour) -->
    <div
      v-else
      class="webinar-btn-wrap"
      @mouseenter="openMenu"
      @mouseleave="scheduleClose"
      data-test="webinar-compact-wrap"
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

      <!-- Hover popover -->
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
        <q-icon name="arrow_forward" class="q-ml-sm" size="1rem" />
      </q-btn>
    </div>
  </div>

  <!-- Top-bar variant: full-width bar above the entire header -->
  <div
    v-else-if="webinarData && !isExpired && variant === 'topbar'"
    class="webinar-topbar"
    data-test="webinar-topbar"
  >
    <span class="webinar-topbar-tag">{{ webinarData.tag }}</span>
    <span class="webinar-topbar-divider" aria-hidden="true">|</span>
    <span class="webinar-topbar-title">{{ webinarData.title }}</span>
    <a
      v-if="webinarData.primaryButton"
      :href="webinarData.primaryButton.link"
      target="_blank"
      rel="noopener noreferrer"
      class="webinar-topbar-link"
      data-test="webinar-topbar-register-link"
    >
      {{ webinarData.primaryButton.text }}
      <q-icon name="arrow_forward" size="0.8rem" class="q-ml-xs" />
    </a>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

defineProps<{
  variant: "header" | "home" | "topbar";
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

const MAX_ROTATIONS = 5;
const MARQUEE_SPEED = 18; // seconds for one full scroll

const WEBINAR_JSON_URL =
  import.meta.env.VITE_WEBINAR_JSON_URL ??
  "https://openobserve.ai/webinar.json";

const webinarData = ref<WebinarData | null>(null);
const collapsed = ref(false);
const iterationCount = ref(0);
const marqueeSpeed = ref(MARQUEE_SPEED);

// Hover-popover state (collapsed mode)
const menuOpen = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const collapse = () => {
  collapsed.value = true;
};

const onIteration = () => {
  // Each inner div has 2 copies of the text, so one CSS animation iteration = 1 visual pass
  iterationCount.value += 1;
  if (iterationCount.value >= MAX_ROTATIONS) {
    collapse();
  }
};

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

onUnmounted(() => {
  if (closeTimer) clearTimeout(closeTimer);
});
</script>

<style scoped lang="scss">
/* ── Shared header wrapper ───────────────────────────────── */
.webinar-header-wrap {
  align-self: center;
  flex-shrink: 0;
  margin: 0 0.5rem;
}

/* ── Marquee (expanded) ──────────────────────────────────── */
.webinar-marquee-wrap {
  display: inline-flex;
  align-items: center;
  max-width: 32rem;
  overflow: hidden;
  border-radius: 0.25rem;
  border: 1px solid color-mix(in srgb, var(--q-secondary) 30%, transparent);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--q-secondary) 12%, var(--o2-primary-background)) 0%,
    var(--o2-primary-background) 100%
  );
  padding: 0 0.375rem;
  height: 1.75rem;
}

.webinar-marquee-outer {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  position: relative;
  // fade edges
  mask-image: linear-gradient(
    to right,
    transparent 0%,
    black 8%,
    black 92%,
    transparent 100%
  );
}

.webinar-marquee-inner {
  display: inline-block;
  white-space: nowrap;
  animation: marquee-scroll linear infinite;
  will-change: transform;
}

@keyframes marquee-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

.webinar-marquee-tag {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--q-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-right: 0.5rem;
}

.webinar-marquee-title {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--o2-text-primary);
  margin-right: 0.5rem;
}

.webinar-marquee-date {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--o2-text-secondary);
  margin-right: 0.75rem;
  vertical-align: middle;
}

.webinar-marquee-date-icon {
  display: inline-flex !important;
  align-items: center;
  flex-shrink: 0;
}

.webinar-marquee-date-text {
  line-height: 1;
  vertical-align: middle;
}

.webinar-marquee-sep {
  font-size: 0.75rem;
  color: var(--o2-text-secondary);
  margin-right: 0.5rem;
}

.webinar-action-btn {
  flex-shrink: 0;
  border-radius: 0.25rem !important;
  font-size: 0.7rem !important;
  padding: 0 0.5rem !important;
  height: 1.375rem !important;
  min-height: 1.375rem !important;
}

.webinar-close-btn {
  flex-shrink: 0;
  color: var(--o2-text-secondary) !important;
}

/* ── Compact button + popover ───────────────────────────── */
.webinar-btn-wrap {
  position: relative;
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

.webinar-home-register-btn {
  flex-shrink: 0;
  border-radius: 0.25rem !important;
  font-size: 0.875rem !important;
  padding: 0 1.25rem !important;
  height: 2.375rem !important;
  min-height: 2.375rem !important;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--q-secondary) 35%, transparent) !important;
}
</style>

<style lang="scss">
.webinar-close-btn {
  .q-icon {
    font-size: 1rem !important;
  }
}

/* ── Top-bar variant ─────────────────────────────────────── */
.webinar-topbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  width: 100%;
  height: 2rem;
  padding: 0 1rem;
  background: #f5c518;
  flex-wrap: nowrap;
  overflow: hidden;
}

.webinar-topbar-tag {
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #1a1a1a;
  white-space: nowrap;
  flex-shrink: 0;
}

.webinar-topbar-divider {
  color: #1a1a1a;
  opacity: 0.4;
  font-weight: 300;
  flex-shrink: 0;
}

.webinar-topbar-title {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40rem;
}

.webinar-topbar-link {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 0.8125rem;
  font-weight: 800;
  color: #1a1a1a;
  text-decoration: none;
  white-space: nowrap;
  border-bottom: 1.5px solid rgba(26, 26, 26, 0.5);
  padding-bottom: 1px;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: #1a1a1a;
  }
}
</style>
