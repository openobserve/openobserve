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
        <q-icon name="search" class="palette-search-icon" />
        <input
          ref="inputRef"
          v-model="query"
          class="palette-input"
          :placeholder="t('commandPalette.placeholder')"
          autocomplete="off"
          spellcheck="false"
          data-test="command-palette-input"
        />
        <div v-if="isSearching" class="palette-spinner">
          <q-spinner-dots size="1rem" color="grey-6" />
        </div>
        <kbd v-else class="palette-esc-hint">Esc</kbd>
      </div>

      <!-- Slash command hint -->
      <div
        v-if="activeSlashCommand && !extractAiPrompt(query)"
        class="palette-slash-hint"
        data-test="command-palette-slash-hint"
      >
        <q-icon name="psychology" size="0.875rem" />
        <span>{{ activeSlashCommand.description }}</span>
      </div>

      <!-- Divider -->
      <div v-if="hasResults || !query.trim()" class="palette-divider" />

      <!-- Results -->
      <!-- eslint-disable-next-line vue/max-attributes-per-line -->
      <div v-if="hasResults" class="palette-results" role="listbox">
        <template v-for="group in groupedResults" :key="group.label">
          <div class="palette-section-label">{{ group.label }}</div>
          <div
            v-for="item in group.items"
            :key="item.type + '-' + item.name"
            class="palette-result-item"
            :class="{ 'is-active': getGlobalIndex(group.items, item) === activeIndex }"
            role="option"
            :aria-selected="getGlobalIndex(group.items, item) === activeIndex"
            data-test="command-palette-result-item"
            @mouseenter="activeIndex = getGlobalIndex(group.items, item)"
            @click="navigateTo(item)"
          >
            <q-icon
              :name="item.icon"
              class="palette-item-icon"
              :class="{ 'palette-item-icon--ai': item.type === 'ai_action' }"
            />
            <span class="palette-item-title">{{ item.title }}</span>
            <span
              v-if="item.type === 'command'"
              class="palette-item-badge"
            >/</span>
            <span v-else-if="item.path" class="palette-item-path">{{ item.path }}</span>
          </div>
        </template>
      </div>

      <!-- Loading state -->
      <div
        v-else-if="isSearching"
        class="palette-status"
        data-test="command-palette-loading"
      >
        Searching entities…
      </div>

      <!-- Empty state: query entered but no match -->
      <div
        v-else-if="query.trim()"
        class="palette-empty"
        data-test="command-palette-empty"
      >
        No results found for "{{ query }}"
      </div>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import useCommandPalette, {
  extractAiPrompt,
} from "@/composables/useCommandPalette";
import type { PaletteItem } from "@/composables/useCommandPalette";

const { t } = useI18n();
const inputRef = ref<HTMLInputElement | null>(null);

const {
  query,
  activeIndex,
  recentPages,
  visibleItems,
  groupedResults,
  hasResults,
  isDefaultView,
  isOpen,
  isSearching,
  activeSlashCommand,
  close,
  moveUp,
  moveDown,
  resetActiveIndex,
  navigateTo,
  navigateSelected,
} = useCommandPalette();

/** Compute the global index of an item within visibleItems for keyboard nav */
function getGlobalIndex(groupItems: PaletteItem[], target: PaletteItem): number {
  let offset = 0;
  for (const group of groupedResults.value) {
    for (const item of group.items) {
      if (item === target) return offset;
      offset++;
    }
  }
  return 0;
}

const defaultPageItems = computed(() => {
  if (!isDefaultView.value) return [];
  const recentNames = new Set(recentPages.value.map((r) => r.name));
  return visibleItems.value.filter((item) => !recentNames.has(item.name));
});

watch(isOpen, async (val) => {
  if (val) {
    query.value = "";
    resetActiveIndex();
    await nextTick();
    inputRef.value?.focus();
  }
});
</script>

<style lang="scss" scoped>
.palette-container {
  width: min(42rem, 92vw);
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
  font-size: 1.25rem;
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

.palette-spinner {
  display: flex;
  align-items: center;
  flex-shrink: 0;
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

.palette-slash-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 1rem 0.5rem;
  font-size: 0.8rem;
  color: var(--o2-text-secondary);
}

.palette-divider {
  height: 1px;
  background: var(--o2-border);
}

.palette-results {
  max-height: 24rem;
  overflow-y: auto;
  padding: 0.375rem 0 0.5rem;
}

.palette-section-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--o2-text-muted);
  padding: 0.5rem 1rem 0.25rem;
}

.palette-result-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.45rem 1rem;
  cursor: pointer;
  transition: background 0.1s;

  &:hover,
  &.is-active {
    background: var(--o2-hover-accent);
  }
}

.palette-item-icon {
  color: var(--o2-text-muted);
  flex-shrink: 0;
  font-size: 1.1rem;

  &--ai {
    color: var(--o2-primary-color);
  }
}

.palette-item-title {
  flex: 1;
  font-size: 0.875rem;
  color: var(--o2-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item-path {
  font-size: 0.75rem;
  color: var(--o2-text-muted);
  flex-shrink: 0;
  font-family: monospace;
  opacity: 0.8;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-item-badge {
  font-size: 0.7rem;
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  background: var(--o2-primary-color);
  color: #fff;
  font-weight: 600;
}

.palette-status {
  padding: 1.5rem 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--o2-text-muted);
}

.palette-empty {
  padding: 1.5rem 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--o2-text-muted);
}
</style>
