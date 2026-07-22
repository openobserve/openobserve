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
    class="wcp w-72 bg-card-glass-solid border border-border-default rounded-default overflow-hidden shadow-[0_0.5rem_1.5rem_rgba(0,0,0,0.14),0_0.125rem_0.375rem_rgba(0,0,0,0.06)]"
    :class="{ 'wcp--flip-up': flipUpward }"
    :style="popoverStyle"
    data-test="wildcard-value-popover"
    @mouseenter="$emit('popoverEnter')"
    @mouseleave="$emit('popoverLeave')"
  >
    <!-- ── Header ── -->
    <div class="wcp__header flex items-center justify-between gap-2 pt-2.5 px-3 pb-1.5">
      <div class="wcp__header-left flex items-center gap-1.5 min-w-0">
        <OTag
          type="fieldType"
          :value="tokenType"
          :label="tokenType"
          class="wcp__type-badge shrink-0 font-mono font-bold"
        />
        <span class="wcp__title text-compact font-semibold text-text-heading truncate">{{
          t("logs.wildcardValuePopover.variableSlot", { type: tokenType })
        }}</span>
      </div>
      <div class="wcp__header-right flex items-baseline gap-1 shrink-0">
        <span
          class="wcp__unique-count text-sm font-bold text-text-body [font-variant-numeric:tabular-nums]"
          >{{ displayValues.length }}</span
        >
        <span class="wcp__unique-label text-2xs text-text-secondary">{{
          t("logs.wildcardValuePopover.unique")
        }}</span>
      </div>
    </div>

    <!-- ── Value rows ── -->
    <div class="wcp__body py-1 max-h-80 overflow-y-auto">
      <div
        v-for="(item, i) in displayValues.slice(0, 10)"
        :key="i"
        class="wcp__row px-3 pt-1.5 pb-1 not-first:pt-2"
        :data-test="`wildcard-value-row-${i}`"
      >
        <!-- Value name + count -->
        <div class="wcp__row-top flex items-baseline justify-between gap-2 mb-1">
          <span
            class="wcp__row-value text-xs font-semibold font-mono text-text-body truncate flex-1 min-w-0"
            >{{ item.value || t("logs.wildcardValuePopover.empty") }}</span
          >
          <span
            class="wcp__row-count text-compact font-bold text-text-body [font-variant-numeric:tabular-nums] shrink-0"
            >{{ item.count.toLocaleString() }}</span
          >
        </div>
        <!-- Full-width progress bar -->
        <div
          class="wcp__bar-track w-full h-1 bg-card-glass-border rounded-full overflow-hidden mb-[0.1875rem]"
        >
          <div
            class="wcp__bar-fill h-full rounded-full transition-[width] duration-200"
            :class="barColorClass"
            :style="{ width: barWidth(item.count) }"
          />
        </div>
        <!-- Percentage -->
        <div class="wcp__row-pct text-3xs text-text-secondary [font-variant-numeric:tabular-nums]">
          {{ totalOccurrences > 0 ? ((item.count / totalOccurrences) * 100).toFixed(1) + "%" : "" }}
        </div>
      </div>

      <div
        v-if="displayValues.length === 0"
        class="wcp__empty py-6 px-3 text-center text-2xs text-text-muted"
      >
        {{ t("search.patternNoValuesAvailable") }}
      </div>
    </div>

    <!-- ── Footer ── -->
    <div
      v-if="displayValues.length > 0 && totalOccurrences > 0"
      class="wcp__footer flex items-center justify-end py-[0.4375rem] px-3 border-t border-card-glass-border"
    >
      <span
        class="wcp__occurrences text-2xs font-semibold text-text-secondary [font-variant-numeric:tabular-nums]"
        >{{
          t("logs.wildcardValuePopover.occurrences", { count: totalOccurrences.toLocaleString() })
        }}</span
      >
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

defineEmits<{
  (e: "popoverEnter"): void;
  (e: "popoverLeave"): void;
  (e: "filter-value", value: string, action: "include" | "exclude"): void;
}>();

const { t } = useI18n();
const popoverRef = ref<HTMLElement | null>(null);
const flipUpward = ref(false);

const tokenType = computed(() => wildcardLabel(props.token, props.displayValues));

const totalOccurrences = computed(() => props.displayValues.reduce((sum, v) => sum + v.count, 0));

const maxCount = computed(() => Math.max(...props.displayValues.map((v) => v.count), 1));

const barWidth = (count: number): string => {
  if (!count) return "0%";
  return `${Math.max((count / maxCount.value) * 100, 2)}%`;
};

const barColorClass = computed(() => {
  const cls = wildcardChipColor(props.token, props.displayValues);
  if (cls.includes("blue")) return "bg-wildcard-bar-blue";
  if (cls.includes("green")) return "bg-wildcard-bar-green";
  if (cls.includes("orange")) return "bg-wildcard-bar-orange";
  if (cls.includes("purple")) return "bg-wildcard-bar-purple";
  return "bg-accent";
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

<style scoped>
/* keep(keyframes): the popover entrance is used only here. Both the `animation`
   and the flipped variant's `animation-name` are declared in this block rather
   than as template `[animation:…]` / `[animation-name:…]` utilities, so Vue's
   scoped compiler renames the keyframes and both references together.
   `.wcp--flip-up` follows `.wcp`, so the flipped name wins on source order. */
.wcp {
  animation: pop-in 0.15s ease-out;
}

.wcp--flip-up {
  animation-name: pop-in-up;
}

@keyframes pop-in {
  from {
    opacity: 0;
    transform: translateY(-0.25rem);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes pop-in-up {
  from {
    opacity: 0;
    transform: translateY(0.25rem);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
