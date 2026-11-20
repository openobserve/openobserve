// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

/** md 32 in toolbars, sm 28 in panels and menus (S1, S2). */
export type SearchInputSize = "sm" | "md";
/** list 280 and scope 360 on list pages (F2); full fills the container. */
export type SearchInputWidth = "list" | "scope" | "full";

export const SEARCH_INPUT_SIZES = ["sm", "md"] as const satisfies readonly SearchInputSize[];
export const SEARCH_INPUT_WIDTHS = [
  "list",
  "scope",
  "full",
] as const satisfies readonly SearchInputWidth[];

/** One segment of the in-field scope switch, such as "This folder | All folders". */
export interface SearchScopeOption {
  value: string;
  label: I18nText;
  icon?: IconName;
  /** Tooltip naming what the scope searches */
  tooltip?: I18nText;
  /** E2E selector for the segment; defaults to `<data-test>-scope-<value>` */
  dataTest?: string;
}

export interface SearchInputProps {
  modelValue?: string;
  /** "Search <objects>", sentence case; defaults to "Search…" */
  placeholder?: I18nText;
  size?: SearchInputSize;
  width?: SearchInputWidth;
  /** Current scope; use with `v-model:scope` and `scopeOptions` */
  scope?: string;
  /** Two segments shown inside the box, after the text */
  scopeOptions?: SearchScopeOption[];
  /** "/" focuses this field and the box shows the key (KB1); defaults to on at md, off at sm */
  shortcut?: boolean;
  /** Milliseconds typing waits before the model updates; a search that asks the server passes 200 */
  debounce?: number;
  /** A spinner replaces the search glyph while results load */
  loading?: boolean;
  disabled?: boolean;
}

export interface SearchInputEmits {
  (_e: "update:modelValue", _value: string): void;
  (_e: "update:scope", _value: string): void;
  (_e: "clear"): void;
}
