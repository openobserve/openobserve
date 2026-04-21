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
  <q-dialog
    v-model="isOpen"
    position="top"
    :no-backdrop-dismiss="false"
    transition-show="slide-down"
    transition-hide="slide-up"
    @hide="close"
    @keydown.up.prevent="moveUp"
    @keydown.down.prevent="moveDown"
    @keydown.enter.prevent="navigateSelected"
    @keydown.escape="close"
  >
    <div class="palette-container">
      <!-- Search input -->
      <div class="palette-input-row">
        <q-icon name="search" class="palette-search-icon" size="1.25rem" />
        <input
          ref="inputRef"
          v-model="query"
          class="palette-input"
          placeholder="Search pages…"
          autocomplete="off"
          spellcheck="false"
          data-test="command-palette-input"
          @input="resetActiveIndex"
        />
        <kbd class="palette-esc-hint">Esc</kbd>
      </div>

      <!-- Divider -->
      <div v-if="hasResults || !query.trim()" class="palette-divider" />

      <!-- Results -->
      <div v-if="hasResults" class="palette-results" role="listbox">
        <!-- Section label -->
        <div class="palette-section-label">
          {{ query.trim() ? "Pages" : "Recent" }}
        </div>

        <div
          v-for="(item, idx) in visibleItems"
          :key="item.name"
          class="palette-result-item"
          :class="{ 'is-active': idx === activeIndex }"
          role="option"
          :aria-selected="idx === activeIndex"
          data-test="command-palette-result-item"
          @mouseenter="activeIndex = idx"
          @click="navigateTo(item)"
        >
          <q-icon :name="item.icon" class="palette-item-icon" size="1.1rem" />
          <span class="palette-item-title">{{ item.title }}</span>
          <span v-if="item.section" class="palette-item-section">
            {{ item.section }}
          </span>
        </div>
      </div>

      <!-- Empty state: query entered but no match -->
      <div
        v-else-if="query.trim()"
        class="palette-empty"
        data-test="command-palette-empty"
      >
        No pages found for "{{ query }}"
      </div>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { nextTick, watch } from "vue";
import { ref } from "vue";
import useCommandPalette from "@/composables/useCommandPalette";

const inputRef = ref<HTMLInputElement | null>(null);

const {
  query,
  activeIndex,
  visibleItems,
  hasResults,
  isOpen,
  close,
  moveUp,
  moveDown,
  resetActiveIndex,
  navigateTo,
  navigateSelected,
} = useCommandPalette();

// Focus input whenever dialog opens
watch(isOpen, async (val) => {
  if (val) {
    await nextTick();
    inputRef.value?.focus();
  }
});
</script>

<style lang="scss" scoped>
.palette-container {
  width: min(38rem, 92vw);
  background: var(--o2-card-background);
  border-radius: 0.625rem;
  box-shadow:
    0 1.25rem 3rem rgba(0, 0, 0, 0.28),
    0 0 0 1px var(--o2-border);
  overflow: hidden;
  margin-top: 5vh;
}

.palette-input-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
}

.palette-search-icon {
  color: var(--o2-text-muted);
  flex-shrink: 0;
}

.palette-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 1rem;
  color: var(--o2-text-primary);
  caret-color: var(--o2-primary-color);

  &::placeholder {
    color: var(--o2-text-muted);
  }
}

.palette-esc-hint {
  font-size: 0.7rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--o2-border);
  border-radius: 0.25rem;
  color: var(--o2-text-muted);
  background: var(--o2-muted-background);
  font-family: inherit;
  flex-shrink: 0;
}

.palette-divider {
  height: 1px;
  background: var(--o2-border);
}

.palette-results {
  max-height: 22rem;
  overflow-y: auto;
  padding: 0.375rem 0 0.5rem;
}

.palette-section-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--o2-text-muted);
  padding: 0.4rem 1rem 0.25rem;
}

.palette-result-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
  border-radius: 0;
  transition: background 0.1s;

  &:hover,
  &.is-active {
    background: var(--o2-hover-accent);
  }
}

.palette-item-icon {
  color: var(--o2-text-muted);
  flex-shrink: 0;
}

.palette-item-title {
  flex: 1;
  font-size: 0.9rem;
  color: var(--o2-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item-section {
  font-size: 0.75rem;
  color: var(--o2-text-muted);
  flex-shrink: 0;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--o2-border);
  border-radius: 0.25rem;
}

.palette-empty {
  padding: 1.5rem 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--o2-text-muted);
}
</style>
