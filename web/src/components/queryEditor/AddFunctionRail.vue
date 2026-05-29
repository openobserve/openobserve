<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <button
    type="button"
    class="add-function-rail"
    :aria-label="label"
    :data-test="dataTest"
    :disabled="disabled"
    @click="emit('open')"
  >
    <span class="add-function-rail__icon" aria-hidden="true">{{ iconText }}</span>
    <span class="add-function-rail__label">{{ label }}</span>
    <OTooltip v-if="tooltip" :content="tooltip" />
  </button>
</template>

<script setup lang="ts">
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue'

withDefaults(
  defineProps<{
    label?: string
    iconText?: string
    tooltip?: string
    disabled?: boolean
    dataTest?: string
  }>(),
  {
    label: 'ADD FUNCTION',
    iconText: 'fx',
    disabled: false,
  },
)

const emit = defineEmits<{
  open: []
}>()
</script>

<style scoped lang="scss">
.add-function-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 1.625rem;
  height: 100%;
  padding: 0.5rem 0;
  background: color-mix(in srgb, var(--o2-primary-color) 6%, transparent);
  border: 0;
  border-left: 0.0625rem solid var(--o2-border);
  cursor: pointer;
  color: var(--o2-text-secondary);
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--o2-primary-color) 14%, transparent);
    color: var(--o2-primary-color);
  }

  &:hover:not(:disabled) .add-function-rail__icon {
    color: var(--o2-primary-color);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &__icon {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-base);
    font-style: italic;
    font-weight: var(--font-bold);
    line-height: 1;
    color: var(--o2-primary-color);
  }

  &__label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 0.6875rem; /* 11px — fits the slim rail but stays readable */
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--o2-text-body);
  }
}
</style>
