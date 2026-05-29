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
    <OTooltip :content="tooltip || label" />
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
@keyframes fx-rail-pulse {
  0%, 100% {
    background: color-mix(in srgb, var(--o2-primary-color) 8%, var(--o2-card-bg-solid));
    border-left-color: color-mix(in srgb, var(--o2-primary-color) 35%, var(--o2-card-bg-solid));
  }
  50% {
    background: color-mix(in srgb, var(--o2-primary-color) 18%, var(--o2-card-bg-solid));
    border-left-color: var(--o2-primary-color);
  }
}

.add-function-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 1.625rem;
  height: 100%;
  padding: 0.5rem 0;
  background: color-mix(in srgb, var(--o2-primary-color) 8%, var(--o2-card-bg-solid));
  border: 0;
  border-left: 0.125rem solid color-mix(in srgb, var(--o2-primary-color) 35%, var(--o2-card-bg-solid));
  cursor: pointer;
  color: var(--o2-text-secondary);
  animation: fx-rail-pulse 2.4s ease-in-out infinite;
  transition: background-color 0.15s ease, color 0.15s ease, border-left-color 0.15s ease;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--o2-primary-color) 22%, var(--o2-card-bg-solid));
    border-left-color: var(--o2-primary-color);
    animation: none;
    color: var(--o2-primary-color);
  }

  &:hover:not(:disabled) .add-function-rail__icon {
    color: var(--o2-primary-color);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    animation: none;
  }

  &__icon {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-base);
    font-style: italic;
    font-weight: var(--font-bold);
    line-height: 1;
    color: var(--o2-primary-color);
  }
}
</style>
