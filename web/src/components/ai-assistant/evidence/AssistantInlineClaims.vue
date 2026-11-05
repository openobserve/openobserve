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
  <span ref="anchor" hidden />
  <Teleport v-for="chip in chips" :key="chip.target.id" :to="chip.target.el">
    <AssistantClaimChip
      :n="chip.from"
      :to="chip.to"
      :call-id="chip.target.callId"
      :available="available(chip.target.callId)"
      :label="
        chip.to
          ? t('assistant.claim.range', { from: chip.from, to: chip.to })
          : label(chip.target.callId)
      "
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

import { useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantClaimChip from "./AssistantClaimChip.vue";

/** A run of this many consecutive numbers, cited side by side, reads as one range chip. */
const MIN_RUN = 3;

interface ClaimSlot {
  id: number;
  el: HTMLElement;
  callId: string;
}

const props = defineProps<{
  /** The block's cited call ids; a slot's `data-claim` is an index into it. */
  claims: string[];
  numbers: Map<string, number>;
  available: (callId: string) => boolean;
  label: (callId: string) => I18nText;
}>();

const { t } = useI18nTyped();
const anchor = ref<HTMLElement | null>(null);
const targets = shallowRef<ClaimSlot[]>([]);
const ids = new WeakMap<Element, number>();
let nextId = 0;
let observer: MutationObserver | null = null;

// Each run of MIN_RUN or more adjacent consecutive numbers keeps its first slot as a range chip; the rest render nothing.
const chips = computed(() => {
  const slots = targets.value;
  const result: { target: ClaimSlot; from: number; to?: number }[] = [];
  let start = 0;
  while (start < slots.length) {
    let end = start;
    while (end + 1 < slots.length && continues(slots[end], slots[end + 1])) end++;
    const from = numberOf(slots[start]);
    if (end - start + 1 >= MIN_RUN) {
      result.push({ target: slots[start], from, to: numberOf(slots[end]) });
    } else {
      for (let index = start; index <= end; index++)
        result.push({ target: slots[index], from: numberOf(slots[index]) });
    }
    start = end + 1;
  }
  return result;
});

function numberOf(slot: ClaimSlot): number {
  return props.numbers.get(slot.callId) ?? 0;
}

// Only whitespace may sit between two slots for them to read as one run.
function continues(before: ClaimSlot, after: ClaimSlot): boolean {
  const n = numberOf(before);
  if (!n || numberOf(after) !== n + 1) return false;
  let node = after.el.previousSibling;
  while (node && node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())
    node = node.previousSibling;
  return node === before.el;
}

// Parts fill outside Vue and may replace their slots, so the slots are found again after every fill.
function scan(): void {
  const root = anchor.value?.parentElement;
  if (!root) return;
  const found: ClaimSlot[] = [];
  root.querySelectorAll<HTMLElement>("span[data-claim]").forEach((el) => {
    const callId = props.claims[Number(el.dataset.claim)];
    if (!callId) return;
    if (!ids.has(el)) ids.set(el, nextId++);
    found.push({ id: ids.get(el)!, el, callId });
  });
  const same =
    found.length === targets.value.length &&
    found.every((slot, index) => slot.id === targets.value[index].id);
  if (!same) targets.value = found;
}

onMounted(() => {
  const root = anchor.value?.parentElement;
  if (!root) return;
  observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
  scan();
});

watch(() => props.claims, scan);

onBeforeUnmount(() => observer?.disconnect());
</script>
