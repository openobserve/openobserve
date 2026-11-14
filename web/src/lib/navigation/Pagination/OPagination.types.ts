// Copyright 2026 OpenObserve Inc.

import type { I18nText } from "@/types/i18n";

/** Selectors of the pager's parts; OTable passes its own so existing tests keep finding them. */
export interface PaginationTestIds {
  range?: string;
  size?: string;
  first?: string;
  prev?: string;
  next?: string;
  last?: string;
}

export interface PaginationProps {
  /** Current page, 1-based. Use with `v-model:page`. */
  page: number;
  /** Rows per page; with `pageSizes` it drives the page-size select (`v-model:page-size`). */
  pageSize?: number;
  /** Total rows: the range reads "1–20 of 143". Without it the range reads "Page 4 of 31". */
  total?: number;
  /** False when `total` is a lower bound: the range reads "of many" and Last page is omitted. */
  totalExact?: boolean;
  /** Page count, for a caller that knows pages rather than rows; derived from `total` otherwise. */
  pageCount?: number;
  /** Page-size choices (no "All"); an empty list hides the select. */
  pageSizes?: number[];
  /** A page is on its way or paging is locked: controls stay focusable but ignore input. */
  loading?: boolean;
  /** Tooltip of the controls while `loading`; defaults to "Loading". */
  disabledReason?: I18nText;
  testIds?: PaginationTestIds;
}

export interface PaginationEmits {
  (e: "update:page", page: number): void;
  (e: "update:pageSize", size: number): void;
}

export interface PaginationSlots {
  /** Replaces the range text, e.g. with a skeleton while the first page loads. */
  range?: (props: { text: string }) => unknown;
}

/** First and Last page buttons appear only past this many pages. */
export const PAGINATION_FIRST_LAST_MIN_PAGES = 10;

/** The default page-size choices: the same everywhere (D5). */
export const PAGINATION_DEFAULT_PAGE_SIZES = [20, 50, 100] as const;
