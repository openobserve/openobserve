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
  header: undefined,
  emptyText: undefined,
  loading: false,
  autoHighlight: true,
  disabled: false,
  inputGrow: true,
  size: "md",
  ariaLabel: undefined,
  dataTest: undefined,
});
const emit = defineEmits<ChipInputEmits>();
defineSlots<ChipInputSlots>();

const rootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const highlighted = ref(-1);

const listId = `o-chip-input-${Math.random().toString(36).slice(2, 9)}`;

const showList = computed(
  () =>
    props.open &&
    !props.disabled &&
    (props.suggestions.length > 0 || props.loading || Boolean(props.emptyText)),
);

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

function focus() {
  inputRef.value?.focus();
}

function focusSelect() {
  focus();
  inputRef.value?.select();
}

defineExpose<ChipInputExpose>({ focus, focusSelect });

function move(step: number) {
  const count = props.suggestions.length;
  if (!count) return;
  highlighted.value = (highlighted.value + step + count) % count;
}

function onEnter(event: KeyboardEvent) {
  event.preventDefault();
  const active = showList.value ? props.suggestions[highlighted.value] : undefined;
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
      if (showList.value) {
        event.preventDefault();
        emit("close");
      }
      emit("escape");
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

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}

// A pointerdown inside the field (a chip, the caret) is not an outside interaction.
function onInteractOutside(event: Event) {
  if (rootRef.value?.contains(event.target as Node)) event.preventDefault();
  else emit("close");
}

function onFieldPointerDown(event: PointerEvent) {
  if (event.target === rootRef.value) {
    event.preventDefault();
    focus();
  }
}
</script>

<template>
  <PopoverRoot :open="showList">
    <PopoverAnchor as-child>
      <div
        ref="rootRef"
        :data-test="testId('field')"
        :class="[
          'rounded-default flex w-full min-w-0 cursor-text flex-wrap items-center gap-1 border px-1.5 py-0.75 transition-[border-color,box-shadow] duration-150',
          'bg-input-bg border-input-border hover:border-input-border-hover focus-within:border-input-border-focus focus-within:ring-focus-ring-accent focus-within:ring-[0.125rem]',
          sizeClasses,
          disabled
            ? 'bg-input-disabled-bg border-input-disabled-border cursor-not-allowed border-dashed'
            : '',
        ]"
        @pointerdown="onFieldPointerDown"
      >
        <slot />
        <input
          ref="inputRef"
          :value="modelValue"
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          :aria-expanded="showList"
          :aria-controls="listId"
          :aria-activedescendant="
            showList && highlighted >= 0 ? `${listId}-${highlighted}` : undefined
          "
          :aria-label="ariaLabel"
          :placeholder="placeholder"
          :disabled="disabled"
          :data-test="testId('input')"
          :class="[
            'text-text-body placeholder:text-text-secondary min-w-24 basis-24 border-0 bg-transparent px-1 py-0.5 outline-none',
            inputGrow ? 'flex-1' : 'w-24 flex-none',
          ]"
          @input="onInput"
          @keydown="onKeydown"
          @focus="emit('focus')"
          @blur="emit('blur')"
        />
        <slot name="after" />
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
        class="rounded-default bg-select-content-bg border-select-content-border z-10001 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden border shadow-md"
        :style="{ maxHeight: 'min(20rem, var(--reka-popover-content-available-height, 20rem))' }"
        @open-auto-focus.prevent
        @close-auto-focus.prevent
        @interact-outside="onInteractOutside"
        @escape-key-down="emit('close')"
      >
        <div
          v-if="header"
          class="text-text-secondary border-select-content-border flex items-center gap-2 border-b px-3 py-1.5 text-xs"
        >
          <span class="min-w-0 flex-1">{{ header }}</span>
          <OSpinner v-if="loading" size="xs" />
        </div>
        <div
          :id="listId"
          ref="listRef"
          role="listbox"
          :aria-label="header ?? ariaLabel"
          class="min-h-0 flex-1 overflow-y-auto p-1"
        >
          <div
            v-for="(suggestion, index) in suggestions"
            :id="`${listId}-${index}`"
            :key="suggestion.key"
            role="option"
            :aria-selected="index === highlighted"
            :data-index="index"
            :data-active="index === highlighted ? '' : undefined"
            :data-test="testId(`suggest-item-${suggestion.key}`)"
            class="rounded-default text-select-item-text data-active:bg-select-item-hover-bg flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs select-none"
            @mousedown.prevent
            @pointermove="highlighted = index"
            @click="emit('select', suggestion.key)"
          >
            <slot name="suggestion" :suggestion="suggestion" :active="index === highlighted">
              <OIcon
                v-if="suggestion.icon"
                :name="suggestion.icon"
                size="xs"
                class="text-text-secondary shrink-0"
              />
              <OTruncatedText class="min-w-0 flex-1">{{ suggestion.label }}</OTruncatedText>
              <span v-if="suggestion.detail" class="text-text-secondary shrink-0">{{
                suggestion.detail
              }}</span>
              <OIcon
                v-if="suggestion.selected"
                name="check"
                size="xs"
                class="text-theme-accent shrink-0"
              />
            </slot>
          </div>
          <div
            v-if="!suggestions.length && !loading && emptyText"
            class="text-text-secondary px-2 py-1.5 text-xs"
          >
            {{ emptyText }}
          </div>
        </div>
        <div
          v-if="$slots.footer"
          class="text-text-secondary border-select-content-border text-2xs border-t px-3 py-1.5"
        >
          <slot name="footer" />
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
