<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="tw:px-2 tw:pt-4 tw:pb-2 tw:flex tw:flex-col tw:h-full tw:overflow-hidden">
    <div
      class="section-container tw:overflow-hidden tw:flex tw:flex-col tw:flex-1"
    >
      <!-- Header -->
      <div
        :class="[
          'section-header-bg tw:px-3 tw:py-2 tw:flex tw:items-center tw:gap-2 tw:border-b tw:flex-shrink-0',
          isDarkMode
            ? 'tw:border-gray-700'
            : 'tw:border-gray-200'
        ]"
      >
        <q-icon name="format_list_bulleted" size="16px" class="tw:opacity-80" />
        <span :class="isDarkMode ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-xs tw:font-semibold">
          Table of Contents
        </span>
      </div>

      <!-- Content -->
      <div class="tw:p-3 tw:flex-1 tw:overflow-auto">
        <!-- Table of Contents -->
        <div v-if="tableOfContents.length === 0" :class="isDarkMode ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:text-xs tw:italic">
          No sections available
        </div>
        <div v-else class="tw:space-y-1">
          <!-- TOC Items -->
          <template v-for="item in tableOfContents" :key="item.id">
            <div>
              <!-- Level 1 Item -->
              <div
                :class="[
                  'tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1.5 tw:rounded tw:transition-colors',
                  isDarkMode
                    ? 'tw:text-gray-200'
                    : 'tw:text-gray-900'
                ]"
              >
                <!-- Icon on the left -->
                <q-icon
                  :name="item.children.length > 0 ? 'folder' : 'article'"
                  size="14px"
                  class="tw:opacity-60 tw:flex-shrink-0"
                />
                <!-- Text in the middle - clickable to scroll -->
                <span
                  @click="$emit('scroll-to-section', item.id)"
                  :class="[
                    'tw:text-xs tw:font-medium tw:truncate tw:flex-1 tw:cursor-pointer',
                    isDarkMode
                      ? 'hover:tw:text-blue-400'
                      : 'hover:tw:text-blue-600'
                  ]"
                >{{ item.text }}</span>
                <!-- Expand button on the right (only for items with children) -->
                <q-btn
                  v-if="item.children.length > 0"
                  flat
                  dense
                  round
                  size="xs"
                  :icon="expandedSections[item.id] ? 'expand_more' : 'chevron_right'"
                  @click="$emit('toggle-section', item, $event)"
                  class="tw:flex-shrink-0"
                >
                  <q-tooltip :delay="500">{{ expandedSections[item.id] ? 'Collapse' : 'Expand' }}</q-tooltip>
                </q-btn>
              </div>

              <!-- Level 2 Children -->
              <div v-if="expandedSections[item.id] && item.children.length > 0" class="tw:ml-4 tw:space-y-1 tw:mt-1">
                <template v-for="child in item.children" :key="child.id">
                  <div>
                    <!-- Level 2 Item -->
                    <div
                      :class="[
                        'tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1 tw:rounded tw:transition-colors',
                        isDarkMode
                          ? 'tw:text-gray-300'
                          : 'tw:text-gray-700'
                      ]"
                    >
                      <!-- Icon on the left -->
                      <q-icon
                        name="label"
                        size="12px"
                        class="tw:opacity-60 tw:flex-shrink-0"
                      />
                      <!-- Text in the middle - clickable to scroll -->
                      <span
                        @click="$emit('scroll-to-section', child.id)"
                        :class="[
                          'tw:text-xs tw:truncate tw:flex-1 tw:cursor-pointer',
                          isDarkMode
                            ? 'hover:tw:text-blue-400'
                            : 'hover:tw:text-blue-600'
                        ]"
                      >{{ child.text }}</span>
                      <!-- Expand button on the right (only for items with children) -->
                      <q-btn
                        v-if="child.children.length > 0"
                        flat
                        dense
                        round
                        size="xs"
                        :icon="expandedSections[child.id] ? 'expand_more' : 'chevron_right'"
                        @click="$emit('toggle-section', child, $event)"
                        class="tw:flex-shrink-0"
                      >
                        <q-tooltip :delay="500">{{ expandedSections[child.id] ? 'Collapse' : 'Expand' }}</q-tooltip>
                      </q-btn>
                    </div>

                    <!-- Level 3 Children -->
                    <div v-if="expandedSections[child.id] && child.children.length > 0" class="tw:ml-4 tw:space-y-1 tw:mt-1">
                      <div
                        v-for="grandchild in child.children"
                        :key="grandchild.id"
                        @click="$emit('scroll-to-section', grandchild.id)"
                        :class="[
                          'tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1 tw:rounded tw:cursor-pointer tw:transition-colors',
                          isDarkMode
                            ? 'hover:tw:bg-gray-700 tw:text-gray-400'
                            : 'hover:tw:bg-blue-50 tw:text-gray-600'
                        ]"
                      >
                        <q-icon name="fiber_manual_record" size="8px" class="tw:opacity-60" />
                        <span class="tw:text-[11px] tw:truncate">{{ grandchild.text }}</span>
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

interface TocItem {
  id: string;
  text: string;
  level: number;
  children: TocItem[];
  expanded: boolean;
}

export default defineComponent({
  name: "IncidentTableOfContents",
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

<style lang="scss" scoped>
.section-header-bg {
  background: var(--o2-table-header-bg) !important;
}

.section-container {
  border: 0.0625rem solid var(--o2-border-color);
  border-radius: 0.375rem;
}
</style>
