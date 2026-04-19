// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Select — headless-first select replacing q-select.
 *
 * Three-layer token strategy — same as O2Input:
 *   Layer 1 – Primitive  : $o2-* SCSS vars  (_variables.scss)
 *   Layer 2 – Semantic   : --o2-* CSS props  (_variables.scss)
 *   Layer 3 – Component  : --o2-select-* CSS props (this file)
 *
 * State is exposed as data attributes (Shadcn / Radix UI convention):
 *   data-variant="outlined|borderless|filled"
 *   data-state="open|closed"   — dropdown open state
 *   data-invalid               — present when validation fails or error prop is true
 *   data-disabled              — present when disabled
 *   data-loading               — present when loading spinner is shown
 *   Each option:
 *     data-state="selected|unselected"
 *     data-focused             — present when keyboard-focused
 *     data-disabled            — present when this option is disabled
 *
 * Covers all q-select patterns found in the codebase:
 *   Pattern A – Search / filter with @filter callback
 *   Pattern B – Multiple selection with chips
 *   Pattern C – Tagging / custom value creation
 *   Pattern D – Simple single dropdown
 *   Pattern E – Custom #option slot rendering
 *   Pattern F – Validated selects with :rules
 */

import {
  computed,
  getCurrentInstance,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useAttrs,
  useSlots,
  watch,
} from "vue";

defineOptions({ inheritAttrs: false });

// ─── Types ────────────────────────────────────────────────────────────────────

type OptionRaw = string | number | boolean | Record<string, unknown>;
type LabelResolver = string | ((opt: unknown) => string);
type ValueResolver = string | ((opt: unknown) => unknown);
type DisableResolver = string | ((opt: unknown) => boolean);

export interface O2SelectProps {
  modelValue?: unknown;
  options?: OptionRaw[];

  optionLabel?: LabelResolver;
  optionValue?: ValueResolver;
  optionDisable?: DisableResolver;
  emitValue?: boolean;
  mapOptions?: boolean;

  useInput?: boolean;
  fillInput?: boolean;
  hideSelected?: boolean;
  inputDebounce?: number | string;

  multiple?: boolean;
  useChips?: boolean;
  maxValues?: number;

  newValueMode?: "add" | "add-unique" | "toggle";

  label?: string;
  stackLabel?: boolean;
  placeholder?: string;
  displayValue?: string | number;

  variant?: "outlined" | "borderless" | "filled";
  dense?: boolean;
  hideDropdownIcon?: boolean;

  loading?: boolean;
  disable?: boolean;
  readonly?: boolean;
  clearable?: boolean;

  rules?: Array<(val: unknown) => true | string>;
  lazyRules?: boolean | "ondemand";
  hideBottomSpace?: boolean;
  noErrorIcon?: boolean;
  error?: boolean;
  errorMessage?: string;

  popupContentStyle?: string | Record<string, string>;
  behavior?: "menu" | "dialog";
}

const props = withDefaults(defineProps<O2SelectProps>(), {
  options: () => [],
  optionLabel: "label",
  optionValue: "value",
  optionDisable: "disable",
  dense: true,
  variant: "outlined",
  inputDebounce: 0,
  behavior: "menu",
});

const emit = defineEmits<{
  "update:modelValue": [value: unknown];
  filter: [value: string, update: (fn: () => void) => void, abort: () => void];
  "new-value": [value: string, done: (val?: unknown, mode?: string) => void];
  "input-value": [value: string];
  "popup-show": [];
  "popup-hide": [];
  blur: [event: FocusEvent];
  focus: [event: FocusEvent];
}>();

const attrs = useAttrs();
const slots = useSlots();
const instance = getCurrentInstance();

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const rootRef = ref<HTMLElement | null>(null);
const controlRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const optionsListRef = ref<HTMLElement | null>(null);

// ─── UI state ─────────────────────────────────────────────────────────────────

const isOpen = ref(false);
const inputValue = ref("");
const focusedIndex = ref(-1);
const dropdownStyle = ref<Record<string, string>>({});

// ─── Validation state ─────────────────────────────────────────────────────────

const isDirty = ref(false);
const internalError = ref<string | null>(null);

// ─── Option helpers ───────────────────────────────────────────────────────────

const resolveLabel = (opt: unknown): string => {
  if (opt === null || opt === undefined) return "";
  if (typeof opt !== "object") return String(opt);
  const resolver = props.optionLabel;
  if (typeof resolver === "function") return resolver(opt);
  return String((opt as Record<string, unknown>)[resolver] ?? opt);
};

const resolveValue = (opt: unknown): unknown => {
  if (opt === null || opt === undefined) return opt;
  if (typeof opt !== "object") return opt;
  const resolver = props.optionValue;
  if (typeof resolver === "function") return resolver(opt);
  return (opt as Record<string, unknown>)[resolver] ?? opt;
};

const resolveDisabled = (opt: unknown): boolean => {
  if (typeof opt !== "object" || opt === null) return false;
  const resolver = props.optionDisable;
  if (typeof resolver === "function") return resolver(opt);
  return !!(opt as Record<string, unknown>)[resolver];
};

const isOptionSelected = (opt: unknown): boolean => {
  const optVal = props.emitValue ? resolveValue(opt) : opt;

  if (props.multiple) {
    const arr = Array.isArray(props.modelValue)
      ? (props.modelValue as unknown[])
      : [];
    if (props.emitValue) return arr.includes(optVal);
    if (props.mapOptions) {
      return arr.some((v) => resolveValue(v) === resolveValue(opt));
    }
    return arr.some((v) => JSON.stringify(v) === JSON.stringify(optVal));
  }

  if (props.emitValue) return props.modelValue === optVal;
  if (props.mapOptions)
    return resolveValue(props.modelValue) === resolveValue(opt);
  return JSON.stringify(props.modelValue) === JSON.stringify(optVal);
};

// ─── Filtered options ─────────────────────────────────────────────────────────

const filteredOptionsInternal = ref<unknown[]>(props.options ?? []);

watch(
  () => props.options,
  (next) => {
    filteredOptionsInternal.value = next ?? [];
  },
  { immediate: true },
);

const hasFilterListener = computed(() => {
  return !!instance?.vnode?.props?.onFilter;
});

const runInternalFilter = (val: string) => {
  if (!val) {
    filteredOptionsInternal.value = props.options ?? [];
    return;
  }
  const lower = val.toLowerCase();
  filteredOptionsInternal.value = (props.options ?? []).filter((opt) =>
    resolveLabel(opt).toLowerCase().includes(lower),
  );
};

let filterDebounce: ReturnType<typeof setTimeout> | null = null;

const triggerFilter = (val: string) => {
  if (filterDebounce) clearTimeout(filterDebounce);
  const delay = Number(props.inputDebounce) || 0;

  const doFilter = () => {
    if (hasFilterListener.value) {
      emit(
        "filter",
        val,
        (fn: () => void) => {
          fn?.();
        },
        () => {},
      );
    } else {
      runInternalFilter(val);
    }
  };

  if (delay > 0) {
    filterDebounce = setTimeout(doFilter, delay);
  } else {
    doFilter();
  }
};

// ─── Display computed ─────────────────────────────────────────────────────────

const resolvedSingleOption = computed(() => {
  if (
    props.multiple ||
    props.modelValue === null ||
    props.modelValue === undefined
  )
    return null;
  if (!props.emitValue) return props.modelValue;
  return (
    (props.options ?? []).find((o) => resolveValue(o) === props.modelValue) ??
    null
  );
});

const selectedOptions = computed(() => {
  if (!props.multiple) return [];
  const arr = Array.isArray(props.modelValue)
    ? (props.modelValue as unknown[])
    : [];
  if (!props.emitValue || !props.mapOptions) return arr;
  return arr.map(
    (v) => (props.options ?? []).find((o) => resolveValue(o) === v) ?? v,
  );
});

const hasValue = computed(() => {
  if (props.multiple) {
    return (
      Array.isArray(props.modelValue) &&
      (props.modelValue as unknown[]).length > 0
    );
  }
  return (
    props.modelValue !== null &&
    props.modelValue !== undefined &&
    props.modelValue !== ""
  );
});

const displayText = computed(() => {
  if (props.displayValue !== undefined) return String(props.displayValue);
  if (!hasValue.value) return "";

  if (props.multiple) {
    if (props.useChips) return "";
    return selectedOptions.value.map((o) => resolveLabel(o)).join(", ");
  }

  const opt = resolvedSingleOption.value;
  if (opt === null) return "";
  return resolveLabel(opt);
});

const showSearchInput = computed(
  () => props.useInput && (isOpen.value || (props.fillInput && hasValue.value)),
);

const showSelectedText = computed(() => {
  if (!hasValue.value) return false;
  if (props.multiple && props.useChips) return false;
  if (props.multiple) return !showSearchInput.value;
  if (props.hideSelected && isOpen.value && props.useInput) return false;
  if (props.fillInput) return false;
  return true;
});

const showPlaceholder = computed(
  () => !hasValue.value && !isOpen.value && !showSearchInput.value,
);

const inputNativeValue = computed(() => {
  if (!isOpen.value && props.fillInput && hasValue.value)
    return displayText.value;
  return inputValue.value;
});

const showClear = computed(
  () => props.clearable && hasValue.value && !props.disable && !props.readonly,
);

// ─── Validation ───────────────────────────────────────────────────────────────

const runValidation = (val: unknown): boolean => {
  if (!props.rules?.length) {
    internalError.value = null;
    return true;
  }
  for (const rule of props.rules) {
    const result = rule(val);
    if (result !== true) {
      internalError.value = result;
      return false;
    }
  }
  internalError.value = null;
  return true;
};

const validate = (): boolean => {
  isDirty.value = true;
  return runValidation(props.modelValue);
};

const resetValidation = (): void => {
  isDirty.value = false;
  internalError.value = null;
};

defineExpose({
  validate,
  resetValidation,
  focus: () => controlRef.value?.focus(),
});

// ─── Form context ─────────────────────────────────────────────────────────────

type O2FormContext = {
  register: (fn: () => boolean) => void;
  unregister: (fn: () => boolean) => void;
};
const form = inject<O2FormContext | null>("o2-form", null);

onMounted(() => {
  form?.register(validate);
});

const errorText = computed(() => {
  if (props.error) return props.errorMessage ?? "";
  if (isDirty.value) return internalError.value ?? "";
  return "";
});

const hasError = computed(
  () => !!(props.error || (isDirty.value && internalError.value)),
);

const showBottom = computed(() => {
  if (props.hideBottomSpace) return hasError.value || !!slots.hint;
  return true;
});

// ─── Attr splitting ───────────────────────────────────────────────────────────

const rootAttrs = computed(() => {
  const {
    class: cls,
    style,
    "data-test": dt,
  } = attrs as Record<string, unknown>;
  return { class: cls, style, "data-test": dt };
});

// ─── Dropdown positioning ─────────────────────────────────────────────────────

const updatePosition = () => {
  if (!controlRef.value) return;
  const rect = controlRef.value.getBoundingClientRect();
  const viewH = window.innerHeight;
  const dropH = dropdownRef.value?.offsetHeight ?? 280;
  const spaceBelow = viewH - rect.bottom;
  const openUp = spaceBelow < dropH + 8 && rect.top > spaceBelow;

  dropdownStyle.value = {
    position: "fixed",
    left: `${rect.left}px`,
    width: `${Math.max(rect.width, 160)}px`,
    minWidth: `${rect.width}px`,
    zIndex: "9999",
    ...(props.popupContentStyle && typeof props.popupContentStyle === "object"
      ? props.popupContentStyle
      : {}),
    ...(openUp
      ? {
          bottom: `${viewH - rect.top + 2}px`,
          top: "auto",
          maxHeight: `${rect.top - 8}px`,
        }
      : {
          top: `${rect.bottom + 2}px`,
          bottom: "auto",
          maxHeight: `${spaceBelow - 8}px`,
        }),
  };
};

const handleWindowScroll = () => closeDropdown();
const handleWindowResize = () => {
  if (isOpen.value) updatePosition();
};

const handleDocumentClick = (e: MouseEvent) => {
  if (!isOpen.value) return;
  const target = e.target as Node;
  if (rootRef.value?.contains(target)) return;
  if (dropdownRef.value?.contains(target)) return;
  closeDropdown();
};

// ─── Open / close ─────────────────────────────────────────────────────────────

const openDropdown = async () => {
  if (isOpen.value || props.disable || props.readonly) return;
  isOpen.value = true;
  focusedIndex.value = -1;
  if (!hasFilterListener.value && !inputValue.value) {
    filteredOptionsInternal.value = props.options ?? [];
  }

  await nextTick();
  updatePosition();

  document.addEventListener("click", handleDocumentClick, true);
  window.addEventListener("scroll", handleWindowScroll, true);
  window.addEventListener("resize", handleWindowResize);

  if (props.useInput) {
    searchInputRef.value?.focus();
    triggerFilter(inputValue.value);
  } else {
    controlRef.value?.focus();
  }

  emit("popup-show");
};

const closeDropdown = () => {
  if (!isOpen.value) return;
  isOpen.value = false;
  focusedIndex.value = -1;

  if (props.useInput && !props.fillInput) {
    inputValue.value = "";
    if (!hasFilterListener.value) {
      filteredOptionsInternal.value = props.options ?? [];
    }
  }

  document.removeEventListener("click", handleDocumentClick, true);
  window.removeEventListener("scroll", handleWindowScroll, true);
  window.removeEventListener("resize", handleWindowResize);

  if (isDirty.value || props.lazyRules) {
    if (props.lazyRules && props.lazyRules !== "ondemand") {
      isDirty.value = true;
      runValidation(props.modelValue);
    }
  }

  emit("popup-hide");
};

onBeforeUnmount(() => {
  closeDropdown();
  if (filterDebounce) clearTimeout(filterDebounce);
  form?.unregister(validate);
});

// ─── Selection ────────────────────────────────────────────────────────────────

const buildEmitValue = (opt: unknown): unknown =>
  props.emitValue ? resolveValue(opt) : opt;

const selectOption = (opt: unknown) => {
  if (resolveDisabled(opt)) return;

  const val = buildEmitValue(opt);

  if (props.multiple) {
    const current = Array.isArray(props.modelValue)
      ? [...(props.modelValue as unknown[])]
      : [];
    const idx = props.emitValue
      ? current.indexOf(val)
      : current.findIndex((v) => JSON.stringify(v) === JSON.stringify(val));

    if (idx === -1) {
      if (props.maxValues && current.length >= props.maxValues) return;
      emit("update:modelValue", [...current, val]);
    } else {
      current.splice(idx, 1);
      emit("update:modelValue", current);
    }
    if (props.useInput && !props.fillInput) {
      inputValue.value = "";
      if (!hasFilterListener.value) runInternalFilter("");
      else triggerFilter("");
      searchInputRef.value?.focus();
    }
  } else {
    emit("update:modelValue", val);
    if (props.useInput && props.fillInput) {
      inputValue.value = resolveLabel(opt);
    }
    closeDropdown();
  }

  if (isDirty.value) runValidation(props.multiple ? props.modelValue : val);
};

const removeAt = (index: number) => {
  if (!props.multiple) return;
  const current = Array.isArray(props.modelValue)
    ? [...(props.modelValue as unknown[])]
    : [];
  current.splice(index, 1);
  emit("update:modelValue", current);
};

const clearValue = () => {
  emit("update:modelValue", props.multiple ? [] : null);
  inputValue.value = "";
  if (!hasFilterListener.value)
    filteredOptionsInternal.value = props.options ?? [];
  if (isDirty.value) runValidation(props.multiple ? [] : null);
};

// ─── Input handling (search) ──────────────────────────────────────────────────

const handleSearchInput = (e: Event) => {
  const val = (e.target as HTMLInputElement).value;
  inputValue.value = val;
  emit("input-value", val);
  if (!isOpen.value) openDropdown();
  triggerFilter(val);
};

// ─── New value (tagging) ──────────────────────────────────────────────────────

const handleNewValue = (val: string) => {
  if (!val.trim()) return;

  if (props.newValueMode) {
    const done = (newVal?: unknown, mode?: string) => {
      const resolvedMode = mode ?? props.newValueMode;
      const emitVal = newVal !== undefined ? newVal : val;

      if (props.multiple) {
        const current = Array.isArray(props.modelValue)
          ? [...(props.modelValue as unknown[])]
          : [];
        const exists = current.includes(emitVal);
        if (resolvedMode === "add-unique" && exists) return;
        if (resolvedMode === "toggle" && exists) {
          emit(
            "update:modelValue",
            current.filter((v) => v !== emitVal),
          );
          return;
        }
        emit("update:modelValue", [...current, emitVal]);
      } else {
        emit("update:modelValue", emitVal);
      }
    };
    emit("new-value", val, done);
  } else {
    emit("new-value", val, () => {});
  }

  inputValue.value = "";
  closeDropdown();
};

// ─── Keyboard navigation ──────────────────────────────────────────────────────

const scrollToFocused = () => {
  if (!optionsListRef.value || focusedIndex.value < 0) return;
  const items =
    optionsListRef.value.querySelectorAll<HTMLElement>(".o2-select__option");
  items[focusedIndex.value]?.scrollIntoView({ block: "nearest" });
};

const handleControlKeydown = (e: KeyboardEvent) => {
  if (props.disable || props.readonly) return;

  switch (e.key) {
    case "ArrowDown":
    case "ArrowUp": {
      e.preventDefault();
      if (!isOpen.value) {
        openDropdown();
        return;
      }
      const len = filteredOptionsInternal.value.length;
      if (!len) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      focusedIndex.value = (focusedIndex.value + dir + len) % len;
      nextTick(scrollToFocused);
      break;
    }
    case "Enter": {
      e.preventDefault();
      if (!isOpen.value) {
        openDropdown();
        return;
      }
      if (
        focusedIndex.value >= 0 &&
        filteredOptionsInternal.value[focusedIndex.value]
      ) {
        selectOption(filteredOptionsInternal.value[focusedIndex.value]);
      } else if (
        props.useInput &&
        inputValue.value &&
        (props.newValueMode || instance?.vnode?.props?.onNewValue)
      ) {
        handleNewValue(inputValue.value);
      }
      break;
    }
    case "Escape":
    case "Tab":
      closeDropdown();
      break;
    case "Backspace":
      if (props.multiple && props.useChips && !inputValue.value) {
        const arr = Array.isArray(props.modelValue)
          ? (props.modelValue as unknown[])
          : [];
        if (arr.length) removeAt(arr.length - 1);
      }
      break;
  }
};

// ─── itemProps for #option slot ───────────────────────────────────────────────

const getItemProps = (opt: unknown, index: number) => ({
  clickable: true,
  active: isOptionSelected(opt),
  tabindex: -1,
  role: "option",
  "aria-selected": isOptionSelected(opt),
  onClick: (e: Event) => {
    e.stopPropagation();
    selectOption(opt);
  },
  onMouseenter: () => {
    focusedIndex.value = index;
  },
});
</script>

<template>
  <div
    ref="rootRef"
    class="o2-select"
    :class="rootAttrs.class"
    :style="rootAttrs.style as string"
    :data-test="rootAttrs['data-test'] as string"
    :data-variant="variant"
    :data-state="isOpen ? 'open' : 'closed'"
    :data-invalid="hasError || undefined"
    :data-disabled="disable || undefined"
    :data-loading="loading || undefined"
    :data-multiple="multiple || undefined"
  >
    <!-- Label -->
    <label v-if="label" class="o2-select__label">{{ label }}</label>

    <!-- Trigger control -->
    <div
      ref="controlRef"
      class="o2-select__control"
      :tabindex="disable || useInput ? -1 : 0"
      role="combobox"
      :aria-expanded="isOpen"
      :aria-haspopup="'listbox'"
      :aria-disabled="disable ? 'true' : undefined"
      @click="isOpen ? closeDropdown() : openDropdown()"
      @keydown="handleControlKeydown"
      @blur="($event: FocusEvent) => emit('blur', $event)"
      @focus="($event: FocusEvent) => emit('focus', $event)"
    >
      <!-- Pattern B: Chips for multiple selections -->
      <div v-if="multiple && useChips" class="o2-select__chips-wrap">
        <template v-for="(opt, i) in selectedOptions" :key="i">
          <slot
            name="selected-item"
            :index="i"
            :opt="opt"
            :remove-at-index="() => removeAt(i)"
            :tabindex="-1"
          >
            <span class="o2-select__chip">
              <span class="o2-select__chip-label">{{ resolveLabel(opt) }}</span>
              <button
                class="o2-select__chip-remove"
                type="button"
                tabindex="-1"
                :aria-label="`Remove ${resolveLabel(opt)}`"
                @click.stop="removeAt(i)"
              >
                <svg
                  viewBox="0 0 8 8"
                  width="8"
                  height="8"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </span>
          </slot>
        </template>

        <input
          v-if="useInput"
          ref="searchInputRef"
          class="o2-select__input o2-select__input--inline"
          :value="inputValue"
          :placeholder="!hasValue ? placeholder : ''"
          aria-autocomplete="list"
          autocomplete="off"
          tabindex="0"
          @input="handleSearchInput"
          @keydown.stop="handleControlKeydown"
          @blur="($event: FocusEvent) => emit('blur', $event)"
          @focus="openDropdown"
          @click.stop
        />
      </div>

      <!-- Pattern A/D: Single value display or search input -->
      <template v-else>
        <span v-if="showSelectedText" class="o2-select__value">{{
          displayText
        }}</span>

        <input
          v-if="showSearchInput"
          ref="searchInputRef"
          class="o2-select__input"
          :value="inputNativeValue"
          :placeholder="placeholder"
          aria-autocomplete="list"
          autocomplete="off"
          tabindex="0"
          @input="handleSearchInput"
          @keydown.stop="handleControlKeydown"
          @blur="($event: FocusEvent) => emit('blur', $event)"
          @click.stop
        />

        <span v-else-if="showPlaceholder" class="o2-select__placeholder">{{
          placeholder
        }}</span>
      </template>

      <!-- Right-side adornments -->
      <span v-if="loading" class="o2-select__spinner"
aria-hidden="true" />

      <button
        v-if="showClear"
        class="o2-select__clear"
        type="button"
        tabindex="-1"
        aria-label="Clear"
        @click.stop="clearValue"
      >
        <svg
          viewBox="0 0 10 10"
          width="10"
          height="10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M1 1l8 8M9 1L1 9"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <span
        v-if="!hideDropdownIcon"
        class="o2-select__arrow"
        aria-hidden="true"
      />
    </div>

    <!-- Bottom: error · hint -->
    <div v-if="showBottom" class="o2-select__bottom">
      <span v-if="hasError" class="o2-select__error-text"
role="alert">
        <svg
          v-if="!noErrorIcon"
          class="o2-select__error-icon"
          viewBox="0 0 12 12"
          width="10"
          height="10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle
            cx="6"
            cy="6"
            r="5"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <path
            d="M6 3.5v3M6 8.2v.3"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
        {{ errorText }}
      </span>
      <span v-else-if="$slots.hint" class="o2-select__hint-text">
        <slot name="hint" />
      </span>
    </div>
  </div>

  <!-- ─── Dropdown (teleported to body to avoid z-index / overflow clipping) ── -->
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="dropdownRef"
      class="o2-select__dropdown"
      :style="dropdownStyle"
      role="listbox"
      :aria-multiselectable="multiple"
      @mousedown.prevent
    >
      <slot name="before-options" />

      <div ref="optionsListRef" class="o2-select__options">
        <template v-if="filteredOptionsInternal.length">
          <div
            v-for="(opt, i) in filteredOptionsInternal"
            :key="i"
            class="o2-select__option"
            :data-state="isOptionSelected(opt) ? 'selected' : 'unselected'"
            :data-focused="focusedIndex === i || undefined"
            :data-disabled="resolveDisabled(opt) || undefined"
            role="option"
            :aria-selected="isOptionSelected(opt)"
            @click.stop="selectOption(opt)"
            @mouseenter="focusedIndex = i"
          >
            <slot
              name="option"
              :opt="opt"
              :index="i"
              :item-props="getItemProps(opt, i)"
              :selected="isOptionSelected(opt)"
              :toggle-option="() => selectOption(opt)"
            >
              <span
                v-if="multiple"
                class="o2-select__option-check"
                aria-hidden="true"
              />
              <span class="o2-select__option-label">{{
                resolveLabel(opt)
              }}</span>
            </slot>
          </div>
        </template>

        <template v-else>
          <slot name="no-option" :inputValue="inputValue">
            <div class="o2-select__no-option">No options</div>
          </slot>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Select styles — global (non-scoped) under .o2-select and .o2-select__dropdown.
// The dropdown is teleported to <body>, so its styles must be global.
// State is targeted via data attributes.
//
// ─── Layer 3: Component Tokens ───────────────────────────────────────────────

.o2-select {
  --o2-select-height: 1.75rem;
  --o2-select-font-size: 0.8125rem;
  --o2-select-font-family: inherit;
  --o2-select-pad-x: 0.5rem;
  --o2-select-pad-y: 0;
  --o2-select-radius: 0.25rem;
  --o2-select-gap: 0.25rem;

  --o2-select-bg: transparent;
  --o2-select-text: var(--o2-text-primary);
  --o2-select-placeholder: var(--o2-text-muted);
  --o2-select-border: var(--o2-border-input);
  --o2-select-border-focus: var(--o2-primary-color);
  --o2-select-border-error: var(--o2-status-error-text);

  --o2-select-label-size: 0.6875rem;
  --o2-select-label-weight: 500;
  --o2-select-label-color: var(--o2-input-label-text-color);
  --o2-select-label-gap: 0.1875rem;

  --o2-select-adornment-color: var(--o2-text-muted);
  --o2-select-arrow-size: 0.25rem;

  --o2-select-bottom-size: 0.6875rem;
  --o2-select-bottom-min-h: 1.125rem;
  --o2-select-bottom-gap: 0.1875rem;
  --o2-select-error-color: var(--o2-status-error-text);
  --o2-select-hint-color: var(--o2-text-muted);

  --o2-select-chip-height: 1.125rem;
  --o2-select-chip-radius: 0.1875rem;
  --o2-select-chip-bg: var(--o2-muted-background);
  --o2-select-chip-text: var(--o2-text-primary);
  --o2-select-chip-border: var(--o2-border);

  // ─── Structure ──────────────────────────────────────────────────────────────
  display: inline-flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  font-size: var(--o2-select-font-size);
  font-family: var(--o2-select-font-family);

  // ─── Label ──────────────────────────────────────────────────────────────────
  &__label {
    display: block;
    font-size: var(--o2-select-label-size);
    font-weight: var(--o2-select-label-weight);
    color: var(--o2-select-label-color);
    margin-bottom: var(--o2-select-label-gap);
    line-height: 1;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  // ─── Control ────────────────────────────────────────────────────────────────
  &__control {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    min-height: var(--o2-select-height);
    gap: var(--o2-select-gap);
    padding: var(--o2-select-pad-y) var(--o2-select-pad-x);
    border: 1px solid var(--o2-select-border);
    border-radius: var(--o2-select-radius);
    background: var(--o2-select-bg);
    cursor: pointer;
    user-select: none;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
    overflow: hidden;
  }

  // ─── Chips wrap ─────────────────────────────────────────────────────────────
  &__chips-wrap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    flex: 1;
    gap: 0.1875rem;
    min-width: 0;
    padding: 0.125rem 0;
  }

  // ─── Chip ───────────────────────────────────────────────────────────────────
  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.1875rem;
    height: var(--o2-select-chip-height);
    padding: 0 0.3125rem 0 0.375rem;
    border-radius: var(--o2-select-chip-radius);
    background: var(--o2-select-chip-bg);
    border: 1px solid var(--o2-select-chip-border);
    color: var(--o2-select-chip-text);
    font-size: 0.75rem;
    white-space: nowrap;
    max-width: 12rem;
  }

  &__chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__chip-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 0.875rem;
    height: 0.875rem;
    flex-shrink: 0;
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
    color: var(--o2-select-adornment-color);
    opacity: 0.6;
    transition: opacity 0.1s;
    border-radius: 50%;

    &:hover {
      opacity: 1;
    }
  }

  // ─── Value text ─────────────────────────────────────────────────────────────
  &__value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--o2-select-text);
    line-height: var(--o2-select-height);
    font-size: var(--o2-select-font-size);
  }

  // ─── Placeholder ────────────────────────────────────────────────────────────
  &__placeholder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--o2-select-placeholder);
    font-size: var(--o2-select-font-size);
    line-height: var(--o2-select-height);
  }

  // ─── Inline search input ────────────────────────────────────────────────────
  &__input {
    flex: 1;
    min-width: 4rem;
    height: var(--o2-select-height);
    border: none;
    outline: none;
    background: transparent;
    color: var(--o2-select-text);
    font-size: var(--o2-select-font-size);
    font-family: var(--o2-select-font-family);
    cursor: text;

    &::placeholder {
      color: var(--o2-select-placeholder);
      opacity: 1;
    }

    &--inline {
      min-width: 2rem;
      width: 4rem;
      flex: 1 1 4rem;
      height: var(--o2-select-chip-height);
    }
  }

  // ─── Loading spinner ────────────────────────────────────────────────────────
  &__spinner {
    display: inline-block;
    flex-shrink: 0;
    width: 0.875rem;
    height: 0.875rem;
    border: 1.5px solid var(--o2-border);
    border-top-color: var(--o2-primary-color);
    border-radius: 50%;
    animation: o2-select-spin 0.7s linear infinite;
  }

  @keyframes o2-select-spin {
    to {
      transform: rotate(360deg);
    }
  }

  // ─── Clear button ────────────────────────────────────────────────────────────
  &__clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    flex-shrink: 0;
    border: none;
    border-radius: 0.125rem;
    background: transparent;
    color: var(--o2-select-adornment-color);
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.12s;

    &:hover {
      opacity: 1;
    }
  }

  // ─── Dropdown arrow ──────────────────────────────────────────────────────────
  &__arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1rem;
    color: var(--o2-select-adornment-color);

    &::after {
      content: "";
      display: block;
      width: 0;
      height: 0;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 5px solid currentColor;
      transition: transform 0.15s;
    }
  }

  // Arrow rotates when open
  &[data-state="open"] &__arrow::after {
    transform: rotate(180deg);
  }

  // ─── Bottom row ──────────────────────────────────────────────────────────────
  &__bottom {
    display: flex;
    align-items: flex-start;
    min-height: var(--o2-select-bottom-min-h);
    padding-top: var(--o2-select-bottom-gap);
    font-size: var(--o2-select-bottom-size);
    line-height: 1.3;
  }

  &__error-text {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--o2-select-error-color);
  }

  &__error-icon,
  &__hint-text {
    color: var(--o2-select-hint-color);
  }

  // ─── State: open (focus) ─────────────────────────────────────────────────────
  &[data-state="open"] &__control {
    border-color: var(--o2-select-border-focus);
  }

  // ─── State: invalid ───────────────────────────────────────────────────────────
  &[data-invalid] &__control {
    border-color: var(--o2-select-border-error);
  }

  // ─── State: disabled ──────────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    pointer-events: none;
    cursor: not-allowed;
  }

  // ─── Variant: borderless ──────────────────────────────────────────────────────
  &[data-variant="borderless"] &__control {
    border-color: var(--o2-border);
    background: transparent;
  }

  &[data-variant="borderless"][data-state="open"] &__control {
    border-color: var(--o2-select-border-focus);
  }

  &[data-variant="borderless"][data-invalid] &__control {
    border-color: var(--o2-select-border-error);
  }

  // ─── Variant: filled ──────────────────────────────────────────────────────────
  &[data-variant="filled"] &__control {
    border-color: transparent;
    background: var(--o2-secondary-background);
  }

  &[data-variant="filled"][data-state="open"] &__control {
    background: var(--o2-secondary-background);
    border-color: var(--o2-select-border-focus);
  }
}

// ─── Dropdown (global — teleported to <body>) ─────────────────────────────────

.o2-select__dropdown {
  --o2-select-dropdown-bg: var(--o2-popover-background);
  --o2-select-dropdown-border: var(--o2-border);
  --o2-select-dropdown-radius: 0.25rem;
  --o2-select-dropdown-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  --o2-select-option-height: 1.875rem;
  --o2-select-option-font-size: 0.8125rem;
  --o2-select-option-pad-x: 0.625rem;
  --o2-select-option-hover-bg: var(--o2-hover-gray);
  --o2-select-option-selected-bg: var(--o2-tab-bg);
  --o2-select-option-selected-text: var(--o2-primary-color);
  --o2-select-option-focused-bg: var(--o2-hover-gray);
  --o2-select-option-disabled-opacity: 0.4;
  --o2-select-check-size: 0.875rem;
  --o2-select-check-color: var(--o2-primary-color);

  background: var(--o2-select-dropdown-bg);
  border: 1px solid var(--o2-select-dropdown-border);
  border-radius: var(--o2-select-dropdown-radius);
  box-shadow: var(--o2-select-dropdown-shadow);
  overflow: hidden;
  animation: o2-select-enter 0.1s ease;

  @keyframes o2-select-enter {
    from {
      opacity: 0;
      transform: translateY(-0.25rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}

.o2-select__options {
  overflow-y: auto;
  max-height: inherit;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--o2-border) transparent;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--o2-border);
    border-radius: 2px;
  }
}

.o2-select__option {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-height: var(--o2-select-option-height);
  padding: 0 var(--o2-select-option-pad-x);
  font-size: var(--o2-select-option-font-size);
  color: var(--o2-text-primary);
  cursor: pointer;
  transition: background 0.1s;
  user-select: none;

  &:hover,
  &[data-focused] {
    background: var(--o2-select-option-hover-bg);
  }

  &[data-state="selected"] {
    color: var(--o2-select-option-selected-text);
    background: var(--o2-select-option-selected-bg);
  }

  &[data-disabled] {
    opacity: var(--o2-select-option-disabled-opacity);
    cursor: not-allowed;
    pointer-events: none;
  }
}

.o2-select__option-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--o2-select-check-size);
  height: var(--o2-select-check-size);
  border: 1px solid var(--o2-border-input);
  border-radius: 0.1875rem;
  background: transparent;
  transition:
    background 0.1s,
    border-color 0.1s;

  // Checked state driven by parent option data-state
  .o2-select__option[data-state="selected"] & {
    background: var(--o2-select-check-color);
    border-color: var(--o2-select-check-color);

    &::after {
      content: "";
      display: block;
      width: 0.3125rem;
      height: 0.1875rem;
      border-left: 1.5px solid #fff;
      border-bottom: 1.5px solid #fff;
      transform: rotate(-45deg) translateY(-0.0625rem);
    }
  }
}

.o2-select__option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.o2-select__no-option {
  padding: 0.5rem 0.625rem;
  font-size: 0.8125rem;
  color: var(--o2-text-muted);
  text-align: center;
}
</style>
