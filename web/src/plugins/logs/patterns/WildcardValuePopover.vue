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
    class="wcp tw:w-72 tw:bg-(--o2-card-bg-solid) tw:border tw:border-(--o2-border) tw:rounded-[0.625rem] tw:overflow-hidden tw:shadow-[0_0.5rem_1.5rem_rgba(0,0,0,0.14),0_0.125rem_0.375rem_rgba(0,0,0,0.06)] tw:[animation:wcpIn_0.15s_ease-out]"
    :class="{ 'tw:[animation-name:wcpInUp]': flipUpward }"
    :style="popoverStyle"
    data-test="wildcard-value-popover"
    @mouseenter="$emit('popoverEnter')"
    @mouseleave="$emit('popoverLeave')"
  >
    <!-- ── Header ── -->
    <div
      class="wcp__header tw:flex tw:items-center tw:justify-between tw:gap-2 tw:pt-[0.625rem] tw:px-3 tw:pb-[0.375rem]"
    >
      <div
        class="wcp__header-left tw:flex tw:items-center tw:gap-[0.375rem] tw:min-w-0"
      >
        <OTag
          type="fieldType"
          :value="tokenType"
          :label="tokenType"
          class="wcp__type-badge tw:shrink-0 tw:font-mono tw:font-bold"
        />
        <span
          class="wcp__title tw:text-[0.8125rem] tw:font-semibold tw:text-(--o2-text-heading) tw:truncate"
        >Variable slot · {{ tokenType }}</span>
      </div>
      <div
        class="wcp__header-right tw:flex tw:items-baseline tw:gap-1 tw:shrink-0"
      >
        <span
          class="wcp__unique-count tw:text-sm tw:font-bold tw:text-(--o2-text-heading) tw:[font-variant-numeric:tabular-nums]"
        >{{ displayValues.length }}</span>
        <span
          class="wcp__unique-label tw:text-[0.6875rem] tw:text-(--o2-text-caption)"
        >unique</span>
      </div>
    </div>


    <!-- ── Value rows ── -->
    <div
      class="wcp__body tw:py-1 tw:max-h-80 tw:overflow-y-auto"
    >
      <div
        v-for="(item, i) in displayValues.slice(0, 10)"
        :key="i"
        class="wcp__row tw:px-3 tw:pt-[0.375rem] tw:pb-1"
        :data-test="`wildcard-value-row-${i}`"
      >
        <!-- Value name + count -->
        <div
          class="wcp__row-top tw:flex tw:items-baseline tw:justify-between tw:gap-2 tw:mb-1"
        >
          <span
            class="wcp__row-value tw:text-xs tw:font-semibold tw:font-mono tw:text-(--o2-text-body) tw:truncate tw:flex-1 tw:min-w-0"
          >{{ item.value || "(empty)" }}</span>
          <span
            class="wcp__row-count tw:text-[0.8125rem] tw:font-bold tw:text-(--o2-text-heading) tw:[font-variant-numeric:tabular-nums] tw:shrink-0"
          >{{ item.count.toLocaleString() }}</span>
        </div>
        <!-- Full-width progress bar -->
        <div
          class="wcp__bar-track tw:w-full tw:h-1 tw:bg-(--o2-border-color) tw:rounded-full tw:overflow-hidden tw:mb-[0.1875rem]"
        >
          <div
            class="wcp__bar-fill tw:h-full tw:rounded-full tw:transition-[width] tw:duration-200"
            :class="barColorClass"
            :style="{ width: barWidth(item.count) }"
          />
        </div>
        <!-- Percentage -->
        <div
          class="wcp__row-pct tw:text-[0.625rem] tw:text-(--o2-text-caption) tw:[font-variant-numeric:tabular-nums]"
        >
          {{ totalOccurrences > 0 ? ((item.count / totalOccurrences) * 100).toFixed(1) + '%' : '' }}
        </div>
      </div>

      <div
        v-if="displayValues.length === 0"
        class="wcp__empty tw:py-6 tw:px-3 tw:text-center tw:text-[0.6875rem] tw:text-(--o2-text-muted)"
      >
        {{ t("search.patternNoValuesAvailable") }}
      </div>
    </div>

    <!-- ── Footer ── -->
    <div
      v-if="displayValues.length > 0 && totalOccurrences > 0"
      class="wcp__footer tw:flex tw:items-center tw:justify-end tw:py-[0.4375rem] tw:px-3 tw:border-t tw:border-(--o2-border-color)"
    >
      <span
        class="wcp__occurrences tw:text-[0.6875rem] tw:font-semibold tw:text-(--o2-text-caption) tw:[font-variant-numeric:tabular-nums]"
      >{{ totalOccurrences.toLocaleString() }} occurrences</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { wildcardChipColor, wildcardLabel } from "@/composables/useLogs/useTemplateTokenizer";
import OTag from "@/lib/core/Badge/OTag.vue";
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
  if (cls.includes("blue"))   return "tw:bg-(--o2-wildcard-bar-blue)";
  if (cls.includes("green"))  return "tw:bg-(--o2-wildcard-bar-green)";
  if (cls.includes("orange")) return "tw:bg-(--o2-wildcard-bar-orange)";
  if (cls.includes("purple")) return "tw:bg-(--o2-wildcard-bar-purple)";
  return "tw:bg-(--o2-primary-color)";
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

<style>
/* ── Animation ── */
@keyframes wcpIn    { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes wcpInUp  { from { opacity: 0; transform: translateY(4px);  } to { opacity: 1; transform: none; } }

/* ── Sibling spacing ── */
.wcp__row + .wcp__row {
  padding-top: 0.5rem;
}
</style>
