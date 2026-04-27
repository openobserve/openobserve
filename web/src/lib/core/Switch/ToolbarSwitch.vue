<script setup lang="ts">
withDefaults(defineProps<{
  checked: boolean
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{ 'update:checked': [value: boolean] }>()
</script>

<template>
  <!--
    Binary toolbar toggle sized to match the Run Query button (h-[30px]).
    Active state uses the same --o2-primary-btn-bg / --o2-primary-btn-text
    theme CSS variables so it respects Settings > Manage Theme.
  -->
  <button
    type="button"
    role="switch"
    :aria-checked="checked"
    :disabled="disabled"
    :class="[
      'toolbar-switch',
      'tw:inline-flex tw:items-center tw:gap-1.5',
      'tw:h-[26px] tw:px-2.5 tw:text-[11px] tw:font-medium tw:rounded-[5px]',
      'tw:whitespace-nowrap tw:transition-colors tw:duration-150',
      'tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-primary-500/40',
      checked ? 'toolbar-switch--on' : 'toolbar-switch--off',
      disabled && 'tw:opacity-50 tw:cursor-not-allowed',
      !disabled && 'tw:cursor-pointer',
    ]"
    @click="!disabled && emit('update:checked', !checked)"
  >
    <slot />
  </button>
</template>

<style scoped>
.toolbar-switch--on {
  background-color: var(--o2-primary-btn-bg);
  color: var(--o2-primary-btn-text);
  border: 1px solid transparent;
}
.toolbar-switch--off {
  background-color: transparent;
  color: var(--o2-tab-text-color, #374151);
  border: 1px solid transparent;
}
.toolbar-switch--off:hover {
  background-color: var(--o2-border-color, rgba(0, 0, 0, 0.08));
}
</style>
