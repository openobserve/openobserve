export interface ToggleGroupProps {
  /** Accessible label for the group */
  label?: string
  /** Currently selected value (controlled) */
  modelValue?: string
}

export interface ToggleGroupEmits {
  (e: 'update:modelValue', value: string): void
}

export interface ToggleGroupItemProps {
  /** The value this item represents */
  value: string
  /** Disables the item */
  disabled?: boolean
}
