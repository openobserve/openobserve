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
    v-show="visible && !!anchorEl"
    ref="popoverRef"
    class="wildcard-popover"
    :class="popoverPositionClass"
    :style="popoverStyle"
    data-test="wildcard-value-popover"
    @mouseenter="$emit('popoverEnter')"
    @mouseleave="$emit('popoverLeave')"
  >
    <!-- Header -->
    <div class="wildcard-popover-header" :class="headerClass">
      <span class="wildcard-popover-header-token">{{ token }}</span>
    </div>

    <!-- Body - bar chart distribution -->
    <div class="wildcard-popover-body">
      <div
        v-for="(item, i) in displayValues.slice(0, 10)"
        :key="i"
        class="wildcard-value-row"
        :data-test="`wildcard-value-row-${i}`"
      >
        <div class="wildcard-value-bar-wrapper">
          <div
            class="wildcard-value-bar"
            :style="{ width: barWidth(item.count) }"
            :class="barColorClass"
          ></div>
        </div>
        <span class="wildcard-value-count">{{ formatCount(item.count) }}</span>
        <span class="wildcard-value-text">{{ item.value || "(empty)" }}</span>
        <div class="wildcard-value-actions">
          <button
            class="wildcard-value-action-btn"
            :data-test="`wildcard-value-row-${i}-include-btn`"
            @click.stop="emit('filter-value', item.value, 'include')"
          >
            =
          </button>
          <button
            class="wildcard-value-action-btn"
            :data-test="`wildcard-value-row-${i}-exclude-btn`"
            @click.stop="emit('filter-value', item.value, 'exclude')"
          >
            &ne;
          </button>
        </div>
      </div>
      <div
        v-if="displayValues.length === 0"
        class="tw:text-[0.6875rem] tw:opacity-50 tw:py-4 tw:text-center"
      >
        {{ t("search.patternNoValuesAvailable") }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { formatCount } from "@/utils/logs/convertLogData";
import { wildcardChipColor } from "@/composables/useLogs/useTemplateTokenizer";
import type { WildcardDisplayValue } from "./useWildcardHover";

const props = defineProps<{
  visible: boolean;
  token: string;
  displayValues: WildcardDisplayValue[];
  anchorEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: "popoverEnter"): void;
  (e: "popoverLeave"): void;
  (e: "filter-value", value: string, action: "include" | "exclude"): void;
}>();

const { t } = useI18n();
const popoverRef = ref<HTMLElement | null>(null);
const flipUpward = ref(false);

watch(
  () => [props.visible, props.token, props.displayValues],
  () => {
    console.log("[WildcardValuePopover] props updated", {
      visible: props.visible,
      token: props.token,
      displayValues: props.displayValues,
    });
  },
  { immediate: true },
);

const maxCount = computed(() =>
  Math.max(...props.displayValues.map((v) => v.count), 1),
);

const barWidth = (count: number): string => {
  if (!count) return "0%";
  const pct = (count / maxCount.value) * 100;
  return `${Math.max(pct, 2)}%`;
};

const barColorClass = computed(() => {
  const cls = headerClass.value;
  if (cls.includes("blue")) return "wildcard-bar-blue";
  if (cls.includes("green")) return "wildcard-bar-green";
  if (cls.includes("orange")) return "wildcard-bar-orange";
  if (cls.includes("purple")) return "wildcard-bar-purple";
  if (cls.includes("grey")) return "wildcard-bar-grey";
  return "wildcard-bar-default";
});

const headerClass = computed(() => {
  const chipClass = wildcardChipColor(props.token);
  const bgMatch = chipClass.match(/bg-(\S+)/);
  if (bgMatch) {
    return `wildcard-header-${bgMatch[1]}`;
  }
  return "wildcard-header-default";
});

const popoverPositionClass = computed(() => ({
  "wildcard-popover--flip-up": flipUpward.value,
}));

const popoverStyle = computed(() => {
  if (!props.anchorEl) return { display: "none" };
  const rect = props.anchorEl.getBoundingClientRect();
  const gap = 4;
  const top = flipUpward.value ? rect.top - gap : rect.bottom + gap;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 320));
  return {
    position: "fixed" as const,
    top: `${top}px`,
    left: `${left}px`,
    zIndex: 9999,
  };
});

function repositionPopover() {
  void nextTick().then(() => {
    if (!popoverRef.value || !props.anchorEl) return;
    const popoverRect = popoverRef.value.getBoundingClientRect();
    if (popoverRect.bottom > window.innerHeight - 8) {
      flipUpward.value = true;
    }
    if (popoverRect.right > window.innerWidth - 8) {
      popoverRef.value.style.left = `${window.innerWidth - popoverRect.width - 8}px`;
    }
  });
}

onMounted(repositionPopover);

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      flipUpward.value = false;
      repositionPopover();
    }
  },
);
</script>

<style scoped lang="scss">
.wildcard-popover {
  min-width: 14rem;
  max-width: 24rem;
  background: var(--o2-card-bg, #ffffff);
  border: 1px solid var(--o2-border, #e5e7eb);
  border-radius: 0.5rem;
  box-shadow:
    0 0.5rem 1.5rem rgba(0, 0, 0, 0.18),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.08);
  overflow: hidden;
  animation: wildcardPopoverIn 0.15s ease-out;
}

.wildcard-popover--flip-up {
  animation-name: wildcardPopoverInUp;
}

@keyframes wildcardPopoverIn {
  from {
    opacity: 0;
    transform: translateY(-0.25rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes wildcardPopoverInUp {
  from {
    opacity: 0;
    transform: translateY(0.25rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── Header ── */
.wildcard-popover-header {
  display: flex;
  align-items: center;
  padding: 0.375rem 0.75rem;
  border-bottom: 1px solid var(--o2-border, #e5e7eb);

  &.wildcard-header-blue-2 {
    background: #eff6ff;
    color: #1e40af;
  }
  &.wildcard-header-green-2 {
    background: #f0fdf4;
    color: #166534;
  }
  &.wildcard-header-orange-2 {
    background: #fff7ed;
    color: #9a3412;
  }
  &.wildcard-header-purple-2 {
    background: #faf5ff;
    color: #6b21a8;
  }
  &.wildcard-header-grey-3 {
    background: #f9fafb;
    color: #374151;
  }
  &.wildcard-header-default {
    background: var(--o2-surface-2, #f9fafb);
    color: var(--o2-text-primary, #111827);
  }
}

.wildcard-popover-header-token {
  font-family: monospace;
  font-weight: 600;
  font-size: 0.75rem;
  line-height: 1.4;
}

/* ── Body ── */
.wildcard-popover-body {
  padding: 0.25rem 0;
  max-height: 20rem;
  overflow-y: auto;
}

/* ── Value rows with bar chart ── */
.wildcard-value-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3125rem 0.75rem;
  position: relative;
}

.wildcard-value-bar-wrapper {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.wildcard-value-bar {
  height: 100%;
  opacity: 0.18;
  min-width: 0;
  transition: opacity 0.1s ease;

  .wildcard-value-row:hover & {
    opacity: 0.28;
  }

  &.wildcard-bar-blue {
    background: #3b82f6;
  }
  &.wildcard-bar-green {
    background: #22c55e;
  }
  &.wildcard-bar-orange {
    background: #f97316;
  }
  &.wildcard-bar-purple {
    background: #a855f7;
  }
  &.wildcard-bar-grey {
    background: #6b7280;
  }
  &.wildcard-bar-default {
    background: var(--o2-text-muted, #6b7280);
  }
}

.wildcard-value-count {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--o2-text-primary, #111827);
  line-height: 1.4;

  .wildcard-value-row:hover & {
    display: none;
  }
}

.wildcard-value-text {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--o2-text-primary, #111827);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

/* ── Action buttons (= / ≠) ── */
.wildcard-value-actions {
  display: none;
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  gap: 0.125rem;

  .wildcard-value-row:hover & {
    display: flex;
  }
}

.wildcard-value-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: none;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  font-family: monospace;
  cursor: pointer;
  background: transparent;
  color: var(--o2-text-secondary, #4b5563);
  transition: background 0.1s ease, color 0.1s ease;

  &:hover {
    color: var(--o2-text-primary, #111827);
    background: rgba(0, 0, 0, 0.08);
  }
}
</style>
