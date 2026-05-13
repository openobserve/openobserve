// Copyright 2026 OpenObserve Inc.

import type { PrimitiveProps } from "reka-ui";

export interface PageProps extends PrimitiveProps {
  /** HTML element to render. Defaults to "div". */
  as?: string;
}

export interface PageEmits {
  // Reserved for future use
}

export interface PageSlots {
  default?: () => unknown;
}
