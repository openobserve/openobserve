// Copyright 2026 OpenObserve Inc.

export interface OVirtualScrollProps<T = any> {
  /** The full array of items to virtualize. */
  items: T[];

  /**
   * Estimated height of each item in pixels.
   * Used for initial layout. More accurate values improve scroll thumb behaviour.
   * @default 40
   */
  estimateSize?: number;

  /**
   * Number of extra items rendered above and below the visible viewport.
   * Higher values reduce blank flashes during fast scrolling at the cost of
   * more DOM nodes.
   * @default 5
   */
  overscan?: number;

  /**
   * External scroll container. When provided, that element's scroll position
   * drives virtualization instead of the component's own container.
   * Pass `null` (or omit) to use the component's internal scroll container.
   */
  scrollTarget?: HTMLElement | null;

  /**
   * CSS height of the internal scroll container.
   * Only used when `scrollTarget` is not set.
   * Accepts any valid CSS value: `"400px"`, `"100%"`, `"50vh"`.
   * When omitted the container grows to fill its parent (height: 100%).
   */
  height?: string;

  /**
   * When true, enables per-element DOM measurement via ResizeObserver so
   * items with variable heights (wrapped text, expandable rows) are
   * tracked correctly. When false (default), all items use estimateSize.
   */
  dynamicRowHeight?: boolean;
}

export interface OVirtualScrollEmits {
  /**
   * Fires when the visible range changes (scroll or resize).
   */
  (
    e: "virtual-scroll",
    payload: {
      startIndex: number;
      endIndex: number;
      visibleStartIndex: number;
      visibleEndIndex: number;
    },
  ): void;
}

export interface OVirtualScrollSlots<T = any> {
  /**
   * Renders one visible item.
   *
   * The wrapper `<div>` is provided by OVirtualScroll — consumers do NOT need
   * to apply any positioning styles.  Just render your item content directly.
   */
  default(props: { item: T; index: number }): any;
}
