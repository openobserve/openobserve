<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OEmojiPicker — a swatch-style trigger that opens a searchable grid of curated
// emojis. Same shape as OColor (trigger + popover panel), but picking from a
// fixed catalog instead of a continuous space.

import { computed, inject, ref, watch, nextTick } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OGlyph from "./OGlyph.vue";
import { useI18nTyped } from "@/types/i18n";
import { EMOJI_GROUPS } from "./emojiCatalog";
import type { EmojiPickerProps, EmojiPickerEmits, EmojiOption } from "./OEmojiPicker.types";

const { t } = useI18nTyped();

const props = withDefaults(defineProps<EmojiPickerProps>(), {
  modelValue: null,
  size: "md",
  disabled: false,
  ariaLabel: undefined,
});

const emit = defineEmits<EmojiPickerEmits>();

/** Grid width in cells — Up/Down step by this many. */
const COLUMNS = 7;

const open = ref(false);
const query = ref("");
const activeIndex = ref(0);
const gridRef = ref<HTMLElement | null>(null);

// ODialog stacks each nesting level 1000 apart starting at 6000, which is also
// OPopover's default — so a picker inside a dialog would tie with its own
// dialog. Ride the same ladder, one step above whatever level we opened in.
const dialogDepth = inject<number>("o2DialogDepth", 0);
const popoverZIndex = computed(() => 6100 + dialogDepth * 1000);

// `md` deliberately matches OInput's box height so a picker sitting beside a
// text field lines up with it rather than floating 2px short. Only the box is
// set here — OGlyph sizes the icon itself, emoji and SVG alike.
const triggerClasses: Record<NonNullable<EmojiPickerProps["size"]>, string> = {
  sm: "h-8 w-8",
  md: "h-[2.125rem] w-[2.125rem]",
};

const normalizedQuery = computed(() => query.value.trim().toLowerCase());

/** Groups to render — collapses to a single result group while searching. */
const visibleGroups = computed(() => {
  if (!normalizedQuery.value) return EMOJI_GROUPS;
  const matches = EMOJI_GROUPS.flatMap((group) =>
    group.emojis.filter((option) =>
      option.keywords.some((keyword) => keyword.includes(normalizedQuery.value)),
    ),
  );
  return matches.length
    ? [
        {
          id: "results",
          labelKey: "components.emojiPicker.groups.results" as const,
          emojis: matches,
        },
      ]
    : [];
});

/** Flat render order — the index space the roving tabindex walks. */
const flatEmojis = computed(() => visibleGroups.value.flatMap((group) => group.emojis));

function indexOf(option: EmojiOption): number {
  return flatEmojis.value.indexOf(option);
}

function focusCell(index: number) {
  const cells = gridRef.value?.querySelectorAll<HTMLElement>("[data-emoji-cell]");
  cells?.[index]?.focus();
}

function moveActive(delta: number) {
  const total = flatEmojis.value.length;
  if (!total) return;
  activeIndex.value = Math.min(total - 1, Math.max(0, activeIndex.value + delta));
  focusCell(activeIndex.value);
}

function onGridKeydown(event: KeyboardEvent) {
  const moves: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: COLUMNS,
    ArrowUp: -COLUMNS,
  };
  const delta = moves[event.key];
  if (delta !== undefined) {
    event.preventDefault();
    moveActive(delta);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    activeIndex.value = event.key === "Home" ? 0 : flatEmojis.value.length - 1;
    focusCell(activeIndex.value);
  }
}

function choose(token: string) {
  const next = token === props.modelValue ? null : token;
  emit("update:modelValue", next);
  emit("select", next);
  open.value = false;
}

function clear() {
  emit("update:modelValue", null);
  emit("select", null);
  open.value = false;
}

// Each opening starts clean: no stale query, and the cursor parked on the
// current selection so Enter re-picks what is already there rather than jumping.
watch(open, async (isOpen) => {
  if (!isOpen) return;
  query.value = "";
  await nextTick();
  const current = flatEmojis.value.findIndex((option) => option.token === props.modelValue);
  activeIndex.value = current >= 0 ? current : 0;
});

// A filtered-down list can leave the cursor past the end.
watch(flatEmojis, (list) => {
  if (activeIndex.value > list.length - 1) activeIndex.value = 0;
});
</script>

<template>
  <!-- The clear control is a SIBLING of the popover, not part of #trigger:
       PopoverTrigger uses as-child, so anything inside the trigger slot either
       nests a button in a button or steals the trigger's aria wiring. PopoverRoot
       renders no element of its own, so this span is what the badge positions
       against. -->
  <span class="relative inline-flex">
    <OPopover
      v-model:open="open"
      side="bottom"
      align="start"
      :z-index="popoverZIndex"
      content-class="w-72 p-2"
    >
      <template #trigger>
        <button
          type="button"
          :disabled="disabled"
          :aria-label="ariaLabel ?? t('components.emojiPicker.chooseIcon')"
          data-test="emoji-picker-trigger"
          :class="[
            'rounded-default ring-offset-surface-base inline-flex shrink-0 items-center justify-center border leading-none transition-colors outline-none',
            'focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-1',
            triggerClasses[size],
            modelValue
              ? 'border-border-default bg-surface-base hover:bg-surface-subtle-hover'
              : 'border-border-default text-text-secondary hover:bg-surface-subtle-hover hover:text-text-heading border-dashed',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          ]"
        >
          <OGlyph v-if="modelValue" :token="modelValue" :size="size === 'sm' ? 'md' : 'lg'" />
          <OIcon v-else name="add" size="sm" />
        </button>
      </template>

      <div class="flex flex-col gap-2">
        <OSearchInput
          v-model="query"
          size="sm"
          :placeholder="t('components.emojiPicker.searchPlaceholder')"
          data-test="emoji-picker-search"
        />

        <div
          ref="gridRef"
          class="-mx-1 flex max-h-64 flex-col gap-2 overflow-y-auto px-1 py-1"
          @keydown="onGridKeydown"
        >
          <div v-for="group in visibleGroups" :key="group.id" class="flex flex-col gap-1">
            <span class="text-text-secondary text-2xs px-0.5 font-medium">
              {{ t(group.labelKey) }}
            </span>
            <div class="grid grid-cols-7 justify-items-center gap-1">
              <button
                v-for="option in group.emojis"
                :key="option.token"
                type="button"
                data-emoji-cell
                :data-test="`emoji-picker-option-${option.keywords[0]}`"
                :tabindex="indexOf(option) === activeIndex ? 0 : -1"
                :aria-label="option.keywords[0]"
                :aria-pressed="option.token === modelValue"
                :class="[
                  'rounded-default ring-offset-surface-base inline-flex h-8 w-8 cursor-pointer items-center justify-center text-lg leading-none transition-colors outline-none',
                  'focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-1',
                  option.token === modelValue
                    ? 'bg-surface-accent-active ring-accent ring-1'
                    : 'hover:bg-surface-subtle-hover',
                ]"
                @click="choose(option.token)"
                @focus="activeIndex = indexOf(option)"
              >
                <OGlyph :token="option.token" size="md" />
              </button>
            </div>
          </div>

          <p
            v-if="!visibleGroups.length"
            class="text-text-secondary px-0.5 py-4 text-center text-xs"
            data-test="emoji-picker-empty"
          >
            {{ t("components.emojiPicker.noResults") }}
          </p>
        </div>
      </div>
    </OPopover>

    <button
      v-if="modelValue && !disabled"
      type="button"
      :aria-label="t('components.emojiPicker.removeIcon')"
      :title="t('components.emojiPicker.removeIcon')"
      data-test="emoji-picker-clear"
      class="border-border-default bg-surface-base text-text-secondary hover:bg-surface-subtle-hover hover:text-text-heading focus-visible:ring-accent ring-offset-surface-base absolute -top-1 -right-1 inline-flex size-4 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      @click="clear"
    >
      <OIcon name="close" size="xs" />
    </button>
  </span>
</template>
