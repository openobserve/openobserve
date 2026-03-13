/**
 * Chunked Content Loading Composable
 * ===================================
 *
 * Manages progressive loading of large content in chunks.
 * Used for "load more" functionality in log detail views.
 */

import { ref, computed } from "vue";

interface ChunkState {
  [fieldKey: string]: {
    currentChunkIndex: number;
    totalChunks: number;
    fullContent: string;
    chunkSize: number;
  };
}

const CHUNK_SIZE_KB = 50; // Default chunk size in KB
const CHUNK_SIZE_BYTES = CHUNK_SIZE_KB * 1024;

export function useChunkedContent() {
  const chunkStates = ref<ChunkState>({});

  /**
   * Initializes chunk state for a field
   */
  const initializeChunk = (
    fieldKey: string,
    content: string,
    chunkSizeBytes: number = CHUNK_SIZE_BYTES
  ) => {
    const contentLength = content.length;
    const totalChunks = Math.ceil(contentLength / chunkSizeBytes);

    chunkStates.value[fieldKey] = {
      currentChunkIndex: 0, // Start with first chunk (index 0)
      totalChunks,
      fullContent: content,
      chunkSize: chunkSizeBytes,
    };
  };

  /**
   * Gets the current visible content for a field
   */
  const getVisibleContent = (fieldKey: string): string => {
    const state = chunkStates.value[fieldKey];
    if (!state) return "";

    const endIndex = (state.currentChunkIndex + 1) * state.chunkSize;
    return state.fullContent.substring(0, endIndex);
  };

  /**
   * Loads the next chunk for a field
   */
  const loadNextChunk = (fieldKey: string) => {
    const state = chunkStates.value[fieldKey];
    if (!state) return;

    if (state.currentChunkIndex < state.totalChunks - 1) {
      state.currentChunkIndex++;
    }
  };

  /**
   * Checks if there are more chunks to load
   */
  const hasMoreChunks = (fieldKey: string): boolean => {
    const state = chunkStates.value[fieldKey];
    if (!state) return false;

    return state.currentChunkIndex < state.totalChunks - 1;
  };

  /**
   * Gets chunk info for display
   */
  const getChunkInfo = (fieldKey: string) => {
    const state = chunkStates.value[fieldKey];
    if (!state) {
      return {
        currentChunk: 0,
        totalChunks: 0,
        loadedSizeKB: 0,
        totalSizeKB: 0,
      };
    }

    const loadedSize = Math.min(
      (state.currentChunkIndex + 1) * state.chunkSize,
      state.fullContent.length
    );

    return {
      currentChunk: state.currentChunkIndex + 1,
      totalChunks: state.totalChunks,
      loadedSizeKB: Math.round(loadedSize / 1024),
      totalSizeKB: Math.round(state.fullContent.length / 1024),
    };
  };

  /**
   * Resets all chunk states
   */
  const resetChunks = () => {
    chunkStates.value = {};
  };

  /**
   * Resets chunk state for a specific field
   */
  const resetChunk = (fieldKey: string) => {
    if (chunkStates.value[fieldKey]) {
      delete chunkStates.value[fieldKey];
    }
  };

  /**
   * Checks if content needs chunking
   */
  const needsChunking = (content: string, threshold: number = CHUNK_SIZE_BYTES): boolean => {
    return content.length > threshold;
  };

  return {
    chunkStates,
    initializeChunk,
    getVisibleContent,
    loadNextChunk,
    hasMoreChunks,
    getChunkInfo,
    resetChunks,
    resetChunk,
    needsChunking,
    CHUNK_SIZE_KB,
    CHUNK_SIZE_BYTES,
  };
}
