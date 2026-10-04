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
    v-if="open"
    ref="rootRef"
    class="bg-surface-panel flex h-full w-full flex-col overflow-hidden"
  >
    <div class="border-border-default flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <OButton
        ref="backBtnRef"
        data-test="traces-drill-down-back-btn"
        variant="outline"
        size="xs"
        icon-left="arrow-back"
        @click="close"
      >
        {{ t("traces.backToResults") }}
      </OButton>
      <span class="text-text-heading min-w-0 truncate text-base font-semibold">{{ title }}</span>
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <slot name="header-left" />
      </div>
    </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <slot />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

defineProps<{
  open: boolean;
  title?: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const { t } = useI18nTyped();
const rootRef = ref<HTMLElement | null>(null);
const backBtnRef = ref<{ $el?: HTMLElement } | null>(null);

const close = () => emit("update:open", false);

// Content this page covers stays in the DOM to keep its state, so it must not take focus.
const coveredSiblings: Element[] = [];
const setCoveredInert = (inert: boolean) => {
  if (!inert) {
    coveredSiblings.splice(0).forEach((el) => el.removeAttribute("inert"));
    return;
  }
  const host = rootRef.value?.parentElement;
  for (const el of Array.from(host?.parentElement?.children ?? [])) {
    if (el !== host && !el.hasAttribute("inert")) {
      el.setAttribute("inert", "");
      coveredSiblings.push(el);
    }
  }
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const target = e.target as Node | null;
  // Popovers opened from the page are teleported to body and own their Escape.
  if (target === document.body || (target && rootRef.value?.contains(target))) close();
};

onMounted(() => {
  setCoveredInert(true);
  document.addEventListener("keydown", onKeydown);
  backBtnRef.value?.$el?.focus?.();
});
onBeforeUnmount(() => {
  setCoveredInert(false);
  document.removeEventListener("keydown", onKeydown);
  document.querySelector<HTMLElement>('[data-test="insights-button"]')?.focus();
});
</script>
