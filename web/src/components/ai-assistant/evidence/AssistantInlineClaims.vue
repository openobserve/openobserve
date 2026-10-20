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
  <Teleport v-for="target in targets" :key="target.id" :to="target.el">
    <AssistantClaimChip
      :n="numbers.get(target.callId) ?? 0"
      :call-id="target.callId"
      :available="available(target.callId)"
      :label="label(target.callId)"
      :sid="sid"
      :readonly="readonly"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

import type { Sid } from "@/composables/assistant/pure";
import type { I18nText } from "@/types/i18n";

import AssistantClaimChip from "./AssistantClaimChip.vue";

interface ClaimSlot {
  id: number;
  el: HTMLElement;
  callId: string;
}

const props = withDefaults(
  defineProps<{
    /** The block's cited call ids; a slot's `data-claim` is an index into it. */
    claims: string[];
    numbers: Map<string, number>;
    available: (callId: string) => boolean;
    label: (callId: string) => I18nText;
    sid?: Sid | null;
    readonly?: boolean;
  }>(),
  { sid: null, readonly: false },
);

const anchor = ref<HTMLElement | null>(null);
const targets = shallowRef<ClaimSlot[]>([]);
const ids = new WeakMap<Element, number>();
let nextId = 0;
let observer: MutationObserver | null = null;

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
