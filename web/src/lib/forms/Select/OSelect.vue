<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  SelectProps,
  SelectEmits,
  SelectSlots,
  SelectValue as SelectPrimitiveValue,
  SelectModelValue,
} from "./OSelect.types";
import { SELECT_VALUE_MAP_KEY, SELECT_PARENT_DATA_TEST_KEY, NULL_VALUE_SENTINEL } from "./OSelect.types";
import OSelectItem from "./OSelectItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import {
  ListboxFilter,
  ListboxItem,
  ListboxRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "reka-ui";
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
  type Ref,
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  useAttrs,
  useId,
  useSlots,
  watch,
  watchEffect,
} from "vue";
import {
  O_DROPDOWN_NESTED_KEY,
  setActiveOverlay,
  clearActiveOverlay,
} from "@/lib/overlay/Dropdown/ODropdown.context";

type NormalizedOption = {
  label: string;
  value: SelectPrimitiveValue;
  disabled: boolean;
  header: boolean;
  icon?: string;
  /** Pre-rendered Vue component (e.g. an inlined SVG) shown beside the option label.
   *  Used when the icon isn't a string name in the OIcon registry. */
  iconComponent?: any;
  /** Secondary description text shown below the label in the dropdown item. */
  subLabel?: string;
  /** When true, renders subLabel on the same line as the label (name – url style). */
  subLabelInline?: boolean;
  /** Array of CSS color strings used to render a gradient swatch below the label. */
  colorPalette?: string[];
  /** Optional badge/chip text rendered inline next to the label (e.g. "recommended"). */
  badge?: string;
  /** Tooltip for the badge. Use when the badge is abbreviated (e.g. `C` → "Counter"). */
  badgeTitle?: string;
  /**
   * Per-option badge colours, e.g. `{ color, background }`. A styled badge renders
   * as a filled pill in that option's own colour, right-aligned into a single
   * column; a bare (unstyled) badge stays inline next to the label.
   */
  badgeStyle?: Record<string, string>;
};

const DEFAULT_OPTION_LABEL = "label";
const DEFAULT_OPTION_VALUE = "value";
const DEFAULT_OPTION_DISABLED = "disabled";

const props = withDefaults(defineProps<SelectProps>(), {
  size: "md",
  disabled: false,
  clearable: false,
  error: false,
  multiple: false,
  searchable: true,
  searchDebounce: 0,
  hideSelected: false,
  collapsibleGroups: false,
  creatable: false,
  searchPlaceholder: "Search...",
  labelKey: DEFAULT_OPTION_LABEL,
  valueKey: DEFAULT_OPTION_VALUE,
  iconKey: undefined,
  labelPosition: "outside",
  rowClickSingleSelect: false,
  optionTooltip: false,
  // Intentionally no default — when undefined, the chip count is computed
  // from the live trigger width. Pass a number to force a fixed cap.
});

// Forward the consumer's `data-test` from <OSelect data-test="…"> onto the
// root wrapper so E2E selectors can scope to the specific field instance.
// (Same pattern as ODialog / OInput.)
defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(
  () => $attrs["data-test"] as string | undefined,
);

// Forward tabindex to the real trigger; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex, ...rest } = $attrs;
  void tabindex;
  return rest;
});

const emit = defineEmits<SelectEmits>();
const slots = useSlots();

defineSlots<SelectSlots>();

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);

// Dev-time warning: slot-based options with multiple/searchable require listbox
// mode, but listboxModeEnabled requires options prop. Guide the developer early.
if (import.meta.env.DEV) {
  watchEffect(() => {
    if (slots.default && (props.multiple || props.searchable)) {
      console.warn(
        "[OSelect] Slot-based options (OSelectItem/OSelectGroup) do not support " +
          "`multiple`, `searchable`, or `useInput`. Pass options via the `options` prop instead.",
      );
    }
  });
}

// Value map populated by OSelectItem children to preserve original types
// (Reka UI requires string values; this lets us recover number originals)
const valueMap = new Map<string, SelectPrimitiveValue>();
provide(SELECT_VALUE_MAP_KEY, valueMap);
// Forward the parent OSelect's data-test to OSelectItem children so they can
// auto-derive `<parent>-option` data-test attributes (non-listbox mode).
provide(SELECT_PARENT_DATA_TEST_KEY, parentDataTest);

const isPrimitiveSelectValue = (
  value: unknown,
): value is SelectPrimitiveValue =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

/** Map null ↔ sentinel so Reka UI receives a valid string */
function toRekaString(v: SelectPrimitiveValue): string {
  if (v === null) return NULL_VALUE_SENTINEL;
  return String(v);
}

function normalizeOption(raw: unknown): NormalizedOption | null {
  if (isPrimitiveSelectValue(raw)) {
    return {
      label: String(raw),
      value: raw,
      disabled: false,
      header: false,
    };
  }

  if (!raw || typeof raw !== "object") return null;

  const option = raw as Record<string, unknown>;
  const rawLabel = option[props.labelKey];

  // Group header: items with header:true or isTab:true are non-selectable labels
  const isHeader = Boolean(option["header"]) || Boolean(option["isTab"]);
  if (isHeader) {
    return {
      label:
        rawLabel === undefined || rawLabel === null ? "" : String(rawLabel),
      value: `__header__${String(rawLabel)}`,
      disabled: true,
      header: true,
    };
  }

  const rawValue = option[props.valueKey];
  if (!isPrimitiveSelectValue(rawValue)) return null;

  const rawIcon = props.iconKey ? option[props.iconKey] : undefined;
  // Auto-pick up `iconComponent` on the option (raw Vue component / inlined SVG).
  // Lets consumers like ConfigPanel pass `iconComponent: markRaw(MyIcon)` per option
  // when the icon isn't a string in the OIcon registry.
  const rawIconComponent = option["iconComponent"];
  const rawSubLabel = option["subLabel"];
  const rawSubLabelInline = option["subLabelInline"];
  const rawColorPalette = option["colorPalette"];
  return {
    label:
      rawLabel === undefined || rawLabel === null
        ? String(rawValue)
        : String(rawLabel),
    value: rawValue,
    disabled: Boolean(option[DEFAULT_OPTION_DISABLED]),
    header: false,
    icon: typeof rawIcon === "string" && rawIcon ? rawIcon : undefined,
    iconComponent: rawIconComponent ?? undefined,
    subLabel: typeof rawSubLabel === "string" ? rawSubLabel : undefined,
    subLabelInline: rawSubLabelInline === true,
    colorPalette: Array.isArray(rawColorPalette)
      ? (rawColorPalette as string[])
      : undefined,
    badge: typeof option["badge"] === "string" ? (option["badge"] as string) : undefined,
    badgeTitle:
      typeof option["badgeTitle"] === "string"
        ? (option["badgeTitle"] as string)
        : undefined,
    badgeStyle:
      option["badgeStyle"] && typeof option["badgeStyle"] === "object"
        ? (option["badgeStyle"] as Record<string, string>)
        : undefined,
  };
}

const normalizedOptions = computed<NormalizedOption[]>(() => {
  if (!props.options?.length) return [];
  return props.options
    .map((raw) => normalizeOption(raw))
    .filter((opt): opt is NormalizedOption => opt !== null);
});

// Mirror prop-supplied options into valueMap so resolveListboxValue can recover
// their original type. Without this, numeric values like `1` round-trip as `"1"`
// (Reka stores listbox values as strings) and strict-equality checks against
// the typed option value — e.g. the multi-select checkbox indicator — never match.
// Also registers NULL_VALUE_SENTINEL → null so null options round-trip correctly.
watchEffect(() => {
  for (const o of normalizedOptions.value) {
    if (!o.header) valueMap.set(toRekaString(o.value), o.value);
  }
});

const searchTerm = ref("");
const popoverOpen = ref(false);
const filterDebounceTimer = ref<ReturnType<typeof setTimeout> | null>(null);

// Set of Reka string keys that were selected when the popover last opened.
// Frozen for the lifetime of one open session so items don't re-order mid-interaction.
// Cleared when the popover opens with nothing selected.
const pinnedSelected = ref<Set<string>>(new Set());

const inputEnabled = computed(() => props.searchable);

const baseFilteredOptions = computed(() => {
  if (!inputEnabled.value) return normalizedOptions.value;
  const term = searchTerm.value.trim().toLowerCase();
  let options = normalizedOptions.value;

  if (props.hideSelected && props.multiple && selectedValues.value.length > 0) {
    options = options.filter(
      (opt) => opt.header || !selectedValues.value.includes(opt.value),
    );
    // Drop headers that no longer have any following non-header items
    options = options.filter((opt, i) => {
      if (!opt.header) return true;
      const next = options[i + 1];
      return next !== undefined && !next.header;
    });
  }

  if (!term) {
    // In multi-select mode, float previously-selected items to the top so users
    // can immediately see and manage their current choices on re-open.
    // Only applies when there is a non-empty pin set and no headers in the list
    // (headers imply grouped options where reordering would break visual grouping).
    if (
      props.multiple &&
      pinnedSelected.value.size > 0 &&
      !options.some((o) => o.header)
    ) {
      const pinned = pinnedSelected.value;
      const top = options.filter((o) => pinned.has(toRekaString(o.value)));
      const rest = options.filter((o) => !pinned.has(toRekaString(o.value)));
      return [...top, ...rest];
    }
    return options;
  }

  // Keep headers visible if any of their following non-header items match
  const result: NormalizedOption[] = [];
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (opt.header) {
      // Include the header only if at least one subsequent non-header item matches
      let j = i + 1;
      while (j < options.length && !options[j].header) {
        if (options[j].label.toLowerCase().includes(term)) {
          result.push(opt);
          break;
        }
        j++;
      }
    } else {
      if (opt.label.toLowerCase().includes(term)) {
        result.push(opt);
      }
    }
  }
  return result;
});

// ── Collapsible groups (opt-in via `collapsibleGroups`) ──────────────────────
// Group headers become accordion toggles: collapsing a group hides its items
// (the header stays, so it can be re-expanded). Keyed by header label — group
// labels are unique in practice. Ignored while searching so matches always show.
const collapsedGroups = ref<Set<string>>(new Set());
const isGroupCollapsed = (label: string) => collapsedGroups.value.has(label);
const toggleGroup = (label: string) => {
  const next = new Set(collapsedGroups.value);
  next.has(label) ? next.delete(label) : next.add(label);
  collapsedGroups.value = next;
};

// The final option list the dropdown renders — the single source of truth that
// feeds the virtualizer, keyboard navigation, and the empty-state check. It
// layers the accordion collapse on top of `baseFilteredOptions` (which has
// already applied the search + hide-selected filters), one step before render.
//
// `baseFilteredOptions` is a FLAT array where each group header
// (`{ header: true, label }`) is followed by that group's items, e.g.
//   [Destinations(header), dest1, dest2, Workflows(header), wf1, wf2]
// Collapsing a group must hide its items but KEEP the header (so the bar stays
// visible and clickable to re-expand).
//
// Two early exits leave `base` untouched:
//   1. Not in collapsible mode, or nothing collapsed — every other select in the
//      app hits this, so the feature is invisible unless opted in.
//   2. An active search term — collapse is bypassed so a match inside a collapsed
//      group still shows (otherwise search would look broken).
//
// Otherwise walk the flat list: on a header, remember whether ITS group is
// collapsed (and always keep the header); on an item, keep it only while the
// current group isn't collapsed. `hidden` carries forward until the next header
// resets it.
const filteredOptions = computed(() => {
  const base = baseFilteredOptions.value;
  if (!props.collapsibleGroups || collapsedGroups.value.size === 0) return base;
  if (searchTerm.value.trim()) return base; // search spans every group
  const out: NormalizedOption[] = [];
  let hidden = false;
  for (const opt of base) {
    if (opt.header) {
      hidden = collapsedGroups.value.has(opt.label);
      out.push(opt);
    } else if (!hidden) {
      out.push(opt);
    }
  }
  return out;
});

const listboxModeEnabled = computed(
  () =>
    !slots.default &&
    (props.multiple ||
      props.searchable ||
      props.creatable ||
      (!!props.options?.length &&
        (props.labelKey !== DEFAULT_OPTION_LABEL ||
          props.valueKey !== DEFAULT_OPTION_VALUE))),
);

const selectedValues = computed<SelectPrimitiveValue[]>(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue;
  if (props.modelValue === undefined || props.modelValue === "") {
    return [];
  }
  if (props.modelValue === null) {
    // null is a valid selection when a null-valued option exists (e.g. "Auto", "None", "Default")
    const hasNullOption = normalizedOptions.value.some(
      (opt) => !opt.header && opt.value === null,
    );
    return hasNullOption ? [null] : [];
  }
  return [props.modelValue];
});

const hasSelection = computed(() =>
  selectedValues.value.some((v) => v !== undefined),
);

const selectedLabels = computed(() => {
  return selectedValues.value
    .map((selectedValue) => {
      const option = normalizedOptions.value.find(
        (opt) => opt.value === selectedValue,
      );
      if (option) return option.label;
      // Don't render "null" for unmatched null values — treat as empty/placeholder
      if (selectedValue === null) return null;
      return String(selectedValue);
    })
    .filter((label): label is string => Boolean(label));
});

const triggerDisplayLabel = computed(() => {
  if (!hasSelection.value) return "";
  if (props.multiple) return selectedLabels.value.join(", ");
  return selectedLabels.value[0] ?? "";
});

watch(searchTerm, (value) => {
  if (!inputEnabled.value) return;
  if ((props.searchDebounce ?? 0) > 0) {
    if (filterDebounceTimer.value) clearTimeout(filterDebounceTimer.value);
    filterDebounceTimer.value = setTimeout(
      () => emit("search", value),
      props.searchDebounce,
    );
    return;
  }
  emit("search", value);
});

// Clear the search term whenever the popover closes so re-opening the
// dropdown always shows the full unfiltered option list.
// In multi-select mode, also snapshot the current selection so selected items
// can be floated to the top on the next open.
watch(popoverOpen, (open) => {
  if (!open) {
    searchTerm.value = "";
  } else if (props.multiple) {
    pinnedSelected.value = new Set(
      selectedValues.value.map((v) => toRekaString(v)),
    );
  }
});

// ── Error state ────────────────────────────────────────────────────────────
// The error message is only shown when `props.error` is true. `error` is the
// single source of truth for whether the error is visible; `errorMessage` only
// controls the text.
const effectiveError = computed(() => {
  if (!props.error) return null;
  return props.errorMessage || " ";
});
const hasError = computed(() => !!effectiveError.value);

const stringValue = computed(() =>
  !Array.isArray(props.modelValue) && props.modelValue !== undefined
    ? toRekaString(props.modelValue)
    : undefined,
);

function handleUpdate(value: string | null) {
  // Reka's SelectRoot types the value as nullable; null means no selection here.
  if (value === null) {
    emit("update:modelValue", undefined);
    return;
  }
  // Recover the original type: prefer props.options, then the slot-item registry
  const opt = normalizedOptions.value.find((o) => String(o.value) === value);
  let resolved: SelectPrimitiveValue;
  if (opt !== undefined) {
    resolved = opt.value;
  } else if (valueMap.has(value)) {
    resolved = valueMap.get(value)!;
  } else {
    resolved = value;
  }
  emit("update:modelValue", resolved);
}

function resolveListboxValue(value: unknown): SelectModelValue {
  if (props.multiple) {
    if (!Array.isArray(value)) {
      return value === undefined || value === null ? [] : [String(value)];
    }
    return value.map((item) => {
      const key = String(item);
      return valueMap.has(key)
        ? (valueMap.get(key) as SelectPrimitiveValue)
        : key;
    });
  }

  if (Array.isArray(value)) {
    const first = value[0];
    if (first === undefined || first === null) return undefined;
    const key = String(first);
    return valueMap.has(key)
      ? (valueMap.get(key) as SelectPrimitiveValue)
      : key;
  }

  if (value === undefined || value === null) return undefined;
  const key = String(value);
  return valueMap.has(key) ? (valueMap.get(key) as SelectPrimitiveValue) : key;
}

function handleListboxUpdate(value: unknown) {
  const resolved = resolveListboxValue(value);

  // Single-select: prevent deselecting the already-selected option
  if (!props.multiple) {
    if (resolved === undefined || resolved === "") {
      // Reka toggles off the current selection by emitting "" or undefined — ignore it.
      // Note: resolved === null is a valid mapped value (e.g. "None"/"Auto"/"Default"
      // options that use null as their value), so it must NOT be blocked here.
      popoverOpen.value = false;
      return;
    }
  }

  emit("update:modelValue", resolved);

  if (!props.multiple) {
    popoverOpen.value = false;
  }
}

function handleRowClickSingleSelect(rekaStringValue: string) {
  const resolved = valueMap.has(rekaStringValue)
    ? (valueMap.get(rekaStringValue) as SelectPrimitiveValue)
    : rekaStringValue;
  emit("update:modelValue", [resolved]);
  popoverOpen.value = false;
}

function handleItemClickCapture(event: MouseEvent, rekaStringValue: string) {
  if (!props.rowClickSingleSelect) return;

  // Find the separator line rendered inside this item. Anything clicked at or
  // to the left of the separator is the "checkbox zone" — let Reka toggle normally.
  // Anything to the right is the "label zone" — single-select and close.
  const separator = (event.currentTarget as HTMLElement | null)?.querySelector("[data-select-separator]");

  if (separator) {
    const { right } = separator.getBoundingClientRect();
    if (event.clientX <= right) return; // checkbox zone — let Reka handle
  } else {
    // Fallback: no separator means rowClickSingleSelect isn't active for this item
    return;
  }

  event.stopPropagation();
  handleRowClickSingleSelect(rekaStringValue);
}

const listboxStringModelValue = computed<string | string[]>(() => {
  const resolved = props.multiple
    ? selectedValues.value.map((value) => toRekaString(value))
    : selectedValues.value[0] !== undefined
      ? toRekaString(selectedValues.value[0])
      : "";
  return resolved;
});

function handleClear() {
  const clearedValue: SelectModelValue = props.multiple ? [] : undefined;
  emit("update:modelValue", clearedValue);
  emit("clear");
  searchTerm.value = "";
}

// ── Select-all (multi-select listbox) ─────────────────────────────────────
// Operates on all enabled, non-header options — not just the currently
// filtered subset — so the master state stays predictable regardless of the
// search term.
const selectableOptions = computed<NormalizedOption[]>(() =>
  normalizedOptions.value.filter(
    (o: NormalizedOption) => !o.header && !o.disabled,
  ),
);

const allSelected = computed(() => {
  const all = selectableOptions.value;
  if (all.length === 0) return false;
  return all.every((o: NormalizedOption) =>
    selectedValues.value.includes(o.value),
  );
});

const partiallySelected = computed(() => {
  if (allSelected.value) return false;
  return selectableOptions.value.some((o: NormalizedOption) =>
    selectedValues.value.includes(o.value),
  );
});

function toggleAllSelections() {
  if (allSelected.value) {
    emit("update:modelValue", []);
  } else {
    emit(
      "update:modelValue",
      selectableOptions.value.map((o: NormalizedOption) => o.value),
    );
  }
}

function handleCreateFromInput() {
  if (!props.creatable) return;
  const term = searchTerm.value.trim();
  if (!term) return;

  const hasExisting = normalizedOptions.value.some(
    (opt) => opt.label === term || String(opt.value) === term,
  );
  if (hasExisting) return;

  emit("create", term);
}

onBeforeUnmount(() => {
  if (filterDebounceTimer.value) clearTimeout(filterDebounceTimer.value);
});

/** Close the dropdown programmatically */
function close() {
  popoverOpen.value = false;
  searchTerm.value = "";
}

/** Focus the trigger programmatically (both listbox and native-select modes). */
function focus() {
  if (typeof document === "undefined") return;
  document.getElementById(inputId.value)?.focus();
}

defineExpose({ close, focus });

// Type-to-search on the closed trigger: a printable keystroke opens the
// dropdown and seeds the filter, mirroring native <select> typeahead. The
// event is consumed here so page-level single-letter shortcuts (logs "s",
// "r", "h", …) never fire while the select has keyboard focus.
function handleTriggerKeydown(e: KeyboardEvent) {
  if (props.disabled) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length !== 1 || e.key === " ") return;
  e.preventDefault();
  e.stopPropagation();
  popoverOpen.value = true;
  if (inputEnabled.value) searchTerm.value = searchTerm.value + e.key;
}

// ── Virtual scroll (listbox mode) ─────────────────────────────────────────
// Items are virtualised whenever the listbox has more than 50 entries, keeping
// DOM nodes minimal even for 20 000+ option datasets.
const listboxScrollEl = ref<HTMLElement | null>(null);

// ── Keyboard navigation ────────────────────────────────────────────────────
// Because items are virtualised (absolutely positioned inside a spacer div
// rather than real DOM children of ListboxRoot), Reka's built-in roving-focus
// never reaches them. We manage highlight state ourselves with an index.
//
// Strategy:
//   - highlightedIndex tracks which filteredOptions entry is highlighted.
//   - Up / Down move the index through selectable (non-header, non-disabled)
//     items with wrap-around.
//   - Enter commits the selection; Escape closes the dropdown.
//   - The highlight class is applied reactively — no DOM focus juggling.
//   - The search <input> retains browser focus the whole time the dropdown is
//     open, so typing always goes straight to the filter.
const highlightedIndex = ref(-1);

// Indices into filteredOptions that are actual selectable items (no headers/disabled).
const navigableIndices = computed(() =>
  filteredOptions.value
    .map((opt, i) => ({ opt, i }))
    .filter(({ opt }) => !opt.header && !opt.disabled)
    .map(({ i }) => i),
);

// Reset highlight whenever the dropdown opens or the filtered list changes.
watch(popoverOpen, (open) => {
  if (open) highlightedIndex.value = -1;
});
watch(filteredOptions, () => {
  highlightedIndex.value = -1;
});

function scrollHighlightedIntoView() {
  if (highlightedIndex.value < 0 || !listboxScrollEl.value) return;
  const rows =
    listboxScrollEl.value.querySelectorAll<HTMLElement>("[data-vrow]");
  for (const row of rows) {
    if (Number(row.dataset.vrow) === highlightedIndex.value) {
      row.scrollIntoView({ block: "nearest" });
      break;
    }
  }
}

function handleDropdownKeydown(e: KeyboardEvent) {
  const nav = navigableIndices.value;

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    popoverOpen.value = false;
    return;
  }

  // Allow Enter to trigger create even when no options are visible.
  // Otherwise creatable=true with an empty filtered list silently swallows
  // the keystroke, breaking the "type a new name and press Enter" UX.
  if (nav.length === 0) {
    if (e.key === "Enter" && props.creatable) {
      e.preventDefault();
      handleCreateFromInput();
    }
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    const cur = nav.indexOf(highlightedIndex.value);
    highlightedIndex.value = cur < nav.length - 1 ? nav[cur + 1] : nav[0];
    nextTick(scrollHighlightedIntoView);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const cur = nav.indexOf(highlightedIndex.value);
    highlightedIndex.value = cur > 0 ? nav[cur - 1] : nav[nav.length - 1];
    nextTick(scrollHighlightedIntoView);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (highlightedIndex.value >= 0) {
      const opt = filteredOptions.value[highlightedIndex.value];
      if (opt) handleListboxUpdate(toRekaString(opt.value));
    } else {
      handleCreateFromInput();
    }
  }
}

const virtualizer = useVirtualizer(
  computed(() => ({
    count: filteredOptions.value.length,
    getScrollElement: () => listboxScrollEl.value,
    estimateSize: (index: number) => {
      const opt = filteredOptions.value[index];
      if (!opt) return 28;
      const hasSubLabel = !!opt.subLabel;
      const isInline = !!opt.subLabelInline;
      const hasPalette = !!(opt.colorPalette?.length);
      const hasBadge = !!opt.badge;
      // Inline subLabel renders on the same line — single-row height.
      if (hasSubLabel && isInline) return 28;
      // py-2(16) + label(20) + gap(4) + 2-line subLabel(34) + gap(4) + gradient(6) = 84px
      if (hasPalette && hasSubLabel) return 84;
      // py-2(16) + label(20) + gap(4) + gradient(6) = 46px  — no subLabel
      if (hasPalette) return 46;
      // badge+subLabel: py-2(16) + label+badge(20) + gap(4) + 1-line subLabel(16) = 56px
      if (hasBadge && hasSubLabel) return 56;
      // py-2(16) + label(20) + gap(4) + 1-line subLabel(16) = 56px
      if (hasSubLabel) return 56;
      // badge is inline with label — same single-row height
      if (hasBadge) return 28;
      return 28;
    },
    overscan: 8,
  })),
);

/** Build a CSS linear-gradient string from an array of color stops. */
function getPaletteGradient(colors: string[]): string {
  return `linear-gradient(to right, ${colors.join(", ")})`;
}

// Aligned with OInput and OButton sm: h-[2.125rem] ≈ 30px at the 14px html base.
const heightClasses: Record<NonNullable<SelectProps["size"]>, string> = {
  sm: "h-6 text-sm",
  md: "h-[2.125rem] text-sm",
};

// Open-state tracking. Reka's PopoverTrigger / SelectTrigger expose
// `data-state="open"`, but Vue can't reach across components with a
// CSS group selector without extra wiring — track a ref instead and
// bind the chevron's rotation class to it.
const selectOpen = ref(false);

const isOpen = computed(() =>
  listboxModeEnabled.value ? popoverOpen.value : selectOpen.value,
);

// Clicking the field label opens the dropdown — mirroring how clicking an
// OInput's label focuses its input. Reka's triggers open on `pointerdown`, so
// the `click` a native <label for> forwards never opens them; open explicitly.
// `.prevent` (on the template handler) stops the redundant native forwarding.
function handleLabelClick() {
  if (props.disabled) return;
  if (listboxModeEnabled.value) {
    popoverOpen.value = true;
  } else {
    selectOpen.value = true;
  }
}


// When this OSelect is nested inside an ODropdown, signal its
// open/close so the parent ignores the pointer event that closes us.
const parentDropdownRegistry = inject<{ open: () => () => void } | null>(
  O_DROPDOWN_NESTED_KEY,
  null,
);
let closeNestedRegistration: (() => void) | null = null;

watch(isOpen, (open) => {
  if (!parentDropdownRegistry) return;
  if (open && !closeNestedRegistration) {
    closeNestedRegistration = parentDropdownRegistry.open();
  } else if (!open && closeNestedRegistration) {
    closeNestedRegistration();
    closeNestedRegistration = null;
  }
});
onBeforeUnmount(() => {
  if (closeNestedRegistration) {
    closeNestedRegistration();
    closeNestedRegistration = null;
  }
});

// Single-active-overlay coordination. Opening any other top-level O overlay
// closes this one (and vice-versa), so two unrelated dropdowns are never open
// at once — even when the new one is opened by focus rather than a click that
// Reka would treat as a dismiss. Nested selects (inside an open ODropdown) opt
// out so they don't close their ancestor.
const closeSelf = () => {
  popoverOpen.value = false;
  selectOpen.value = false;
};
if (!parentDropdownRegistry) {
  watch(isOpen, (open) => {
    if (open) setActiveOverlay(closeSelf);
    else clearActiveOverlay(closeSelf);
  });
  onBeforeUnmount(() => clearActiveOverlay(closeSelf));
}

// Close when the sidebar scroll container scrolls, preventing the portal
// from floating disconnected at the top of the screen.
const sidebarScrollTick = inject<Ref<number> | null>('sidebarScrollTick', null);
if (sidebarScrollTick) {
  watch(sidebarScrollTick, () => {
    if (popoverOpen.value) popoverOpen.value = false;
    if (selectOpen.value) selectOpen.value = false;
  });
}

// Generic close-on-scroll: while the dropdown is open, scrolling any ancestor
// scroll container (page, query-builder area, joins popup, etc.) would leave
// the portaled list floating detached from the trigger — close it instead.
// Scrolls that originate inside the option list are ignored so the list stays
// scrollable.
function handleViewportScroll(event: Event) {
  if (!isOpen.value) return;
  const target = event.target as (Element & Node) | Document | null;
  if (!target) return;
  // Ignore scrolls that originate inside the option list so it stays scrollable.
  if (
    target instanceof Element &&
    (listboxScrollEl.value?.contains(target) ||
      target.closest?.('[role="listbox"]'))
  ) {
    return;
  }
  // Only close when the scrolled container actually holds this select's
  // trigger — i.e. the scroll moves the trigger and would leave the portaled
  // menu detached. Scrolls in unrelated sections (e.g. the field list while a
  // config-panel dropdown is open) are ignored.
  const triggerEl = triggerWrapperRef.value ?? selectTriggerWrapperRef.value;
  if (triggerEl && target.contains(triggerEl)) {
    popoverOpen.value = false;
    selectOpen.value = false;
  }
}

watch(isOpen, (open) => {
  if (typeof window === "undefined") return;
  if (open) {
    window.addEventListener("scroll", handleViewportScroll, {
      capture: true,
      passive: true,
    });
  } else {
    window.removeEventListener("scroll", handleViewportScroll, true);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("scroll", handleViewportScroll, true);
  }
});

// ── Chip overflow (width-aware) ──────────────────────────────────────────
// In multi-select mode, fit as many chips as the trigger width allows; the
// rest collapse into a "+N more" indicator. When `maxVisibleChips` is set,
// that becomes a hard upper bound; otherwise the count is computed live
// from the trigger's measured width via ResizeObserver.

/** The outer wrapper around the trigger. Measured to size the chip row. */
const triggerWrapperRef = ref<HTMLElement | null>(null);
// Wrapper around the native-select (non-listbox) trigger, used by the
// close-on-scroll handler to detect whether a scroll moves this select's trigger.
const selectTriggerWrapperRef = ref<HTMLElement | null>(null);
const triggerWidth = ref(0);
let triggerResizeObserver: ResizeObserver | null = null;

/*
 * Why watch instead of onMounted: `triggerWrapperRef` lives inside a
 * `v-if="listboxModeEnabled"` branch. If a consumer toggles `multiple` /
 * `searchable` at runtime, the listbox wrapper mounts *after* the parent
 * component's `onMounted` already ran — so a one-shot observer setup
 * would leave `triggerWidth` stuck at 0 forever. Watching the ref lets us
 * attach the observer whenever the element comes into existence (and tear
 * it down when it goes away). `flush: 'post'` ensures the DOM node is
 * already painted so `clientWidth` is meaningful.
 */
watch(
  triggerWrapperRef,
  (el, _prev, onCleanup) => {
    triggerResizeObserver?.disconnect();
    triggerResizeObserver = null;
    if (!el) {
      triggerWidth.value = 0;
      return;
    }
    triggerWidth.value = el.clientWidth;
    triggerResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        triggerWidth.value = entry.contentRect.width;
      }
    });
    triggerResizeObserver.observe(el);
    onCleanup(() => {
      triggerResizeObserver?.disconnect();
      triggerResizeObserver = null;
    });
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  triggerResizeObserver?.disconnect();
  triggerResizeObserver = null;
});

/**
 * Estimate a chip's rendered width in pixels from its label.
 * Chip styling: `px-2 py-0.5 text-xs` (12px font), max-w-40 = 160px.
 * Roughly 6.5px per character at 12px font + 16px horizontal padding.
 */
function estimateChipWidth(label: string): number {
  const labelW = Math.min(Math.ceil(label.length * 6.5), 144); // cap to 160-16 padding
  return labelW + 16; // px-2 each side
}

// Space reserved inside the trigger for non-chip content: left ps-3 padding +
// right padding (which contains the absolutely-positioned chevron, and the
// clear button when shown). Mirrors `triggerEndPadding` so the chip-fit
// calculation matches the actual squeeze on the content area.
const reservedTriggerSpace = computed(() => {
  let reserved = 12 + 28; // ps-3 (12px) + pe-7 (28px) — chevron-only
  if (props.clearable && hasSelection.value) reserved += 20; // pe-12 - pe-7
  return reserved;
});

const overflowChipEstimatedWidth = 70; // "+N more" pill width approximation
const chipGap = 4; // gap-1 between chips

/**
 * Number of chips that actually fit in the current trigger width. If
 * `maxVisibleChips` is set on the prop, it caps the result. Always returns
 * at least 1 so the user can see something is selected.
 */
const dynamicMaxChips = computed(() => {
  const total = selectedLabels.value.length;
  if (total === 0) return 0;

  // No measurement yet (SSR / pre-mount) — fall back to the prop or a safe
  // default so we don't render nothing.
  if (triggerWidth.value === 0) {
    return Math.min(props.maxVisibleChips ?? 3, total);
  }

  const available = Math.max(
    0,
    triggerWidth.value - reservedTriggerSpace.value,
  );
  let used = 0;
  let count = 0;

  for (let i = 0; i < total; i++) {
    const chipW = estimateChipWidth(selectedLabels.value[i]);
    const remaining = total - i - 1;
    // If there'll be hidden chips after this one, reserve space for the
    // "+N more" pill so it can still fit on the row.
    const overflowReserve =
      remaining > 0 ? overflowChipEstimatedWidth + chipGap : 0;
    const needed = chipW + (i > 0 ? chipGap : 0) + overflowReserve;
    if (used + needed > available) break;
    used += chipW + (i > 0 ? chipGap : 0);
    count++;
  }

  const fit = Math.max(1, count);
  // Honour an explicit cap when provided.
  if (props.maxVisibleChips !== undefined) {
    return Math.min(fit, props.maxVisibleChips);
  }
  return fit;
});

const visibleSelectedLabels = computed(() =>
  selectedLabels.value.slice(0, dynamicMaxChips.value),
);
const overflowSelectedCount = computed(() =>
  Math.max(0, selectedLabels.value.length - dynamicMaxChips.value),
);

// Trigger right padding. Chevron + clear icons live in an absolutely-positioned
// flex container at the trigger's right edge, so changing this padding only
// squeezes the content area — it does not shift the chevron position when the
// clear button toggles into view.
const triggerEndPadding = computed(() =>
  props.clearable && hasSelection.value ? "pe-12" : "pe-7",
);

const fieldWidthClass = computed(() => {
  switch (props.width) {
    case "xs":
      return "w-field-width-xs";
    case "sm":
      return "w-field-width-sm";
    case "md":
      return "w-field-width-md";
    case "lg":
      return "w-field-width-lg";
    default:
      return "w-full";
  }
});
</script>

<template>
  <div
    v-bind="wrapperAttrs"
    :class="[
      'flex flex-col gap-1',
      fieldWidthClass,
      labelPosition === 'inside' ? 'min-w-0' : '',
    ]"
  >
    <!-- Label -->
    <label
      v-if="(label || $slots.tooltip) && labelPosition !== 'inside'"
      :for="inputId"
      :class="[
        'o-input-label text-compact leading-tight flex items-center gap-1',
        disabled ? 'font-normal text-input-label-text-disabled' : 'font-medium text-input-label-text cursor-pointer',
      ]"
      @click.prevent="handleLabelClick"
    >
      {{ label }}<span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help"
        ><slot name="tooltip"
      /></OIcon>
    </label>

    <template v-if="listboxModeEnabled">
      <PopoverRoot
        v-model:open="popoverOpen"
        @update:open="(v) => (v ? emit('open') : emit('close'))"
      >
        <div
          ref="triggerWrapperRef"
          class="relative flex items-center"
        >
          <PopoverTrigger
            type="button"
            :id="inputId"
            :name="name"
            :disabled="disabled"
            :tabindex="inputTabindex"
            role="combobox"
            :aria-expanded="popoverOpen"
            :aria-invalid="hasError || undefined"
            @keydown="handleTriggerKeydown"
            :data-test="
              parentDataTest ? `${parentDataTest}-trigger` : undefined
            "
            :data-test-selected-value="
              multiple
                ? selectedValues.map((v) => String(v)).join(',')
                : selectedValues[0] !== undefined
                  ? String(selectedValues[0])
                  : ''
            "
            :data-test-selected-label="triggerDisplayLabel"
            :class="[
              'relative flex w-full rounded-default border',
              // In inside-label mode padding is handled per-row; in normal mode it goes on the trigger
              labelPosition === 'inside' && label ? '' : ($slots['icon-left'] ? 'ps-2' : 'ps-3'),
              'bg-select-bg',
              hasError
                ? 'border-select-border-error focus:ring-[0.125rem] focus:ring-select-border-error/30 data-[state=open]:ring-[0.125rem] data-[state=open]:ring-select-border-error/30'
                : 'border-select-border hover:border-select-border-hover focus:border-select-border-focus focus:ring-[0.125rem] focus:ring-primary-500/25 data-[state=open]:border-select-border-focus data-[state=open]:ring-[0.125rem] data-[state=open]:ring-primary-500/25',
              /* Keep the red error border on focus; focus border color applies only when there's no error. */
              'focus:outline-none',
              'transition-[color,background-color,border-color,box-shadow] duration-150',
              'disabled:bg-select-disabled-bg disabled:cursor-not-allowed disabled:border-dashed',
              labelPosition === 'inside' && label
                ? [
                    'flex-col justify-between py-0.5',
                    heightClasses[size ?? 'md'],
                  ]
                : ['items-center', triggerEndPadding, heightClasses[size ?? 'md']],
            ]"
          >
            <!-- Inside label: in-flow with whitespace-nowrap so it drives the trigger's auto-width -->
            <span
              v-if="label && labelPosition === 'inside'"
              class="text-3xs leading-none whitespace-nowrap text-start text-text-secondary select-none pointer-events-none ps-3 pe-7"
              >{{ label }}<span v-if="required" aria-hidden="true">&nbsp;*</span></span
            >

            <!-- Content row: flex-row for inside-label; display:contents (transparent) for normal mode -->
            <div
              :class="labelPosition === 'inside' && label
                ? ['flex items-center flex-1 w-full min-w-0', triggerEndPadding, $slots['icon-left'] ? 'ps-2' : 'ps-3']
                : 'contents'"
            >
              <!-- Icon-left slot (inside trigger, left — matches OButton #icon-left) -->
              <span
                v-if="$slots['icon-left']"
                class="flex items-center me-1.5 text-select-placeholder shrink-0"
              >
                <slot name="icon-left" />
              </span>

              <slot name="trigger" :value="modelValue">
                <template v-if="multiple && selectedLabels.length > 0">
                  <div
                    class="flex-1 flex flex-nowrap items-center gap-1 overflow-hidden pe-2"
                  >
                    <slot
                      v-for="(labelText, idx) in visibleSelectedLabels"
                      name="chip"
                      :label="String(labelText ?? '')"
                      :value="selectedValues[idx]"
                    >
                      <span
                        :key="`${idx}-${String(labelText ?? '')}`"
                        class="inline-flex items-center rounded-default px-2 py-0.5 text-xs leading-none bg-select-item-selected-bg text-select-item-selected-text max-w-40 truncate shrink-0"
                      >
                        {{ labelText }}
                      </span>
                    </slot>
                    <span
                      v-if="overflowSelectedCount > 0"
                      class="inline-flex items-center rounded-default px-2 py-0.5 text-xs bg-select-item-hover-bg text-select-text shrink-0"
                      data-test="o-select-overflow-chip"
                    >
                      +{{ overflowSelectedCount }} more
                    </span>
                  </div>
                </template>
                <span
                  v-else
                  :title="optionTooltip && hasSelection ? triggerDisplayLabel : undefined"
                  :class="[
                    'flex-1 text-start truncate text-sm',
                    labelPosition === 'inside' && label
                      ? 'text-xs leading-4'
                      : '',
                    disabled
                      ? 'text-select-disabled-text'
                      : hasSelection
                        ? 'text-select-text'
                        : 'text-select-placeholder',
                  ]"
                >
                  {{ hasSelection ? triggerDisplayLabel : placeholder }}
                </span>
              </slot>
            </div>
          </PopoverTrigger>

          <!--
            Trailing icons: clear (left) then chevron (right).
            Container is absolutely positioned and pointer-events:none so the
            chevron alone never blocks the trigger click. The clear button
            re-enables its own pointer events. Because the chevron's position
            is anchored to the container's right edge, toggling the clear
            button in or out does not shift the chevron.
          -->
          <div
            class="absolute end-2.5 flex items-center gap-1.5 pointer-events-none"
          >
            <button
              v-if="clearable && hasSelection"
              type="button"
              tabindex="-1"
              aria-label="Clear selection"
              :class="[
                'flex items-center justify-center size-3.5',
                'text-input-clear-btn hover:text-input-clear-btn-hover',
                'transition-colors pointer-events-auto',
              ]"
              @click.stop="handleClear"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                class="size-3.5"
                aria-hidden="true"
              >
                <path
                  d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
                />
              </svg>
            </button>

            <OSpinner v-if="loading" size="xs" />
            <span
              v-else
              aria-hidden="true"
              :class="[
                'flex items-center justify-center text-select-icon',
                'transition-transform duration-150',
                isOpen ? 'rotate-180' : '',
              ]"
            >
              <!-- chevron-down — rotates 180° when the popover is open -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                class="size-4"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                  clip-rule="evenodd"
                />
              </svg>
            </span>
          </div>
        </div>

        <PopoverPortal>
          <PopoverContent
            :side-offset="4"
            align="start"
            :trap-focus="false"
            :disable-outside-pointer-events="false"
            :hide-when-detached="true"
            :data-test="
              parentDataTest ? `${parentDataTest}-popover` : undefined
            "
            :class="[
              'z-[10001] min-w-(--reka-popover-trigger-width)',
              'overflow-hidden flex flex-col',
              'rounded-default shadow-lg',
              'bg-select-content-bg',
            ]"
            :style="[dropdownStyle, { maxHeight: 'min(18rem, var(--reka-popover-content-available-height, 18rem))' }]"
            @click.stop
          >
            <ListboxRoot
              :model-value="listboxStringModelValue"
              :multiple="multiple"
              :disabled="disabled"
              class="flex flex-col flex-1 min-h-0"
              @update:model-value="handleListboxUpdate"
            >
              <!-- Single bordered container wrapping search + list -->
              <div
                :class="[
                  'rounded-default border border-input-border overflow-hidden',
                  'bg-select-content-bg flex flex-col flex-1 min-h-0',
                ]"
              >
                <ListboxFilter
                  v-if="inputEnabled"
                  v-model="searchTerm"
                  auto-focus
                  :data-test="
                    parentDataTest ? `${parentDataTest}-search` : undefined
                  "
                  :class="[
                    'w-full px-3 bg-transparent text-input-text shrink-0',
                    'placeholder:text-input-placeholder outline-none',
                    'border-b border-input-border',
                    heightClasses[size ?? 'md'],
                  ]"
                  :placeholder="searchPlaceholder"
                  @keydown="handleDropdownKeydown"
                />

                <!--
                Select-all master row. Indeterminate (dash) when only some
                options are checked, full check when all are. Toggles the
                whole selection. Rendered as a plain button so it sits
                outside the listbox's keyboard navigation while remaining
                focusable.
              -->
                <div
                  v-if="selectAll && multiple && selectableOptions.length > 0"
                  role="button"
                  tabindex="0"
                  aria-label="Toggle all options"
                  :aria-checked="
                    allSelected ? 'true' : partiallySelected ? 'mixed' : 'false'
                  "
                  :class="[
                    'relative flex items-center w-full gap-2 shrink-0',
                    'ps-3 pe-3 py-1.5 text-sm',
                    'text-select-item-text rounded-default',
                    'cursor-pointer select-none outline-none',
                    'hover:bg-select-item-hover-bg',
                    'focus-visible:bg-select-item-hover-bg',
                    'transition-colors duration-100',
                    'border-b border-select-content-border mb-1 pb-1.5',
                  ]"
                  data-test="o-select-all"
                  @click="toggleAllSelections"
                  @keydown.enter.prevent="toggleAllSelections"
                  @keydown.space.prevent="toggleAllSelections"
                >
                  <span
                    :class="[
                      'flex items-center justify-center shrink-0',
                      'size-3.5 rounded-default border transition-colors',
                      allSelected
                        ? 'bg-checkbox-checked-bg border-checkbox-checked-border'
                        : 'bg-checkbox-bg border-checkbox-border',
                    ]"
                    aria-hidden="true"
                  >
                    <svg
                      v-if="allSelected"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="size-full p-0.5 text-checkbox-checked-fg"
                    >
                      <polyline points="2,6 5,9 10,3" />
                    </svg>
                  </span>
                  <span class="truncate font-medium">Select all</span>
                </div>

                <!-- Consumer-supplied rows rendered above the option list -->
                <slot name="before-options" />

                <!-- Virtual scroll container — keyboard nav handled by handleDropdownKeydown
                   on the ListboxFilter input above. Items are index-highlighted reactively. -->
                <div ref="listboxScrollEl" :class="['overflow-auto', multiple && rowClickSingleSelect ? 'flex-1 min-h-24' : 'max-h-60']">
                  <div
                    v-if="filteredOptions.length === 0"
                    class="px-3 py-2 text-sm text-select-placeholder"
                  >
                    <slot name="empty">No options found</slot>
                  </div>

                  <!-- Virtualised list — spacer div with absolutely positioned rows -->
                  <div
                    v-if="filteredOptions.length > 0"
                    :style="{
                      height: `${virtualizer.getTotalSize()}px`,
                      position: 'relative',
                    }"
                  >
                    <div
                      v-for="vRow in virtualizer.getVirtualItems()"
                      :key="`${vRow.key}-${toRekaString(filteredOptions[vRow.index].value)}`"
                      :data-vrow="vRow.index"
                      :style="{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${vRow.size}px`,
                        transform: `translateY(${vRow.start}px)`,
                      }"
                    >
                      <!-- Group header — non-interactive label. Virtualisation
                         renders each flex as a sibling, so a real ListboxGroup
                         can't wrap its items. Render a plain styled header
                         instead of misusing ListboxGroup/Label ARIA roles. -->
                      <div
                        v-if="filteredOptions[vRow.index].header"
                        :class="[
                          'flex w-full h-full px-3 py-1 text-xs font-bold select-none text-select-item-text',
                          collapsibleGroups
                            ? 'items-center gap-1 cursor-pointer bg-surface-subtle'
                            : 'pointer-events-none bg-select-content-bg',
                        ]"
                        @click.stop="
                          collapsibleGroups &&
                            toggleGroup(filteredOptions[vRow.index].label)
                        "
                      >
                        <OIcon
                          v-if="collapsibleGroups"
                          name="keyboard-arrow-up"
                          size="sm"
                          :class="[
                            'shrink-0 transition-transform duration-150',
                            !isGroupCollapsed(filteredOptions[vRow.index].label)
                              ? 'rotate-180'
                              : '',
                          ]"
                        />
                        {{ filteredOptions[vRow.index].label }}
                      </div>

                      <!-- Regular item -->
                      <!-- rowClickSingleSelect wrapper: intercepts clicks at capture phase.
                           Checkbox clicks (marked by @pointerdown on the checkbox span)
                           fall through to Reka for normal toggle. Row/label clicks replace
                           the whole selection with just this item and close the dropdown. -->
                      <div
                        v-else
                        class="contents"
                        @click.capture="handleItemClickCapture($event, toRekaString(filteredOptions[vRow.index].value))"
                      >
                      <ListboxItem
                        :value="toRekaString(filteredOptions[vRow.index].value)"
                        :disabled="filteredOptions[vRow.index].disabled"
                        :data-test="
                          parentDataTest
                            ? `${parentDataTest}-option`
                            : undefined
                        "
                        :data-test-value="
                          toRekaString(filteredOptions[vRow.index].value)
                        "
                        :data-test-label="
                          String(filteredOptions[vRow.index].label ?? '')
                        "
                        :class="[
                          'relative flex w-full h-full gap-2',
                          'ps-3 pe-3 text-sm',
                          'text-select-item-text rounded-default',
                          'cursor-pointer select-none outline-none',
                          'transition-colors duration-100',
                          // Use flex-col for stacked rich items; flex-row for inline subLabel or simple items
                          (filteredOptions[vRow.index].subLabel && !filteredOptions[vRow.index].subLabelInline) || filteredOptions[vRow.index].colorPalette?.length
                            ? 'flex-col items-start py-2'
                            : 'flex-row items-center',
                          // highlightedIndex-based highlight — works with virtualised items.
                          // Reka's data-highlighted only fires for direct DOM children of
                          // ListboxRoot; virtual rows are not, so we track highlight ourselves.
                          vRow.index === highlightedIndex
                            ? 'bg-select-item-hover-bg'
                            : 'hover:bg-select-item-hover-bg',
                          multiple
                            ? ''
                            : 'data-[state=checked]:bg-select-item-selected-bg data-[state=checked]:text-select-item-selected-text',
                          'data-disabled:text-select-item-disabled data-disabled:cursor-not-allowed data-disabled:pointer-events-none',
                        ]"
                      >
                        <!-- Multi-select: always-visible checkbox indicator -->
                        <template v-if="multiple">
                          <span
                            :class="[
                              'flex items-center justify-center shrink-0',
                              'size-3.5 rounded-default border transition-colors',
                              selectedValues.includes(
                                filteredOptions[vRow.index].value,
                              )
                                ? 'bg-checkbox-checked-bg border-checkbox-checked-border'
                                : 'bg-checkbox-bg border-checkbox-border',
                            ]"
                            aria-hidden="true"
                            data-select-checkbox
                          >

                            <svg
                              v-if="
                                selectedValues.includes(
                                  filteredOptions[vRow.index].value,
                                )
                              "
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 12 12"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              class="size-full p-0.5 text-checkbox-checked-fg"
                            >
                              <polyline points="2,6 5,9 10,3" />
                            </svg>
                          </span>
                          <!-- Separator between checkbox zone and label zone (rowClickSingleSelect only) -->
                          <span
                            v-if="rowClickSingleSelect"
                            class="w-px shrink-0 bg-card-glass-border mx-1 my-1 self-stretch"
                            aria-hidden="true"
                            data-select-separator
                          />
                        </template>

                        <!-- Inline subLabel: name – url on a single row -->
                        <template
                          v-if="filteredOptions[vRow.index].subLabel && filteredOptions[vRow.index].subLabelInline"
                        >
                          <span class="font-medium shrink-0">{{ filteredOptions[vRow.index].label }}</span>
                          <span class="text-select-placeholder shrink-0 mx-1">–</span>
                          <span class="text-text-secondary truncate text-xs">{{ filteredOptions[vRow.index].subLabel }}</span>
                        </template>

                        <!-- Rich item: label + optional badge + optional subLabel + optional color palette swatch.
                             Wrapped in a single div so ListboxItem's gap-2 does not
                             add unexpected space between each child and overflow the fixed height. -->
                        <template
                          v-else-if="filteredOptions[vRow.index].subLabel || filteredOptions[vRow.index].colorPalette?.length || filteredOptions[vRow.index].badge"
                        >
                          <div class="flex flex-col gap-1 w-full overflow-hidden">
                            <span class="flex items-center gap-1.5 w-full leading-snug">
                              <span class="truncate font-medium" :title="optionTooltip ? filteredOptions[vRow.index].label : undefined">{{ filteredOptions[vRow.index].label }}</span>
                              <span
                                v-if="filteredOptions[vRow.index].badge"
                                class="shrink-0 rounded-default border border-solid"
                                :class="[
                                  filteredOptions[vRow.index].badgeTitle ? 'cursor-help' : undefined,
                                  filteredOptions[vRow.index].badgeStyle
                                    ? 'inline-flex items-center justify-center leading-none ml-auto min-w-[1.125rem] h-[1.125rem] px-1 text-xs font-semibold border-current'
                                    : 'text-3xs font-medium px-1 py-px leading-tight',
                                ]"
                                :title="filteredOptions[vRow.index].badgeTitle"
                                :style="
                                  filteredOptions[vRow.index].badgeStyle ?? {
                                    color: 'var(--color-status-positive)',
                                    borderColor: 'var(--color-status-positive)',
                                  }
                                "
                              >{{ filteredOptions[vRow.index].badge }}</span>
                            </span>
                            <span
                              v-if="filteredOptions[vRow.index].subLabel"
                              class="text-xs text-text-secondary line-clamp-2 whitespace-normal w-full leading-snug"
                            >{{ filteredOptions[vRow.index].subLabel }}</span>
                            <div
                              v-if="filteredOptions[vRow.index].colorPalette?.length"
                              class="h-1.5 w-full rounded-default"
                              :style="{
                                background: getPaletteGradient(
                                  filteredOptions[vRow.index].colorPalette!,
                                ),
                              }"
                            />
                          </div>
                        </template>

                        <!-- Simple item: optional icon + label -->
                        <template v-else>
                          <!-- Per-option icon: prefer a raw Vue component (iconComponent),
                             fall back to a string name (icon) resolved via OIcon registry.
                             When iconKey is set but this option has no icon, reserve the
                             same space with a blank spacer so labels stay aligned. -->
                          <component
                            v-if="filteredOptions[vRow.index].iconComponent"
                            :is="filteredOptions[vRow.index].iconComponent"
                            class="shrink-0 size-4"
                          />
                          <OIcon
                            v-else-if="filteredOptions[vRow.index].icon"
                            :name="filteredOptions[vRow.index].icon"
                            size="sm"
                            class="shrink-0"
                          />
                          <span
                            v-else-if="iconKey"
                            class="shrink-0 size-4"
                          />
                          <span class="truncate" :title="optionTooltip ? filteredOptions[vRow.index].label : undefined">{{
                            filteredOptions[vRow.index].label
                          }}</span>
                        </template>
                      </ListboxItem>
                      </div>
                    </div>
                  </div>
                </div>

                <slot name="after-options" />
              <!-- rowClickSingleSelect hint bar — inside bordered container so the border wraps it -->
              <template v-if="multiple && rowClickSingleSelect">
              <div class="mx-2 mt-1 h-px bg-input-border shrink-0" aria-hidden="true" />
              <div
                class="flex items-center gap-2 px-3 py-2 select-none pointer-events-none shrink-0"
              >
                <!-- Checkbox zone hint -->
                <span class="flex items-center gap-1.5 text-2xs text-select-placeholder shrink-0">
                  <span
                    class="inline-flex items-center justify-center size-3.5 rounded-default border border-select-placeholder shrink-0"
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-2.5 p-px">
                      <polyline points="1.5,5 4,8 8.5,2" />
                    </svg>
                  </span>
                  <span>Multi select</span>
                </span>

                <span class="w-px h-3.5 bg-input-border shrink-0" aria-hidden="true" />

                <!-- Name zone hint -->
                <span class="flex items-center gap-1.5 text-2xs text-select-placeholder shrink-0">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="size-3 shrink-0" aria-hidden="true">
                    <path d="M4 2h6M4 5h6M4 8h3" />
                  </svg>
                  <span>Single select</span>
                </span>
              </div>
              </template>
              </div>
              <!-- end bordered container -->
            </ListboxRoot>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </template>

    <SelectRoot
      v-else
      :model-value="stringValue"
      :open="selectOpen"
      :disabled="disabled"
      :name="name"
      @update:model-value="handleUpdate"
      @update:open="
        (v) => {
          selectOpen = v;
          if (v) emit('open');
          else emit('close');
        }
      "
    >
      <div
        ref="selectTriggerWrapperRef"
        class="relative flex items-center"
      >
        <SelectTrigger
          :id="inputId"
          :tabindex="inputTabindex"
          :data-test="
            parentDataTest ? `${parentDataTest}-trigger` : undefined
          "
          :class="[
            'relative flex w-full rounded-default border',
            // In inside-label mode padding is handled per-row
            labelPosition === 'inside' && label ? '' : 'ps-3',
            'bg-select-bg',
            hasError
              ? 'border-select-border-error focus:ring-[0.125rem] focus:ring-select-border-error/30 data-[state=open]:ring-[0.125rem] data-[state=open]:ring-select-border-error/30'
              : 'border-select-border hover:border-select-border-hover focus:border-select-border-focus focus:ring-[0.125rem] focus:ring-primary-500/25 data-[state=open]:border-select-border-focus data-[state=open]:ring-[0.125rem] data-[state=open]:ring-primary-500/25',
            /* Keep the red error border on focus; focus border color applies only when there's no error. */
            'focus:outline-none',
            'transition-[color,background-color,border-color,box-shadow] duration-150',
            'data-disabled:bg-select-disabled-bg data-disabled:cursor-not-allowed data-disabled:border-dashed',
            labelPosition === 'inside' && label
              ? [
                  'flex-col justify-between py-0.5',
                  heightClasses[size ?? 'md'],
                ]
              : ['items-center', triggerEndPadding, heightClasses[size ?? 'md']],
          ]"
        >
          <!-- Inside label: in-flow with whitespace-nowrap so it drives the trigger's auto-width -->
          <span
            v-if="label && labelPosition === 'inside'"
            class="text-3xs leading-none whitespace-nowrap text-start text-text-secondary select-none pointer-events-none ps-3 pe-7"
            >{{ label }}<span v-if="required" aria-hidden="true">&nbsp;*</span></span
          >

          <!-- Content row: flex-row for inside-label; display:contents for normal mode -->
          <div
            :class="labelPosition === 'inside' && label
              ? ['flex items-center flex-1 w-full min-w-0', triggerEndPadding, 'ps-3']
              : 'contents'"
          >
            <SelectValue
              :placeholder="placeholder"
              :class="[
                'flex-1 text-start truncate text-sm',
                labelPosition === 'inside' && label
                  ? 'text-xs leading-4'
                  : '',
                disabled
                  ? 'text-select-disabled-text'
                  : hasSelection
                    ? 'text-select-text'
                    : 'text-select-placeholder',
              ]"
            >
              <slot name="trigger" :value="modelValue" />
            </SelectValue>
          </div>
        </SelectTrigger>

        <!-- Trailing icons: clear (left) then chevron (right). See note in
             the listbox branch above for the pointer-events strategy. -->
        <div
          class="absolute end-2.5 flex items-center gap-1.5 pointer-events-none"
        >
          <button
            v-if="clearable && hasSelection"
            type="button"
            tabindex="-1"
            aria-label="Clear selection"
            :class="[
              'flex items-center justify-center size-3.5',
              'text-input-clear-btn hover:text-input-clear-btn-hover',
              'transition-colors pointer-events-auto',
            ]"
            @click.stop="handleClear"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="size-3.5"
              aria-hidden="true"
            >
              <path
                d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
          </button>

          <OSpinner v-if="loading" size="xs" />
          <span
            v-else
            aria-hidden="true"
            :class="[
              'flex items-center justify-center text-select-icon',
              'transition-transform duration-150',
              isOpen ? 'rotate-180' : '',
            ]"
          >
            <!-- chevron-down — rotates 180° when the dropdown is open -->
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="size-4"
            >
              <path
                fill-rule="evenodd"
                d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </span>
        </div>
      </div>

      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="4"
          :hide-when-detached="true"
          :data-test="parentDataTest ? `${parentDataTest}-popover` : undefined"
          :class="[
            'z-[10001] min-w-(--reka-select-trigger-width)',
            'overflow-hidden',
            'rounded-default border shadow-md',
            'bg-select-content-bg border-select-content-border',
            // Clip-path reveal: unveiled at full size from its trigger edge (no
            // scale/squish). Wipes down by default; top-placed wipes up. Soft
            // ease-out-expo in (200ms), quick wipe out (140ms).
            'data-[state=open]:animate-[o2-reveal-down-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
            'data-[state=closed]:animate-[o2-reveal-down-out_100ms_cubic-bezier(0.4,0,1,1)]',
            'data-[side=top]:data-[state=open]:animate-[o2-reveal-up-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
            'data-[side=top]:data-[state=closed]:animate-[o2-reveal-up-out_100ms_cubic-bezier(0.4,0,1,1)]',
          ]"
          :style="[dropdownStyle, { maxHeight: 'min(15rem, var(--reka-select-content-available-height, 15rem))' }]"
          @click.stop
          @pointerdown.stop
        >
          <SelectScrollUpButton
            class="flex items-center justify-center h-6 text-select-icon"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="size-4"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3-3a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </SelectScrollUpButton>

          <SelectViewport class="p-1">
            <template v-if="normalizedOptions.length && !slots.default">
              <OSelectItem
                v-for="opt in normalizedOptions"
                :key="String(opt.value)"
                :value="opt.value"
                :label="opt.label"
                :disabled="opt.disabled"
              />
            </template>

            <slot />
          </SelectViewport>

          <SelectScrollDownButton
            class="flex items-center justify-center h-6 text-select-icon"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="size-4"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </SelectScrollDownButton>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>

    <!-- Error message -->
    <span
      v-if="effectiveError && effectiveError.trim()"
      :data-test="parentDataTest ? `${parentDataTest}-error` : undefined"
      class="text-xs text-select-error-text leading-none"
      role="alert"
    >
      {{ effectiveError }}
    </span>
    <!-- Help text -->
    <span
      v-else-if="helpText"
      class="text-xs text-input-help-text leading-none"
    >
      {{ helpText }}
    </span>
  </div>
</template>
