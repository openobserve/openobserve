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
  <div>
    <!-- Loading state -->
    <div
      v-if="isLoadingTranslation"
      class="loading-container tw:p-6 tw:text-center tw:min-h-[200px] tw:flex tw:flex-col tw:items-center tw:justify-center tw:rounded-md"
      :style="{ 'background-color': backgroundColor, 'border': `1px solid ${borderColor}` }"
    >
      <OSpinner variant="dots" size="lg" />
      <div class="tw:mt-3 tw:text-gray-400" style="font-size: 14px; font-weight: 500;">
        Translating stack trace with source maps...
      </div>
      <div class="tw:mt-1 tw:text-gray-400" style="font-size: 12px;">
        This may take a few moments
      </div>
    </div>

    <!-- No source maps available message -->
    <div
      v-else-if="allSourceInfoNull"
      class="no-source-maps-container tw:p-3 tw:text-center tw:flex tw:flex-col tw:items-center tw:justify-center tw:rounded-md tw:py-5 tw:px-6"
      :style="{ 'background-color': backgroundColor, 'border': `1px solid ${borderColor}` }"
    >
      <OIcon name="code-off" size="lg" class="tw:mb-2" />
      <div class="tw:text-base tw:font-medium tw:text-gray-500 tw:mb-1" style="font-weight: 500;">
        Source Maps Not Available
      </div>
      <div class="tw:text-sm tw:text-gray-400" style="max-width: 500px; margin: 0 auto; font-size: 13px;">
        To view detailed stack traces with original source code and line numbers, please upload source maps for this application.
      </div>
      <div v-if="props.error.service || props.error.version" class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:mt-2 tw:mb-2">
        <span
          v-if="props.error.service"
          class="service-version-badge service-badge tw:inline-flex tw:items-center tw:gap-1 tw:py-1 tw:px-[10px] tw:rounded tw:text-xs tw:font-medium"
          :class="isDarkMode ? 'tw:bg-[rgba(149,117,205,0.2)] tw:text-[#b39ddb]' : 'tw:bg-[rgba(103,58,183,0.12)] tw:text-[#5e35b1]'"
        >
          <span class="badge-label tw:opacity-80">Service:</span>
          <span class="badge-value tw:font-semibold">{{ props.error.service }}</span>
        </span>
        <span
          v-if="props.error.version"
          class="service-version-badge version-badge tw:inline-flex tw:items-center tw:gap-1 tw:py-1 tw:px-[10px] tw:rounded tw:text-xs tw:font-medium"
          :class="isDarkMode ? 'tw:bg-[rgba(66,165,245,0.2)] tw:text-[#90caf9]' : 'tw:bg-[rgba(25,118,210,0.12)] tw:text-[#1976d2]'"
        >
          <span class="badge-label tw:opacity-80">Version:</span>
          <span class="badge-value tw:font-semibold">{{ props.error.version }}</span>
        </span>
      </div>
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="upload"
        class="tw:my-2"
        @click="navigateToUpload"
      >
        Upload Source Maps
      </OButton>
    </div>

    <!-- Pretty formatted view -->
    <div v-else-if="translatedStackTrace.length > 0" class="pretty-stack-container">
      <template v-for="(stackTrace, traceIndex) in translatedStackTrace" :key="traceIndex">
        <!-- Error message -->
        <div
          v-if="stackTrace.error"
          class="error-header tw:px-3 tw:py-2 text-weight-bold tw:border tw:border-solid tw:rounded-t-md tw:text-sm tw:font-semibold tw:[letter-spacing:0.01em] tw:!px-4 tw:!py-[10px] tw:[box-shadow:0_1px_2px_rgba(0,0,0,0.05)] tw:-mb-px"
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
          class="stack-frame-wrapper tw:rounded-b-md tw:[box-shadow:0_1px_3px_rgba(0,0,0,0.08)] tw:overflow-hidden tw:mt-0"
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
            class="frame-header tw:px-3 tw:py-2 tw:cursor-pointer tw:transition-all tw:duration-200 tw:ease-in-out tw:!px-4 tw:!py-3"
            @click="toggleFrame(traceIndex, 0)"
          >
            <div class="frame-header-content tw:flex tw:items-center tw:gap-2">
              <OIcon
                :name="isFrameExpanded(traceIndex, 0) ? 'expand-more' : 'chevron-right'"
                size="xs"
                class="tw:mr-1 tw:text-gray-400"
              />
              <div
                v-if="stackTrace.stack[0].line"
                class="stack-line-header tw:[font-family:'SF_Mono','Monaco','Inconsolata','Fira_Code','Droid_Sans_Mono',monospace] tw:text-[12.5px] tw:font-medium tw:break-all tw:flex-1 tw:[line-height:1.5]"
                :style="{ color: textColor }"
              >
                {{ stackTrace.stack[0].line }}
              </div>
            </div>
          </div>

          <!-- Expandable source code context -->
          <div
            v-if="isFrameExpanded(traceIndex, 0) && stackTrace.stack[0].source_info"
            class="source-context tw:!px-4 tw:!pb-4 tw:!pt-0"
            :style="{ 'background-color': isDarkMode ? '#0d0d0d' : '#f8f9fa' }"
          >
            <!-- File location -->
            <div class="source-location-header tw:text-gray-400 tw:text-xs tw:!mb-[10px] tw:text-[11px] tw:font-semibold tw:[letter-spacing:0.02em] tw:opacity-80">
              Line {{ stackTrace.stack[0].source_info.stack_line }}:{{ stackTrace.stack[0].source_info.stack_col }}
              <span class="tw:ml-1">
                (Lines {{ stackTrace.stack[0].source_info.source_line_start }}-{{ stackTrace.stack[0].source_info.source_line_end }})
              </span>
            </div>

            <!-- Source code snippet with syntax highlighting -->
            <div class="source-code-box tw:border tw:border-solid tw:rounded-md tw:h-[200px] tw:overflow-hidden tw:[box-shadow:0_2px_6px_rgba(0,0,0,0.1)]" :style="{ 'border-color': borderColor }">
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
          class="remaining-frames tw:rounded-b-md tw:[box-shadow:0_1px_3px_rgba(0,0,0,0.08)]"
          :style="{
            'border-bottom': `1px solid ${borderColor}`,
            'border-left': `1px solid ${borderColor}`,
            'border-right': `1px solid ${borderColor}`,
            'border-radius': '0 0 4px 4px',
            'background-color': backgroundColor,
          }"
        >
          <!-- Show more button - only visible when frames are tw:hidden -->
          <div
            v-if="!expandedTraces[traceIndex]"
            class="show-more-button tw:px-3 tw:py-2 tw:cursor-pointer tw:flex tw:items-center tw:gap-[6px] tw:transition-all tw:duration-200 tw:ease-in-out tw:!px-4 tw:!py-[10px] tw:text-xs tw:font-medium"
            :style="{ 'border-top': `1px solid ${borderColor}` }"
            @click="showFrames(traceIndex)"
          >
            <OIcon
              name="expand-more"
              size="xs"
              class="tw:mr-1"
            />
            <span class="tw:text-xs tw:text-gray-400">
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
                class="collapsed-frame-header tw:px-3 tw:py-1 tw:cursor-pointer tw:transition-all tw:duration-200 tw:ease-in-out tw:!px-4 tw:!py-[10px]"
                :style="{ 'background-color': backgroundColor }"
                @click="toggleFrame(traceIndex, frameIndex + 1)"
              >
                <div class="collapsed-frame-content tw:flex tw:items-center tw:gap-2">
                  <OIcon
                    :name="isFrameExpanded(traceIndex, frameIndex + 1) ? 'expand-more' : 'chevron-right'"
                    size="xs"
                    class="tw:mr-1 tw:text-gray-400"
                  />
                  <div
                    v-if="frame.line"
                    class="stack-line-collapsed tw:[font-family:'SF_Mono','Monaco','Inconsolata','Fira_Code','Droid_Sans_Mono',monospace] tw:text-[11.5px] tw:[line-height:1.5] tw:break-all tw:flex-1 tw:opacity-85"
                    :style="{ color: mutedTextColor }"
                  >
                    {{ frame.line }}
                  </div>
                </div>
              </div>

              <!-- Expandable source code context -->
              <div
                v-if="isFrameExpanded(traceIndex, frameIndex + 1) && frame.source_info"
                class="source-context tw:!px-4 tw:!pb-4 tw:!pt-0"
                :style="{ 'background-color': isDarkMode ? '#0d0d0d' : '#f8f9fa' }"
              >
                <div class="source-location-header tw:text-gray-400 tw:text-xs tw:!mb-[10px] tw:ml-4 tw:text-[11px] tw:font-semibold tw:[letter-spacing:0.02em] tw:opacity-80">
                  Line {{ frame.source_info.stack_line }}:{{ frame.source_info.stack_col }}
                  <span class="tw:ml-1">
                    (Lines {{ frame.source_info.source_line_start }}-{{ frame.source_info.source_line_end }})
                  </span>
                </div>

                <div class="source-code-box tw:ml-4 tw:border tw:border-solid tw:rounded-md tw:h-[200px] tw:overflow-hidden tw:[box-shadow:0_2px_6px_rgba(0,0,0,0.1)]" :style="{ 'border-color': borderColor }">
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
    <div v-else class="tw:p-3 tw:text-center tw:text-gray-400">
      <div v-if="translationError" class="tw:text-red-500">
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
import OButton from '@/lib/core/Button/OButton.vue';

import {
  generateCacheKey,
  getCachedTranslation,
  setCachedTranslation,
} from "@/utils/stackTraceCache";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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


    // Call the API
    const response = await sourcemapsService.translateStackTrace(
      store.state.selectedOrganization.identifier,
      payload
    );


    if (response.data && response.data.stacktrace) {
      // Check if stacktrace is already an array, if not wrap it in an array
      const translatedData = Array.isArray(response.data.stacktrace)
        ? response.data.stacktrace
        : [response.data.stacktrace];

      translatedStackTrace.value = translatedData;

      // Store in cache
      setCachedTranslation(cacheKey, translatedData);


      // Log each frame for debugging
      translatedStackTrace.value.forEach((trace, idx) => {
        trace.stack.forEach((frame, frameIdx) => {
          if (frame.source_info) {
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
  const query: any = {
    org_identifier: store.state.selectedOrganization.identifier,
  };

  // Pre-fill service, version, and environment if available
  if (props.error.service) {
    query.service = props.error.service;
  }
  if (props.error.version) {
    query.version = props.error.version;
  }
  if (props.error.env) {
    query.environment = props.error.env;
  }

  router.push({
    name: "UploadSourceMaps",
    query,
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

<style>
.pretty-stack-container .stack-frame-wrapper .frame-header:hover {
  background-color: v-bind(hoverBackgroundColor);
}

.pretty-stack-container .remaining-frames .show-more-button:hover {
  background-color: v-bind(hoverBackgroundColor);
}

.pretty-stack-container .remaining-frames .collapsed-frame-wrapper .collapsed-frame-header:hover {
  background-color: v-bind(hoverBackgroundColor);
}
</style>
