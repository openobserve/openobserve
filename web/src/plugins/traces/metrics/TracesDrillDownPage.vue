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
    <OPageHeader
      :title="title"
      :back="{
        label: t('traces.drillDownBackTarget'),
        onClick: close,
        dataTest: 'traces-drill-down-back-btn',
      }"
    >
      <template #actions>
        <slot name="actions" />
      </template>
    </OPageHeader>
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <slot />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

defineProps<{
  open: boolean;
  title?: I18nText;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const { t } = useI18nTyped();
const rootRef = ref<HTMLElement | null>(null);

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
  rootRef.value?.querySelector<HTMLElement>('[data-test="traces-drill-down-back-btn"]')?.focus();
});
onBeforeUnmount(() => {
  // Only a Back/Escape close leaves focus here; a close caused by a new search must not steal it.
  const active = document.activeElement;
  const focusWasOnPage = active === document.body || !!rootRef.value?.contains(active);
  setCoveredInert(false);
  document.removeEventListener("keydown", onKeydown);
  if (focusWasOnPage) {
    document.querySelector<HTMLElement>('[data-test="insights-button"]')?.focus();
  }
});
</script>
