// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";
import type { WildcardTopValue } from "@/composables/useLogs/useTemplateTokenizer";

interface HoveredToken {
  token: string;
  topValues: WildcardTopValue[];
  anchorEl: HTMLElement | null;
}

const hoveredToken = ref<HoveredToken | null>(null);
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

export default function useWildcardHover() {
  function onMouseEnter(
    token: string,
    topValues: WildcardTopValue[],
    event: MouseEvent,
  ) {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    hoveredToken.value = {
      token,
      topValues,
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
