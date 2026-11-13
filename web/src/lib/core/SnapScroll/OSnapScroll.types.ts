// Copyright 2026 OpenObserve Inc.

/**
 * OSnapScroll — a vertical scroller that pages between section starts.
 *
 * Children mark sections with `data-snap-section="<id>"` and optional
 * intermediate stops with `data-snap-stop` (a `scroll-margin-top` on a stop
 * keeps it clear of a sticky header). A stop only counts while its
 * section is taller than the scroller. Every section is at least one view
 * tall, so one section fills the view. The wheel and trackpad scroll freely;
 * PageDown/Space moves one stop and Alt+Down/Up a whole section.
 */
export interface OSnapScrollProps {
  /** Scroll in its own box with keyboard paging between stops. When false the content flows and the page scrolls. Default: true */
  snap?: boolean;
  /** Id of the section currently in view (v-model:active). */
  active?: string;
}

export interface OSnapScrollEmits {
  (e: "update:active", id: string): void;
}

export interface OSnapScrollSlots {
  default: () => unknown;
}

export interface OSnapScrollExpose {
  /** Scroll so the section's start is at the top and focus its `[data-snap-heading]`, if any. */
  scrollToSection: (id: string) => void;
  /** Bring a descendant into view without animating: the nearest stop at or above it while snapping, centred otherwise. */
  revealElement: (el: HTMLElement) => void;
  /** Move one stop down (1) or up (-1). */
  pageStop: (direction: 1 | -1) => void;
  /** Move one whole section down (1) or up (-1). */
  pageSection: (direction: 1 | -1) => void;
}
