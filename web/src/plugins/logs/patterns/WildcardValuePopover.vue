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
    class="wcp"
    :class="{ 'wcp--flip-up': flipUpward }"
    :style="popoverStyle"
    data-test="wildcard-value-popover"
    @mouseenter="$emit('popoverEnter')"
    @mouseleave="$emit('popoverLeave')"
  >
    <!-- ── Header ── -->
    <div class="wcp__header">
      <div class="wcp__header-left">
        <OBadge variant="default-soft" size="sm" class="wcp__type-badge">
          {{ tokenType }}
        </OBadge>
        <span class="wcp__title">Variable slot · {{ tokenType }}</span>
      </div>
      <div class="wcp__header-right">
        <span class="wcp__unique-count">{{ displayValues.length }}</span>
        <span class="wcp__unique-label">unique</span>
      </div>
    </div>


    <!-- ── Value rows ── -->
    <div class="wcp__body">
      <div
        v-for="(item, i) in displayValues.slice(0, 10)"
        :key="i"
        class="wcp__row"
        :data-test="`wildcard-value-row-${i}`"
      >
        <!-- Value name + count -->
        <div class="wcp__row-top">
          <span class="wcp__row-value">{{ item.value || "(empty)" }}</span>
          <span class="wcp__row-count">{{ item.count.toLocaleString() }}</span>
        </div>
        <!-- Full-width progress bar -->
        <div class="wcp__bar-track">
          <div
            class="wcp__bar-fill"
            :class="barColorClass"
            :style="{ width: barWidth(item.count) }"
          />
        </div>
        <!-- Percentage -->
        <div class="wcp__row-pct">
          {{ totalOccurrences > 0 ? ((item.count / totalOccurrences) * 100).toFixed(1) + '%' : '' }}
        </div>
      </div>

      <div
        v-if="displayValues.length === 0"
        class="wcp__empty"
      >
        {{ t("search.patternNoValuesAvailable") }}
      </div>
    </div>

    <!-- ── Footer ── -->
    <div v-if="displayValues.length > 0 && totalOccurrences > 0" class="wcp__footer">
      <span class="wcp__occurrences">{{ totalOccurrences.toLocaleString() }} occurrences</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { wildcardChipColor, wildcardLabel } from "@/composables/useLogs/useTemplateTokenizer";
import OBadge from "@/lib/core/Badge/OBadge.vue";
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

const tokenType = computed(() => wildcardLabel(props.token, props.displayValues));

const totalOccurrences = computed(() =>
  props.displayValues.reduce((sum, v) => sum + v.count, 0),
);

const maxCount = computed(() =>
  Math.max(...props.displayValues.map((v) => v.count), 1),
);

const barWidth = (count: number): string => {
  if (!count) return "0%";
  return `${Math.max((count / maxCount.value) * 100, 2)}%`;
};

const barColorClass = computed(() => {
  const cls = wildcardChipColor(props.token, props.displayValues);
  if (cls.includes("blue"))   return "wcp__bar--blue";
  if (cls.includes("green"))  return "wcp__bar--green";
  if (cls.includes("orange")) return "wcp__bar--orange";
  if (cls.includes("purple")) return "wcp__bar--purple";
  return "wcp__bar--default";
});

// ── Positioning ──────────────────────────────────────────────────────────────
const popoverStyle = computed(() => {
  if (!props.anchorEl) return { display: "none" };
  const rect = props.anchorEl.getBoundingClientRect();
  const gap = 6;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 320));
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
    const r = popoverRef.value.getBoundingClientRect();
    if (!flipUpward.value && r.bottom > window.innerHeight - 8) flipUpward.value = true;
    if (flipUpward.value && r.top < 8) flipUpward.value = false;
    if (r.right > window.innerWidth - 8) {
      popoverRef.value.style.left = `${window.innerWidth - r.width - 8}px`;
    }
  });
}

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible && props.anchorEl) {
      const rect = props.anchorEl.getBoundingClientRect();
      const estimatedHeight = 260;
      flipUpward.value =
        window.innerHeight - rect.bottom < estimatedHeight &&
        rect.top > window.innerHeight - rect.bottom;
      repositionPopover();
    }
  },
);
</script>

<style scoped lang="scss">
/* ── Container ── */
.wcp {
  width: 18rem;
  background: var(--o2-card-bg-solid, #ffffff);
  border: 1px solid var(--o2-border, #e5e7eb);
  border-radius: 0.625rem;
  box-shadow:
    0 0.5rem 1.5rem rgba(0, 0, 0, 0.14),
    0 0.125rem 0.375rem rgba(0, 0, 0, 0.06);
  overflow: hidden;
  animation: wcpIn 0.15s ease-out;
}

.wcp--flip-up { animation-name: wcpInUp; }

@keyframes wcpIn    { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes wcpInUp  { from { opacity: 0; transform: translateY(4px);  } to { opacity: 1; transform: none; } }

/* ── Header ── */
.wcp__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem 0.375rem;
}

.wcp__header-left {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.wcp__type-badge {
  flex-shrink: 0;
  font-family: monospace;
  font-weight: 700;
}

.wcp__title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--o2-text-heading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wcp__header-right {
  display: flex;
  align-items: baseline;
  gap: 0.25rem;
  flex-shrink: 0;
}

.wcp__unique-count {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--o2-text-heading);
  font-variant-numeric: tabular-nums;
}

.wcp__unique-label {
  font-size: 0.6875rem;
  color: var(--o2-text-caption);
}


/* ── Body ── */
.wcp__body {
  padding: 0.25rem 0;
  max-height: 20rem;
  overflow-y: auto;
}

/* ── Value row ── */
.wcp__row {
  padding: 0.375rem 0.75rem 0.25rem;
}

.wcp__row + .wcp__row {
  padding-top: 0.5rem;
}

.wcp__row-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.wcp__row-value {
  font-size: 0.75rem;
  font-weight: 600;
  font-family: monospace;
  color: var(--o2-text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.wcp__row-count {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--o2-text-heading);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.wcp__bar-track {
  width: 100%;
  height: 0.25rem;
  background: var(--o2-border-color);
  border-radius: 9999px;
  overflow: hidden;
  margin-bottom: 0.1875rem;
}

.wcp__bar-fill {
  height: 100%;
  border-radius: 9999px;
  transition: width 0.2s ease;

  &.wcp__bar--blue    { background: var(--o2-wildcard-bar-blue,   #6366f1); }
  &.wcp__bar--green   { background: var(--o2-wildcard-bar-green,  #10b981); }
  &.wcp__bar--orange  { background: var(--o2-wildcard-bar-orange, #f59e0b); }
  &.wcp__bar--purple  { background: var(--o2-wildcard-bar-purple, #8b5cf6); }
  &.wcp__bar--default { background: var(--o2-primary-color,       #6366f1); }
}

.wcp__row-pct {
  font-size: 0.625rem;
  color: var(--o2-text-caption);
  font-variant-numeric: tabular-nums;
}

/* ── Empty ── */
.wcp__empty {
  padding: 1.5rem 0.75rem;
  text-align: center;
  font-size: 0.6875rem;
  color: var(--o2-text-muted);
}

/* ── Footer ── */
.wcp__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0.4375rem 0.75rem;
  border-top: 1px solid var(--o2-border-color);
}

.wcp__occurrences {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--o2-text-caption);
  font-variant-numeric: tabular-nums;
}
</style>
