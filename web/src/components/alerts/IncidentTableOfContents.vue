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
  <div data-test="toc-container" class="flex h-full flex-col overflow-hidden px-2 pt-4 pb-2">
    <div
      data-test="toc-section-container"
      class="border-card-glass-border rounded-default flex flex-1 flex-col overflow-hidden border"
    >
      <!-- Header -->
      <div
        data-test="toc-header"
        class="border-border-default flex flex-shrink-0 items-center gap-2 border-b !bg-[var(--color-theme-table-header-bg)] px-3 py-2"
      >
        <OIcon
          data-test="toc-header-icon"
          name="format-list-bulleted"
          size="sm"
          class="opacity-80"
        />
        <span data-test="toc-header-title" class="text-text-body text-xs font-semibold">
          Table of Contents
        </span>
      </div>

      <!-- Content -->
      <div data-test="toc-content" class="flex-1 overflow-auto p-3">
        <!-- Table of Contents -->
        <div
          v-if="tableOfContents.length === 0"
          data-test="toc-empty-state"
          class="text-text-secondary text-xs italic"
        >
          No sections available
        </div>
        <div v-else class="space-y-1">
          <!-- TOC Items -->
          <template v-for="item in tableOfContents" :key="item.id">
            <div :data-test="`toc-level1-item-${item.id}`">
              <!-- Level 1 Item -->
              <div
                :data-test="`toc-level1-content-${item.id}`"
                class="rounded-default text-text-heading flex items-center gap-2 px-2 py-1.5 transition-colors"
              >
                <!-- Icon on the left -->
                <OIcon
                  :data-test="`toc-level1-icon-${item.id}`"
                  :name="item.children.length > 0 ? 'folder' : 'article'"
                  size="sm"
                  class="flex-shrink-0 opacity-60"
                />
                <!-- Text in the middle - clickable to scroll -->
                <span
                  :data-test="`toc-level1-text-${item.id}`"
                  @click="$emit('scroll-to-section', item.id)"
                  class="hover:text-text-link-hover flex-1 cursor-pointer truncate text-xs font-medium"
                  >{{ item.text }}</span
                >
                <!-- Expand button on the right (only for items with children) -->
                <OButton
                  v-if="item.children.length > 0"
                  :data-test="`toc-level1-expand-btn-${item.id}`"
                  variant="ghost"
                  size="icon-xs-circle"
                  @click="$emit('toggle-section', item, $event)"
                  class="flex-shrink-0"
                >
                  <OIcon
                    :name="expandedSections[item.id] ? 'expand-more' : 'chevron-right'"
                    size="sm"
                  />
                  <OTooltip
                    :content="expandedSections[item.id] ? 'Collapse' : 'Expand'"
                    side="top"
                  />
                </OButton>
              </div>

              <!-- Level 2 Children -->
              <div
                v-if="expandedSections[item.id] && item.children.length > 0"
                :data-test="`toc-level2-container-${item.id}`"
                class="mt-1 ml-4 space-y-1"
              >
                <template v-for="child in item.children" :key="child.id">
                  <div :data-test="`toc-level2-item-${child.id}`">
                    <!-- Level 2 Item -->
                    <div
                      :data-test="`toc-level2-content-${child.id}`"
                      class="rounded-default text-text-body flex items-center gap-2 px-2 py-1 transition-colors"
                    >
                      <!-- Icon on the left -->
                      <OIcon
                        :data-test="`toc-level2-icon-${child.id}`"
                        name="label"
                        size="xs"
                        class="flex-shrink-0 opacity-60"
                      />
                      <!-- Text in the middle - clickable to scroll -->
                      <span
                        :data-test="`toc-level2-text-${child.id}`"
                        @click="$emit('scroll-to-section', child.id)"
                        class="hover:text-text-link-hover flex-1 cursor-pointer truncate text-xs"
                        >{{ child.text }}</span
                      >
                      <!-- Expand button on the right (only for items with children) -->
                      <OButton
                        v-if="child.children.length > 0"
                        :data-test="`toc-level2-expand-btn-${child.id}`"
                        variant="ghost"
                        size="icon-xs-circle"
                        @click="$emit('toggle-section', child, $event)"
                        class="flex-shrink-0"
                      >
                        <OIcon
                          :name="expandedSections[child.id] ? 'expand-more' : 'chevron-right'"
                          size="sm"
                        />
                        <OTooltip
                          :content="expandedSections[child.id] ? 'Collapse' : 'Expand'"
                          side="top"
                        />
                      </OButton>
                    </div>

                    <!-- Level 3 Children -->
                    <div
                      v-if="expandedSections[child.id] && child.children.length > 0"
                      :data-test="`toc-level3-container-${child.id}`"
                      class="mt-1 ml-4 space-y-1"
                    >
                      <div
                        v-for="grandchild in child.children"
                        :key="grandchild.id"
                        :data-test="`toc-level3-item-${grandchild.id}`"
                        @click="$emit('scroll-to-section', grandchild.id)"
                        class="rounded-default text-text-secondary hover:bg-surface-subtle-hover flex cursor-pointer items-center gap-2 px-2 py-1 transition-colors"
                      >
                        <OIcon
                          :data-test="`toc-level3-icon-${grandchild.id}`"
                          name="fiber-manual-record"
                          size="xs"
                          class="opacity-60"
                        />
                        <span
                          :data-test="`toc-level3-text-${grandchild.id}`"
                          class="text-2xs truncate"
                          >{{ grandchild.text }}</span
                        >
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

interface TocItem {
  id: string;
  text: string;
  level: number;
  children: TocItem[];
  expanded: boolean;
}

export default defineComponent({
  name: "IncidentTableOfContents",
  components: { OButton, OIcon, OTooltip },
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
  emits: ["scroll-to-section", "toggle-section"],
});
</script>
