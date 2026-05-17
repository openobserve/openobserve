// Copyright 2026 OpenObserve Inc.

export interface OSplitterProps {
  modelValue: number
  horizontal?: boolean
  limits?: [number, number]
  unit?: 'px' | '%'
  disable?: boolean
  separator?: boolean
  separatorClass?: string
  separatorStyle?: object
}

export interface OSplitterEmits {
  'update:modelValue': [value: number]
}
