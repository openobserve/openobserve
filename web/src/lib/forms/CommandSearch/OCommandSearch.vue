<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { ref, useId } from "vue";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxViewport,
} from "reka-ui";
import type {
  CommandSearchEmits,
  CommandSearchExpose,
  CommandSearchProps,
  CommandSearchSlots,
} from "./OCommandSearch.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { raw } from "@/types/i18n";

const props = withDefaults(defineProps<CommandSearchProps>(), {
  modelValue: "",
  placeholder: undefined,
  shortcutId: undefined,
  countText: undefined,
  emptyText: undefined,
  disabled: false,
});

const emit = defineEmits<CommandSearchEmits>();
defineSlots<CommandSearchSlots>();

const crumbSeparator = raw(" · ");
const inputId = useId();
const rootEl = ref<HTMLElement | null>(null);
const open = ref(false);

const hasText = (): boolean => props.modelValue.trim().length > 0;

const focus = (): void => {
  rootEl.value?.querySelector<HTMLInputElement>("input")?.focus();
};

const onSearch = (value: string): void => {
  emit("update:modelValue", value);
  open.value = value.trim().length > 0;
};

const onOpen = (next: boolean): void => {
  open.value = next && hasText();
};

const onSelect = (value: unknown): void => {
  if (typeof value !== "string" || !value) return;
  open.value = false;
  emit("update:modelValue", "");
  emit("select", value);
};

if (props.shortcutId) {
  useShortcuts([{ id: props.shortcutId, handler: () => focus() }]);
}

defineExpose<CommandSearchExpose>({ focus });
</script>

<template>
  <div ref="rootEl" class="w-full" data-test="o-command-search">
    <ComboboxRoot
      :open="open"
      model-value=""
      :ignore-filter="true"
      :open-on-focus="false"
      :open-on-click="false"
      :reset-search-term-on-blur="false"
      :reset-search-term-on-select="false"
      :disabled="disabled"
      @update:open="onOpen"
      @update:model-value="onSelect"
    >
      <ComboboxAnchor class="relative flex w-full items-center">
        <OIcon
          name="search"
          size="sm"
          class="text-input-placeholder pointer-events-none absolute start-2.5"
        />
        <ComboboxInput
          :id="inputId"
          :model-value="modelValue"
          :placeholder="placeholder"
          :aria-label="label"
          :disabled="disabled"
          auto-complete="off"
          :class="[
            'rounded-default h-[2.125rem] w-full border ps-8 text-sm',
            shortcutId ? 'pe-9' : 'pe-3',
            'bg-input-bg text-input-text placeholder:text-input-placeholder',
            'border-input-border hover:border-input-border-hover transition-[border-color,box-shadow] duration-150 outline-none',
            'focus:border-input-border-focus focus:ring-input-focus-ring focus:ring-2',
            'disabled:bg-input-disabled-bg disabled:text-input-disabled-text disabled:cursor-not-allowed',
          ]"
          data-test="o-command-search-input"
          @update:model-value="onSearch"
          @focus="onOpen(true)"
        />
        <span
          v-if="shortcutId"
          class="pointer-events-none absolute end-2 max-md:hidden"
          data-test="o-command-search-shortcut"
        >
          <OShortcut :id="shortcutId" />
        </span>
      </ComboboxAnchor>

      <ComboboxPortal>
        <ComboboxContent
          position="popper"
          align="start"
          :side-offset="4"
          :class="[
            'z-10001 w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden',
            'rounded-default shadow-overlay bg-select-content-bg border border-transparent',
            'data-[state=open]:animate-[o2-reveal-down-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
            'data-[state=closed]:animate-[o2-reveal-down-out_100ms_cubic-bezier(0.4,0,1,1)]',
          ]"
          data-test="o-command-search-results"
        >
          <div
            v-if="countText && items.length"
            class="text-text-secondary px-3 pt-2 pb-1 text-xs font-medium"
            data-test="o-command-search-count"
          >
            {{ countText }}
          </div>
          <ComboboxViewport
            class="max-h-72 overflow-y-auto p-1 max-lg:max-h-[min(18rem,var(--reka-popper-available-height,18rem))]"
          >
            <ComboboxEmpty
              class="text-text-secondary px-3 py-2 text-sm"
              data-test="o-command-search-empty"
            >
              {{ emptyText }}
            </ComboboxEmpty>
            <ComboboxItem
              v-for="item in items"
              :key="item.id"
              :value="item.id"
              :data-test="`o-command-search-item-${item.id}`"
              class="rounded-default text-select-item-text data-highlighted:bg-select-item-hover-bg flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm outline-none select-none"
            >
              <span class="min-w-0 flex-1">
                <span class="text-text-heading font-medium">{{ item.label }}</span>
                <span
                  v-for="(crumb, index) in item.context ?? []"
                  :key="index"
                  class="text-text-secondary"
                  >{{ crumbSeparator }}{{ crumb }}</span
                >
              </span>
            </ComboboxItem>
          </ComboboxViewport>
          <div
            v-if="$slots.footer"
            class="border-border-default text-text-secondary border-t px-3 py-2 text-xs"
            data-test="o-command-search-footer"
          >
            <slot name="footer" />
          </div>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </div>
</template>
