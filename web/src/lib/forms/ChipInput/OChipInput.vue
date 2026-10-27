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
import { computed, nextTick, ref, watch } from "vue";
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type {
  ChipInputEmits,
  ChipInputExpose,
  ChipInputProps,
  ChipInputSlots,
} from "./OChipInput.types";

const props = withDefaults(defineProps<ChipInputProps>(), {
  placeholder: undefined,
  searchPlaceholder: undefined,
  anchor: null,
  emptyText: undefined,
  loading: false,
  autoHighlight: true,
  multiple: false,
  disabled: false,
  size: "md",
  appearance: "field",
  ariaLabel: undefined,
  dataTest: undefined,
});
const emit = defineEmits<ChipInputEmits>();
defineSlots<ChipInputSlots>();

const rootRef = ref<HTMLElement | null>(null);
const addRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const highlighted = ref(-1);

const listId = `o-chip-input-${Math.random().toString(36).slice(2, 9)}`;

const showList = computed(() => props.open && !props.disabled);
const anchorElement = computed(() => props.anchor ?? addRef.value ?? undefined);

const fieldClasses = computed(() => [
  "rounded-default border px-1.5 py-0.75 transition-[border-color,box-shadow] duration-150",
  props.disabled
    ? "bg-input-disabled-bg border-input-disabled-border border-dashed"
    : "bg-input-bg border-input-border hover:border-input-border-hover",
  showList.value ? "border-input-border-focus ring-focus-ring-accent ring-[0.125rem]" : "",
]);

const sizeClasses = computed(() => (props.size === "sm" ? "min-h-8 text-xs" : "min-h-9 text-sm"));

const testId = (suffix: string) => (props.dataTest ? `${props.dataTest}-${suffix}` : undefined);

watch(
  () => [props.suggestions.map((s) => s.key).join("\u0000"), props.autoHighlight, props.open],
  () => {
    highlighted.value = props.autoHighlight && props.suggestions.length ? 0 : -1;
  },
  { immediate: true },
);

watch(highlighted, async (index) => {
  if (index < 0) return;
  await nextTick();
  listRef.value
    ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    ?.scrollIntoView({ block: "nearest" });
});

// Each newly opened step selects its search text, so typing replaces a value being edited.
watch([showList, anchorElement], async ([shown]) => {
  if (!shown) return;
  await nextTick();
  inputRef.value?.focus();
  inputRef.value?.select();
});

function focus() {
  addRef.value?.focus();
}

defineExpose<ChipInputExpose>({ focus });

function move(step: number) {
  const count = props.suggestions.length;
  if (!count) return;
  highlighted.value = (highlighted.value + step + count) % count;
}

function onEnter(event: KeyboardEvent) {
  event.preventDefault();
  const active = props.suggestions[highlighted.value];
  if (active) emit("select", active.key);
  else emit("enter");
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      move(1);
      return;
    case "ArrowUp":
      event.preventDefault();
      move(-1);
      return;
    case "Enter":
      onEnter(event);
      return;
    case "Escape":
      event.preventDefault();
      emit("escape");
      focus();
      return;
    case "Backspace":
      if (props.modelValue === "") {
        event.preventDefault();
        emit("backspace-empty");
      }
      return;
    case ",":
      event.preventDefault();
      emit("separator", ",");
  }
}

function onAddKeydown(event: KeyboardEvent) {
  if (event.isComposing || props.disabled) return;
  if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
    event.preventDefault();
    emit("activate", "");
  } else if (event.key === "Backspace") {
    event.preventDefault();
    emit("backspace-empty");
  } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    emit("activate", event.key);
  }
}

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}

// A pointerdown inside the field (a chip, the add target) is not an outside interaction.
function onInteractOutside(event: Event) {
  if (rootRef.value?.contains(event.target as Node)) event.preventDefault();
  else emit("close");
}

function onFieldPointerDown(event: PointerEvent) {
  if (props.disabled || event.target !== rootRef.value) return;
  event.preventDefault();
  emit("activate", "");
}
</script>

<template>
  <PopoverRoot :open="showList">
    <PopoverAnchor as-child :reference="anchorElement">
      <div
        ref="rootRef"
        :data-test="testId('field')"
        :class="[
          'flex w-full min-w-0 cursor-text flex-wrap items-center gap-1',
          sizeClasses,
          appearance === 'plain' ? 'px-0.5 py-0.75' : fieldClasses,
          disabled ? 'cursor-not-allowed' : '',
        ]"
        @pointerdown="onFieldPointerDown"
      >
        <slot />
        <span
          ref="addRef"
          role="button"
          :tabindex="disabled ? -1 : 0"
          :aria-label="ariaLabel"
          :aria-expanded="showList"
          :aria-controls="listId"
          :data-test="testId('add')"
          class="text-text-secondary rounded-default focus-visible:ring-focus-ring-accent flex min-h-6 min-w-8 flex-1 items-center px-1 outline-none focus-visible:ring-2"
          @click="!disabled && emit('activate', '')"
          @keydown="onAddKeydown"
        >
          <OTruncatedText v-if="placeholder" class="min-w-0">{{ placeholder }}</OTruncatedText>
          <OIcon v-else name="add" size="xs" />
        </span>
        <div v-if="$slots.trailing" class="ms-auto flex shrink-0 items-center gap-1">
          <slot name="trailing" />
        </div>
      </div>
    </PopoverAnchor>
    <PopoverPortal>
      <!-- The raw var() is reka's measured popover space, not a design token. -->
      <PopoverContent
        align="start"
        :side-offset="4"
        :hide-when-detached="true"
        :disable-outside-pointer-events="false"
        :collision-padding="8"
        :data-test="testId('suggest')"
        class="rounded-default bg-select-content-bg border-select-content-border z-10001 flex w-max max-w-[min(20rem,calc(100vw-1.5rem))] min-w-52 flex-col overflow-hidden border shadow-md"
        :style="{ maxHeight: 'min(20rem, var(--reka-popover-content-available-height, 20rem))' }"
        @open-auto-focus.prevent
        @close-auto-focus.prevent
        @interact-outside="onInteractOutside"
        @escape-key-down.prevent
      >
        <div class="border-select-content-border flex items-center gap-2 border-b px-2.5">
          <OIcon name="search" size="xs" class="text-text-secondary shrink-0" />
          <input
            ref="inputRef"
            :value="modelValue"
            type="text"
            role="combobox"
            autocomplete="off"
            spellcheck="false"
            aria-expanded="true"
            :aria-controls="listId"
            :aria-activedescendant="highlighted >= 0 ? `${listId}-${highlighted}` : undefined"
            :aria-label="searchPlaceholder ?? ariaLabel"
            :placeholder="searchPlaceholder"
            :data-test="testId('input')"
            class="text-text-body placeholder:text-text-secondary min-w-0 flex-1 border-0 bg-transparent py-1.5 text-xs outline-none"
            @input="onInput"
            @keydown="onKeydown"
          />
          <OSpinner v-if="loading" size="xs" />
        </div>
        <div
          :id="listId"
          ref="listRef"
          role="listbox"
          :aria-multiselectable="multiple || undefined"
          :aria-label="searchPlaceholder ?? ariaLabel"
          class="min-h-0 flex-1 overflow-y-auto p-1"
        >
          <div
            v-for="(suggestion, index) in suggestions"
            :id="`${listId}-${index}`"
            :key="suggestion.key"
            role="option"
            :aria-selected="multiple ? Boolean(suggestion.selected) : index === highlighted"
            :data-index="index"
            :data-active="index === highlighted ? '' : undefined"
            :data-test="testId(`suggest-item-${suggestion.key}`)"
            class="rounded-default text-select-item-text data-active:bg-select-item-hover-bg flex cursor-pointer items-center gap-2 px-2 py-1 text-xs select-none"
            @mousedown.prevent
            @pointermove="highlighted = index"
            @click="emit('select', suggestion.key)"
          >
            <slot name="suggestion" :suggestion="suggestion" :active="index === highlighted">
              <span
                v-if="multiple"
                aria-hidden="true"
                :class="[
                  'rounded-checkbox flex size-3.5 shrink-0 items-center justify-center border transition-colors',
                  suggestion.selected
                    ? 'bg-checkbox-checked-bg border-checkbox-checked-border text-checkbox-checked-fg'
                    : 'bg-checkbox-bg border-checkbox-border',
                ]"
              >
                <OIcon v-if="suggestion.selected" name="check" size="xs" class="size-3!" />
              </span>
              <OIcon
                v-if="suggestion.icon"
                :name="suggestion.icon"
                size="xs"
                class="text-text-secondary shrink-0"
              />
              <OTruncatedText class="min-w-0 flex-1">{{ suggestion.label }}</OTruncatedText>
              <span v-if="suggestion.detail" class="text-text-secondary ms-3 shrink-0">{{
                suggestion.detail
              }}</span>
              <OIcon
                v-if="suggestion.selected && !multiple"
                name="check"
                size="xs"
                class="text-theme-accent shrink-0"
              />
            </slot>
          </div>
          <div
            v-if="!suggestions.length && !loading && emptyText"
            class="text-text-secondary w-0 min-w-full px-2 py-1 text-xs"
          >
            {{ emptyText }}
          </div>
        </div>
        <div
          v-if="$slots.footer"
          class="text-text-secondary border-select-content-border text-2xs w-0 min-w-full border-t px-2.5 py-1.5"
        >
          <slot name="footer" />
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
