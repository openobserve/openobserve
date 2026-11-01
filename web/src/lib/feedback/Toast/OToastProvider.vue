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
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { ToastProvider, ToastViewport } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useToast, toastRecords } from "./useToast";
import { copyConfirm, dismissCopyConfirm, trackActivations } from "./copyConfirm";
import { viewportPositionClasses } from "./OToastProvider.types";
import type { ToastPosition } from "./OToast.types";
import OToast from "./OToast.vue";
import { LAYER_ROOT_ATTR } from "@/lib/overlay/Drawer/drawerInset";

const { toasts } = useToast();

// Always render these two positions. Each needs its own ToastProvider so that
// Reka UI's single-viewport-per-provider constraint is satisfied — if all toasts
// shared one provider with two viewports the last-mounted viewport would win and
// all toasts would appear there regardless of their intended position.
const positions: ToastPosition[] = ["bottom-center"];

function toastsForPosition(pos: ToastPosition) {
  return toasts.filter((t) => t.position === pos);
}

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
const bubbleOpen = computed(
  () => copyConfirm.open && !!copyConfirm.anchor && placedAnchor.value === copyConfirm.anchor,
);

let stopTracking: (() => void) | null = null;
onMounted(() => (stopTracking = trackActivations()));
// The bubble lives here, so its timers and scroll fallback must not outlive the provider.
onBeforeUnmount(() => {
  stopTracking?.();
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
  <ToastProvider v-for="pos in positions" :key="pos" swipe-direction="right" :duration="0">
    <OToast
      v-for="t in toastsForPosition(pos)"
      :key="t.id"
      v-bind="t"
      @open-change="(open) => handleOpenChange(t.id, open)"
    />
    <!-- A layer root: a drawer that hides the page leaves toasts and their actions usable. -->
    <ToastViewport :class="viewportPositionClasses[pos]" :[LAYER_ROOT_ATTR]="''" />
  </ToastProvider>
  <OTooltip
    :anchor="copyConfirm.anchor"
    :open="bubbleOpen"
    side="top"
    @update:open="(open) => open || dismissCopyConfirm()"
  >
    <template #content>
      <span
        class="inline-flex items-center gap-1"
        data-test="copy-confirm"
        data-test-variant="success"
        :data-test-message="copyConfirm.message"
      >
        <OIcon name="check" size="sm" />{{ copyConfirm.message }}
      </span>
    </template>
  </OTooltip>
  <div aria-live="polite" aria-atomic="true" class="sr-only" data-test="copy-confirm-announcer">
    {{ copyConfirm.open ? copyConfirm.message : "" }}
  </div>
</template>
