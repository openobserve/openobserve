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

const hoveredToken = ref<HoveredToken | null>(null);
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

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
  function onMouseEnter(
    token: string,
    sampleValues: any[],
    event: MouseEvent,
  ) {
    console.log("[useWildcardHover] onMouseEnter", {
      token,
      sampleValues,
      sampleValuesType: typeof sampleValues[0],
      currentTarget: event.currentTarget,
    });
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    hoveredToken.value = {
      token,
      displayValues: normalizeSampleValues(sampleValues),
      anchorEl: event.currentTarget as HTMLElement,
    };
  }

  function onMouseLeave() {
    hideTimeout = setTimeout(() => {
      hoveredToken.value = null;
    }, 200);
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
    }, 200);
  }

  return {
    hoveredToken,
    onMouseEnter,
    onMouseLeave,
    onPopoverEnter,
    onPopoverLeave,
  };
}
