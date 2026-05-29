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
  <div
    class="query-editor-footer"
    :class="{ 'query-editor-footer--compact': compact }"
    :data-test="dataTest"
  >
    <div class="query-editor-footer__left">
      <slot name="left" />
    </div>
    <div class="query-editor-footer__right">
      <slot name="right" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  compact?: boolean
  dataTest?: string
}>()
</script>

<style scoped lang="scss">
.query-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0 0.5rem;
  background: var(--o2-section-header-bg);
  border-top: 0.0625rem solid var(--o2-border);
  height: 2rem; /* fixed 32px — identical on both query and function panes */
  flex-shrink: 0;

  &--compact {
    height: 2rem;
    padding: 0 0.5rem;
  }

  &__left,
  &__right {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
  }

  &__left {
    flex: 1 1 auto;
    overflow: hidden;
  }

  &__right {
    flex: 0 0 auto;
  }
}
</style>
