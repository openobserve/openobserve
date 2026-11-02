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
  <OPopover
    :open="!!actionNotice"
    :anchor="actionNotice?.el ?? null"
    side="bottom"
    align="end"
    flip-align
    arrow
    :close-on-scroll="false"
    :side-offset="-1"
    :collision-padding="8"
    content-class="border-0!"
    @update:open="onOpenChange"
    @open-auto-focus="keepFocus"
    @focus-outside="keepWhileOnAnchor"
  >
    <OAccessDeniedCard
      ref="card"
      :denials="denials"
      role="alert"
      data-test="access-action-error"
      @keydown="onCardKeydown"
    />
    <template #arrow>
      <path class="fill-dropdown-bg" d="M0 0L6 6L12 0Z" />
      <path class="fill-banner-error-soft-bg" d="M0 0L6 6L12 0Z" />
      <path class="stroke-banner-error-soft-border fill-none" d="M0 0L6 6L12 0" />
    </template>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OAccessDeniedCard from "@/components/access/OAccessDeniedCard.vue";
import { useAccessBoundary, type AccessDenial } from "@/composables/useAccessStore";

const { actionNotice, dismissAction } = useAccessBoundary();
const card = ref<{ focus: () => void; $el?: Element } | null>(null);

const denials = computed<AccessDenial[]>(() => actionNotice.value?.denials ?? []);

const anchorEl = (): HTMLElement | null => {
  const el = actionNotice.value?.el;
  return el instanceof HTMLElement ? el : null;
};
const cardEl = (): Element | null => card.value?.$el ?? null;
const focusInCard = () => !!cardEl()?.contains(document.activeElement);

function onOpenChange(open: boolean): void {
  if (open || !actionNotice.value) return;
  const anchor = anchorEl();
  // The card lives in a portal, so closing it from inside would drop focus to the page start.
  if (focusInCard()) anchor?.focus();
  dismissAction();
}

// The control the user just pressed keeps focus; the error is announced through role="alert".
function keepFocus(event: Event): void {
  event.preventDefault();
}

function keepWhileOnAnchor(event: Event): void {
  const target = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent?.target;
  if (target instanceof Node && anchorEl()?.contains(target)) event.preventDefault();
}

// The portal sits at the end of the page, so Tab from the pressed control would never reach the card.
function onAnchorKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)
    return;
  event.preventDefault();
  card.value?.focus();
}

watch(
  () => actionNotice.value?.el,
  (el, _old, onCleanup) => {
    if (!(el instanceof HTMLElement)) return;
    el.addEventListener("keydown", onAnchorKeydown);
    onCleanup(() => el.removeEventListener("keydown", onAnchorKeydown));
  },
  { immediate: true },
);

// Tabbing out of either end of the card returns to the pressed control, which keeps the user's place on the page.
function onCardKeydown(event: KeyboardEvent): void {
  const root = cardEl();
  if (event.key !== "Tab" || !root) return;
  const buttons = [...root.querySelectorAll<HTMLElement>("button:not([disabled])")];
  const leavingStart = event.shiftKey && document.activeElement === root;
  const leavingEnd = !event.shiftKey && document.activeElement === buttons[buttons.length - 1];
  if (!leavingStart && !leavingEnd) return;
  event.preventDefault();
  anchorEl()?.focus();
  if (leavingEnd) dismissAction();
}
</script>
