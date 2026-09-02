// variables constans
export const SELECT_ALL_VALUE = "_o2_all_";

export const CUSTOM_VALUE = "::_o2_custom";

// add panel general constants
export const MAX_FIELD_LABEL_CHARS = 50;

export const TABLE_ROWS_PER_PAGE_DEFAULT_VALUE = 10;

// Pivot table constants
export const PIVOT_TABLE_MAX_COLUMNS = 50;
export const PIVOT_TABLE_SEPARATOR = "\x00";
export const PIVOT_TABLE_ROW_KEY_SEPARATOR = "\x00";
export const PIVOT_TABLE_TOTAL_LABEL = "Total";
export const PIVOT_TABLE_OTHERS_LABEL = "Others";
// Machine key for breakdown values that are null, undefined or "". A control
// character keeps it out of the user-data namespace, so a genuine "(empty)"
// string value stays a separate column instead of merging into this bucket.
// It must not contain PIVOT_TABLE_SEPARATOR: per-level values are joined and
// re-split on that character.
export const PIVOT_TABLE_EMPTY_KEY = "\x01__empty__";
// Display label for the empty bucket — applied only when rendering headers.
export const PIVOT_TABLE_EMPTY_LABEL = "(empty)";
export const PIVOT_TABLE_HEADER_ROW_HEIGHT = 28;
export const PIVOT_TABLE_DEFAULT_HEADER_HEIGHT = 48;
export const PIVOT_TABLE_TOTAL_COLUMN_WIDTH = 150;

// UI constants
export const FIELD_FUNCTION_MENU_WIDTH = "48.1875rem";

// Chart types whose queries are always hand-written (custom) rather than
// builder-generated. Add future custom-query chart types here.
export const CUSTOM_QUERY_CHART_TYPES = ["custom_chart"];
