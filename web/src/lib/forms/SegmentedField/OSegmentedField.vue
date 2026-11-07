<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  SegmentedFieldEmits,
  SegmentedFieldExposed,
  SegmentedFieldProps,
  SegmentedFieldStatus,
} from "./OSegmentedField.types";
import { computed, nextTick, ref, useId, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import {
  convertValues,
  emptyValues,
  layoutSegments,
  parseCanonical,
  parseWholeValue,
  segmentDefs,
  segmentMax,
  segmentText,
  statusOf,
  toCanonical,
  type SegmentValues,
} from "./segments";

const props = withDefaults(defineProps<SegmentedFieldProps>(), {
  modelValue: "",
  offsets: () => [],
  offset: undefined,
  error: false,
  errorMessage: undefined,
  hideErrorIcon: false,
  errorId: undefined,
  ariaLabel: undefined,
  describedBy: undefined,
  segmentLabels: () => ({}),
  dayPeriods: () => ["AM", "PM"],
  min: undefined,
  max: undefined,
  disabled: false,
  highlighted: false,
});

const emit = defineEmits<SegmentedFieldEmits>();

const SEPARATOR_KEYS = [":", "-", " ", "/", "."];
const STEP_KEYS = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];

const ownErrorId = useId();
const inputRef = ref<HTMLInputElement | null>(null);
const values = ref<SegmentValues>(parseCanonical(props.pattern, props.modelValue));
const active = ref(0);
const focused = ref(false);
// Digits typed into the active segment so far; a segment change starts it over.
let typed = "";
// A separator right after an auto-advance is the user typing the format, not a request to skip a segment.
let justAdvanced = false;
let lastEmitted = props.modelValue;
let lastStatus: SegmentedFieldStatus | null = null;
let pointerDown = false;

const defs = computed(() => segmentDefs(props.pattern, props.offsets.length));
const offsetIndex = computed(() => Math.max(0, props.offsets.indexOf(props.offset ?? "")));
const allValues = computed<SegmentValues>(() =>
  defs.value.map((def, index) =>
    def.kind === "offset" ? offsetIndex.value : (values.value[index] ?? null),
  ),
);
const layout = computed(() =>
  layoutSegments(defs.value, allValues.value, props.dayPeriods, props.offsets),
);
const status = computed(() => statusOf(props.pattern, values.value, props.min, props.max));
const isEmpty = computed(() => status.value === "empty");
const displayValue = computed(() => (isEmpty.value && !focused.value ? "" : layout.value.text));
const placeholder = computed(
  () => layoutSegments(defs.value, [], props.dayPeriods, props.offsets).text,
);
const invalid = computed(() => props.error || !!props.errorMessage);
const errorTarget = computed(() =>
  props.errorMessage ? ownErrorId : invalid.value ? props.errorId : undefined,
);

const widthClass = computed(() => {
  const withOffset = defs.value.some((def) => def.kind === "offset");
  if (props.pattern === "date") return "w-[11ch]";
  if (props.pattern === "time12") return withOffset ? "w-[21ch]" : "w-[12ch]";
  return withOffset ? "w-[18ch]" : "w-[9ch]";
});

watch(
  () => props.modelValue,
  (next) => {
    if (next === lastEmitted) return;
    lastEmitted = next;
    values.value = parseCanonical(props.pattern, next);
    syncStatus();
  },
);

watch(
  () => props.pattern,
  (next, previous) => {
    values.value = convertValues(previous, next, values.value);
    active.value = Math.min(active.value, defs.value.length - 1);
    selectActive();
  },
);

const syncStatus = () => {
  if (status.value === lastStatus) return;
  lastStatus = status.value;
  emit("update:status", status.value);
};

// Digits still being typed into a segment are not a value yet, so nothing is emitted mid-segment.
const commit = () => {
  if (typed) return;
  const keeps = status.value === "valid" || status.value === "out-of-range";
  // An out-of-range date stays a value; the status tells the host it cannot be applied.
  const canonical = keeps ? (toCanonical(props.pattern, values.value) ?? "") : "";
  if (canonical !== lastEmitted) {
    lastEmitted = canonical;
    emit("update:modelValue", canonical);
  }
  syncStatus();
};

const selectActive = () => {
  if (!focused.value) return;
  nextTick(() => {
    const el = inputRef.value;
    const range = layout.value.ranges[active.value];
    if (!el || !range || document.activeElement !== el) return;
    el.setSelectionRange(range[0], range[1]);
  });
};

const moveTo = (index: number) => {
  active.value = Math.max(0, Math.min(defs.value.length - 1, index));
  typed = "";
  commit();
  selectActive();
};

const setValue = (index: number, value: number | null) => {
  const def = defs.value[index];
  if (def.kind === "offset") {
    if (value !== null) emit("update:offset", props.offsets[value] ?? "");
    return;
  }
  const next = [...values.value];
  next[index] = value;
  values.value = next;
  commit();
};

const announce = (index: number) => {
  const def = defs.value[index];
  emit("step", {
    kind: def.kind,
    label: props.segmentLabels[def.kind] ?? def.kind,
    value: segmentText(def, allValues.value[index] ?? null, props.dayPeriods, props.offsets),
  });
};

// Wraps inside the segment, as a native time input does: no carry into the next one.
const step = (index: number, delta: number) => {
  const def = defs.value[index];
  const max = segmentMax(defs.value, values.value, index);
  const current = allValues.value[index];
  let next: number;
  if (current === null) next = delta > 0 ? def.min : max;
  else if (def.kind === "year") next = Math.max(def.min, Math.min(max, current + delta));
  else {
    const span = max - def.min + 1;
    next = ((((current - def.min + delta) % span) + span) % span) + def.min;
  }
  setValue(index, next);
};

const stepTo = (index: number, edge: "min" | "max") => {
  const def = defs.value[index];
  setValue(index, edge === "min" ? def.min : segmentMax(defs.value, values.value, index));
};

const advance = () => {
  justAdvanced = true;
  if (active.value < defs.value.length - 1) moveTo(active.value + 1);
  else {
    typed = "";
    commit();
    emit("complete");
  }
};

const typeDigit = (digit: string) => {
  const index = active.value;
  const def = defs.value[index];
  if (def.digits === 0) return;
  typed = (typed + digit).slice(-def.digits);
  const max = segmentMax(defs.value, values.value, index);
  const value = Number(typed);
  const full = typed.length >= def.digits || value * 10 > max;
  if (full) {
    typed = "";
    setValue(index, Math.max(def.min, Math.min(max, value)));
    advance();
    return;
  }
  setValue(index, value < def.min ? null : Math.min(value, max));
};

const setPeriod = (key: string) => {
  const index = active.value;
  if (defs.value[index].kind !== "period") return false;
  setValue(index, key === "a" ? 0 : 1);
  announce(index);
  return true;
};

const stepKeyDelta = (event: KeyboardEvent): number => {
  const big = event.shiftKey || event.key === "PageUp" || event.key === "PageDown" ? 10 : 1;
  return event.key === "ArrowUp" || event.key === "PageUp" ? big : -big;
};

const onStepKey = (event: KeyboardEvent) => {
  const index = active.value;
  const kind = defs.value[index].kind;
  if (event.key === "Home" || event.key === "End")
    stepTo(index, event.key === "Home" ? "min" : "max");
  else
    step(
      index,
      kind === "period" || kind === "offset" ? Math.sign(stepKeyDelta(event)) : stepKeyDelta(event),
    );
  typed = "";
  announce(index);
  selectActive();
};

const onArrowAcross = (event: KeyboardEvent) => {
  const forward = event.key === "ArrowRight";
  const atEdge = forward ? active.value === defs.value.length - 1 : active.value === 0;
  if (atEdge) emit("edge", forward ? "next" : "prev");
  else moveTo(active.value + (forward ? 1 : -1));
};

const onTab = (event: KeyboardEvent) => {
  justAdvanced = false;
  const target = active.value + (event.shiftKey ? -1 : 1);
  if (target < 0 || target >= defs.value.length) return;
  event.preventDefault();
  moveTo(target);
};

const onKeydown = (event: KeyboardEvent) => {
  if (props.disabled || event.metaKey || event.ctrlKey || event.altKey) return;
  const { key } = event;
  if (key === "Tab") return onTab(event);
  if (key === "Enter") {
    event.preventDefault();
    typed = "";
    commit();
    emit("submit");
    return;
  }
  if (key === "Escape") return;
  event.preventDefault();
  const afterAdvance = justAdvanced;
  justAdvanced = false;
  if (STEP_KEYS.includes(key)) return onStepKey(event);
  if (key === "ArrowLeft" || key === "ArrowRight") return onArrowAcross(event);
  if (key === "Backspace" || key === "Delete") {
    typed = "";
    setValue(active.value, null);
    selectActive();
    return;
  }
  if (/^\d$/.test(key)) {
    typeDigit(key);
    selectActive();
    return;
  }
  if (SEPARATOR_KEYS.includes(key)) {
    if (typed) advance();
    else if (!afterAdvance) moveTo(active.value + 1);
    else justAdvanced = false;
    return;
  }
  if (setPeriod(key.toLowerCase())) selectActive();
};

// A whole-value write (Playwright fill, a test's setValue) replaces every segment at once.
const onInput = (event: Event) => {
  const el = event.target as HTMLInputElement;
  // Focus narrows the selection to one segment, so an insert can land inside the old text; its data is the whole value.
  const inserted = (event as InputEvent).data ?? "";
  const parsed =
    el.value.trim() === ""
      ? emptyValues(props.pattern)
      : (parseWholeValue(props.pattern, el.value) ??
        (inserted ? parseWholeValue(props.pattern, inserted) : null));
  if (parsed) {
    values.value = parsed;
    commit();
  }
  el.value = displayValue.value;
  selectActive();
};

const onPaste = (event: ClipboardEvent) => {
  event.preventDefault();
  emit("paste-text", event.clipboardData?.getData("text") ?? "");
};

const onFocus = (event: FocusEvent) => {
  focused.value = true;
  if (!pointerDown) {
    active.value = 0;
    typed = "";
    selectActive();
  }
  emit("focus", event);
};

const onBlur = (event: FocusEvent) => {
  focused.value = false;
  typed = "";
  justAdvanced = false;
  commit();
  emit("blur", event);
};

const onPointerDown = () => {
  pointerDown = true;
};

// A click picks the segment under the caret, so the segment, not a character, is selected.
const onPointerUp = () => {
  pointerDown = false;
  const caret = inputRef.value?.selectionStart ?? 0;
  const ranges = layout.value.ranges;
  const hit = ranges.findIndex(([, end]) => caret <= end);
  moveTo(hit === -1 ? ranges.length - 1 : hit);
};

const focusSegment: SegmentedFieldExposed["focusSegment"] = (which) => {
  const firstEmpty = values.value.findIndex((value) => value === null);
  if (which === "first") active.value = 0;
  else if (which === "last") active.value = defs.value.length - 1;
  else active.value = firstEmpty === -1 ? 0 : firstEmpty;
  typed = "";
  pointerDown = true;
  inputRef.value?.focus();
  pointerDown = false;
  focused.value = true;
  selectActive();
};

defineExpose<SegmentedFieldExposed>({ focusSegment });
</script>

<template>
  <div class="inline-flex min-w-0 flex-col">
    <div
      class="rounded-default inline-flex items-center gap-1"
      :class="highlighted ? 'bg-surface-tint-accent' : ''"
    >
      <input
        ref="inputRef"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        class="text-input-text placeholder:text-input-placeholder disabled:text-input-disabled-text min-w-0 bg-transparent px-1 text-sm tabular-nums outline-none"
        :class="widthClass"
        :value="displayValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :aria-describedby="describedBy"
        :aria-invalid="invalid ? 'true' : undefined"
        :aria-errormessage="errorTarget"
        data-test="o-segmented-field-input"
        @keydown="onKeydown"
        @input="onInput"
        @paste="onPaste"
        @focus="onFocus"
        @blur="onBlur"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
      />
      <OIcon
        v-if="invalid && !hideErrorIcon"
        name="error"
        size="xs"
        class="text-input-error-text shrink-0"
        aria-hidden="true"
        data-test="o-input-error"
      />
    </div>
    <p
      v-if="errorMessage"
      :id="ownErrorId"
      class="text-input-error-text mt-1 text-xs"
      data-test="o-segmented-field-error"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
