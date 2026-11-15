<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { FieldWidth } from "../Input/OInput.types";
import type {
  SelectProps,
  SelectSize,
  SelectEmits,
  SelectSlots,
  SelectValue as SelectPrimitiveValue,
  SelectModelValue,
  SelectOption,
} from "./OSelect.types";
import {
  SELECT_VALUE_MAP_KEY,
  SELECT_PARENT_DATA_TEST_KEY,
  NULL_VALUE_SENTINEL,
} from "./OSelect.types";
import OSelectItem from "./OSelectItem.vue";
import OSelectHeaderRow from "./OSelectHeaderRow.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
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
  onMounted,
  provide,
  ref,
  useAttrs,
  useId,
  useSlots,
  watch,
  watchEffect,
} from "vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useLockedDisabled } from "@/composables/useFeatureLock";
import { mergeDescribedBy, splitControlAttrs, warnIfUnlabelled } from "@/lib/forms/controlAttrs";
import {
  O_DROPDOWN_NESTED_KEY,
  setActiveOverlay,
  clearActiveOverlay,
} from "@/lib/overlay/Dropdown/ODropdown.context";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const { t } = useI18nTyped();

type NormalizedOption = {
  label: I18nText;
  value: SelectPrimitiveValue;
  disabled: boolean;
  header: boolean;
  icon?: IconName;
  /** Pre-rendered Vue component (e.g. an inlined SVG) shown beside the option label.
   *  Used when the icon isn't a string name in the OIcon registry. */
  iconComponent?: any;
  /** Secondary description text shown below the label in the dropdown item. */
  subLabel?: I18nText;
  /** When true, renders subLabel on the same line as the label (name – url style). */
  subLabelInline?: boolean;
  /** Array of CSS color strings used to render a gradient swatch below the label. */
  colorPalette?: string[];
  /** Optional badge/chip text rendered inline next to the label (e.g. "recommended"). */
  badge?: string;
  /** Tooltip for the badge. Use when the badge is abbreviated (e.g. `C` → "Counter"). */
  badgeTitle?: string;
  /** Tints the badge neutral instead of positive, e.g. a badge naming why a disabled row is disabled. */
  badgeMuted?: boolean;
  /**
   * Per-option badge colours, e.g. `{ color, background }`. A styled badge renders
   * as a filled pill in that option's own colour, right-aligned into a single
   * column; a bare (unstyled) badge stays inline next to the label.
   */
  badgeStyle?: Record<string, string>;
  /** Non-selectable row that shows or hides the options nested under it. */
  expandable?: boolean;
  /** Reka string key of the expandable option this one is nested under. */
  parentKey?: string;
  /** Extra lowercase text the search matches besides the label, e.g. a zone's legacy names. */
  searchText?: string;
  listLabel?: I18nText;
  suffix?: I18nText;
  count?: number;
  headerCount?: I18nText;
  headerAction?: I18nText;
  headerActionAriaLabel?: I18nText;
  keepOnSearch?: boolean;
  /** The option as passed in: handed back by `header-action`, and to the `#option` slot. */
  source?: SelectOption;
};

const { lgUp } = useBreakpoint();

const props = withDefaults(defineProps<SelectProps>(), {
  // A boolean option value makes Vue cast an absent model to false, which reads as a pick.
  modelValue: undefined,
  size: "md",
  variant: "field",
  summary: "value",
  disabled: false,
  // Undefined so a filter defaults to clearable (S6) while a field defaults to not.
  clearable: undefined,
  // Undefined so Vue's boolean casting never turns an absent reset value into false.
  resetValue: undefined,
  error: false,
  multiple: false,
  maxChips: 2,
  searchable: "auto",
  searchDebounce: 0,
  hideSelected: false,
  collapsibleGroups: false,
  pinSelectedInGroups: false,
  rowClickSingleSelect: false,
  creatable: false,
  labelKey: DEFAULT_OPTION_LABEL,
  valueKey: DEFAULT_OPTION_VALUE,
  iconKey: undefined,
  width: undefined,
});

// Forward the consumer's `data-test` from <OSelect data-test="…"> onto the
// root wrapper so E2E selectors can scope to the specific field instance.
// (Same pattern as ODialog / OInput.)
defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);
const isDisabled = useLockedDisabled(() => props.disabled);

// Without a label the icon is aria-hidden and unreachable by assistive tech; the tooltip's own content never gets a name otherwise.
const tooltipIconLabel = computed(() =>
  props.label
    ? t("components.select.moreInfoAbout", { field: props.label })
    : t("components.select.moreInfo"),
);

// Forward tabindex to the real trigger; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const split = computed(() => splitControlAttrs($attrs));
const wrapperAttrs = computed(() => split.value.wrapperAttrs);
const controlAttrs = computed(() => split.value.controlAttrs);

const isFilter = computed(() => props.variant === "filter");
// Only a labelled filter has an "Any" to reset to; an unlabelled one always holds a pick.
const isClearable = computed(() => props.clearable ?? (isFilter.value && !!props.label));
const insideLabelName = computed(() => (isFilter.value && props.label ? props.label : undefined));
onMounted(() =>
  warnIfUnlabelled(
    "OSelect",
    Boolean(props.label || $attrs["aria-label"] || $attrs["aria-labelledby"]),
  ),
);

const emit = defineEmits<SelectEmits>();
const slots = useSlots();

defineSlots<SelectSlots>();

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const errorId = computed(() => `${inputId.value}-error`);
const labelId = computed(() => `${inputId.value}-label`);
// The popover trigger keeps Reka's own id, so `<label for>` cannot reach it.
const outsideLabelId = computed(() =>
  props.label && !isFilter.value && !$attrs["aria-label"] && !$attrs["aria-labelledby"]
    ? labelId.value
    : undefined,
);

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

const isPrimitiveSelectValue = (value: unknown): value is SelectPrimitiveValue =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

/** Map null ↔ sentinel so Reka UI receives a valid string */
function toRekaString(v: SelectPrimitiveValue): string {
  if (v === null) return NULL_VALUE_SENTINEL;
  return String(v);
}

function normalizeOption(input: unknown): NormalizedOption | null {
  if (isPrimitiveSelectValue(input)) {
    return {
      label: raw(String(input)),
      value: input,
      disabled: false,
      header: false,
    };
  }

  if (!input || typeof input !== "object") return null;

  const option = input as Record<string, unknown>;
  const rawLabel = option[props.labelKey];

  // Group header: items with header:true or isTab:true are non-selectable labels
  const isHeader = Boolean(option["header"]) || Boolean(option["isTab"]);
  if (isHeader) {
    const header = option as SelectOption;
    return {
      label: raw(rawLabel === undefined || rawLabel === null ? "" : String(rawLabel)),
      value: `__header__${String(rawLabel)}`,
      disabled: true,
      header: true,
      headerCount: header.headerCount,
      headerAction: header.headerAction,
      headerActionAriaLabel: header.headerActionAriaLabel,
      keepOnSearch: header.keepOnSearch === true,
      source: header,
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
    label: raw(rawLabel === undefined || rawLabel === null ? String(rawValue) : String(rawLabel)),
    value: rawValue,
    disabled: Boolean(option[DEFAULT_OPTION_DISABLED]),
    header: false,
    icon: typeof rawIcon === "string" && rawIcon ? (rawIcon as IconName) : undefined,
    iconComponent: rawIconComponent ?? undefined,
    subLabel: typeof rawSubLabel === "string" ? raw(rawSubLabel) : undefined,
    subLabelInline: rawSubLabelInline === true,
    colorPalette: Array.isArray(rawColorPalette) ? (rawColorPalette as string[]) : undefined,
    badge: typeof option["badge"] === "string" ? (option["badge"] as string) : undefined,
    badgeTitle:
      typeof option["badgeTitle"] === "string" ? (option["badgeTitle"] as string) : undefined,
    badgeStyle:
      option["badgeStyle"] && typeof option["badgeStyle"] === "object"
        ? (option["badgeStyle"] as Record<string, string>)
        : undefined,
    badgeMuted: option["badgeMuted"] === true,
    expandable: option["expandable"] === true,
    parentKey: isPrimitiveSelectValue(option["parentValue"])
      ? toRekaString(option["parentValue"])
      : undefined,
    searchText:
      typeof option["searchText"] === "string" ? option["searchText"].toLowerCase() : undefined,
    source: option as SelectOption,
    listLabel: option.listLabel ? raw(String(option.listLabel)) : undefined,
    suffix: option.suffix ? raw(String(option.suffix)) : undefined,
    count: typeof option.count === "number" ? option.count : undefined,
  };
}

const normalizedOptions = computed<NormalizedOption[]>(() => {
  if (!props.options?.length) return [];
  return props.options
    .map((option) => normalizeOption(option))
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

// Past eight options a list is searched, not scanned (S5); a creatable select always needs the box.
const AUTO_SEARCH_THRESHOLD = 8;
const inputEnabled = computed(() => {
  if (props.creatable || props.searchable === true) return true;
  if (props.searchable !== "auto") return false;
  return normalizedOptions.value.filter((o) => !o.header).length > AUTO_SEARCH_THRESHOLD;
});

// Not a `withDefaults` default: that is evaluated once at module scope, which
// would freeze the placeholder in whatever locale was active at first load.
const resolvedSearchPlaceholder = computed(
  () => props.searchPlaceholder ?? t("common.searchEllipsis"),
);

const matchesTerm = (opt: NormalizedOption, term: string) =>
  opt.label.toLowerCase().includes(term) || !!opt.searchText?.includes(term);

const baseFilteredOptions = computed(() => {
  if (!inputEnabled.value) return normalizedOptions.value;
  const term = searchTerm.value.trim().toLowerCase();
  let options = normalizedOptions.value;

  if (props.hideSelected && props.multiple && selectedValues.value.length > 0) {
    options = options.filter((opt) => opt.header || !selectedValues.value.includes(opt.value));
    // Drop headers that no longer have any following non-header items
    options = options.filter((opt, i) => {
      if (!opt.header) return true;
      const next = options[i + 1];
      return next !== undefined && !next.header;
    });
  }

  if (!term) {
    // Picks float within their own group (a flat list is one group), so no row leaves its header.
    const grouped = options.some((o) => o.header);
    if (
      props.multiple &&
      pinnedSelected.value.size > 0 &&
      (!grouped || props.pinSelectedInGroups)
    ) {
      const pinned = pinnedSelected.value;
      let group = 0;
      return options
        .map((o) => ({
          o,
          group: o.header ? ++group : group,
          rank: o.header ? 0 : pinned.has(toRekaString(o.value)) ? 1 : 2,
        }))
        .sort((a, b) => a.group - b.group || a.rank - b.rank)
        .map(({ o }) => o);
    }
    return options;
  }

  // Keep headers visible if any of their following non-header items match
  const result: NormalizedOption[] = [];
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (opt.header && opt.keepOnSearch) {
      result.push(opt);
    } else if (opt.header) {
      // Include the header only if at least one subsequent non-header item matches
      let j = i + 1;
      while (j < options.length && !options[j].header) {
        if (matchesTerm(options[j], term)) {
          result.push(opt);
          break;
        }
        j++;
      }
    } else {
      if (matchesTerm(opt, term)) {
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

// ── Expandable options (`expandable` / `parentValue` on an option) ─────────
const hasNestedOptions = computed(() =>
  normalizedOptions.value.some((o) => o.parentKey !== undefined),
);
// Toggles made while open; null until the first one, so each open starts from the selection.
const toggledParents = ref<Set<string> | null>(null);
const expandedParents = computed(() => {
  if (toggledParents.value) return toggledParents.value;
  const selected = new Set(selectedValues.value.map((v) => toRekaString(v)));
  const parents = new Set<string>();
  for (const opt of normalizedOptions.value) {
    if (opt.parentKey !== undefined && selected.has(toRekaString(opt.value))) {
      parents.add(opt.parentKey);
    }
  }
  return parents;
});
const isSearching = computed(() => searchTerm.value.trim() !== "");
const isExpanded = (value: SelectPrimitiveValue) => expandedParents.value.has(toRekaString(value));
const isNestedRow = (opt: NormalizedOption) => opt.parentKey !== undefined && !isSearching.value;
const toggleExpanded = (value: SelectPrimitiveValue) => {
  const next = new Set(expandedParents.value);
  const key = toRekaString(value);
  next.has(key) ? next.delete(key) : next.add(key);
  toggledParents.value = next;
};
watch(popoverOpen, (open) => {
  if (!open) toggledParents.value = null;
});

// Hides the options of collapsed rows; a search lists every match flat, without the rows.
const nestedFilteredOptions = computed(() => {
  const base = baseFilteredOptions.value;
  if (!hasNestedOptions.value) return base;
  if (isSearching.value) {
    const flat = base.filter((o) => !o.expandable);
    // A header kept only for a matching expandable row has nothing left under it.
    return flat.filter(
      (o, i) => !o.header || o.keepOnSearch || (flat[i + 1] !== undefined && !flat[i + 1].header),
    );
  }
  return base.filter((o) => o.parentKey === undefined || expandedParents.value.has(o.parentKey));
});

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
  const base = nestedFilteredOptions.value;
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
        (props.labelKey !== DEFAULT_OPTION_LABEL || props.valueKey !== DEFAULT_OPTION_VALUE))),
);

const selectedValues = computed<SelectPrimitiveValue[]>(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue;
  if (props.modelValue === undefined || props.modelValue === "") {
    return [];
  }
  if (props.modelValue === null) {
    // null is a valid selection when a null-valued option exists (e.g. "Auto", "None", "Default")
    const hasNullOption = normalizedOptions.value.some((opt) => !opt.header && opt.value === null);
    return hasNullOption ? [null] : [];
  }
  return [props.modelValue];
});

const hasSelection = computed(() => selectedValues.value.some((v) => v !== undefined));

// A filter's "All" choice is the absence of a filter, so it never reads as narrowed (F3, S6).
const resetOption = computed<{ value: SelectPrimitiveValue; label?: I18nText } | null>(() => {
  if (!isFilter.value || props.multiple) return null;
  if (props.resetValue !== undefined) {
    const match = normalizedOptions.value.find((o) => !o.header && o.value === props.resetValue);
    return { value: props.resetValue, label: match?.label };
  }
  const first = normalizedOptions.value.find((o) => !o.header && !o.expandable);
  return first && isResetOption(first) ? { value: first.value, label: first.label } : null;
});
const isAtReset = computed(
  () => resetOption.value !== null && selectedValues.value[0] === resetOption.value.value,
);
const canClear = computed(() => isClearable.value && hasSelection.value && !isAtReset.value);

const selectedLabels = computed(() => {
  return selectedValues.value
    .map((selectedValue) => {
      const option = normalizedOptions.value.find(
        (opt) => !opt.expandable && opt.value === selectedValue,
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
  if (props.multiple) {
    // "Select all" is a sentinel elsewhere (e.g. an absent/empty field reads as
    // "every panel"); showing its own label here keeps the trigger readable
    // instead of listing every option.
    if (props.allSelectedLabel && allSelected.value) return String(props.allSelectedLabel);
    return selectedLabels.value.join(", ");
  }
  return selectedLabels.value[0] ?? "";
});

watch(searchTerm, (value) => {
  if (!inputEnabled.value) return;
  if ((props.searchDebounce ?? 0) > 0) {
    if (filterDebounceTimer.value) clearTimeout(filterDebounceTimer.value);
    filterDebounceTimer.value = setTimeout(() => {
      filterDebounceTimer.value = null;
      emit("search", value);
    }, props.searchDebounce);
    return;
  }
  emit("search", value);
});

// The consumer must rebuild a header from the term the list is filtered by, or a header it drops for that term unmounts the focused action.
function flushPendingSearch() {
  if (!filterDebounceTimer.value) return;
  clearTimeout(filterDebounceTimer.value);
  filterDebounceTimer.value = null;
  emit("search", searchTerm.value);
}

// Clear the search term whenever the popover closes so re-opening the
// dropdown always shows the full unfiltered option list.
// In multi-select mode, also snapshot the current selection so selected items
// can be floated to the top on the next open.
watch(popoverOpen, (open) => {
  if (!open) {
    searchTerm.value = "";
  } else if (props.multiple) {
    pinnedSelected.value = new Set(selectedValues.value.map((v) => toRekaString(v)));
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
const errorDescribedBy = computed(() => (effectiveError.value?.trim() ? errorId.value : undefined));

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
      return valueMap.has(key) ? (valueMap.get(key) as SelectPrimitiveValue) : key;
    });
  }

  if (Array.isArray(value)) {
    const first = value[0];
    if (first === undefined || first === null) return undefined;
    const key = String(first);
    return valueMap.has(key) ? (valueMap.get(key) as SelectPrimitiveValue) : key;
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

// Left of the row's separator is the checkbox zone, which Reka toggles; the label zone replaces the selection.
function handleItemClickCapture(event: MouseEvent, rekaValue: string) {
  if (!props.multiple || !props.rowClickSingleSelect) return;
  const row = event.currentTarget as HTMLElement | null;
  const separator = row?.querySelector("[data-select-separator]");
  if (!separator || event.clientX <= separator.getBoundingClientRect().right) return;
  event.stopPropagation();
  const value = valueMap.has(rekaValue) ? valueMap.get(rekaValue)! : rekaValue;
  emit("update:modelValue", [value]);
  popoverOpen.value = false;
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
  const clearedValue: SelectModelValue = props.multiple ? [] : resetOption.value?.value;
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
    (o: NormalizedOption) => !o.header && !o.disabled && !o.expandable,
  ),
);

const allSelected = computed(() => {
  const all = selectableOptions.value;
  if (all.length === 0) return false;
  return all.every((o: NormalizedOption) => selectedValues.value.includes(o.value));
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

  const matches = normalizedOptions.value.filter(
    (opt) => opt.label === term || String(opt.value) === term,
  );
  if (matches.length) {
    const pick = matches.find((opt) => !opt.header && !opt.disabled && !opt.expandable);
    if (!pick) return;
    // Enter on a typed exact match picks it; a multi-select only adds, never toggles it off.
    if (!props.multiple) handleListboxUpdate(toRekaString(pick.value));
    else if (!selectedValues.value.includes(pick.value))
      emit("update:modelValue", [...selectedValues.value, pick.value]);
    return;
  }

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

/** Focus the trigger and open it, so a programmatic call reads as more than a ring. */
function focus() {
  if (typeof document === "undefined") return;
  document.getElementById(inputId.value)?.focus();
  if (isDisabled.value) return;
  if (listboxModeEnabled.value) {
    popoverOpen.value = true;
  } else {
    selectOpen.value = true;
  }
}

defineExpose({ close, focus });

// Type-to-search on the closed trigger: a printable keystroke opens the
// dropdown and seeds the filter, mirroring native <select> typeahead. The
// event is consumed here so page-level single-letter shortcuts (logs "s",
// "r", "h", …) never fire while the select has keyboard focus.
function handleTriggerKeydown(e: KeyboardEvent) {
  if (isDisabled.value) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length !== 1 || e.key === " ") return;
  e.preventDefault();
  e.stopPropagation();
  popoverOpen.value = true;
  if (inputEnabled.value) searchTerm.value = searchTerm.value + e.key;
}

const searchFilterRef = ref<{ $el: HTMLInputElement } | null>(null);

// Reka's open auto-focus selects the search text, so the next keystroke would overwrite the seeded character.
function handlePopoverOpenAutoFocus(e: Event) {
  const input = searchFilterRef.value?.$el;
  if (!inputEnabled.value || !input) return;
  e.preventDefault();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
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
//   - Up / Down move it through navigable rows with wrap-around.
//   - Enter commits the selection; Escape closes the dropdown.
//   - The highlight class is applied reactively — no DOM focus juggling.
//   - The search <input> retains browser focus the whole time the dropdown is
//     open, so typing always goes straight to the filter.
const highlightedIndex = ref(-1);

// Indices into filteredOptions the arrow keys land on: selectable items, plus action headers.
const navigableIndices = computed(() =>
  filteredOptions.value
    .map((opt, i) => ({ opt, i }))
    .filter(({ opt }) => isActionHeader(opt) || (!opt.header && !opt.disabled))
    .map(({ i }) => i),
);

// Reset highlight whenever the dropdown opens or the filtered list changes.
// Single-select: land on the current value instead of the top of the list —
// a 48-row virtualised list (e.g. a time-of-day picker) otherwise always opens
// scrolled to its first entry, forcing a scroll/search just to see what's
// already chosen. Multi-select keeps its own affordance (pinned-to-top in
// `baseFilteredOptions`), so it stays untouched.
watch(popoverOpen, (open) => {
  if (!open) {
    highlightedIndex.value = -1;
    return;
  }
  if (props.multiple) {
    highlightedIndex.value = -1;
    return;
  }
  const selected = selectedValues.value[0];
  const index =
    selected === undefined
      ? -1
      : filteredOptions.value.findIndex((opt) => !opt.header && opt.value === selected);
  highlightedIndex.value = index;
  if (index < 0) return;
  nextTick(() => {
    virtualizer.value.scrollToIndex(index, { align: "center", behavior: "auto" });
    nextTick(scrollHighlightedIntoView);
  });
});
watch(filteredOptions, () => {
  highlightedIndex.value = -1;
});
// The list opens scrolled to the current value; a search keeping that offset hides its best matches above the fold.
watch(searchTerm, () => {
  if (listboxScrollEl.value) listboxScrollEl.value.scrollTop = 0;
});

function scrollHighlightedIntoView() {
  if (highlightedIndex.value < 0 || !listboxScrollEl.value) return;
  const rows = listboxScrollEl.value.querySelectorAll<HTMLElement>("[data-vrow]");
  for (const row of rows) {
    if (Number(row.dataset.vrow) === highlightedIndex.value) {
      row.scrollIntoView({ block: "nearest" });
      break;
    }
  }
}

function expandKeyTarget(key: string, opt: NormalizedOption): NormalizedOption | undefined {
  if (opt.expandable) {
    const expanded = isExpanded(opt.value);
    const toggles =
      key === "Enter" || (key === "ArrowRight" && !expanded) || (key === "ArrowLeft" && expanded);
    return toggles ? opt : undefined;
  }
  if (key !== "ArrowLeft" || opt.parentKey === undefined) return undefined;
  return filteredOptions.value.find((o) => toRekaString(o.value) === opt.parentKey);
}

// Enter toggles an expandable row, Right expands it, Left collapses it (or its row from a nested option).
function handleExpandKey(e: KeyboardEvent): boolean {
  if (isSearching.value) return false;
  const opt = filteredOptions.value[highlightedIndex.value];
  const target = opt ? expandKeyTarget(e.key, opt) : undefined;
  if (!target) return false;
  e.preventDefault();
  toggleExpanded(target.value);
  // Runs after the filteredOptions watcher has reset the highlight.
  nextTick(() => {
    highlightedIndex.value = filteredOptions.value.indexOf(target);
    nextTick(scrollHighlightedIntoView);
  });
  return true;
}

/** A header carrying a count or an action renders as OSelectHeaderRow instead of the plain label. */
function isRichHeader(opt: NormalizedOption): boolean {
  return opt.header && (opt.headerAction !== undefined || opt.headerCount !== undefined);
}

function isActionHeader(opt: NormalizedOption): boolean {
  return opt.header && Boolean(opt.headerAction);
}

// Rows outside the virtual window are not in the DOM, so scrollIntoView alone cannot reach them.
function highlightAndReveal(index: number) {
  highlightedIndex.value = index;
  virtualizer.value.scrollToIndex(index, { align: "auto" });
  nextTick(scrollHighlightedIntoView);
}

// Enter or Space on a highlighted action header runs its action; the highlight follows the header across the swap.
function handleHeaderActionKey(e: KeyboardEvent): boolean {
  if (e.key !== "Enter" && e.key !== " ") return false;
  const opt = filteredOptions.value[highlightedIndex.value];
  if (!opt || !isActionHeader(opt)) return false;
  // Reka's ListboxFilter guards: IME commits and modified keys do nothing, and must not fall through to select the header.
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || (e.key === " " && e.shiftKey))
    return true;
  e.preventDefault();
  flushPendingSearch();
  if (opt.source) emit("header-action", opt.source);
  // Runs after the filteredOptions watcher has reset the highlight.
  nextTick(() => {
    const index = filteredOptions.value.findIndex((o) => o.header && o.value === opt.value);
    if (index >= 0) highlightAndReveal(index);
  });
  return true;
}

// The consumer usually swaps this header's text in response; a keyboard user must stay on its action.
function handleHeaderAction(opt: NormalizedOption, event: MouseEvent) {
  const hadFocus =
    event.currentTarget instanceof HTMLElement && event.currentTarget === document.activeElement;
  flushPendingSearch();
  if (opt.source) emit("header-action", opt.source);
  if (!hadFocus) return;
  nextTick(() => {
    const index = filteredOptions.value.findIndex((o) => o.header && o.value === opt.value);
    const button = listboxScrollEl.value?.querySelector<HTMLElement>(
      `[data-vrow="${index}"] [data-select-header-action]`,
    );
    if (button && button !== document.activeElement) button.focus();
  });
}

function handleDropdownKeydown(e: KeyboardEvent) {
  const nav = navigableIndices.value;

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    popoverOpen.value = false;
    return;
  }
  if (handleExpandKey(e) || handleHeaderActionKey(e)) return;

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
    highlightAndReveal(cur < nav.length - 1 ? nav[cur + 1] : nav[0]);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const cur = nav.indexOf(highlightedIndex.value);
    highlightAndReveal(cur > 0 ? nav[cur - 1] : nav[nav.length - 1]);
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
      if (!opt) return ROW_HEIGHT;
      // Must equal the min-h-8 of OSelectHeaderRow or the virtual rows drift.
      if (isRichHeader(opt)) return 32;
      if (opt.header) return HEADER_HEIGHT;
      const hasSubLabel = !!opt.subLabel;
      const isInline = !!opt.subLabelInline;
      const hasPalette = !!opt.colorPalette?.length;
      const hasBadge = !!opt.badge;
      // Inline subLabel renders on the same line — single-row height.
      if (hasSubLabel && isInline) return ROW_HEIGHT;
      // py-2(16) + label(20) + gap(4) + 2-line subLabel(34) + gap(4) + gradient(6) = 84px
      if (hasPalette && hasSubLabel) return 84;
      // py-2(16) + label(20) + gap(4) + gradient(6) = 46px  — no subLabel
      if (hasPalette) return 46;
      // badge+subLabel: py-2(16) + label+badge(20) + gap(4) + 1-line subLabel(16) = 56px
      if (hasBadge && hasSubLabel) return 56;
      // py-2(16) + label(20) + gap(4) + 1-line subLabel(16) = 56px
      if (hasSubLabel) return 56;
      return ROW_HEIGHT;
    },
    overscan: 8,
  })),
);

/** Build a CSS linear-gradient string from an array of color stops. */
function getPaletteGradient(colors: string[]): string {
  return `linear-gradient(to right, ${colors.join(", ")})`;
}

const heightClasses = SIZE_CLASSES;

// Open-state tracking. Reka's PopoverTrigger / SelectTrigger expose
// `data-state="open"`, but Vue can't reach across components with a
// CSS group selector without extra wiring — track a ref instead and
// bind the chevron's rotation class to it.
const selectOpen = ref(false);

const isOpen = computed(() => (listboxModeEnabled.value ? popoverOpen.value : selectOpen.value));

// Clicking the field label opens the dropdown — mirroring how clicking an
// OInput's label focuses its input. Reka's triggers open on `pointerdown`, so
// the `click` a native <label for> forwards never opens them; open explicitly.
// `.prevent` (on the template handler) stops the redundant native forwarding.
function handleLabelClick() {
  if (isDisabled.value) return;
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
const sidebarScrollTick = inject<Ref<number> | null>("sidebarScrollTick", null);
if (sidebarScrollTick) {
  watch(sidebarScrollTick, () => {
    if (popoverOpen.value) popoverOpen.value = false;
    if (selectOpen.value) selectOpen.value = false;
  });
}

// Scroll events arrive a frame late, so a scroll from before the open is only real if the trigger moved since.
let openTriggerTop: number | null = null;
let openTriggerLeft: number | null = null;
// One layout read per frame: a sticky trigger never moves, so per-event reads would force layout throughout a long scroll.
let triggerMoveFrame: number | null = null;

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
    (listboxScrollEl.value?.contains(target) || target.closest?.('[role="listbox"]'))
  ) {
    return;
  }
  // Only close when the scrolled container actually holds this select's
  // trigger — i.e. the scroll moves the trigger and would leave the portaled
  // menu detached. Scrolls in unrelated sections (e.g. the field list while a
  // config-panel dropdown is open) are ignored.
  const triggerEl = triggerWrapperRef.value ?? selectTriggerWrapperRef.value;
  if (!triggerEl || !target.contains(triggerEl) || triggerMoveFrame !== null) return;
  triggerMoveFrame = requestAnimationFrame(closeIfTriggerMoved);
}

function closeIfTriggerMoved() {
  triggerMoveFrame = null;
  if (!isOpen.value) return;
  const rect = (triggerWrapperRef.value ?? selectTriggerWrapperRef.value)?.getBoundingClientRect();
  if (rect && rect.top === openTriggerTop && rect.left === openTriggerLeft) return;
  popoverOpen.value = false;
  selectOpen.value = false;
}

function cancelTriggerMoveCheck() {
  if (triggerMoveFrame === null) return;
  cancelAnimationFrame(triggerMoveFrame);
  triggerMoveFrame = null;
}

// Type-ahead, label clicks, focus(), Escape and picks set popoverOpen directly and Reka never reports them.
watch(popoverOpen, (open, wasOpen) => {
  if (open && !wasOpen) emit("open");
  else if (!open && wasOpen) emit("close");
});

watch(isOpen, (open) => {
  if (typeof window === "undefined") return;
  if (open) {
    const rect = (
      triggerWrapperRef.value ?? selectTriggerWrapperRef.value
    )?.getBoundingClientRect();
    openTriggerTop = rect?.top ?? null;
    openTriggerLeft = rect?.left ?? null;
    window.addEventListener("scroll", handleViewportScroll, {
      capture: true,
      passive: true,
    });
  } else {
    window.removeEventListener("scroll", handleViewportScroll, true);
    cancelTriggerMoveCheck();
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("scroll", handleViewportScroll, true);
    cancelTriggerMoveCheck();
  }
});

// ── Chip overflow (width-aware) ──────────────────────────────────────────
// Multi-select shows up to `maxChips` chips that fit the trigger; the rest collapse into "+N" (S5).

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
  if (canClear.value) reserved += 20; // pe-12 - pe-7
  return reserved;
});

const overflowChipEstimatedWidth = 32; // "+N" pill width approximation
const chipGap = 4; // gap-1 between chips

/**
 * Number of chips that fit the trigger width, capped by `maxChips`; at least 1 so a pick shows.
 */
const dynamicMaxChips = computed(() => {
  const total = selectedLabels.value.length;
  if (total === 0) return 0;

  // No measurement yet (SSR / pre-mount) — fall back to the prop or a safe
  // default so we don't render nothing.
  if (triggerWidth.value === 0) {
    return Math.min(props.maxChips, total);
  }

  const available = Math.max(0, triggerWidth.value - reservedTriggerSpace.value);
  let used = 0;
  let count = 0;

  for (let i = 0; i < total; i++) {
    const chipW = estimateChipWidth(selectedLabels.value[i]);
    const remaining = total - i - 1;
    // If there'll be hidden chips after this one, reserve space for the
    // "+N more" pill so it can still fit on the row.
    const overflowReserve = remaining > 0 ? overflowChipEstimatedWidth + chipGap : 0;
    const needed = chipW + (i > 0 ? chipGap : 0) + overflowReserve;
    if (used + needed > available) break;
    used += chipW + (i > 0 ? chipGap : 0);
    count++;
  }

  return Math.min(Math.max(1, count), props.maxChips);
});

const visibleSelectedLabels = computed(() => selectedLabels.value.slice(0, dynamicMaxChips.value));
const overflowSelectedCount = computed(() =>
  Math.max(0, selectedLabels.value.length - dynamicMaxChips.value),
);

const triggerTextTone = computed(() =>
  isDisabled.value
    ? "text-select-disabled-text"
    : hasSelection.value
      ? "text-select-text"
      : "text-select-placeholder",
);

// Chevron and clear sit absolutely at the end, so this padding only squeezes the content and the chevron never moves.
const triggerEndPadding = computed(() => (canClear.value ? "pe-12" : "pe-7"));

// A filter sizes to its text from 160 (S7) unless the page gives it a width.
const fieldWidthClass = computed(() =>
  props.width ? WIDTH_CLASSES[props.width] : isFilter.value ? "w-fit min-w-40" : "w-full",
);

// "Status: Any" → "Status: Firing" → "Status: 3" (F3).
const filterValueText = computed(() => {
  const count = selectedLabels.value.length;
  if (!hasSelection.value || count === 0)
    return props.anyLabel ?? resetOption.value?.label ?? t("components.select.any");
  if (count === 1 && props.summary === "value") return selectedLabels.value[0];
  return raw(String(count));
});
const isNarrowed = computed(() => isFilter.value && canClear.value);

const triggerChromeClasses = computed(() => [
  "rounded-default relative flex w-full items-center border",
  slots.icon ? "ps-2" : "ps-3",
  "focus:outline-none transition-[color,background-color,border-color,box-shadow] duration-150",
  isNarrowed.value ? "bg-select-item-selected-bg" : "bg-select-bg",
  // The red error border stays on focus; the focus colour applies only without an error.
  hasError.value
    ? "border-select-border-error focus:ring-control-error-halo data-[state=open]:ring-control-error-halo focus:ring-3 data-[state=open]:ring-3"
    : "border-select-border hover:border-select-border-hover focus:border-control-border-focus focus:ring-control-focus-halo data-[state=open]:border-control-border-focus data-[state=open]:ring-control-focus-halo focus:ring-3 data-[state=open]:ring-3",
  isNarrowed.value && !hasError.value ? "border-select-border-focus" : "",
  "disabled:bg-select-disabled-bg disabled:border-select-disabled-border disabled:cursor-not-allowed disabled:border-dashed",
  "data-disabled:bg-select-disabled-bg data-disabled:border-select-disabled-border data-disabled:cursor-not-allowed data-disabled:border-dashed",
  triggerEndPadding.value,
  heightClasses[props.size ?? "md"],
]);

// The menu keeps the size it opened at, so filtering never shrinks or moves it (O4).
const LIST_MAX_HEIGHT = 232;
const frozenListHeight = ref<number | null>(null);
const frozenMenuWidth = ref<number | null>(null);
const menuContentRef = ref<{ $el?: HTMLElement } | null>(null);
watch(
  [popoverOpen, () => normalizedOptions.value.length],
  async ([open]) => {
    if (!open) {
      frozenListHeight.value = null;
      frozenMenuWidth.value = null;
      return;
    }
    if (isSearching.value) return;
    await nextTick();
    const total = virtualizer.value.getTotalSize();
    frozenListHeight.value = total > 0 ? Math.min(LIST_MAX_HEIGHT, total) : null;
    const width = menuContentRef.value?.$el?.getBoundingClientRect?.().width ?? 0;
    if (width > 0) frozenMenuWidth.value = Math.max(frozenMenuWidth.value ?? 0, width);
  },
  { flush: "post" },
);
const listStyle = computed(() =>
  frozenListHeight.value ? { height: `${frozenListHeight.value / 16}rem` } : undefined,
);
const menuWidthStyle = computed(() =>
  frozenMenuWidth.value ? { minWidth: `${frozenMenuWidth.value / 16}rem` } : undefined,
);

const exactMatch = computed(() => {
  const term = searchTerm.value.trim().toLowerCase();
  return normalizedOptions.value.some(
    (o) => !o.header && (o.label.toLowerCase() === term || String(o.value).toLowerCase() === term),
  );
});
const showCreateRow = computed(
  () => props.creatable && searchTerm.value.trim() !== "" && !exactMatch.value,
);
const showLoadingRow = computed(() => props.loading && normalizedOptions.value.length === 0);

function clearSearch() {
  searchTerm.value = "";
  searchFilterRef.value?.$el?.focus();
}

function formatCount(count: number) {
  return raw(count.toLocaleString());
}
</script>

<script lang="ts">
const DEFAULT_OPTION_LABEL = "label";
const DEFAULT_OPTION_VALUE = "value";
const DEFAULT_OPTION_DISABLED = "disabled";
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 28;
const SIZE_CLASSES: Record<SelectSize, string> = {
  sm: "h-control-sm text-compact",
  md: "h-control-md text-compact",
  lg: "h-control-lg text-sm",
};
const WIDTH_CLASSES: Record<FieldWidth, string> = {
  s: "w-field-width-s",
  m: "w-field-width-m",
  l: "w-field-width-l",
  full: "w-full",
};
const RESET_VALUE_KEYS = new Set(["", "all", "any", "*"]);
const RESET_LABEL = /^(all|any)\b/i;

// Sentinels like "__all__" count too, since their label is translated and may not read "All".
function isResetOption(opt: { value: SelectPrimitiveValue; label: string }): boolean {
  if (opt.value === null) return true;
  if (typeof opt.value === "string") {
    const key = opt.value
      .trim()
      .toLowerCase()
      .replace(/^_+|_+$/g, "");
    if (RESET_VALUE_KEYS.has(key)) return true;
  }
  return RESET_LABEL.test(opt.label.trim());
}
</script>

<template>
  <div
    v-bind="wrapperAttrs"
    :class="['flex flex-col gap-1', fieldWidthClass, isFilter ? 'max-w-full min-w-0' : '']"
  >
    <!-- A filter carries its label inside and never gets a label row (S3, F3). -->
    <label
      v-if="!isFilter && (label || $slots.tooltip)"
      :id="labelId"
      :for="inputId"
      :class="[
        'o-input-label text-compact flex items-center gap-1 leading-tight',
        isDisabled
          ? 'text-input-label-text-disabled font-normal'
          : 'text-input-label-text cursor-pointer font-medium',
      ]"
      @click.prevent="handleLabelClick"
    >
      {{ label }}<span v-if="required" aria-hidden="true" class="select-none">*</span>
      <!-- The tooltip goes first so it anchors to this focusable wrapper, not the icon's svg, and opens on Tab too. -->
      <span
        v-if="$slots.tooltip"
        tabindex="0"
        role="img"
        :aria-label="tooltipIconLabel"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="rounded-default focus-visible:ring-focus-ring-accent inline-flex cursor-help focus-visible:ring-2 focus-visible:outline-none"
        ><slot name="tooltip" /><OIcon name="info-outline" size="sm"
      /></span>
    </label>

    <template v-if="listboxModeEnabled">
      <PopoverRoot v-model:open="popoverOpen">
        <div ref="triggerWrapperRef" class="relative flex items-center">
          <PopoverTrigger
            type="button"
            :id="inputId"
            :name="name"
            :disabled="isDisabled"
            :tabindex="inputTabindex"
            role="combobox"
            :aria-expanded="popoverOpen"
            :aria-invalid="hasError || undefined"
            :aria-label="insideLabelName"
            :aria-labelledby="outsideLabelId"
            v-bind="controlAttrs"
            :aria-describedby="mergeDescribedBy(errorDescribedBy, controlAttrs)"
            @keydown="handleTriggerKeydown"
            :data-test="parentDataTest ? `${parentDataTest}-trigger` : undefined"
            :data-test-selected-value="
              multiple
                ? selectedValues.map((v) => String(v)).join(',')
                : selectedValues[0] !== undefined
                  ? String(selectedValues[0])
                  : ''
            "
            :data-test-selected-label="triggerDisplayLabel"
            :class="triggerChromeClasses"
          >
            <span
              v-if="$slots.icon"
              class="text-select-placeholder me-1.5 flex shrink-0 items-center"
            >
              <slot name="icon" />
            </span>

            <slot name="trigger" :value="modelValue">
              <template v-if="isFilter">
                <span
                  v-if="label"
                  class="text-select-label me-1 shrink-0 whitespace-nowrap select-none"
                  data-test="o-select-filter-label"
                  >{{ label }}:</span
                >
                <span
                  :class="[
                    'min-w-0 flex-1 truncate text-start',
                    hasSelection && !isAtReset
                      ? 'text-select-text font-medium'
                      : 'text-select-text',
                  ]"
                  data-test="o-select-filter-value"
                  >{{ filterValueText }}</span
                >
                <OTooltip v-if="hasSelection && multiple" :content="raw(triggerDisplayLabel)" />
                <OTooltip v-else-if="hasSelection" overflow-only />
              </template>
              <template v-else-if="multiple && allSelectedLabel && allSelected">
                <span class="text-select-text flex-1 truncate text-start">{{
                  allSelectedLabel
                }}</span>
              </template>
              <template v-else-if="multiple && selectedLabels.length > 0">
                <div class="flex flex-1 flex-nowrap items-center gap-1 overflow-hidden pe-2">
                  <slot
                    v-for="(labelText, idx) in visibleSelectedLabels"
                    name="chip"
                    :label="String(labelText ?? '')"
                    :value="selectedValues[idx]"
                  >
                    <OTruncatedText
                      :key="`${idx}-${String(labelText ?? '')}`"
                      class="rounded-chip bg-select-item-selected-bg text-select-item-selected-text inline-block max-w-40 shrink-0 px-1.5 py-0.5 text-xs leading-none"
                    >
                      {{ labelText }}
                    </OTruncatedText>
                  </slot>
                  <span
                    v-if="overflowSelectedCount > 0"
                    class="rounded-chip bg-select-item-hover-bg text-select-text inline-flex shrink-0 items-center px-1.5 py-0.5 text-xs tabular-nums"
                    data-test="o-select-overflow-chip"
                  >
                    +{{ overflowSelectedCount }}
                  </span>
                  <OTooltip v-if="overflowSelectedCount > 0" :content="raw(triggerDisplayLabel)" />
                </div>
              </template>
              <template v-else>
                <span :class="['flex-1 truncate text-start', triggerTextTone]">
                  {{ hasSelection ? triggerDisplayLabel : placeholder }}
                </span>
                <OTooltip v-if="hasSelection" overflow-only />
              </template>
            </slot>
          </PopoverTrigger>

          <!-- pointer-events-none so the chevron never blocks the trigger; anchored to the end so clear never moves it. -->
          <div class="pointer-events-none absolute end-2.5 flex items-center gap-1.5">
            <button
              v-if="canClear && !isDisabled"
              type="button"
              tabindex="-1"
              :aria-label="t('components.select.clearSelection')"
              :data-test="parentDataTest ? `${parentDataTest}-clear` : undefined"
              class="text-input-clear-btn hover:text-input-clear-btn-hover pointer-events-auto flex items-center justify-center transition-colors"
              @click.stop="handleClear"
            >
              <OIcon name="close" size="sm" />
            </button>

            <OSpinner v-if="loading" size="sm" />
            <span
              v-else
              aria-hidden="true"
              :class="[
                'text-select-icon flex items-center justify-center',
                'transition-transform duration-150',
                isOpen ? 'rotate-180' : '',
              ]"
            >
              <OIcon name="expand-more" size="sm" />
            </span>
          </div>
        </div>

        <PopoverPortal>
          <PopoverContent
            ref="menuContentRef"
            :side-offset="4"
            align="start"
            :trap-focus="false"
            :disable-outside-pointer-events="false"
            :hide-when-detached="true"
            :data-test="parentDataTest ? `${parentDataTest}-popover` : undefined"
            @open-auto-focus="handlePopoverOpenAutoFocus"
            :class="[
              'z-10001 max-w-[max(var(--reka-popover-trigger-width),22.5rem)] min-w-[max(var(--reka-popover-trigger-width),12.5rem)]',
              'flex flex-col overflow-hidden',
              'rounded-menu shadow-overlay border-border-default border',
              'bg-select-content-bg text-compact',
            ]"
            :style="[
              menuWidthStyle,
              { maxHeight: 'min(20rem, var(--reka-popover-content-available-height, 20rem))' },
            ]"
            @click.stop
          >
            <ListboxRoot
              :model-value="listboxStringModelValue"
              :multiple="multiple"
              :disabled="isDisabled"
              class="flex min-h-0 flex-1 flex-col"
              @update:model-value="handleListboxUpdate"
            >
              <div
                class="rounded-menu border-dropdown-border bg-select-content-bg flex min-h-0 flex-1 flex-col overflow-hidden border"
              >
                <ListboxFilter
                  v-if="inputEnabled"
                  ref="searchFilterRef"
                  v-model="searchTerm"
                  auto-focus
                  :data-test="parentDataTest ? `${parentDataTest}-search` : undefined"
                  :class="[
                    'text-input-text h-control-md w-full shrink-0 bg-transparent px-3',
                    'placeholder:text-input-placeholder outline-none',
                    'border-dropdown-border border-b',
                  ]"
                  :placeholder="resolvedSearchPlaceholder"
                  @keydown="handleDropdownKeydown"
                />

                <!-- Select-all row: outside the listbox keyboard navigation but still focusable. -->
                <div
                  v-if="selectAll && multiple && selectableOptions.length > 0"
                  role="checkbox"
                  tabindex="0"
                  :aria-label="t('components.select.toggleAllOptions')"
                  :aria-checked="allSelected ? 'true' : partiallySelected ? 'mixed' : 'false'"
                  :class="[
                    'relative flex h-8 w-full shrink-0 items-center gap-2 ps-3 pe-3',
                    'text-select-item-text',
                    'cursor-pointer outline-none select-none',
                    'hover:bg-select-item-hover-bg',
                    'focus-visible:bg-select-item-hover-bg',
                    'transition-colors duration-(--duration-control) ease-(--ease-control)',
                    'border-select-content-border border-b',
                  ]"
                  data-test="o-select-all"
                  @click="toggleAllSelections"
                  @keydown.enter.prevent="toggleAllSelections"
                  @keydown.space.prevent="toggleAllSelections"
                >
                  <span
                    :class="[
                      'rounded-chip flex size-4 shrink-0 items-center justify-center border transition-colors',
                      allSelected || partiallySelected
                        ? 'bg-checkbox-checked-bg border-checkbox-checked-border text-checkbox-checked-fg'
                        : 'bg-checkbox-bg border-checkbox-border',
                    ]"
                    aria-hidden="true"
                  >
                    <OIcon v-if="allSelected" name="check" size="xs" />
                    <OIcon v-else-if="partiallySelected" name="remove" size="xs" />
                  </span>
                  <span class="truncate font-medium">{{
                    t("components.select.selectAllLabel")
                  }}</span>
                </div>

                <slot name="before-options" />

                <!-- Height frozen at open (listStyle) so filtering never resizes the menu; keyboard nav lives on the filter input. -->
                <div
                  ref="listboxScrollEl"
                  class="max-h-58 overflow-auto"
                  :style="listStyle"
                  data-test="o-select-list"
                >
                  <div
                    v-if="showLoadingRow"
                    class="text-select-placeholder flex h-8 items-center gap-2 px-3"
                    data-test="o-select-loading"
                  >
                    <OSpinner size="sm" />{{ t("common.loading") }}
                  </div>
                  <div
                    v-else-if="filteredOptions.length === 0 && isSearching"
                    class="text-select-placeholder flex flex-col items-start gap-1 px-3 py-2"
                    data-test="o-select-no-matches"
                  >
                    <slot name="empty">
                      <span>{{
                        t("components.select.noMatches", { term: searchTerm.trim() })
                      }}</span>
                      <button
                        type="button"
                        class="text-text-link text-xs hover:underline"
                        data-test="o-select-clear-search"
                        @click="clearSearch"
                      >
                        {{ t("components.select.clearSearch") }}
                      </button>
                    </slot>
                  </div>
                  <div
                    v-else-if="filteredOptions.length === 0"
                    class="text-select-placeholder px-3 py-2"
                  >
                    <slot name="empty">{{ t("components.select.noOptionsFound") }}</slot>
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
                      <OSelectHeaderRow
                        v-if="isRichHeader(filteredOptions[vRow.index])"
                        :label="filteredOptions[vRow.index].label"
                        :count="filteredOptions[vRow.index].headerCount"
                        :action="filteredOptions[vRow.index].headerAction"
                        :action-aria-label="filteredOptions[vRow.index].headerActionAriaLabel"
                        :highlighted="vRow.index === highlightedIndex"
                        :data-test="parentDataTest ? `${parentDataTest}-header` : undefined"
                        @action="handleHeaderAction(filteredOptions[vRow.index], $event)"
                      />

                      <!-- Virtual rows are siblings, so a ListboxGroup cannot wrap its items: the header is a plain label. -->
                      <div
                        v-else-if="filteredOptions[vRow.index].header"
                        :class="[
                          'text-text-secondary flex h-full w-full items-center px-3 text-xs font-medium select-none',
                          collapsibleGroups
                            ? 'bg-surface-subtle cursor-pointer gap-1'
                            : 'bg-select-content-bg pointer-events-none',
                        ]"
                        @click.stop="
                          collapsibleGroups && toggleGroup(filteredOptions[vRow.index].label)
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

                      <!-- Not a ListboxItem, so Reka can never select it; mousedown.prevent keeps focus in the search input. -->
                      <div
                        v-else-if="filteredOptions[vRow.index].expandable"
                        :data-test="parentDataTest ? `${parentDataTest}-expand` : undefined"
                        :data-test-value="toRekaString(filteredOptions[vRow.index].value)"
                        :aria-expanded="isExpanded(filteredOptions[vRow.index].value)"
                        :class="[
                          'flex h-full w-full items-center justify-between gap-2 ps-3 pe-3',
                          'text-select-item-text cursor-pointer select-none',
                          'transition-colors duration-(--duration-control) ease-(--ease-control)',
                          vRow.index === highlightedIndex
                            ? 'bg-select-item-hover-bg'
                            : 'hover:bg-select-item-hover-bg',
                        ]"
                        @mousedown.prevent
                        @click.stop="toggleExpanded(filteredOptions[vRow.index].value)"
                      >
                        <OTruncatedText>{{ filteredOptions[vRow.index].label }}</OTruncatedText>
                        <OIcon
                          name="chevron-right"
                          size="sm"
                          :class="[
                            'shrink-0 transition-transform duration-150',
                            isExpanded(filteredOptions[vRow.index].value) ? 'rotate-90' : '',
                          ]"
                        />
                      </div>

                      <!-- An ancestor, so its capture listener runs before Reka's toggle on the item. -->
                      <div
                        v-else
                        class="contents"
                        @click.capture="
                          handleItemClickCapture(
                            $event,
                            toRekaString(filteredOptions[vRow.index].value),
                          )
                        "
                      >
                        <ListboxItem
                          :value="toRekaString(filteredOptions[vRow.index].value)"
                          :disabled="filteredOptions[vRow.index].disabled"
                          :data-test="parentDataTest ? `${parentDataTest}-option` : undefined"
                          :data-test-value="toRekaString(filteredOptions[vRow.index].value)"
                          :data-test-label="String(filteredOptions[vRow.index].label ?? '')"
                          :class="[
                            'relative flex h-full w-full gap-2',
                            isNestedRow(filteredOptions[vRow.index]) ? 'ps-7' : 'ps-3',
                            'pe-3',
                            'text-select-item-text',
                            'cursor-pointer outline-none select-none',
                            'transition-colors duration-(--duration-control) ease-(--ease-control)',
                            (filteredOptions[vRow.index].subLabel &&
                              !filteredOptions[vRow.index].subLabelInline) ||
                            filteredOptions[vRow.index].colorPalette?.length
                              ? 'flex-col items-start py-2'
                              : 'flex-row items-center',
                            // Virtual rows are not direct ListboxRoot children, so Reka's data-highlighted never fires.
                            vRow.index === highlightedIndex
                              ? 'bg-select-item-hover-bg'
                              : 'hover:bg-select-item-hover-bg',
                            multiple
                              ? ''
                              : 'data-[state=checked]:bg-select-item-selected-bg data-[state=checked]:text-select-item-selected-text',
                            'data-disabled:text-select-item-disabled data-disabled:pointer-events-none data-disabled:cursor-not-allowed',
                          ]"
                        >
                          <span
                            v-if="multiple"
                            :class="[
                              'rounded-chip flex size-4 shrink-0 items-center justify-center border transition-colors',
                              selectedValues.includes(filteredOptions[vRow.index].value)
                                ? 'bg-checkbox-checked-bg border-checkbox-checked-border text-checkbox-checked-fg'
                                : 'bg-checkbox-bg border-checkbox-border',
                            ]"
                            aria-hidden="true"
                            data-select-checkbox
                          >
                            <OIcon
                              v-if="selectedValues.includes(filteredOptions[vRow.index].value)"
                              name="check"
                              size="xs"
                            />
                          </span>
                          <span
                            v-if="multiple && rowClickSingleSelect"
                            class="bg-select-content-border my-1.5 w-px shrink-0 self-stretch"
                            aria-hidden="true"
                            data-select-separator
                          />

                          <template v-if="$slots.option && filteredOptions[vRow.index].source">
                            <OIcon
                              v-if="filteredOptions[vRow.index].icon"
                              :name="filteredOptions[vRow.index].icon"
                              size="sm"
                              class="shrink-0"
                            />
                            <span class="flex min-w-0 flex-1 items-center">
                              <slot name="option" :option="filteredOptions[vRow.index].source!" />
                            </span>
                          </template>

                          <!-- Inline subLabel: name – url on a single row -->
                          <template
                            v-else-if="
                              filteredOptions[vRow.index].subLabel &&
                              filteredOptions[vRow.index].subLabelInline
                            "
                          >
                            <span class="shrink-0 font-medium">{{
                              filteredOptions[vRow.index].label
                            }}</span>
                            <span class="text-select-placeholder mx-1 shrink-0">–</span>
                            <OTruncatedText class="text-text-secondary text-xs">{{
                              filteredOptions[vRow.index].subLabel
                            }}</OTruncatedText>
                          </template>

                          <!-- One wrapper so the row's gap-2 does not space each part and overflow the fixed height. -->
                          <template
                            v-else-if="
                              filteredOptions[vRow.index].subLabel ||
                              filteredOptions[vRow.index].colorPalette?.length ||
                              filteredOptions[vRow.index].badge
                            "
                          >
                            <div class="flex w-full flex-col gap-1 overflow-hidden">
                              <span class="flex w-full items-center gap-1.5 leading-snug">
                                <OIcon
                                  v-if="filteredOptions[vRow.index].icon"
                                  :name="filteredOptions[vRow.index].icon"
                                  size="sm"
                                  class="shrink-0"
                                />
                                <!-- Weight only separates a label from the description under it; alone it emphasises nothing. -->
                                <OTruncatedText
                                  :class="filteredOptions[vRow.index].subLabel ? 'font-medium' : ''"
                                  >{{ filteredOptions[vRow.index].label }}</OTruncatedText
                                >
                                <span
                                  v-if="filteredOptions[vRow.index].badge"
                                  class="rounded-chip shrink-0 border border-solid"
                                  :class="[
                                    // pointer-events-auto keeps a muted badge's tooltip reachable despite the row's pointer-events-none.
                                    filteredOptions[vRow.index].badgeMuted
                                      ? 'text-text-secondary border-border-default pointer-events-auto'
                                      : 'text-status-positive border-status-positive',
                                    filteredOptions[vRow.index].badgeTitle
                                      ? 'cursor-help'
                                      : undefined,
                                    filteredOptions[vRow.index].badgeStyle
                                      ? 'ms-auto inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center border-current px-1 text-xs leading-none font-semibold'
                                      : 'text-2xs px-1 py-px leading-tight font-medium',
                                  ]"
                                  :title="filteredOptions[vRow.index].badgeTitle"
                                  :style="filteredOptions[vRow.index].badgeStyle"
                                  >{{ filteredOptions[vRow.index].badge }}</span
                                >
                                <span
                                  v-if="filteredOptions[vRow.index].count !== undefined"
                                  class="text-text-secondary ms-auto shrink-0 text-xs tabular-nums"
                                  >{{ formatCount(filteredOptions[vRow.index].count!) }}</span
                                >
                              </span>
                              <OTruncatedText
                                v-if="filteredOptions[vRow.index].subLabel"
                                :lines="2"
                                class="text-text-secondary w-full text-xs leading-snug whitespace-normal"
                                >{{ filteredOptions[vRow.index].subLabel }}</OTruncatedText
                              >
                              <div
                                v-if="filteredOptions[vRow.index].colorPalette?.length"
                                class="rounded-default h-1.5 w-full"
                                :style="{
                                  background: getPaletteGradient(
                                    filteredOptions[vRow.index].colorPalette!,
                                  ),
                                }"
                              />
                            </div>
                          </template>

                          <!-- Simple item: optional icon + label + suffix or count -->
                          <template v-else>
                            <component
                              v-if="filteredOptions[vRow.index].iconComponent"
                              :is="filteredOptions[vRow.index].iconComponent"
                              class="size-4 shrink-0"
                            />
                            <OIcon
                              v-else-if="filteredOptions[vRow.index].icon"
                              :name="filteredOptions[vRow.index].icon"
                              size="sm"
                              class="shrink-0"
                            />
                            <span v-else-if="iconKey" class="size-4 shrink-0" />
                            <OTruncatedText class="min-w-0 flex-1">{{
                              filteredOptions[vRow.index].listLabel ??
                              filteredOptions[vRow.index].label
                            }}</OTruncatedText>
                            <span
                              v-if="filteredOptions[vRow.index].suffix"
                              class="text-text-secondary ms-auto shrink-0 text-xs tabular-nums"
                              >{{ filteredOptions[vRow.index].suffix }}</span
                            >
                            <span
                              v-else-if="filteredOptions[vRow.index].count !== undefined"
                              class="text-text-secondary ms-auto shrink-0 text-xs tabular-nums"
                              data-test="o-select-option-count"
                              >{{ formatCount(filteredOptions[vRow.index].count!) }}</span
                            >
                          </template>
                        </ListboxItem>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- The typed value that is not listed becomes the last row (creatable). -->
                <button
                  v-if="showCreateRow"
                  type="button"
                  class="text-select-item-text hover:bg-select-item-hover-bg border-select-content-border flex h-8 w-full shrink-0 items-center gap-2 border-t ps-3 pe-3 text-start"
                  :data-test="parentDataTest ? `${parentDataTest}-create` : 'o-select-create'"
                  @mousedown.prevent
                  @click="handleCreateFromInput"
                >
                  <OIcon name="add" size="sm" class="shrink-0" />
                  <OTruncatedText class="min-w-0 flex-1">{{
                    t("components.select.addOption", { value: searchTerm.trim() })
                  }}</OTruncatedText>
                </button>

                <slot name="after-options" />

                <div
                  v-if="multiple && rowClickSingleSelect"
                  class="border-select-content-border text-text-secondary flex h-8 shrink-0 items-center gap-3 border-t px-3 select-none"
                  data-test="o-select-row-click-hint"
                >
                  <span class="flex items-center gap-1.5">
                    <span
                      class="rounded-chip border-checkbox-border flex size-4 shrink-0 items-center justify-center border"
                      aria-hidden="true"
                    >
                      <OIcon name="check" size="xs" />
                    </span>
                    {{ t("components.select.multiSelect") }}
                  </span>
                  <span class="bg-select-content-border h-4 w-px shrink-0" aria-hidden="true" />
                  <span class="flex items-center gap-1.5">
                    <OIcon name="ads-click" size="sm" class="shrink-0" />
                    {{ t("components.select.singleSelect") }}
                  </span>
                </div>
              </div>
            </ListboxRoot>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </template>

    <SelectRoot
      v-else
      :model-value="stringValue"
      :open="selectOpen"
      :disabled="isDisabled"
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
      <div ref="selectTriggerWrapperRef" class="relative flex items-center">
        <SelectTrigger
          :id="inputId"
          :tabindex="inputTabindex"
          :aria-invalid="hasError || undefined"
          :aria-label="insideLabelName"
          v-bind="controlAttrs"
          :aria-describedby="mergeDescribedBy(errorDescribedBy, controlAttrs)"
          :data-test="parentDataTest ? `${parentDataTest}-trigger` : undefined"
          :class="triggerChromeClasses"
        >
          <span
            v-if="$slots.icon"
            class="text-select-placeholder me-1.5 flex shrink-0 items-center"
          >
            <slot name="icon" />
          </span>
          <span
            v-if="isFilter && label"
            class="text-select-label me-1 shrink-0 whitespace-nowrap select-none"
            data-test="o-select-filter-label"
            >{{ label }}:</span
          >
          <span
            v-if="isFilter && !hasSelection"
            class="text-select-text min-w-0 flex-1 truncate text-start"
            data-test="o-select-filter-value"
            >{{ filterValueText }}</span
          >
          <!-- reka's SelectValue is pointer-events:none, so the wrapper is what cuts and takes the hover. -->
          <OTruncatedText
            v-else
            :class="[
              'flex-1 text-start',
              isFilter && !isAtReset ? 'font-medium' : '',
              triggerTextTone,
            ]"
            :tooltip="hasSelection && !$slots.trigger ? undefined : false"
          >
            <SelectValue :placeholder="placeholder">
              <slot name="trigger" :value="modelValue" />
            </SelectValue>
          </OTruncatedText>
        </SelectTrigger>

        <div class="pointer-events-none absolute end-2.5 flex items-center gap-1.5">
          <button
            v-if="canClear && !isDisabled"
            type="button"
            tabindex="-1"
            :aria-label="t('components.select.clearSelection')"
            :data-test="parentDataTest ? `${parentDataTest}-clear` : undefined"
            class="text-input-clear-btn hover:text-input-clear-btn-hover pointer-events-auto flex items-center justify-center transition-colors"
            @click.stop="handleClear"
          >
            <OIcon name="close" size="sm" />
          </button>

          <OSpinner v-if="loading" size="sm" />
          <span
            v-else
            aria-hidden="true"
            :class="[
              'text-select-icon flex items-center justify-center',
              'transition-transform duration-150',
              isOpen ? 'rotate-180' : '',
            ]"
          >
            <OIcon name="expand-more" size="sm" />
          </span>
        </div>
      </div>

      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="4"
          :hide-when-detached="true"
          :collision-padding="lgUp ? 0 : 8"
          :data-test="parentDataTest ? `${parentDataTest}-popover` : undefined"
          :class="[
            'z-10001 min-w-[max(var(--reka-select-trigger-width),12.5rem)] max-lg:max-w-[calc(100vw-1rem)]',
            'text-compact overflow-hidden',
            'max-lg:max-h-[var(--reka-popper-available-height,75vh)] max-lg:overflow-y-auto',
            'rounded-menu shadow-overlay border-border-default border',
            'bg-select-content-bg',
            // Clip-path reveal from the trigger edge: wipes down by default, up when placed on top.
            'data-[state=open]:animate-[o2-reveal-down-in_var(--duration-overlay-in)_var(--ease-out-expo)]',
            'data-[state=closed]:animate-[o2-reveal-down-out_var(--duration-overlay-out)_var(--ease-overlay-out)]',
            'data-[side=top]:data-[state=open]:animate-[o2-reveal-up-in_var(--duration-overlay-in)_var(--ease-out-expo)]',
            'data-[side=top]:data-[state=closed]:animate-[o2-reveal-up-out_var(--duration-overlay-out)_var(--ease-overlay-out)]',
          ]"
          :style="{ maxHeight: 'min(15rem, var(--reka-select-content-available-height, 15rem))' }"
          @click.stop
          @pointerdown.stop
        >
          <SelectScrollUpButton class="text-select-icon flex h-6 items-center justify-center">
            <OIcon name="expand-less" size="sm" />
          </SelectScrollUpButton>

          <SelectViewport class="p-1">
            <template v-if="normalizedOptions.length && !slots.default">
              <OSelectItem
                v-for="opt in normalizedOptions"
                :key="String(opt.value)"
                :value="opt.value"
                :label="opt.label"
                :disabled="opt.disabled || opt.expandable"
                :icon="opt.icon"
                :icon-component="opt.iconComponent"
                :reserve-icon-space="!!iconKey"
              />
            </template>

            <div v-else-if="!slots.default" class="text-select-placeholder px-3 py-2">
              <slot name="empty">{{ t("components.select.noOptionsFound") }}</slot>
            </div>

            <slot />
          </SelectViewport>

          <SelectScrollDownButton class="text-select-icon flex h-6 items-center justify-center">
            <OIcon name="expand-more" size="sm" />
          </SelectScrollDownButton>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>

    <span
      v-if="effectiveError && effectiveError.trim()"
      :id="errorId"
      :data-test="parentDataTest ? `${parentDataTest}-error` : undefined"
      class="text-select-error-text text-xs leading-snug"
      role="alert"
    >
      {{ effectiveError }}
    </span>
    <span v-else-if="helpText" class="text-input-help-text text-xs leading-snug">
      {{ helpText }}
    </span>
  </div>
</template>
