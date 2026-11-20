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

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { ToastProvider, ToastViewport } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useToast, toastRecords } from "./useToast";
import { copyConfirm, dismissCopyConfirm, trackActivations } from "./copyConfirm";
import { TOAST_AVOID_ATTR, TOAST_AVOID_BAND_REM } from "./OToastProvider.types";
import OToast from "./OToast.vue";

const { toasts } = useToast();

// Bars docked at the viewport's bottom edge (table footer, selection bar, sticky Save) lift the toasts above them (D6).
const coveredBottom = ref(0);
function measureCoveredBottom(): void {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const edge = window.innerHeight - TOAST_AVOID_BAND_REM * rem;
  let covered = 0;
  for (const bar of document.querySelectorAll<HTMLElement>(`[${TOAST_AVOID_ATTR}]`)) {
    const box = bar.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || box.bottom < edge) continue;
    covered = Math.max(covered, window.innerHeight - box.top);
  }
  coveredBottom.value = Math.max(0, Math.round(covered));
}
// A measured length, so it travels as a runtime style value rather than a class.
const viewportStyle = computed(() => ({
  bottom: `calc(1rem + ${coveredBottom.value}px)`,
}));
watch(
  () => toasts.length,
  (count) => {
    if (count > 0) measureCoveredBottom();
  },
  { flush: "post" },
);
const onResize = () => {
  if (toasts.length > 0) measureCoveredBottom();
};

// The tooltip adopts a new anchor only after rendering, so opening in that render places the bubble top-left.
const placedAnchor = shallowRef<HTMLElement | null>(null);
let placeFrame = 0;
watch(
  () => copyConfirm.anchor,
  (anchor) => {
    placedAnchor.value = null;
    placeFrame = requestAnimationFrame(() => {
      if (copyConfirm.anchor === anchor) placedAnchor.value = anchor;
    });
  },
  { flush: "post", immediate: true },
);
const failed = computed(() => copyConfirm.tone === "error");
// `!` because OTooltip's own surface classes would otherwise win or lose by stylesheet order.
const bubbleClass = computed(() =>
  failed.value
    ? "bg-copy-confirm-error-bg! border border-status-error-text/40"
    : "bg-copy-confirm-bg! text-copy-confirm-text!",
);
const bubbleArrowClass = computed(() =>
  failed.value ? "fill-copy-confirm-error-bg" : "fill-copy-confirm-bg",
);
const bubbleOpen = computed(
  () => copyConfirm.open && !!copyConfirm.anchor && placedAnchor.value === copyConfirm.anchor,
);

let stopTracking: (() => void) | null = null;
onMounted(() => {
  stopTracking = trackActivations();
  window.addEventListener("resize", onResize);
});
// The bubble lives here, so its timers and scroll fallback must not outlive the provider.
onBeforeUnmount(() => {
  stopTracking?.();
  window.removeEventListener("resize", onResize);
  dismissCopyConfirm();
  cancelAnimationFrame(placeFrame);
});

function handleOpenChange(id: string, open: boolean): void {
  if (!open) {
    const idx = toastRecords.findIndex((r) => r.id === id);
    if (idx !== -1) {
      const record = toastRecords[idx];
      record.onDismiss?.();
      toastRecords.splice(idx, 1);
    }
  }
}
</script>

<template>
  <ToastProvider swipe-direction="down" :duration="0">
    <OToast
      v-for="t in toasts"
      :key="t.id"
      :id="t.id"
      :open="t.open"
      :variant="t.variant"
      :message="t.message"
      :timeout="t.timeout"
      :action="t.action"
      :count="t.count"
      @open-change="(open) => handleOpenChange(t.id, open)"
    />
    <ToastViewport
      class="fixed left-1/2 z-10001 flex -translate-x-1/2 flex-col-reverse items-center gap-2"
      :style="viewportStyle"
      data-test="o-toast-viewport"
    />
  </ToastProvider>
  <OTooltip
    :anchor="copyConfirm.anchor"
    :open="bubbleOpen"
    :side="copyConfirm.side"
    :content-class="bubbleClass"
    :arrow-class="bubbleArrowClass"
    @update:open="(open) => open || dismissCopyConfirm()"
  >
    <template #content>
      <span
        :class="['inline-flex items-center gap-1', failed && 'text-status-error-text']"
        data-test="copy-confirm"
        :data-test-side="copyConfirm.side"
        :data-test-variant="copyConfirm.tone"
        :data-test-message="copyConfirm.message"
      >
        <OIcon :name="failed ? 'error-outline' : 'check'" size="sm" />{{ copyConfirm.message }}
      </span>
    </template>
  </OTooltip>
  <div aria-live="polite" aria-atomic="true" class="sr-only" data-test="copy-confirm-announcer">
    {{ copyConfirm.open && !failed ? copyConfirm.message : "" }}
  </div>
  <!-- An alert is announced when it is inserted, so it exists only while the failure shows. -->
  <div
    v-if="copyConfirm.open && failed"
    role="alert"
    class="sr-only"
    data-test="copy-confirm-alert"
  >
    {{ copyConfirm.message }}
  </div>
</template>
