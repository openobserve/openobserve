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
  <div class="histogram-skeleton" aria-hidden="true">
    <div class="histogram-skeleton__main">
      <div class="histogram-skeleton__y-axis">
        <div class="histogram-skeleton__y-label w-7" />
        <div class="histogram-skeleton__y-label w-9" />
        <div class="histogram-skeleton__y-label w-4" />
      </div>
      <div class="histogram-skeleton__plot border-card-glass-border border-s border-b">
        <div class="histogram-skeleton__bars">
          <div
            v-for="bar in bars"
            :key="bar.id"
            class="histogram-skeleton__bar"
            :style="{ height: bar.pct + '%' }"
          />
        </div>
      </div>
    </div>
    <div class="histogram-skeleton__x-axis">
      <div v-for="i in 6" :key="i" class="histogram-skeleton__x-label bg-skeleton-base" />
    </div>
  </div>
</template>

<script setup lang="ts">
const HEIGHTS = [
  45, 72, 58, 88, 62, 42, 78, 52, 73, 38, 68, 83, 48, 68, 44, 92, 62, 38, 72, 56, 32, 82, 48, 64,
  38, 88, 68, 44, 78, 52, 40, 95, 55, 70, 30, 85, 65, 50, 75, 42,
];
const bars = Array.from({ length: 250 }, (_, i) => ({ id: i, pct: HEIGHTS[i % HEIGHTS.length] }));
</script>

<style scoped>
.histogram-skeleton {
  --hsk-bar: var(--color-grey-100);
  --hsk-shimmer: color-mix(in srgb, var(--color-white) 65%, transparent);

  .dark & {
    --hsk-bar: var(--color-grey-700);
    --hsk-shimmer: color-mix(in srgb, var(--color-white) 6%, transparent);
  }

  height: 6.25rem;
  display: flex;
  flex-direction: column;
  padding-top: 0.25rem;
  overflow: hidden;
}

.histogram-skeleton__main {
  flex: 1;
  display: flex;
  min-height: 0;
}

.histogram-skeleton__y-axis {
  width: 2.25rem;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  padding-right: 0.3125rem;
  padding-bottom: 0.125rem;
}

.histogram-skeleton__y-label {
  height: 0.4375rem;
  border-radius: 0.125rem;
  background-color: var(--hsk-bar);
}

.histogram-skeleton__plot {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.histogram-skeleton__bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 0.125rem;
  padding: 0.25rem 0.25rem 0;
  overflow: hidden;
  position: relative;

  &::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    transform: translateX(-100%);
    background: linear-gradient(
      90deg,
      transparent 0%,
      transparent 20%,
      var(--hsk-shimmer) 50%,
      transparent 80%,
      transparent 100%
    );
    animation: histogram-bar-shimmer 1.6s ease-in-out infinite;
    pointer-events: none;
  }
}

.histogram-skeleton__bar {
  flex: 0 0 0.4375rem;
  flex-shrink: 0;
  border-radius: 0.0625rem 0.0625rem 0 0;
  background-color: var(--hsk-bar);
}

.histogram-skeleton__x-axis {
  display: flex;
  justify-content: space-between;
  padding-left: 2.25rem;
  padding-top: 0.1875rem;
}

.histogram-skeleton__x-label {
  width: 2.25rem;
  height: 0.4375rem;
  border-radius: 0.125rem;
}

@keyframes histogram-bar-shimmer {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}
</style>
