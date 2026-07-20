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
      data-test="rum-pretty-stack-trace-loading"
      class="loading-container p-6 text-center min-h-[200px] flex flex-col items-center justify-center rounded-md"
      :style="{ 'background-color': backgroundColor, 'border': `1px solid ${borderColor}` }"
    >
      <OSpinner variant="dots" size="lg" />
      <div class="mt-3 text-gray-400" style="font-size: 14px; font-weight: 500;">
        {{ t("rum.translatingStackTrace") }}
      </div>
      <div class="mt-1 text-gray-400" style="font-size: 12px;">
        {{ t("rum.translatingStackTraceHint") }}
      </div>
    </div>

    <!-- No source maps available message -->
    <div
      v-else-if="allSourceInfoNull"
      data-test="rum-pretty-stack-trace-unavailable"
      class="no-source-maps-container p-3 text-center flex flex-col items-center justify-center rounded-md py-5 px-6"
      :style="{ 'background-color': backgroundColor, 'border': `1px solid ${borderColor}` }"
    >
      <OIcon name="code-off" size="lg" class="mb-2" />
      <div class="text-base font-medium text-gray-500 mb-1" style="font-weight: 500;">
        {{ t("rum.sourceMapsNotAvailable") }}
      </div>
      <div class="text-sm text-gray-400" style="max-width: 500px; margin: 0 auto; font-size: 13px;">
        {{ t("rum.sourceMapsNotAvailableBody") }}
      </div>
      <div v-if="props.error.service || props.error.version" class="flex items-center justify-center gap-2 mt-2 mb-2">
        <span
          v-if="props.error.service"
          class="service-version-badge service-badge inline-flex items-center gap-1 py-1 px-[10px] rounded text-xs font-medium"
          :class="isDarkMode ? 'bg-[rgba(149,117,205,0.2)] text-[#b39ddb]' : 'bg-[rgba(103,58,183,0.12)] text-[#5e35b1]'"
        >
          <span class="badge-label opacity-80">{{ t("rum.serviceBadge") }}</span>
          <span class="badge-value font-semibold">{{ props.error.service }}</span>
        </span>
        <span
          v-if="props.error.version"
          class="service-version-badge version-badge inline-flex items-center gap-1 py-1 px-[10px] rounded text-xs font-medium"
          :class="isDarkMode ? 'bg-[rgba(66,165,245,0.2)] text-[#90caf9]' : 'bg-[rgba(25,118,210,0.12)] text-[#1976d2]'"
        >
          <span class="badge-label opacity-80">{{ t("rum.versionBadge") }}</span>
          <span class="badge-value font-semibold">{{ props.error.version }}</span>
        </span>
      </div>
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="upload"
        class="my-2"
        @click="navigateToUpload"
      >
        {{ t("rum.uploadSourceMaps") }}
      </OButton>
    </div>

    <!-- Pretty formatted view -->
    <div
      v-else-if="translatedStackTrace.length > 0"
      data-test="rum-pretty-stack-trace-container"
      class="pretty-stack-container"
    >
      <template v-for="(stackTrace, traceIndex) in translatedStackTrace" :key="traceIndex">
        <!-- Error message -->
        <div
          v-if="stackTrace.error"
          class="error-header px-3 py-2 text-weight-bold border border-solid rounded-t-md text-sm font-semibold [letter-spacing:0.01em] !px-4 !py-[10px] [box-shadow:0_1px_2px_rgba(0,0,0,0.05)] -mb-px"
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
          class="stack-frame-wrapper rounded-b-md [box-shadow:0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden mt-0"
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
            class="frame-header px-3 py-2 cursor-pointer transition-all duration-200 ease-in-out !px-4 !py-3"
            @click="toggleFrame(traceIndex, 0)"
          >
            <div class="frame-header-content flex items-center gap-2">
              <OIcon
                :name="isFrameExpanded(traceIndex, 0) ? 'expand-more' : 'chevron-right'"
                size="xs"
                class="mr-1 text-gray-400"
              />
              <div
                v-if="stackTrace.stack[0].line"
                data-test="rum-pretty-stack-trace-frame-line"
                class="stack-line-header [font-family:'SF_Mono','Monaco','Inconsolata','Fira_Code','Droid_Sans_Mono',monospace] text-[12.5px] font-medium break-all flex-1 [line-height:1.5]"
                :style="{ color: textColor }"
              >
                {{ stackTrace.stack[0].line }}
              </div>
            </div>
          </div>

          <!-- Expandable source code context -->
          <div
            v-if="isFrameExpanded(traceIndex, 0) && stackTrace.stack[0].source_info"
            data-test="rum-pretty-stack-trace-source-context"
            class="source-context !px-4 !pb-4 !pt-0"
            :style="{ 'background-color': isDarkMode ? '#0d0d0d' : '#f8f9fa' }"
          >
            <!-- File location -->
            <div class="source-location-header text-gray-400 text-xs !mb-[10px] text-[11px] font-semibold [letter-spacing:0.02em] opacity-80">
              {{ t("rum.stackLine") }} {{ stackTrace.stack[0].source_info.stack_line }}:{{ stackTrace.stack[0].source_info.stack_col }}
              <span class="ml-1">
                ({{ t("rum.stackLines") }} {{ stackTrace.stack[0].source_info.source_line_start }}-{{ stackTrace.stack[0].source_info.source_line_end }})
              </span>
            </div>

            <!-- Source code snippet with syntax highlighting -->
            <div class="source-code-box border border-solid rounded-md h-[200px] overflow-hidden [box-shadow:0_2px_6px_rgba(0,0,0,0.1)]" :style="{ 'border-color': borderColor }">
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
          class="remaining-frames rounded-b-md [box-shadow:0_1px_3px_rgba(0,0,0,0.08)]"
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
            class="show-more-button px-3 py-2 cursor-pointer flex items-center gap-[6px] transition-all duration-200 ease-in-out !px-4 !py-[10px] text-xs font-medium"
            :style="{ 'border-top': `1px solid ${borderColor}` }"
            @click="showFrames(traceIndex)"
          >
            <OIcon
              name="expand-more"
              size="xs"
              class="mr-1"
            />
            <span class="text-xs text-gray-400">
              {{
                stackTrace.stack.length - 1 > 1
                  ? t("rum.showMoreFrames", { count: stackTrace.stack.length - 1 })
                  : t("rum.showMoreFrame", { count: stackTrace.stack.length - 1 })
              }}
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
                class="collapsed-frame-header px-3 py-1 cursor-pointer transition-all duration-200 ease-in-out !px-4 !py-[10px]"
                :style="{ 'background-color': backgroundColor }"
                @click="toggleFrame(traceIndex, frameIndex + 1)"
              >
                <div class="collapsed-frame-content flex items-center gap-2">
                  <OIcon
                    :name="isFrameExpanded(traceIndex, frameIndex + 1) ? 'expand-more' : 'chevron-right'"
                    size="xs"
                    class="mr-1 text-gray-400"
                  />
                  <div
                    v-if="frame.line"
                    data-test="rum-pretty-stack-trace-frame-line"
                    class="stack-line-collapsed [font-family:'SF_Mono','Monaco','Inconsolata','Fira_Code','Droid_Sans_Mono',monospace] text-[11.5px] [line-height:1.5] break-all flex-1 opacity-85"
                    :style="{ color: mutedTextColor }"
                  >
                    {{ frame.line }}
                  </div>
                </div>
              </div>

              <!-- Expandable source code context -->
              <div
                v-if="isFrameExpanded(traceIndex, frameIndex + 1) && frame.source_info"
                class="source-context !px-4 !pb-4 !pt-0"
                :style="{ 'background-color': isDarkMode ? '#0d0d0d' : '#f8f9fa' }"
              >
                <div class="source-location-header text-gray-400 text-xs !mb-[10px] ml-4 text-[11px] font-semibold [letter-spacing:0.02em] opacity-80">
                  {{ t("rum.stackLine") }} {{ frame.source_info.stack_line }}:{{ frame.source_info.stack_col }}
                  <span class="ml-1">
                    ({{ t("rum.stackLines") }} {{ frame.source_info.source_line_start }}-{{ frame.source_info.source_line_end }})
                  </span>
                </div>

                <div class="source-code-box ml-4 border border-solid rounded-md h-[200px] overflow-hidden [box-shadow:0_2px_6px_rgba(0,0,0,0.1)]" :style="{ 'border-color': borderColor }">
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
    <div v-else data-test="rum-pretty-stack-trace-error" class="p-3 text-center text-gray-400">
      <div v-if="translationError" class="text-red-500">
        {{ translationError }}
      </div>
      <div v-else>
        {{ t("rum.unableToTranslateStackTrace") }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
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
const { t } = useI18n();

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
      t("rum.failedToTranslateStackTrace");
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
