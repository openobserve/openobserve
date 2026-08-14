// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";

export interface WildcardDisplayValue {
  value: string;
  count: number;
}

interface HoveredToken {
  token: string;
  displayValues: WildcardDisplayValue[];
  anchorEl: HTMLElement | null;
}

// Module-level singleton — one popover visible at a time, shared across
// PatternCard and PatternDetailsDialog.
const hoveredToken = ref<HoveredToken | null>(null);
let showTimeout: ReturnType<typeof setTimeout> | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

const SHOW_DELAY_MS = 350; // wait until pointer settles before opening
const HIDE_DELAY_MS = 200; // grace period to move into the popover

function normalizeSampleValues(raw: any[]): WildcardDisplayValue[] {
  return raw.map((item) => {
    if (typeof item === "string") {
      return { value: item, count: 0 };
    }
    return {
      value: item?.value ?? String(item),
      count: item?.count ?? 0,
    };
  });
}

export default function useWildcardHover() {
  function onMouseEnter(token: string, sampleValues: any[], event: MouseEvent) {
    // Cancel any pending hide
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    // Cancel any previous pending show (pointer moved to a different chip)
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
    const anchorEl = event.currentTarget as HTMLElement;
    // Only open after the pointer has settled for SHOW_DELAY_MS
    showTimeout = setTimeout(() => {
      hoveredToken.value = {
        token,
        displayValues: normalizeSampleValues(sampleValues),
        anchorEl,
      };
      showTimeout = null;
    }, SHOW_DELAY_MS);
  }

  function onMouseLeave() {
    // Cancel pending show — pointer left before the delay fired
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
    hideTimeout = setTimeout(() => {
      hoveredToken.value = null;
    }, HIDE_DELAY_MS);
  }

  function onPopoverEnter() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }

  function onPopoverLeave() {
    hideTimeout = setTimeout(() => {
      hoveredToken.value = null;
    }, HIDE_DELAY_MS);
  }

  return {
    hoveredToken,
    onMouseEnter,
    onMouseLeave,
    onPopoverEnter,
    onPopoverLeave,
  };
}
