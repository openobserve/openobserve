// Copyright 2026 OpenObserve Inc.

import type { StyleValue } from "vue";

export interface OSplitterProps {
  modelValue: number;
  horizontal?: boolean;
  limits?: [number, number];
  unit?: "px" | "%";
  disable?: boolean;
  separator?: boolean;
  separatorClass?: string;
  separatorStyle?: StyleValue;
  beforeClass?: string;
}

export interface OSplitterEmits {
  "update:modelValue": [value: number];
}
