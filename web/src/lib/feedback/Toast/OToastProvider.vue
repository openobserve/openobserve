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
import { computed } from "vue"
import { ToastProvider, ToastViewport } from "reka-ui"
import { useToast } from "./useToast"
import { toastRecords } from "./useToast"
import { viewportPositionClasses } from "./OToastProvider.types"
import type { ToastPosition } from "./OToast.types"
import OToast from "./OToast.vue"

const { toasts } = useToast()

// Collect distinct positions from active toasts.
// NOTE: For the initial implementation a single bottom-right viewport is used.
// Multi-position support (one viewport per position bucket) will be added in a
// follow-up once the full Quasar migration is complete. See toast.md § 4.
const activePositions = computed<ToastPosition[]>(() => {
  const seen = new Set<ToastPosition>()
  for (const t of toasts) {
    seen.add(t.position)
  }
  // Always show at least the default position so the viewport is mounted
  seen.add("bottom-right")
  return [...seen]
})

function handleOpenChange(id: string, open: boolean): void {
  if (!open) {
    // Remove the record after Reka's exit animation finishes
    const idx = toastRecords.findIndex((r) => r.id === id)
    if (idx !== -1) {
      toastRecords.splice(idx, 1)
    }
  }
}
</script>

<template>
  <ToastProvider swipe-direction="right" :duration="0">
    <OToast
      v-for="t in toasts"
      :key="t.id"
      v-bind="t"
      @open-change="(open) => handleOpenChange(t.id, open)"
    />

    <ToastViewport
      v-for="pos in activePositions"
      :key="pos"
      :class="viewportPositionClasses[pos]"
    />
  </ToastProvider>
</template>
