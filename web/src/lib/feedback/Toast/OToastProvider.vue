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
import { ToastProvider, ToastViewport } from "reka-ui";
import { useToast } from "./useToast";
import { toastRecords } from "./useToast";
import { viewportPositionClasses } from "./OToastProvider.types";
import type { ToastPosition } from "./OToast.types";
import OToast from "./OToast.vue";

const { toasts } = useToast();

// Always render these two positions. Each needs its own ToastProvider so that
// Reka UI's single-viewport-per-provider constraint is satisfied — if all toasts
// shared one provider with two viewports the last-mounted viewport would win and
// all toasts would appear there regardless of their intended position.
const positions: ToastPosition[] = ["bottom-center"];

function toastsForPosition(pos: ToastPosition) {
  return toasts.filter((t) => t.position === pos);
}

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
    <ToastViewport :class="viewportPositionClasses[pos]" />
  </ToastProvider>
</template>
