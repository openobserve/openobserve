export interface PaginationProps {
  /** Currently active page number (1-based). Use with v-model. */
  modelValue: number;
  /** Total number of pages. */
  max: number;
  /** Disables all interaction when true. */
  disable?: boolean;
  /**
   * Maximum number of page-number buttons to display at once.
   * The window is centred around the current page.
   * @default 5
   */
  maxPages?: number;
}

export interface PaginationEmits {
  /** Emitted with the new page number when the user navigates. */
  (e: "update:modelValue", page: number): void;
}
