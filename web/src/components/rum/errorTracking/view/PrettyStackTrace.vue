<!-- Copyright 2023 OpenObserve Inc.

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
  <div>
    <!-- Loading state -->
    <div v-if="isLoadingTranslation" class="loading-container q-pa-xl text-center">
      <q-spinner-dots color="primary" size="3em" />
      <div class="q-mt-md text-grey-7" style="font-size: 14px; font-weight: 500;">
        Translating stack trace with source maps...
      </div>
      <div class="q-mt-xs text-grey-6" style="font-size: 12px;">
        This may take a few moments
      </div>
    </div>

    <!-- No source maps available message -->
    <div v-else-if="allSourceInfoNull" class="no-source-maps-container q-pa-xl text-center">
      <q-icon name="code_off" size="3em" color="grey-6" class="q-mb-md" />
      <div class="text-h6 text-grey-8 q-mb-sm" style="font-weight: 500;">
        Source Maps Not Available
      </div>
      <div class="text-body2 text-grey-6 tw:pb-2" style="max-width: 500px; margin: 0 auto;">
        To view detailed stack traces with original source code and line numbers, please upload source maps for this application.
      </div>
      <q-btn
        unelevated
        no-caps
        color="primary"
        label="Upload Source Maps"
        icon="cloud_upload"
        class="o2-primary-button tw:mt-2"
        @click="navigateToUpload"
      />
    </div>

    <!-- Pretty formatted view -->
    <div v-else-if="translatedStackTrace.length > 0" class="pretty-stack-container">
      <template v-for="(stackTrace, traceIndex) in translatedStackTrace" :key="traceIndex">
        <!-- Error message -->
        <div
          v-if="stackTrace.error"
          class="error-header q-px-md q-py-sm text-weight-bold"
          :style="{
            'background-color': errorHeaderBackground,
            'color': errorHeaderColor,
            'border-color': borderColor,
          }"
        >
          {{ stackTrace.error }}
        </div>

        <!-- First stack frame - expandable/collapsible -->
        <div
          v-if="stackTrace.stack.length > 0"
          class="stack-frame-wrapper"
          :style="{
            'border-top': `1px solid ${borderColor}`,
            'border-bottom': `1px solid ${borderColor}`,
            'border-left': `1px solid ${borderColor}`,
            'border-right': `1px solid ${borderColor}`,
            'border-radius': stackTrace.stack.length === 1 ? '0 0 4px 4px' : '',
            'background-color': backgroundColor,
          }"
        >
          <!-- Frame header - clickable -->
          <div
            class="frame-header q-px-md q-py-sm cursor-pointer"
            @click="toggleFrame(traceIndex, 0)"
          >
            <div class="frame-header-content">
              <q-icon
                :name="isFrameExpanded(traceIndex, 0) ? 'expand_more' : 'chevron_right'"
                size="xs"
                class="q-mr-xs text-grey-7"
              />
              <div
                v-if="stackTrace.stack[0].line"
                class="stack-line-header"
                :style="{ color: textColor }"
              >
                {{ stackTrace.stack[0].line }}
              </div>
            </div>
          </div>

          <!-- Expandable source code context -->
          <div
            v-if="isFrameExpanded(traceIndex, 0) && stackTrace.stack[0].source_info"
            class="source-context q-px-md q-pb-sm"
            :style="{ 'background-color': isDarkMode ? '#0d0d0d' : '#f8f9fa' }"
          >
            <!-- File location -->
            <div class="source-location-header text-grey-7 text-caption q-mb-xs">
              Line {{ stackTrace.stack[0].source_info.stack_line }}:{{ stackTrace.stack[0].source_info.stack_col }}
              <span class="q-ml-xs">
                (Lines {{ stackTrace.stack[0].source_info.source_line_start }}-{{ stackTrace.stack[0].source_info.source_line_end }})
              </span>
            </div>

            <!-- Source code snippet with syntax highlighting -->
            <div class="source-code-box" :style="{ 'border-color': borderColor }">
              <CodeQueryEditor
                :ref="(el: any) => setEditorRef(traceIndex, 0, el)"
                :editor-id="`source-frame-${traceIndex}-0`"
                :query="stackTrace.stack[0].source_info.source"
                :read-only="true"
                language="javascript"
                style="height: 200px;"
              />
            </div>
          </div>
        </div>

        <!-- Remaining frames - collapsed by default -->
        <div
          v-if="stackTrace.stack.length > 1"
          class="remaining-frames"
          :style="{
            'border-bottom': `1px solid ${borderColor}`,
            'border-left': `1px solid ${borderColor}`,
            'border-right': `1px solid ${borderColor}`,
            'border-radius': '0 0 4px 4px',
            'background-color': backgroundColor,
          }"
        >
          <!-- Show more button - only visible when frames are hidden -->
          <div
            v-if="!expandedTraces[traceIndex]"
            class="show-more-button q-px-md q-py-sm cursor-pointer"
            :style="{ 'border-top': `1px solid ${borderColor}` }"
            @click="showFrames(traceIndex)"
          >
            <q-icon
              name="expand_more"
              size="xs"
              class="q-mr-xs"
            />
            <span class="text-caption text-grey-7">
              Show {{ stackTrace.stack.length - 1 }} more frame{{ stackTrace.stack.length - 1 > 1 ? 's' : '' }}
            </span>
          </div>

          <!-- Collapsed frames - shown after clicking show more -->
          <div v-if="expandedTraces[traceIndex]">
            <div
              v-for="(frame, frameIndex) in stackTrace.stack.slice(1)"
              :key="frameIndex + 1"
              class="collapsed-frame-wrapper"
              :style="{ 'border-top': `1px solid ${borderColor}` }"
            >
              <!-- Frame header - clickable -->
              <div
                class="collapsed-frame-header q-px-md q-py-xs cursor-pointer"
                :style="{ 'background-color': backgroundColor }"
                @click="toggleFrame(traceIndex, frameIndex + 1)"
              >
                <div class="collapsed-frame-content">
                  <q-icon
                    :name="isFrameExpanded(traceIndex, frameIndex + 1) ? 'expand_more' : 'chevron_right'"
                    size="xs"
                    class="q-mr-xs text-grey-5"
                  />
                  <div
                    v-if="frame.line"
                    class="stack-line-collapsed"
                    :style="{ color: mutedTextColor }"
                  >
                    {{ frame.line }}
                  </div>
                </div>
              </div>

              <!-- Expandable source code context -->
              <div
                v-if="isFrameExpanded(traceIndex, frameIndex + 1) && frame.source_info"
                class="source-context q-px-md q-pb-sm q-pt-xs"
                :style="{ 'background-color': isDarkMode ? '#0d0d0d' : '#f8f9fa' }"
              >
                <div class="source-location-header text-grey-7 text-caption q-mb-xs q-ml-lg">
                  Line {{ frame.source_info.stack_line }}:{{ frame.source_info.stack_col }}
                  <span class="q-ml-xs">
                    (Lines {{ frame.source_info.source_line_start }}-{{ frame.source_info.source_line_end }})
                  </span>
                </div>

                <div class="source-code-box q-ml-lg" :style="{ 'border-color': borderColor }">
                  <CodeQueryEditor
                    :ref="(el: any) => setEditorRef(traceIndex, frameIndex + 1, el)"
                    :editor-id="`source-frame-${traceIndex}-${frameIndex + 1}`"
                    :query="frame.source_info.source"
                    :read-only="true"
                    language="javascript"
                    style="height: 200px;"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Error state -->
    <div v-else class="q-pa-md text-center text-grey-7">
      <div v-if="translationError" class="text-negative">
        {{ translationError }}
      </div>
      <div v-else>
        Unable to translate stack trace. Source maps may not be available.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import sourcemapsService from "@/services/sourcemaps";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import {
  generateCacheKey,
  getCachedTranslation,
  setCachedTranslation,
} from "@/utils/stackTraceCache";

const store = useStore();
const router = useRouter();

const isDarkMode = computed(() => store.state.theme === "dark");

const borderColor = computed(() => isDarkMode.value ? "#424242" : "#e0e0e0");
const backgroundColor = computed(() => isDarkMode.value ? "#1e1e1e" : "#fafafa");
const hoverBackgroundColor = computed(() => isDarkMode.value ? "#2a2a2a" : "#f0f0f0");
const errorHeaderBackground = computed(() => isDarkMode.value ? "#3e2723" : "#fff3e0");
const errorHeaderColor = computed(() => isDarkMode.value ? "#ff6b6b" : "#d32f2f");
const textColor = computed(() => isDarkMode.value ? "#e0e0e0" : "#333");
const mutedTextColor = computed(() => isDarkMode.value ? "#b0b0b0" : "#666");

const props = defineProps({
  error_stack: {
    type: Array,
    required: true,
  },
  error: {
    type: Object,
    required: true,
  },
});

interface StackFrame {
  line?: string;
  source?: string;
  source_line_start?: number;
  source_line_end?: number;
  stack_line?: number;
  stack_col?: number;
  source_info?: {
    source: string;
    source_line_start: number;
    source_line_end: number;
    stack_line: number;
    stack_col: number;
  };
}

interface StackTraceFrame {
  error: string;
  stack: StackFrame[];
}

const isLoadingTranslation = ref(false);
const translatedStackTrace = ref<StackTraceFrame[]>([]);
const translationError = ref<string>("");
const expandedTraces = ref<Record<number, boolean>>({});
const expandedFrames = ref<Record<string, boolean>>({});
const editorRefs = ref<Record<string, any>>({});

// Check if all source_info values are null (source maps not available)
const allSourceInfoNull = computed(() => {
  if (translatedStackTrace.value.length === 0) return false;

  return translatedStackTrace.value.every((trace) =>
    trace.stack.every((frame) => !frame.source_info)
  );
});

const showFrames = (traceIndex: number) => {
  expandedTraces.value[traceIndex] = true;
};

const getFrameKey = (traceIndex: number, frameIndex: number) => {
  return `${traceIndex}-${frameIndex}`;
};

const toggleFrame = async (traceIndex: number, frameIndex: number) => {
  const key = getFrameKey(traceIndex, frameIndex);
  expandedFrames.value[key] = !expandedFrames.value[key];

  // If expanding, highlight the error line after the editor is mounted
  if (expandedFrames.value[key]) {
    await nextTick();
    // Give the editor time to fully initialize before highlighting
    setTimeout(() => {
      highlightErrorLine(traceIndex, frameIndex);
    }, 500);
  }
};

const isFrameExpanded = (traceIndex: number, frameIndex: number) => {
  const key = getFrameKey(traceIndex, frameIndex);
  // First frame (index 0) is expanded by default
  if (frameIndex === 0 && expandedFrames.value[key] === undefined) {
    return true;
  }
  return expandedFrames.value[key] || false;
};

const setEditorRef = (traceIndex: number, frameIndex: number, el: any) => {
  if (el) {
    const key = getFrameKey(traceIndex, frameIndex);
    editorRefs.value[key] = el;
  }
};

const highlightErrorLine = (traceIndex: number, frameIndex: number) => {
  const key = getFrameKey(traceIndex, frameIndex);
  const editorComponent = editorRefs.value[key];

  if (!editorComponent) {
    console.warn(`Editor not found for ${key}`);
    return;
  }

  const stackTrace = translatedStackTrace.value[traceIndex];
  if (!stackTrace) return;

  const frame = stackTrace.stack[frameIndex];
  if (!frame?.source_info) return;

  // Calculate the relative line number within the displayed source snippet
  const { stack_line, source_line_start, source_line_end } = frame.source_info;

  // Monaco editor is 1-indexed
  // The source snippet starts at source_line_start and the error is at stack_line
  // Relative position = stack_line - source_line_start + 1
  const relativeLineNumber = stack_line - source_line_start;

  console.log(`Highlighting line - stack_line: ${stack_line}, source_line_start: ${source_line_start}, source_line_end: ${source_line_end}, relativeLineNumber: ${relativeLineNumber}`);

  // Use the decorateRanges method to highlight the error line
  if (editorComponent.decorateRanges) {
    editorComponent.decorateRanges([{
      startLine: relativeLineNumber,
      endLine: relativeLineNumber,
    }]);
  }
};

const translateStackTrace = async () => {
  if (!props.error_stack || props.error_stack.length === 0) {
    console.warn("No error stack available");
    return;
  }

  isLoadingTranslation.value = true;
  translationError.value = "";
  translatedStackTrace.value = [];

  try {
    // Join the stack trace array into a single string
    const stacktraceString = props.error_stack.join("\n");

    // Extract metadata
    const service = props.error.service;
    const version = props.error.version;
    const env = props.error.env;

    // Generate cache key
    const cacheKey = generateCacheKey(
      stacktraceString,
      store.state.selectedOrganization.identifier,
      service,
      version,
      env
    );

    // Check cache first
    const cachedTranslation = getCachedTranslation(cacheKey);
    if (cachedTranslation) {
      translatedStackTrace.value = cachedTranslation;
      isLoadingTranslation.value = false;

      // Highlight the first frame after the editors are mounted
      await nextTick();
      setTimeout(() => {
        translatedStackTrace.value.forEach((trace, traceIndex) => {
          if (trace.stack.length > 0 && trace.stack[0].source_info) {
            highlightErrorLine(traceIndex, 0);
          }
        });
      }, 500);
      return;
    }

    // Prepare the request payload
    const payload: any = {
      stacktrace: stacktraceString,
    };

    // Add optional fields if they exist in the error object
    if (service) {
      payload.service = service;
    }
    if (version) {
      payload.version = version;
    }
    if (env) {
      payload.env = env;
    }

    console.log("Translating stack trace with payload:", payload);
    console.log("Organization identifier:", store.state.selectedOrganization.identifier);

    // Call the API
    const response = await sourcemapsService.translateStackTrace(
      store.state.selectedOrganization.identifier,
      payload
    );

    console.log("Translation response:", response);

    if (response.data && response.data.stacktrace) {
      // Check if stacktrace is already an array, if not wrap it in an array
      const translatedData = Array.isArray(response.data.stacktrace)
        ? response.data.stacktrace
        : [response.data.stacktrace];

      translatedStackTrace.value = translatedData;

      // Store in cache
      setCachedTranslation(cacheKey, translatedData);

      console.log("Translated stack trace:", translatedStackTrace.value);

      // Log each frame for debugging
      translatedStackTrace.value.forEach((trace, idx) => {
        console.log(`Stack trace ${idx}:`, trace.error);
        trace.stack.forEach((frame, frameIdx) => {
          console.log(`  Frame ${frameIdx}:`, frame.line);
          if (frame.source_info) {
            console.log(`    Source: ${frame.source_info.source.substring(0, 100)}...`);
          }
        });
      });

      // Highlight the first frame after the editors are mounted
      await nextTick();
      setTimeout(() => {
        translatedStackTrace.value.forEach((trace, traceIndex) => {
          if (trace.stack.length > 0 && trace.stack[0].source_info) {
            highlightErrorLine(traceIndex, 0);
          }
        });
      }, 500); // Give editors time to fully initialize
    } else {
      console.warn("No stacktrace in response:", response.data);
    }
  } catch (error: any) {
    console.error("Error translating stack trace:", error);
    console.error("Error response:", error?.response);
    console.error("Error response data:", error?.response?.data);
    translationError.value =
      error?.response?.data?.message ||
      error?.message ||
      "Failed to translate stack trace. Source maps may not be available.";
  } finally {
    isLoadingTranslation.value = false;
  }
};

// Navigate to upload source maps page
const navigateToUpload = () => {
  router.push({
    name: "UploadSourceMaps",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

// Translate when component mounts (lazy loaded when tab switches to "pretty")
onMounted(() => {
  translateStackTrace();
});

// Re-translate if error_stack changes
watch(
  () => props.error_stack,
  () => {
    translateStackTrace();
  }
);
</script>

<style lang="scss" scoped>
.loading-container {
  min-height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: v-bind(backgroundColor);
  border: 1px solid v-bind(borderColor);
  border-radius: 6px;
}

.no-source-maps-container {
  min-height: 150px;
  height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: v-bind(backgroundColor);
  border: 1px solid v-bind(borderColor);
  border-radius: 6px;
}

.pretty-stack-container {
  .error-header {
    border: 1px solid;
    border-radius: 6px 6px 0 0;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
    padding: 10px 16px !important;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    margin-bottom: -1px;
  }

  .stack-frame-wrapper {
    border-radius: 0 0 6px 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    margin-top: 0;

    .frame-header {
      transition: all 0.2s ease;
      padding: 12px 16px !important;

      &:hover {
        background-color: v-bind(hoverBackgroundColor);
      }

      .frame-header-content {
        display: flex;
        align-items: center;
        gap: 8px;

        .stack-line-header {
          font-family: "SF Mono", "Monaco", "Inconsolata", "Fira Code", "Droid Sans Mono", monospace;
          font-size: 12.5px;
          font-weight: 500;
          word-break: break-all;
          flex: 1;
          line-height: 1.5;
        }
      }
    }

    .source-context {
      padding: 0px 16px 16px 16px !important;

      .source-location-header {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        margin-bottom: 10px !important;
        opacity: 0.8;
      }

      .source-code-box {
        border: 1px solid;
        border-radius: 6px;
        height: 200px;
        overflow: hidden;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
      }
    }
  }

  .remaining-frames {
    border-radius: 0 0 6px 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);

    .show-more-button {
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      padding: 10px 16px !important;
      font-size: 12px;
      font-weight: 500;

      &:hover {
        background-color: v-bind(hoverBackgroundColor);
      }
    }

    .collapsed-frame-wrapper {
      .collapsed-frame-header {
        transition: all 0.2s ease;
        padding: 10px 16px !important;

        &:hover {
          background-color: v-bind(hoverBackgroundColor);
        }

        .collapsed-frame-content {
          display: flex;
          align-items: center;
          gap: 8px;

          .stack-line-collapsed {
            font-family: "SF Mono", "Monaco", "Inconsolata", "Fira Code", "Droid Sans Mono", monospace;
            font-size: 11.5px;
            line-height: 1.5;
            word-break: break-all;
            flex: 1;
            opacity: 0.85;
          }
        }
      }

      .source-context {
        padding: 0px 16px 16px 16px !important;

        .source-location-header {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          margin-bottom: 10px !important;
          opacity: 0.8;
        }

        .source-code-box {
          border: 1px solid;
          border-radius: 6px;
          height: 200px;
          overflow: hidden;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
          margin-left: 28px !important;
        }
      }
    }
  }
}
</style>
