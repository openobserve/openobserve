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

<!--
ChunkedContent Component
========================
Displays large content progressively with "load more" functionality.
Allows users to load additional chunks of data on demand.

Features:
- Progressive loading of content in configurable chunks (default: 50KB)
- "Load more" button to fetch additional chunks
- Shows loaded vs total size information
- Integrates with LogsHighLighting for syntax highlighting
- Prevents UI freeze for very large log fields

Usage:
- <ChunkedContent :data="value" :field-key="'field_name'" :query-string="highlightQuery" />
-->
<template>
  <div class="chunked-content">
    <!-- Display the visible content with highlighting -->
    <LogsHighLighting
      :data="visibleContent"
      :show-braces="false"
      :query-string="queryString"
      :simple-mode="simpleMode"
    />

    <!-- Load more button and info -->
    <div
      v-if="shouldShowLoadMore"
      class="load-more-container tw-mt-2 tw-flex tw-items-center tw-gap-3"
    >
      <q-btn
        :data-test="`load-more-btn-${fieldKey}`"
        size="sm"
        no-caps
        outline
        color="primary"
        icon="expand_more"
        :label="`Load more (${chunkInfo.loadedSizeKB}KB / ${chunkInfo.totalSizeKB}KB)`"
        @click="handleLoadMore"
        class="load-more-btn"
      />
      <span class="tw-text-sm tw-font-medium" style="color: var(--q-primary)">
        Showing chunk {{ chunkInfo.currentChunk }} of {{ chunkInfo.totalChunks }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useChunkedContent } from "@/composables/useChunkedContent";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";

export interface ChunkedContentProps {
  data: any;
  fieldKey: string; // Unique key to identify this field's chunk state
  queryString?: string;
  simpleMode?: boolean;
  chunkSizeKB?: number; // Optional: override default chunk size
}

const props = withDefaults(defineProps<ChunkedContentProps>(), {
  queryString: "",
  simpleMode: false,
  chunkSizeKB: 50, // Default 50KB chunks
});

const {
  initializeChunk,
  getVisibleContent,
  loadNextChunk,
  hasMoreChunks,
  getChunkInfo,
  needsChunking,
} = useChunkedContent();

// Convert data to string for chunking
const contentString = computed(() => {
  if (props.data === null || props.data === undefined) {
    return "";
  }

  if (typeof props.data === "string") {
    return props.data;
  }

  if (typeof props.data === "object") {
    return JSON.stringify(props.data);
  }

  return String(props.data);
});

// Get chunk size in bytes
const chunkSizeBytes = computed(() => props.chunkSizeKB * 1024);

// Initialize chunk state when component mounts or data changes
const initializeIfNeeded = () => {
  const content = contentString.value;

  if (needsChunking(content, chunkSizeBytes.value)) {
    initializeChunk(props.fieldKey, content, chunkSizeBytes.value);
  }
};

onMounted(() => {
  initializeIfNeeded();
});

watch(
  () => props.data,
  () => {
    initializeIfNeeded();
  },
  { deep: true }
);

// Get visible content for current chunk state
const visibleContent = computed(() => {
  const content = contentString.value;

  // If content doesn't need chunking, show it all
  if (!needsChunking(content, chunkSizeBytes.value)) {
    return props.data;
  }

  // Get the visible portion based on current chunk index
  const visible = getVisibleContent(props.fieldKey);

  // If visible content is a JSON string, parse it back for highlighting
  if (typeof props.data === "object") {
    try {
      // For objects, return truncated JSON string for display
      return visible;
    } catch (e) {
      return visible;
    }
  }

  return visible;
});

// Check if we should show the "load more" button
const shouldShowLoadMore = computed(() => {
  return hasMoreChunks(props.fieldKey);
});

// Get chunk information for display
const chunkInfo = computed(() => {
  return getChunkInfo(props.fieldKey);
});

// Handle load more button click
const handleLoadMore = () => {
  loadNextChunk(props.fieldKey);
};
</script>

<style scoped>
.chunked-content {
  display: inline-block;
  width: 100%;
}

.load-more-container {
  padding-top: 8px;
  border-top: 1px solid var(--o2-border-color);
}

.load-more-btn {
  font-size: 13px;
  padding: 4px 8px;
}
</style>
