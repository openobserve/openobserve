<script setup lang="ts">
import type { SeparatorProps } from './Separator.types'
import { computed } from 'vue'

const props = withDefaults(defineProps<SeparatorProps>(), {
  vertical: false,
  inset: false,
  spaced: false,
  color: 'default',
})

const classes = computed<string[]>(() => {
  const base = props.vertical
    ? [
        'tw:block tw:self-stretch',
        'tw:w-separator tw:min-h-0',
        'tw:border-0 tw:bg-separator',
      ]
    : [
        'tw:block tw:w-full',
        'tw:h-separator',
        'tw:border-0 tw:bg-separator',
      ]

  const colorOverride =
    props.color !== 'default'
      ? props.color === 'strong'
        ? 'tw:bg-separator-strong'
        : '' // arbitrary custom color handled inline via CSS var
      : ''

  const inset = props.inset
    ? props.vertical
      ? 'tw:my-2'        // vertical inset: top/bottom margin
      : 'tw:mx-4'        // horizontal inset: left/right margin
    : ''

  const spaced = props.spaced
    ? props.vertical
      ? 'tw:mx-2'
      : 'tw:my-2'
    : ''

  return [...base, colorOverride, inset, spaced].filter(Boolean)
})

/**
 * When a non-standard color token name is passed (e.g. "blue" from legacy
 * Quasar usage), map it to the closest semantic token. This is the bridge
 * between legacy q-separator[color="..."] and our token system.
 */
const LEGACY_COLOR_MAP: Record<string, string> = {
  primary: 'var(--color-primary-600)',
  blue:    'var(--color-primary-600)',
  grey:    'var(--color-grey-300)',
  gray:    'var(--color-grey-300)',
  dark:    'var(--color-grey-700)',
  white:   'var(--color-white)',
}

const inlineStyle = computed<Record<string, string> | undefined>(() => {
  if (!props.color || props.color === 'default' || props.color === 'strong') {
    return undefined
  }
  const mapped = LEGACY_COLOR_MAP[props.color]
  if (mapped) {
    return { backgroundColor: mapped }
  }
  // Pass through raw token references like "primary-400" → var(--color-primary-400)
  if (/^[a-z]+-\d+$/.test(props.color)) {
    return { backgroundColor: `var(--color-${props.color})` }
  }
  return undefined
})
</script>

<template>
  <div
    role="separator"
    :aria-orientation="vertical ? 'vertical' : 'horizontal'"
    :class="classes"
    :style="inlineStyle"
  />
</template>
