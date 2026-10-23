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

<!-- Not `inert`: Chromium stops wheel-scrolling inert scroll containers, so a locked page could not be scrolled. -->
<!-- pointerdown is left alone: Reka closes header and sidebar popovers on an outside pointerdown. -->
<template>
  <div
    class="h-full"
    :class="locked ? 'feature-locked-content' : ''"
    data-test="feature-lock-boundary"
    :data-locked-feature="feature ?? undefined"
    @click.capture="block"
    @dblclick.capture="block"
    @submit.capture="block"
    @dragstart.capture="block"
    @dragover.capture="block"
    @drop.capture="block"
    @paste.capture="block"
    @keydown.capture="onKeydown"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { toRef } from "vue";
import { provideFeatureLock } from "@/composables/useFeatureLock";

const props = defineProps<{ feature: string | null }>();

const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);
const CONTROL =
  'a[href], button, input, select, textarea, [contenteditable="true"], [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="combobox"], [role="menuitem"], [role="option"], [role="slider"], [role="separator"]';

const { locked } = provideFeatureLock(toRef(props, "feature"));

const block = (event: Event) => {
  if (!locked.value) return;
  event.preventDefault();
  event.stopPropagation();
};

// Only read-only shortcuts: a page's own Cmd/Ctrl+S or Cmd/Ctrl+Enter would still act.
const READ_SHORTCUTS = new Set(["c", "a", "f", "g"]);

// Tab, copy/select-all/find and scroll keys off a control pass; anything else aimed at the page is swallowed.
const onKeydown = (event: KeyboardEvent) => {
  if (!locked.value || event.key === "Tab") return;
  if ((event.metaKey || event.ctrlKey) && READ_SHORTCUTS.has(event.key.toLowerCase())) return;
  const onControl = (event.target as Element | null)?.closest?.(CONTROL);
  if (!onControl && SCROLL_KEYS.has(event.key)) return;
  block(event);
};
</script>
