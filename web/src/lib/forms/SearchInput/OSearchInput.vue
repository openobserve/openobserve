<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, normalizeClass, onBeforeUnmount, onMounted, ref, useAttrs } from "vue";
import type {
  SearchInputProps,
  SearchInputEmits,
  SearchInputWidth,
  SearchScopeOption,
} from "./OSearchInput.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18nTyped } from "@/types/i18n";
import { isInputFocused, isInsideDialog } from "@/utils/keyboardShortcuts";

const { t } = useI18nTyped();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex: _tabindex, ...rest } = $attrs;
  return rest;
});
const dataTest = computed(() => $attrs["data-test"] as string | undefined);

// Below md a flex-1 search would keep its input's intrinsic width as its floor and push the toolbar onto a second row.
const mobileFloorClass = (): string =>
  /(^|[\s:])min-w-/.test(normalizeClass($attrs.class)) ? "" : "max-md:min-w-32";

const props = withDefaults(defineProps<SearchInputProps>(), {
  modelValue: "",
  // A literal default ships untranslated and `t()` at module scope freezes the locale, so it resolves per render.
  placeholder: undefined,
  size: "md",
  width: "full",
  scope: undefined,
  scopeOptions: undefined,
  shortcut: undefined,
  debounce: 0,
  loading: false,
  disabled: false,
});

const emit = defineEmits<SearchInputEmits>();

const resolvedPlaceholder = computed(() => props.placeholder ?? t("common.searchEllipsis"));
const shortcutOn = computed(() => (props.shortcut ?? props.size === "md") && !props.disabled);
const hasScope = computed(() => (props.scopeOptions?.length ?? 0) > 1);

const inputRef = ref<(InstanceType<typeof OInput> & { $el?: HTMLElement }) | null>(null);
const focused = ref(false);
const showKeyHint = computed(
  () => shortcutOn.value && !focused.value && !props.modelValue && !hasScope.value,
);

function focus() {
  inputRef.value?.focus();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !props.modelValue) return;
  // Escape clears first; only an empty field lets it reach the overlay or page behind.
  event.stopPropagation();
  emit("update:modelValue", "");
  emit("clear");
}

function scopeTestId(option: SearchScopeOption): string | undefined {
  if (option.dataTest) return option.dataTest;
  return dataTest.value ? `${dataTest.value}-scope-${option.value}` : undefined;
}

const instance = {
  focus,
  isActive: () => shortcutOn.value,
  el: () => (inputRef.value?.$el as HTMLElement | undefined) ?? null,
};
onMounted(() => registerSlashTarget(instance));
onBeforeUnmount(() => unregisterSlashTarget(instance));

defineExpose({ focus });
</script>

<script lang="ts">
// OInput already fills its container; list and scope cap that at 280 and 360 so a row never stretches the search.
const WIDTH_CLASSES: Record<SearchInputWidth, string> = {
  list: "max-w-70",
  scope: "max-w-90",
  full: "",
};

interface SlashTarget {
  focus: () => void;
  isActive: () => boolean;
  el: () => HTMLElement | null;
}
// "/" goes to the newest visible search that asked for it; one page listener serves them all (KB1).
const slashTargets: SlashTarget[] = [];

function onSlash(event: KeyboardEvent) {
  if (event.key !== "/" || event.defaultPrevented) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isInputFocused(event.target) || isInsideDialog(event.target)) return;
  const target = [...slashTargets]
    .reverse()
    .find((s) => s.isActive() && (s.el()?.getClientRects().length ?? 0) > 0);
  if (!target) return;
  event.preventDefault();
  target.focus();
}

function registerSlashTarget(target: SlashTarget) {
  if (slashTargets.length === 0 && typeof window !== "undefined") {
    window.addEventListener("keydown", onSlash);
  }
  slashTargets.push(target);
}

function unregisterSlashTarget(target: SlashTarget) {
  const index = slashTargets.indexOf(target);
  if (index >= 0) slashTargets.splice(index, 1);
  if (slashTargets.length === 0 && typeof window !== "undefined") {
    window.removeEventListener("keydown", onSlash);
  }
}
</script>

<template>
  <OInput
    ref="inputRef"
    v-bind="wrapperAttrs"
    :class="[WIDTH_CLASSES[width], mobileFloorClass()]"
    :model-value="modelValue"
    :placeholder="resolvedPlaceholder"
    :size="size"
    clearable
    :debounce="debounce"
    :disabled="disabled"
    :tabindex="inputTabindex"
    @update:model-value="emit('update:modelValue', $event as string)"
    @clear="emit('clear')"
    @keydown="onKeydown"
    @focus="focused = true"
    @blur="focused = false"
  >
    <template #icon>
      <OSpinner v-if="loading" size="sm" :data-test="dataTest && `${dataTest}-loading`" />
      <OIcon v-else name="search" size="sm" />
    </template>
    <template v-if="showKeyHint || hasScope" #icon-end>
      <OShortcut v-if="showKeyHint" keys="/" :data-test="dataTest && `${dataTest}-shortcut`" />
      <OToggleGroup
        v-if="hasScope"
        size="sm"
        :model-value="scope"
        type="single"
        class="self-center"
        :data-test="dataTest && `${dataTest}-scope`"
        @update:model-value="emit('update:scope', String($event))"
      >
        <OToggleGroupItem
          v-for="option in scopeOptions"
          :key="option.value"
          :value="option.value"
          :icon-left="option.icon"
          :tooltip="option.tooltip"
          :data-test="scopeTestId(option)"
          ><span class="max-md:hidden">{{ option.label }}</span></OToggleGroupItem
        >
      </OToggleGroup>
    </template>
  </OInput>
</template>
