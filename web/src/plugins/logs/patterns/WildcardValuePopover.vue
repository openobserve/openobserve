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
        <span class="wildcard-value-count" :style="countColumnStyle">{{ formatCount(item.count) }}</span>
        <span class="wildcard-value-text">
          <div class="wildcard-value-bar-wrapper">
            <div
              class="wildcard-value-bar"
              :style="{ width: barWidth(item.count) }"
              :class="barColorClass"
            ></div>
          </div>
          <span class="wildcard-value-text-inner">{{ item.value || "(empty)" }}</span>
        </span>
        <span class="wildcard-value-row-actions">
          <OButton
            variant="ghost"
            size="icon"
            :data-test="`wildcard-value-include-${i}`"
            @click.stop="$emit('filter-value', item.value, 'include')"
          >
            <q-icon name="add" size="xs" />
          </OButton>
          <OButton
            variant="ghost"
            size="icon"
            :data-test="`wildcard-value-exclude-${i}`"
            @click.stop="$emit('filter-value', item.value, 'exclude')"
          >
            <q-icon name="remove" size="xs" />
          </OButton>
        </span>
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
import OButton from "@/lib/core/Button/OButton.vue";
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

const maxCount = computed(() =>
  Math.max(...props.displayValues.map((v) => v.count), 1),
);

const countColumnStyle = computed(() => {
  const chars = formatCount(maxCount.value).length;
  return { width: `${chars * 0.5 + 0.125}rem` };
});

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
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 320));

  // When flipped upward, use `bottom` so the popover extends UP from the
  // anchor rather than down past the viewport. When below, use `top` so it
  // extends DOWN from the anchor.
  if (flipUpward.value) {
    return {
      position: "fixed" as const,
      bottom: `${window.innerHeight - rect.top + gap}px`,
      left: `${left}px`,
      zIndex: 9999,
    };
  }
  return {
    position: "fixed" as const,
    top: `${rect.bottom + gap}px`,
    left: `${left}px`,
    zIndex: 9999,
  };
});

function repositionPopover() {
  void nextTick().then(() => {
    if (!popoverRef.value || !props.anchorEl) return;
    const popoverRect = popoverRef.value.getBoundingClientRect();

    // If popover overflows bottom while positioned below, flip upward
    if (!flipUpward.value && popoverRect.bottom > window.innerHeight - 8) {
      flipUpward.value = true;
    }
    // If popover overflows top while positioned above, revert to below
    if (flipUpward.value && popoverRect.top < 8) {
      flipUpward.value = false;
    }
    // Horizontal overflow — pin to right edge with 8 px margin
    if (popoverRect.right > window.innerWidth - 8) {
      popoverRef.value.style.left = `${window.innerWidth - popoverRect.width - 8}px`;
    }
  });
}

onMounted(repositionPopover);

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible && props.anchorEl) {
      // Pre-decide direction before the popover renders so it never
      // appears off-screen. Use a conservative height estimate (200 px —
      // header + a handful of value rows). repositionPopover will correct
      // if the actual popover height is very different.
      const rect = props.anchorEl.getBoundingClientRect();
      const estimatedHeight = 200;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      flipUpward.value =
        spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
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
    background: var(--o2-wildcard-header-blue-bg);
    color: var(--o2-wildcard-header-blue-text);
  }
  &.wildcard-header-green-2 {
    background: var(--o2-wildcard-header-green-bg);
    color: var(--o2-wildcard-header-green-text);
  }
  &.wildcard-header-orange-2 {
    background: var(--o2-wildcard-header-orange-bg);
    color: var(--o2-wildcard-header-orange-text);
  }
  &.wildcard-header-purple-2 {
    background: var(--o2-wildcard-header-purple-bg);
    color: var(--o2-wildcard-header-purple-text);
  }
  &.wildcard-header-grey-3 {
    background: var(--o2-wildcard-header-grey-bg);
    color: var(--o2-wildcard-header-grey-text);
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

.wildcard-value-count {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  text-align: right;
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--o2-text-primary, #111827);
  line-height: 1.4;

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

.wildcard-value-text-inner {
  position: relative;
  z-index: 1;
}

.wildcard-value-row-actions {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 0.125rem;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.wildcard-value-row:hover .wildcard-value-row-actions {
  opacity: 1;
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
    background: var(--o2-wildcard-bar-blue);
  }
  &.wildcard-bar-green {
    background: var(--o2-wildcard-bar-green);
  }
  &.wildcard-bar-orange {
    background: var(--o2-wildcard-bar-orange);
  }
  &.wildcard-bar-purple {
    background: var(--o2-wildcard-bar-purple);
  }
  &.wildcard-bar-grey {
    background: var(--o2-wildcard-bar-grey);
  }
  &.wildcard-bar-default {
    background: var(--o2-text-muted, #6b7280);
  }
}

</style>
