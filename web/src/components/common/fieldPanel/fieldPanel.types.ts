// Copyright 2026 OpenObserve Inc.

import type { Component, Ref } from "vue";
import type { I18nText } from "@/types/i18n";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";
import type { FieldValueEntry, FieldValuesState } from "@/composables/useFieldValuesStream";

export type FieldAction = "add-filter" | "toggle-column" | "interesting" | "chips";

export type FooterToggle = "schema" | "interesting";

export type StreamPickerMode = "multi" | "single" | "none";

export type StreamTypeMode = "select" | "hidden" | "disabled";

export type GroupingMode = "semantic" | "common-per-stream" | "per-source" | "custom";

export type ValueFilterMode = "include" | "exclude";

export interface FieldPanelCapabilities {
  streamPicker: StreamPickerMode;
  streamType?: StreamTypeMode;
  values: boolean;
  /** Off: top values are shown read-only, without checkboxes or the include / exclude toggle. */
  valueFilters?: boolean;
  drag: boolean;
  actions: FieldAction[];
  footerToggles: FooterToggle[];
  highlightColumns: boolean;
}

export interface StreamOption {
  label: I18nText;
  value: string;
  internal?: boolean;
  [key: string]: unknown;
}

export interface PanelField extends FieldItem {
  name: string;
  dataType: string;
  ftsKey: boolean;
  isSchemaField: boolean;
  showValues: boolean;
  stream_name?: string;
  streams?: string[];
  group?: string;
  isInterestingField?: boolean;
  /** A column the page always shows; the row offers no eye toggle for it. */
  columnLocked?: boolean;
  /** Why a locked column is always shown; with it the row shows the eye disabled instead of none. */
  columnLockedReason?: I18nText;
}

export interface ChipSpec {
  label: I18nText;
  testId: string;
  target: string;
  disabled?: boolean;
  tooltip?: I18nText;
  /** Why a disabled chip cannot take the field; shown in place of its tooltip. */
  reason?: I18nText;
}

/** One group of a page's own grouping; the panel draws its header and drops it when empty. */
export interface FieldGroup {
  key: string;
  label: I18nText;
  fields: PanelField[];
}

export interface ValuesCaption {
  text: I18nText;
  testId: string;
}

/** Page texts for the panel's empty states; each falls back to the panel's own. */
export interface FieldPanelEmptyTexts {
  noStream?: I18nText;
  noFields?: I18nText;
  noMatch?: I18nText;
}

export interface ValuesRequest {
  streamName: string;
  streamType: string;
  startTime: number;
  endTime: number;
  whereClause: string;
}

/** Logs-only picker behaviour: internal-stream header actions, a live region and a close request. */
export interface StreamPickerHooks {
  announcement?: Ref<I18nText | "">;
  searchDebounce?: number;
  /** Bumped by the source when the open popover must close (a drawer is opening over it). */
  closeSignal?: Ref<number>;
  onOpen?: () => void;
  onClose?: () => void;
  onSearch?: (term: string) => void;
  onHeaderAction?: (option: StreamOption) => void;
  /** Options of the stream-type select; the picker's default list when absent. */
  streamTypes?: Ref<string[]>;
  /** The stream select is read-only, as when the host page fixed the stream. */
  locked?: Ref<boolean>;
  optionTooltip?: boolean;
}

export interface FieldPanelSource {
  streams: Ref<StreamOption[]>;
  streamsLoading?: Ref<boolean>;
  selectedStreams: Ref<string[]>;
  streamType: Ref<string>;
  /** Grouped rows: header rows carry `isGroup`, field rows carry `group`. */
  fields: Ref<PanelField[]>;
  loading: Ref<boolean>;
  groupingMode: GroupingMode;
  /** With `groupingMode: "custom"`, groups the flat `fields` rows; the panel adds the headers. */
  groupFn?: (fields: PanelField[]) => FieldGroup[];
  /** Field that keys a row and its expansion, values and filters; set it when names repeat across groups. */
  rowKey?: string;
  search: Ref<string>;
  collapsedGroups: Ref<Set<string>>;
  expandedFields: Ref<string[]>;
  fieldValues: Ref<Record<string, FieldValuesState>>;
  activeIncludeValues: Ref<Record<string, string[]>>;
  activeExcludeValues: Ref<Record<string, string[]>>;
  tableColumns?: Ref<string[]>;
  picker?: StreamPickerHooks;
  /** Which footer schema tab is active: `user_defined_schema`, `all_fields` or `interesting_fields`. */
  footerSchemaTab?: Ref<string>;
  footerInterestingOnly?: Ref<boolean>;
  /** The stream's user-defined schema; null or empty when it has none. Without `footerSchemaTab` the panel owns the tab. */
  definedSchemaFields?: Ref<string[] | null>;
  /** Whether a row is in its own stream's defined schema; defaults to its name being in `definedSchemaFields`. */
  isDefinedSchemaField?: (field: PanelField) => boolean;
  chips?: (field: PanelField) => ChipSpec[];
  expansionOverride?: (field: PanelField) => Component | null;
  valueMapper?: (field: PanelField, values: FieldValueEntry[]) => FieldValueEntry[];
  /** A note shown above an open field's values, such as what the counts cover. */
  valuesCaption?: (field: PanelField) => ValuesCaption | null;
  emptyState?: Ref<FieldPanelEmptyTexts>;
  valuesRequest: (field: PanelField) => ValuesRequest;
  selectStreams: (names: string[]) => void;
  changeStreamType: (type: string) => void;
  setSearch: (value: string) => void;
  toggleGroup: (group: string) => void;
  refreshStreams?: () => void;
  openField: (field: PanelField) => void;
  closeField: (name: string) => void;
  searchValues: (name: string, term: string) => void;
  loadMoreValues: (name: string) => void;
  addFilter: (expression: string) => void;
  /** Sets the field's value filter to the included and excluded values, each with its own operator. */
  addValueFilters: (name: string, include: string[], exclude: string[]) => void;
  removeFieldFilter: (name: string) => void;
  toggleColumn?: (field: PanelField) => void;
  toggleInteresting?: (field: PanelField) => void;
  chip?: (field: PanelField, target: string) => void;
  dragEnabled?: (field: PanelField) => boolean;
  dragStart?: (field: PanelField, event: DragEvent) => void;
  dragEnd?: (field: PanelField, event: DragEvent) => void;
  footerToggle?: (kind: FooterToggle, value: string | boolean) => void;
  resetColumns?: () => void;
}
