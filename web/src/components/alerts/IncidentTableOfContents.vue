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
  <div data-test="toc-container" class="px-2 pt-4 pb-2 flex flex-col h-full overflow-hidden">
    <div
      data-test="toc-section-container"
      class="overflow-hidden flex flex-col flex-1 border border-[var(--o2-border-color)] rounded-md"
    >
      <!-- Header -->
      <div
        data-test="toc-header"
        :class="[
          'px-3 py-2 flex items-center gap-2 border-b flex-shrink-0 !bg-[var(--o2-table-header-bg)]',
          isDarkMode
            ? 'border-gray-700'
            : 'border-gray-200'
        ]"
      >
        <OIcon data-test="toc-header-icon" name="format-list-bulleted" size="sm" class="opacity-80" />
        <span data-test="toc-header-title" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'" class="text-xs font-semibold">
          Table of Contents
        </span>
      </div>

      <!-- Content -->
      <div data-test="toc-content" class="p-3 flex-1 overflow-auto">
        <!-- Table of Contents -->
        <div v-if="tableOfContents.length === 0" data-test="toc-empty-state" :class="isDarkMode ? 'text-gray-500' : 'text-gray-400'" class="text-xs italic">
          No sections available
        </div>
        <div v-else class="space-y-1">
          <!-- TOC Items -->
          <template v-for="item in tableOfContents" :key="item.id">
            <div :data-test="`toc-level1-item-${item.id}`">
              <!-- Level 1 Item -->
              <div
                :data-test="`toc-level1-content-${item.id}`"
                :class="[
                  'flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
                  isDarkMode
                    ? 'text-gray-200'
                    : 'text-gray-900'
                ]"
              >
                <!-- Icon on the left -->
                <OIcon
                  :data-test="`toc-level1-icon-${item.id}`"
                  :name="item.children.length > 0 ? 'folder' : 'article'"
                  size="sm"
                  class="opacity-60 flex-shrink-0"
                />
                <!-- Text in the middle - clickable to scroll -->
                <span
                  :data-test="`toc-level1-text-${item.id}`"
                  @click="$emit('scroll-to-section', item.id)"
                  :class="[
                    'text-xs font-medium truncate flex-1 cursor-pointer',
                    isDarkMode
                      ? 'hover:text-blue-400'
                      : 'hover:text-blue-600'
                  ]"
                >{{ item.text }}</span>
                <!-- Expand button on the right (only for items with children) -->
                <OButton
                  v-if="item.children.length > 0"
                  :data-test="`toc-level1-expand-btn-${item.id}`"
                  variant="ghost"
                  size="icon-xs-circle"
                  @click="$emit('toggle-section', item, $event)"
                  class="flex-shrink-0"
                >
                  <OIcon :name="expandedSections[item.id] ? 'expand-more' : 'chevron-right'" size="sm" />
                  <OTooltip :content="expandedSections[item.id] ? 'Collapse' : 'Expand'" data-test="toc-expand-tooltip" side="top" />
                </OButton>
              </div>

              <!-- Level 2 Children -->
              <div v-if="expandedSections[item.id] && item.children.length > 0" :data-test="`toc-level2-container-${item.id}`" class="ml-4 space-y-1 mt-1">
                <template v-for="child in item.children" :key="child.id">
                  <div :data-test="`toc-level2-item-${child.id}`">
                    <!-- Level 2 Item -->
                    <div
                      :data-test="`toc-level2-content-${child.id}`"
                      :class="[
                        'flex items-center gap-2 px-2 py-1 rounded transition-colors',
                        isDarkMode
                          ? 'text-gray-300'
                          : 'text-gray-700'
                      ]"
                    >
                      <!-- Icon on the left -->
                      <OIcon
                        :data-test="`toc-level2-icon-${child.id}`"
                        name="label"
                        size="xs"
                        class="opacity-60 flex-shrink-0"
                      />
                      <!-- Text in the middle - clickable to scroll -->
                      <span
                        :data-test="`toc-level2-text-${child.id}`"
                        @click="$emit('scroll-to-section', child.id)"
                        :class="[
                          'text-xs truncate flex-1 cursor-pointer',
                          isDarkMode
                            ? 'hover:text-blue-400'
                            : 'hover:text-blue-600'
                        ]"
                      >{{ child.text }}</span>
                      <!-- Expand button on the right (only for items with children) -->
                      <OButton
                        v-if="child.children.length > 0"
                        :data-test="`toc-level2-expand-btn-${child.id}`"
                        variant="ghost"
                        size="icon-xs-circle"
                        @click="$emit('toggle-section', child, $event)"
                        class="flex-shrink-0"
                      >
                        <OIcon :name="expandedSections[child.id] ? 'expand-more' : 'chevron-right'" size="sm" />
                        <OTooltip :content="expandedSections[child.id] ? 'Collapse' : 'Expand'" data-test="toc-expand-tooltip" side="top" />
                      </OButton>
                    </div>

                    <!-- Level 3 Children -->
                    <div v-if="expandedSections[child.id] && child.children.length > 0" :data-test="`toc-level3-container-${child.id}`" class="ml-4 space-y-1 mt-1">
                      <div
                        v-for="grandchild in child.children"
                        :key="grandchild.id"
                        :data-test="`toc-level3-item-${grandchild.id}`"
                        @click="$emit('scroll-to-section', grandchild.id)"
                        :class="[
                          'flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors',
                          isDarkMode
                            ? 'hover:bg-gray-700 text-gray-400'
                            : 'hover:bg-blue-50 text-gray-600'
                        ]"
                      >
                        <OIcon :data-test="`toc-level3-icon-${grandchild.id}`" name="fiber-manual-record" size="xs" class="opacity-60" />
                        <span :data-test="`toc-level3-text-${grandchild.id}`" class="text-[11px] truncate">{{ grandchild.text }}</span>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

interface TocItem {
  id: string;
  text: string;
  level: number;
  children: TocItem[];
  expanded: boolean;
}

export default defineComponent({
  name: "IncidentTableOfContents",
  components: { OButton,
    OIcon,
},
  props: {
    tableOfContents: {
      type: Array as PropType<TocItem[]>,
      required: true,
    },
    expandedSections: {
      type: Object as PropType<Record<string, boolean>>,
      required: true,
    },
    isDarkMode: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['scroll-to-section', 'toggle-section'],
});
</script>
