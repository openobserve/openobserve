<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OInlineEdit — a value that READS as a title and EDITS in place. Use it where a
// name belongs to the header rather than to a form: the page title IS the field.
// Display mode renders the value as heading text with a hover affordance; a
// click (or Enter/F2 on the focused trigger) swaps in an auto-sizing input.
//
// Contract:
//   • `update:modelValue` fires LIVE on every keystroke, so every emission is
//     user-originated — a consumer can treat one as "the user took over" without
//     having to distinguish typing from a programmatic write.
//   • `commit` fires once the user is done (Enter or blur) with the trimmed
//     value — that's the signal to re-derive or persist. Enter additionally
//     submits the owning <form>, if there is one, so a title inside an <OForm>
//     still saves on Enter the way the boxed field it replaced did.
//   • Escape restores the pre-edit value (emitted back) and emits `cancel`.
//
// The input auto-sizes with a grid sizer (an invisible span sharing the input's
// grid cell) rather than a measured pixel width, so it grows with the text
// without an inline style or a hardcoded px.

import { computed, nextTick, ref, useAttrs, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { InlineEditProps, InlineEditEmits, InlineEditSlots } from "./OInlineEdit.types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<InlineEditProps>(), {
  modelValue: "",
  size: "md",
  tone: "title",
  disabled: false,
  readonly: false,
  error: false,
});

const emit = defineEmits<InlineEditEmits>();
defineSlots<InlineEditSlots>();

const $attrs = useAttrs();
const dataTest = computed(() => $attrs["data-test"] as string | undefined);

const isEditing = ref(false);
const draft = ref("");
const valueAtEditStart = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);

const displayValue = computed(() => (props.modelValue ?? "").trim());
const isEmpty = computed(() => displayValue.value === "");
const canEdit = computed(() => !props.disabled && !props.readonly);

// An auto-name (or an async edit-mode prefill) can land while the field sits in
// display mode; keep the draft in step so re-entering edit starts from truth.
watch(
  () => props.modelValue,
  (next) => {
    if (!isEditing.value) draft.value = next ?? "";
  },
  { immediate: true },
);

const startEdit = async () => {
  if (!canEdit.value || isEditing.value) return;
  valueAtEditStart.value = props.modelValue ?? "";
  draft.value = props.modelValue ?? "";
  isEditing.value = true;
  emit("edit-start");
  await nextTick();
  inputRef.value?.focus();
  // Select-all: the common intent on an auto-generated name is to replace it.
  inputRef.value?.select();
};

const commit = () => {
  if (!isEditing.value) return;
  isEditing.value = false;
  const finalValue = draft.value.trim();
  // Emit when trimming changed the text, and also when the consumer never
  // echoed the live emissions back — either way the final value must land.
  if (finalValue !== draft.value || finalValue !== (props.modelValue ?? "")) {
    emit("update:modelValue", finalValue);
  }
  draft.value = finalValue;
  emit("commit", finalValue);
};

const cancel = () => {
  if (!isEditing.value) return;
  isEditing.value = false;
  // Compare against the DRAFT, not the prop: typing already emitted, so the
  // restore has to be emitted whenever the draft moved — whether or not the
  // consumer echoed those emissions back into modelValue.
  const shouldRestore = draft.value !== valueAtEditStart.value;
  draft.value = valueAtEditStart.value;
  if (shouldRestore) emit("update:modelValue", valueAtEditStart.value);
  emit("cancel", valueAtEditStart.value);
};

const onInput = (event: Event) => {
  draft.value = (event.target as HTMLInputElement).value;
  emit("update:modelValue", draft.value);
};

// Closing the editor unmounts the input, which would drop focus to <body> and
// strand a keyboard user before every action in the header (Save included). Hand
// focus back to the display trigger instead, so Tab carries on from the title.
// Only the keyboard paths call this: a blur-commit means focus has already,
// legitimately, gone somewhere else (often the very button that was clicked).
const restoreTriggerFocus = async () => {
  await nextTick();
  // A failed submit can re-open the editor (focus-the-first-error walkers) —
  // don't yank focus back out of an input that was just deliberately opened.
  if (!isEditing.value) triggerRef.value?.focus();
};

// Enter commits AND submits the owning form — Enter in the boxed name field
// this replaced is how a panel or a function got saved from the keyboard, and
// that has to survive the field becoming a title. The browser's own implicit
// submission can't carry it: closing the editor unmounts the input before the
// keypress that would have triggered it, so ask the form directly. A title with
// no form owner (a workflow name, an incident title) submits nothing.
const onEnter = () => {
  const owner = inputRef.value?.form ?? null;
  commit();
  restoreTriggerFocus();
  // After commit, so the form validates and saves the trimmed value.
  owner?.requestSubmit();
};

const onEscape = () => {
  cancel();
  restoreTriggerFocus();
};

// F2 is the platform convention for "rename the focused thing"; Enter matches
// the button's own activation. Both land on the display trigger only.
const onDisplayKeydown = (event: KeyboardEvent) => {
  if (event.key === "F2") {
    event.preventDefault();
    startEdit();
  }
};

// ── Styles ─────────────────────────────────────────────────────────────────
// The value must render at an identical size and weight in BOTH modes,
// otherwise the header jumps as it swaps between the button and the input.
const textClasses = computed(() => {
  if (props.tone === "meta") return "text-xs leading-normal font-normal";
  const scale = { sm: "text-sm", md: "text-base", lg: "text-lg" }[props.size];
  return `${scale} leading-[1.45] font-semibold tracking-[-0.02em]`;
});

/** Colour of a filled value — headings lead, meta values recede. */
const valueToneClass = computed(() =>
  props.tone === "meta" ? "text-text-secondary" : "text-text-heading",
);

// THE BOX MUST BE IDENTICAL IN BOTH MODES, AND MUST COST NOTHING IN LAYOUT.
//
// Identical, because clicking the name swaps a <button> for an <input>: if their
// padding differed by even a pixel the text would jump under the cursor at the
// exact moment the user is aiming at it. Both carry `px-1.5 py-0.5`.
//
// Free, because this control sits inside a heading that also has a subtitle
// under it. Any height the chip adds pushes that subtitle down, so a page using
// OInlineEdit for its title would sit a few pixels off from every page that
// uses plain text. Hence RINGS, not borders — `ring-inset` paints inside the
// box and contributes no size — and a `-my-0.5` on the root that cancels the
// vertical padding exactly. Net contribution to the line box: zero.
const BOX_CLASSES =
  "rounded-default px-1.5 py-0.5 ring-1 ring-inset transition-[background-color,box-shadow,color] duration-150 ease-out";

// Imperative focus for callers that walk to "the invalid field and focus it"
// (e.g. the alert form's focus manager). In display mode there is no input to
// find in the DOM, so opening the editor IS the correct response to "focus me".
defineExpose({ focus: startEdit });
</script>

<template>
  <!-- The -mx-1.5 lives on the ROOT, not on either mode's box, so the shared
       inline padding cancels out identically whichever one is showing and the
       text still lines up with whatever sits above/below it. -->
  <div v-bind="$attrs" class="group/inline-edit -mx-1.5 -my-0.5 flex min-w-0 items-center gap-1.5">
    <!-- EDIT MODE — the input shares a grid cell with an invisible sizer span,
         so the track (and therefore the input) is exactly as wide as the text.
         The sizer mirrors the input's box exactly and only widens its trailing
         padding, leaving room for the caret without moving the text origin. -->
    <!-- minmax(0,max-content): the sizer's `whitespace-pre` makes the track's
         automatic minimum the FULL text width, so a long name grew the track
         past the header and painted the input over the action buttons. A 0
         minimum lets the track stop at whatever width the header can spare,
         while the max-content ceiling keeps the grow-with-the-text behaviour. -->
    <div v-if="isEditing" class="grid max-w-full grid-cols-[minmax(0,max-content)] items-center">
      <span
        aria-hidden="true"
        :class="[
          'invisible col-start-1 row-start-1 pe-7 whitespace-pre ring-transparent',
          BOX_CLASSES,
          textClasses,
        ]"
        >{{ draft || placeholder }}</span
      >
      <input
        ref="inputRef"
        :value="draft"
        type="text"
        size="1"
        :placeholder="placeholder"
        :aria-label="ariaLabel"
        :aria-invalid="error || undefined"
        :maxlength="maxlength"
        :data-test="dataTest ? `${dataTest}-input` : undefined"
        :class="[
          'bg-input-bg text-input-text placeholder:text-input-placeholder col-start-1 row-start-1 w-full min-w-0 outline-none',
          BOX_CLASSES,
          textClasses,
          // The error state shows through the red ring alone — the placeholder
          // keeps its normal muted colour (no separate message either; see the
          // visually-hidden alert below, kept only for screen readers).
          error
            ? 'ring-input-border-error focus:ring-2'
            : 'ring-input-border focus:ring-input-border-focus focus:ring-2',
        ]"
        @input="onInput"
        @blur="commit"
        @keydown.enter="onEnter"
        @keydown.esc.stop.prevent="onEscape"
      />
    </div>

    <!-- DISPLAY MODE — a button so Enter/Space and focus rings come for free.
         Readonly drops the button entirely: no affordance, no hover, no tab stop. -->
    <template v-else>
      <span
        v-if="readonly"
        :class="[
          'min-w-0 truncate ring-transparent',
          BOX_CLASSES,
          textClasses,
          isEmpty ? 'text-text-placeholder' : valueToneClass,
        ]"
        :title="displayValue || placeholder"
        :data-test="dataTest ? `${dataTest}-value` : undefined"
        >{{ displayValue || placeholder }}</span
      >
      <button
        v-else
        ref="triggerRef"
        type="button"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :data-test="dataTest ? `${dataTest}-trigger` : undefined"
        data-inline-edit-trigger
        :class="[
          'focus-visible:outline-accent/40 flex max-w-full min-w-0 items-center gap-1.5 text-start outline-none focus-visible:outline-2',
          BOX_CLASSES,
          // An invalid name draws the same red box in display mode that the input
          // shows while editing, so the field reads as an error even before it is
          // clicked into — the required-name state must be visible at rest, not
          // only mid-edit (matches the pipeline/panel headers).
          error ? 'ring-input-border-error' : 'ring-transparent',
          disabled
            ? 'cursor-not-allowed opacity-60'
            : error
              ? 'cursor-text'
              : 'hover:bg-surface-subtle hover:ring-border-default cursor-text',
        ]"
        @click="startEdit"
        @keydown="onDisplayKeydown"
      >
        <!-- An empty field shows the placeholder in its normal muted colour even
             in the error state — the red ring alone signals the error. A non-empty
             value that is invalid still reads red. -->
        <span
          :class="[
            'min-w-0 truncate',
            textClasses,
            isEmpty ? 'text-text-placeholder' : error ? 'text-input-error-text' : valueToneClass,
          ]"
          :data-test="dataTest ? `${dataTest}-value` : undefined"
          >{{ displayValue || placeholder }}</span
        >
        <!-- Always rendered, never hover-revealed: a pencil that only appears on
             hover cannot tell you the name is editable BEFORE you hover it. It
             sits at reduced opacity so it reads as an affordance, not a control,
             and brightens on hover. -->
        <OIcon
          v-if="!disabled"
          name="edit"
          size="sm"
          class="text-text-secondary shrink-0 opacity-50 transition-opacity group-hover/inline-edit:opacity-100"
        />
        <!-- Child-mode OTooltip (attaches to this button). A real tooltip rather
             than a native `title`: this hint is the ONLY place a generated name
             explains itself, so it can't sit behind the browser's ~1s delay in
             unstyled system chrome. -->
        <OTooltip v-if="editHint && !disabled" :content="editHint" max-width="18rem" />
      </button>

      <!-- Trailing content beside the name — display mode only, so it never
           competes with the input. -->
      <slot name="trail" />
    </template>

    <!-- The message sits BESIDE the value, not below it — below is the header's
         subtitle band, where a floated message would land on top of it. Inline it
         costs no height (smaller than the title's own line box), so the header
         doesn't reflow when a name turns invalid; it keeps its width (`shrink-0`)
         and the name truncates around it. -->
    <span
      v-if="error && errorMessage"
      role="alert"
      class="text-input-error-text text-2xs shrink-0 leading-tight whitespace-nowrap"
      :data-test="dataTest ? `${dataTest}-error` : undefined"
      >{{ errorMessage }}</span
    >
  </div>
</template>
