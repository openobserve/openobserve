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
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  shallowRef,
  Teleport,
  watch,
} from "vue";
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
  searchInList: false,
  anchor: null,
  emptyText: undefined,
  loading: false,
  autoHighlight: true,
  multiple: false,
  disabled: false,
  size: "md",
  appearance: "field",
  ariaLabel: undefined,
  inlineCaret: false,
  maxRows: undefined,
  dataTest: undefined,
});
const emit = defineEmits<ChipInputEmits>();
defineSlots<ChipInputSlots>();

const rootRef = ref<HTMLElement | null>(null);
const linesRef = ref<HTMLElement | null>(null);
const caretRef = ref<HTMLInputElement | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const contentRef = ref<{ $el?: HTMLElement } | null>(null);
const highlighted = ref(-1);
// Survives the caret moving to another place in the field, so the new caret takes focus back.
let caretFocused = false;
// A list opened by typing keeps the typed character instead of selecting it for replacement.
let openedByTyping = false;
const capHeight = ref<number | null>(null);

const listId = `o-chip-input-${Math.random().toString(36).slice(2, 9)}`;

const showList = computed(() => props.open && !props.disabled);
const anchorElement = computed(() => props.anchor ?? caretRef.value ?? undefined);
const caretSearches = computed(() => !props.searchInList);
const caretPlaceholder = computed(() =>
  showList.value && caretSearches.value ? props.searchPlaceholder : props.placeholder,
);

const fieldClasses = computed(() => [
  "rounded-default border px-1.5 py-0.75 transition-[border-color,box-shadow] duration-150",
  props.disabled
    ? "bg-input-disabled-bg border-input-disabled-border border-dashed"
    : "bg-input-bg border-input-border hover:border-input-border-hover",
  showList.value ? "border-input-border-focus ring-focus-ring-accent ring-[0.125rem]" : "",
]);

const sizeClasses = computed(() => {
  const text = props.size === "sm" ? "text-xs" : "text-sm";
  if (props.appearance === "plain") return `${text} min-h-7.5`;
  return `${text} ${props.size === "sm" ? "min-h-8" : "min-h-9"}`;
});

const testId = (suffix: string) => (props.dataTest ? `${props.dataTest}-${suffix}` : undefined);

// A row the user moved to stays highlighted when ticking it turns auto-highlight off.
let navigated = false;
watch(
  [() => props.suggestions.map((s) => s.key).join("\u0000"), () => props.open],
  () => {
    navigated = false;
    highlighted.value = props.autoHighlight && props.suggestions.length ? 0 : -1;
  },
  { immediate: true },
);
watch(
  () => props.autoHighlight,
  (auto) => {
    if (auto) highlighted.value = props.suggestions.length ? Math.max(highlighted.value, 0) : -1;
    else if (!navigated) highlighted.value = -1;
  },
);

watch(highlighted, async (index) => {
  if (index < 0) return;
  await nextTick();
  listRef.value
    ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    ?.scrollIntoView({ block: "nearest" });
});

// Each newly opened step selects its search text, so typing replaces a value being edited.
watch([showList, anchorElement, caretSearches], async ([shown]) => {
  if (!shown) return;
  await nextTick();
  const target = caretSearches.value ? caretRef.value : searchRef.value;
  target?.focus();
  if (!openedByTyping) target?.select();
  openedByTyping = false;
});

function focus() {
  caretRef.value?.focus();
}

// Deep chips scroll sideways inside the field; whatever takes focus or anchors the list is brought into view there.
function revealInLines(target: Element | null | undefined) {
  const lines = linesRef.value;
  if (!lines || !target || !lines.contains(target) || lines.scrollWidth <= lines.clientWidth)
    return;
  const box = lines.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  if (rect.left < box.left) lines.scrollLeft -= box.left - rect.left;
  else if (rect.right > box.right) {
    lines.scrollLeft += Math.min(rect.right - box.right, rect.left - box.left);
  }
}

function onLinesFocusIn(event: FocusEvent) {
  revealInLines(event.target as Element | null);
}

watch(anchorElement, async (element) => {
  await nextTick();
  revealInLines(element);
});

function onCaretFocus() {
  caretFocused = true;
}

function onCaretBlur(event: FocusEvent) {
  const element = event.target as HTMLInputElement;
  queueMicrotask(() => {
    if (element.isConnected && document.activeElement !== element) caretFocused = false;
  });
}

interface CaretHost {
  element: HTMLElement | null;
  props: { grow: boolean };
}

// The most recently placed caret slot holds the one input; it moves there instead of being remounted.
const caretHosts = shallowRef<CaretHost[]>([]);
const caretHost = computed(() => (props.inlineCaret ? (caretHosts.value.at(-1) ?? null) : null));
const caretGrow = computed(() => caretHost.value?.props.grow ?? true);
const endHostRef = ref<HTMLElement | null>(null);
const caretTarget = computed(() => caretHost.value?.element ?? endHostRef.value);
// A moved input loses focus, and a surrounding dialog's focus trap would take it; this keeps the edit open meanwhile.
let relocating = false;

const Caret = defineComponent({
  name: "OChipInputCaret",
  props: {
    /** Fill the rest of the line; off between chips, where the caret sizes to its text. */
    grow: { type: Boolean, default: true },
  },
  setup(caretProps) {
    const host: CaretHost = { element: null, props: caretProps };
    onMounted(() => {
      caretHosts.value = [...caretHosts.value, host];
    });
    onBeforeUnmount(() => {
      caretHosts.value = caretHosts.value.filter((entry) => entry !== host);
    });
    return () =>
      h("span", {
        ref: (el: unknown) => {
          host.element = el instanceof HTMLElement ? el : null;
        },
        class: "contents",
        "data-o-chip-caret": "",
      });
  },
});

// The caret's last parent; when the input lands elsewhere it was moved and lost focus on the way.
let placedIn: Element | null = null;

// Runs in the same flush as the move, so focus is back before any focus trap reacts to the removal.
function restoreFocusAfterMove() {
  const input = caretRef.value;
  const parent = input?.parentElement ?? null;
  if (!input || parent === placedIn) return;
  placedIn = parent;
  const active = document.activeElement;
  if (!caretFocused || active === input || (active && active !== document.body)) return;
  relocating = true;
  input.focus({ preventScroll: true });
  input.scrollIntoView?.({ block: "nearest" });
  revealInLines(input);
  setTimeout(() => {
    relocating = false;
  });
}

// Owns the move, so its own update hook sees every new place the input lands in.
const CaretInput = defineComponent({
  name: "OChipInputCaretInput",
  setup() {
    onMounted(restoreFocusAfterMove);
    onUpdated(restoreFocusAfterMove);
    return () =>
      h(Teleport, { to: caretTarget.value, disabled: !caretTarget.value }, [
        h("input", {
          ref: caretRef,
          value: caretSearches.value ? props.modelValue : "",
          type: "text",
          role: "combobox",
          autocomplete: "off",
          spellcheck: "false",
          disabled: props.disabled,
          "aria-expanded": showList.value && caretSearches.value,
          "aria-controls": listId,
          "aria-activedescendant":
            showList.value && caretSearches.value && highlighted.value >= 0
              ? `${listId}-${highlighted.value}`
              : undefined,
          "aria-label": props.ariaLabel,
          placeholder: caretPlaceholder.value,
          "data-test": testId("input"),
          class: [
            "text-text-body placeholder:text-text-secondary h-6 min-w-24 border-0 bg-transparent px-1 outline-none disabled:cursor-not-allowed",
            caretGrow.value ? "flex-1" : "field-sizing-content max-w-full flex-none",
          ],
          onInput: onCaretInput,
          onKeydown: onCaretKeydown,
          onClick: onCaretClick,
          onFocus: onCaretFocus,
          onBlur: onCaretBlur,
        }),
      ]);
  },
});

// Only focus that fell to the page or to a container around the field (a focus trap's own box) is taken back.
function keepFocusWhileMoving(landedOn: EventTarget | null): boolean {
  const input = caretRef.value;
  if (!relocating || !input?.isConnected) return false;
  const fell =
    !landedOn ||
    landedOn === document.body ||
    (landedOn instanceof Node && landedOn.contains(input));
  if (!fell) return false;
  input.focus({ preventScroll: true });
  return true;
}

// A flex-wrap box holds chips on its own lines; anything else is one chip, measured whole.
function lineItems(container: Element, out: DOMRect[] = []): DOMRect[] {
  for (const child of Array.from(container.children)) {
    const style = getComputedStyle(child);
    if (style.display === "none" || style.position === "absolute") continue;
    if (style.display === "contents") {
      lineItems(child, out);
      continue;
    }
    if (child !== container && style.flexWrap === "wrap" && child.children.length) {
      lineItems(child, out);
    } else out.push(child.getBoundingClientRect());
  }
  return out;
}

// Caps the field at `maxRows` lines of chips, ending in the gap above the next line so no box is cut.
function measureRows() {
  const root = linesRef.value;
  if (!root || !props.maxRows) {
    capHeight.value = null;
    return;
  }
  const origin = root.getBoundingClientRect().top - root.scrollTop;
  const tops: number[] = [];
  for (const rect of lineItems(root)) {
    if (!rect.height) continue;
    const top = rect.top - origin;
    if (!tops.some((seen) => Math.abs(seen - top) < rect.height / 2)) tops.push(top);
  }
  tops.sort((a, b) => a - b);
  const next = tops[props.maxRows];
  const previousBottom =
    next === undefined ? 0 : next - parseFloat(getComputedStyle(root).rowGap || "0") / 2;
  capHeight.value = next === undefined ? null : Math.floor(previousBottom);
}

let rowObserver: ResizeObserver | null = null;
let treeObserver: MutationObserver | null = null;
let measureFrame = 0;
const scheduleMeasure = () => {
  cancelAnimationFrame(measureFrame);
  measureFrame = requestAnimationFrame(measureRows);
};

onMounted(() => {
  if (!props.maxRows || typeof ResizeObserver === "undefined") return;
  rowObserver = new ResizeObserver(scheduleMeasure);
  if (linesRef.value) rowObserver.observe(linesRef.value);
  treeObserver = new MutationObserver(scheduleMeasure);
  if (linesRef.value) treeObserver.observe(linesRef.value, { childList: true, subtree: true });
  scheduleMeasure();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(measureFrame);
  rowObserver?.disconnect();
  treeObserver?.disconnect();
});

// A measured line position, so it stays in the px getBoundingClientRect reports.
const capStyle = computed(() =>
  capHeight.value === null ? undefined : { maxHeight: `${capHeight.value}px` },
);

defineExpose<ChipInputExpose>({ focus });

function move(step: number) {
  const count = props.suggestions.length;
  if (!count) return;
  navigated = true;
  highlighted.value = (highlighted.value + step + count) % count;
}

function onEnter(event: KeyboardEvent) {
  event.preventDefault();
  if (event.metaKey || event.ctrlKey) {
    emit("apply");
    return;
  }
  const active = props.suggestions[highlighted.value];
  if (!active) {
    emit("enter");
    return;
  }
  emit("select", active.key);
  // Enter ticks one value and lets the next Enter apply; Space keeps the row for further ticking.
  if (props.multiple) {
    navigated = false;
    highlighted.value = -1;
  }
}

// Keys an empty caret reads as moves between chips rather than as text editing.
function onCaretKey(event: KeyboardEvent): boolean {
  if (props.modelValue !== "" || event.altKey || event.metaKey || event.ctrlKey) return false;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    emit("caret-move", event.key === "ArrowLeft" ? -1 : 1);
    return true;
  }
  if (event.key === "Delete") {
    event.preventDefault();
    emit("delete-empty");
    return true;
  }
  return false;
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
      // The list closes first, so a surrounding dialog or drawer would otherwise take the same Escape as its own.
      if (showList.value) {
        event.stopPropagation();
        emit("escape");
      }
      focus();
      return;
    case "Backspace":
      if (props.modelValue === "") {
        event.preventDefault();
        emit("backspace-empty");
      }
      return;
    case " ":
      // With nothing typed, Space ticks the highlighted value of a multi-select like a checkbox.
      if (props.multiple && props.modelValue === "" && props.suggestions[highlighted.value]) {
        event.preventDefault();
        emit("select", props.suggestions[highlighted.value].key);
      }
      return;
    case ",":
      event.preventDefault();
      emit("separator", ",");
  }
}

// While the popover is shut the caret only opens it, runs the query, or steps back over chips.
function onCaretKeydown(event: KeyboardEvent) {
  if (event.isComposing || props.disabled) return;
  if (caretSearches.value && onCaretKey(event)) return;
  if (showList.value) return onKeydown(event);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    emit("activate");
  } else if (event.key === "Enter") {
    event.preventDefault();
    emit("enter");
  } else if (event.key === "Backspace" && !caretRef.value?.value) {
    event.preventDefault();
    emit("backspace-empty");
  }
}

function onInput(event: Event) {
  const opening = !showList.value;
  if (opening) openedByTyping = true;
  emit("update:modelValue", (event.target as HTMLInputElement).value);
  if (opening) emit("activate");
}

function onCaretInput(event: Event) {
  if (caretSearches.value || !showList.value) onInput(event);
  // The caret holds no text of its own while the popover search is in use.
  else (event.target as HTMLInputElement).value = "";
}

function onCaretClick() {
  if (!props.disabled && (!showList.value || !caretSearches.value)) emit("activate");
}

// A pointerdown inside the field (a chip, the add target) is not an outside interaction.
function onInteractOutside(event: Event) {
  if (rootRef.value?.contains(event.target as Node) || keepFocusWhileMoving(event.target))
    event.preventDefault();
  else emit("close");
}

// A press on the field's own surface (padding, a group's box, a chip's border) keeps the caret, or focus would fall to the page and shut the list.
function onFieldPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (props.disabled || !target || target === caretRef.value) return;
  if (target !== rootRef.value && target.closest("button, input, a, [tabindex]")) return;
  event.preventDefault();
  emit("press", event);
  focus();
  onCaretClick();
}

// Focus that settles outside the field and its popover ends the edit; inside the field it only shuts the caret's list.
function onFieldFocusOut() {
  setTimeout(() => {
    if (!document.hasFocus()) return;
    const active = document.activeElement;
    const popover = contentRef.value?.$el;
    if (active && popover?.contains?.(active)) return;
    if (active && rootRef.value?.contains(active)) {
      if (active !== caretRef.value && showList.value && caretSearches.value) emit("dismiss");
      return;
    }
    if (keepFocusWhileMoving(active)) return;
    emit("leave");
  });
}
</script>

<template>
  <PopoverRoot :open="showList">
    <PopoverAnchor as-child :reference="anchorElement">
      <div
        ref="rootRef"
        :data-test="testId('field')"
        :class="[
          'flex w-full min-w-0 cursor-text items-center gap-1.5',
          sizeClasses,
          appearance === 'plain' ? 'px-0.5' : fieldClasses,
          disabled ? 'cursor-not-allowed' : '',
        ]"
        @pointerdown="onFieldPointerDown"
        @focusout="onFieldFocusOut"
      >
        <!-- The padding, cancelled by the margin, keeps chip focus rings clear of the scroll clip. -->
        <div
          ref="linesRef"
          :class="[
            '-m-0.5 flex min-w-0 flex-1 flex-wrap items-center gap-1.5 self-stretch overflow-x-auto p-0.5',
            capHeight === null ? '' : 'overflow-y-auto',
          ]"
          :style="capStyle"
          data-o-chip-lines
          @focusin="onLinesFocusIn"
        >
          <slot :caret="Caret" />
          <span ref="endHostRef" class="contents" data-o-chip-caret />
          <CaretInput />
        </div>
        <div v-if="$slots.trailing" class="flex shrink-0 items-center gap-1 self-start">
          <slot name="trailing" />
        </div>
      </div>
    </PopoverAnchor>
    <PopoverPortal>
      <!-- The raw var() is reka's measured popover space, not a design token. -->
      <PopoverContent
        ref="contentRef"
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
        <div
          v-if="searchInList"
          class="border-select-content-border flex items-center gap-2 border-b px-2.5"
        >
          <OIcon name="search" size="xs" class="text-text-secondary shrink-0" />
          <input
            ref="searchRef"
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
            :data-test="testId('search')"
            class="text-text-body placeholder:text-text-secondary min-w-0 flex-1 border-0 bg-transparent py-1.5 text-xs outline-none"
            @input="onInput"
            @keydown="onKeydown"
          />
          <OSpinner v-if="loading" size="xs" />
        </div>
        <div v-else-if="loading" class="flex justify-end px-2.5 pt-1.5">
          <OSpinner size="xs" />
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
