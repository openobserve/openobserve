// Copyright 2026 OpenObserve Inc.

export interface FieldItem {
  name: string;
  type?: string;
  isGroup?: boolean;
  groupName?: string;
  [key: string]: any;
}

export interface OFieldListProps {
  fields: FieldItem[];
  search?: string;
  searchPlaceholder?: string;
  loading?: boolean;
  currentPage?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  rowKey?: string;
  showSearch?: boolean;
  showPagination?: boolean;
  expandedIds?: string[];
  draggable?: boolean;
  dragEnabledFn?: (row: FieldItem, index: number) => boolean;
  sortFn?: (a: FieldItem, b: FieldItem) => number;
}

export interface OFieldListEmits {
  "update:search": [value: string];
  "update:currentPage": [page: number];
  "update:expandedIds": [ids: string[]];
  "row-click": [row: FieldItem, event: MouseEvent];
  "row-dblclick": [row: FieldItem, event: MouseEvent];
  "scroll-end": [scrollInfo: any];
  "drag-start": [row: FieldItem, event: DragEvent];
  "drag-end": [row: FieldItem, event: DragEvent];
}

export interface OFieldListSlots {
  "before-list"?: (props: Record<string, never>) => any;
  "after-list"?: (props: {
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalRows: number;
    isFirstPage: boolean;
    isLastPage: boolean;
    setPageSize: (size: number) => void;
    firstPage: () => void;
    prevPage: () => void;
    nextPage: () => void;
    lastPage: () => void;
  }) => any;
  "field-row"?: (props: {
    row: FieldItem;
    index: number;
    draggable: boolean;
    isDragEnabled: boolean;
  }) => any;
  "field-actions"?: (props: { row: FieldItem; index: number }) => any;
  "group-header"?: (props: { row: FieldItem; groupName: string }) => any;
  expansion?: (props: { row: FieldItem }) => any;
  empty?: (props: Record<string, never>) => any;
  loading?: (props: Record<string, never>) => any;
}
