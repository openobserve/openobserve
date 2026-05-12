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
  <div v-if="hasValidContent" class="llm-content-renderer tw:h-full">
    <!-- Tool-specific rendering -->
    <div v-if="isToolObservation && toolContent !== null" class="tool-content">
      <div v-if="toolMetadata" class="tool-metadata q-mb-sm">
        <q-badge
          v-if="toolMetadata.name"
          :label="`Tool: ${toolMetadata.name}`"
          color="orange"
          class="q-mr-sm"
        />
        <q-badge
          v-if="toolMetadata.callId"
          :label="`Call ID: ${toolMetadata.callId}`"
          color="grey"
        />
      </div>
      <div class="tool-data">
        <CodeQueryEditor
          :editor-id="`${editorIdPrefix}tool-json-viewer-${span?.llm_tool_call_id || 'unknown'}`"
          :query="toolContentJson"
          language="json"
          :read-only="true"
          :show-auto-complete="false"
          :show-line-numbers="false"
          :sticky-scroll="false"
          class="json-viewer-editor tw:max-h-full! tw:h-full!"
        />
      </div>
    </div>

    <!-- Regular content rendering -->
    <div
      v-else
      class="content-wrapper"
      :class="
        props.viewMode === 'formatted' &&
        !shouldRenderAsMessages &&
        !isPlainText &&
        'tw:h-full'
      "
    >
      <!-- Truncated view -->
      <div
        v-if="!isExpanded && contentStats.shouldTruncate"
        :class="
          props.viewMode === 'formatted' &&
          !shouldRenderAsMessages &&
          !isPlainText &&
          'tw:h-full'
        "
      >
        <!-- Formatted mode -->
        <div
          v-if="props.viewMode === 'formatted'"
          :class="!shouldRenderAsMessages && !isPlainText && 'tw:h-full'"
        >
          <div v-if="shouldRenderAsMessages" class="messages-view">
            <div
              v-for="(msg, idx) in previewMessages"
              :key="idx"
              class="message-item q-mb-sm tw:h-full"
              :style="{
                border: '1px solid var(--o2-border)',
                borderRadius: '8px',
              }"
            >
              <div
                class="message-role text-caption text-bold q-pa-sm tw:capitalize"
                :style="{
                  backgroundColor: roleColor(msg.role),
                  borderBottom: '1px solid var(--o2-border)',
                }"
              >
                {{ roleLabel(msg.role) }}
              </div>
              <div
                v-if="isMessageJson(msg.content)"
                class="message-content-json q-pa-sm tw:h-full"
                style="background-color: var(--o2-code-bg)"
              >
                <CodeQueryEditor
                  :editor-id="`${editorIdPrefix}msg-json-editor-${idx}`"
                  :query="stringifyMessageContent(msg.content)"
                  language="json"
                  :read-only="true"
                  :show-auto-complete="false"
                  :show-line-numbers="false"
                  :sticky-scroll="false"
                  class="json-viewer-editor tw:max-h-full! tw:h-full!"
                />
              </div>
              <div
                v-else
                class="message-content markdown-body q-pa-sm tw:overflow-x-auto"
                style="background-color: var(--o2-code-bg)"
                v-html="renderMarkdown(msg.content)"
              />
            </div>
          </div>
          <div v-else-if="isPlainText" class="text-content">
            <pre class="plain-text-content">{{ contentStats.previewText }}</pre>
          </div>
          <div v-else class="json-content">
            <CodeQueryEditor
              :editor-id="`truncated-formatted-json-viewer-${editorIdPrefix}`"
              :query="parsedContentJson"
              language="json"
              :read-only="true"
              :show-auto-complete="false"
              :show-line-numbers="false"
              :sticky-scroll="false"
              class="json-viewer-editor tw:max-h-full! tw:h-full!"
            />
          </div>
        </div>

        <!-- JSON mode -->
        <div v-else class="json-content tw:h-full!">
          <CodeQueryEditor
            :editor-id="`truncated-json-mode-viewer-${editorIdPrefix}`"
            :query="parsedContentJson"
            language="json"
            :read-only="true"
            :show-auto-complete="false"
            :show-line-numbers="false"
            :sticky-scroll="false"
            class="json-viewer-editor tw:max-h-full! tw:h-full!"
          />
        </div>

        <div class="expand-indicator q-mt-sm">
          <OButton
            variant="ghost-primary"
            size="sm"
            @click="isExpanded = true"
          >
            ...expand ({{ contentStats.remainingChars }} more characters)
          </OButton>
        </div>
      </div>

      <!-- Full content view -->
      <div
        v-else
        :class="
          props.viewMode === 'formatted' &&
          !shouldRenderAsMessages &&
          !isPlainText &&
          'tw:h-full'
        "
      >
        <!-- Formatted mode -->
        <div
          v-if="props.viewMode === 'formatted'"
          :class="!shouldRenderAsMessages && !isPlainText && 'tw:h-full'"
        >
          <div v-if="shouldRenderAsMessages" class="messages-view">
            <div
              v-for="(msg, idx) in parsedMessages"
              :key="idx"
              class="message-item q-mb-sm tw:h-full"
              :style="{
                border: '1px solid var(--o2-border)',
                borderRadius: '8px',
              }"
            >
              <div
                class="message-role text-caption text-bold q-pa-sm tw:capitalize"
                :style="{
                  backgroundColor: roleColor(msg.role),
                  borderBottom: '1px solid var(--o2-border)',
                }"
              >
                {{ roleLabel(msg.role) }}
              </div>
              <div
                v-if="isMessageJson(msg.content)"
                class="message-content-json q-pa-sm tw:h-full"
                style="background-color: var(--o2-code-bg)"
              >
                <CodeQueryEditor
                  :editor-id="`${editorIdPrefix}msg-json-editor-full-${idx}`"
                  :query="stringifyMessageContent(msg.content)"
                  language="json"
                  :read-only="true"
                  :show-auto-complete="false"
                  :show-line-numbers="false"
                  :sticky-scroll="false"
                  class="json-viewer-editor tw:max-h-full! tw:h-full!"
                />
              </div>
              <div
                v-else
                class="message-content markdown-body q-pa-sm tw:overflow-x-auto"
                style="background-color: var(--o2-code-bg)"
                v-html="renderMarkdown(msg.content)"
              />
            </div>
          </div>
          <div v-else-if="isPlainText" class="text-content">
            <pre class="plain-text-content">{{ fullText }}</pre>
          </div>
          <div v-else class="json-content tw:h-full">
            <CodeQueryEditor
              :editor-id="`full-formatted-json-viewer-${editorIdPrefix}`"
              :query="parsedContentJson"
              language="json"
              :read-only="true"
              :show-auto-complete="false"
              :show-line-numbers="false"
              :sticky-scroll="false"
              class="json-viewer-editor tw:max-h-full! tw:h-full"
            />
          </div>
        </div>

        <!-- JSON mode -->
        <div v-else class="json-content">
          <CodeQueryEditor
            :editor-id="`full-json-mode-viewer-${editorIdPrefix}`"
            :query="parsedContentJson"
            language="json"
            :read-only="true"
            :show-auto-complete="false"
            :show-line-numbers="false"
            :sticky-scroll="false"
            class="json-viewer-editor"
          />
        </div>

        <div v-if="contentStats.shouldTruncate" class="collapse-btn q-mt-sm">
          <OButton
            variant="ghost-primary"
            size="sm"
            @click="isExpanded = false"
          >
            Collapse
          </OButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";

const CodeQueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);
import OButton from '@/lib/core/Button/OButton.vue';

const INITIAL_LINE_LIMIT = 15;

const props = defineProps({
  content: {
    type: [String, Object, Array],
    default: null,
  },
  observationType: {
    type: String,
    default: "SPAN",
  },
  contentType: {
    type: String as () => "input" | "output",
    default: "input",
  },
  span: {
    type: Object,
    default: null,
  },
  viewMode: {
    type: String as () => "formatted" | "json",
    default: "formatted",
  },
  instanceId: {
    type: String,
    default: "",
  },
});

const editorIdPrefix = computed(() =>
  props.instanceId ? `${props.instanceId}-` : "",
);

const isExpanded = ref(false);

// Tool observation type handling
const isToolObservation = computed(() => {
  return props.observationType === "TOOL";
});

const toolMetadata = computed(() => {
  if (!isToolObservation.value || !props.span) return null;
  return {
    name: props.span.gen_ai_tool_name,
    callId: props.span.gen_ai_tool_call_id,
  };
});

const toolContent = computed(() => {
  if (!isToolObservation.value) return null;

  let content = null;
  if (props.span) {
    if (props.contentType === "input") {
      content = props.span.gen_ai_tool_call_arguments;
    } else {
      content = props.span.gen_ai_tool_call_result;
    }
  }

  // If tool-specific field is null/undefined, fall back to props.content
  if (content === null || content === undefined) {
    content = props.content;
  }

  // Check if content is the string "null"
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.toLowerCase() === "null" || trimmed === "") {
      return null;
    }
    // Try to parse string content as JSON
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }

  // Handle nested content structure: {content: [{type: "text", text: "..."}]}
  if (content && typeof content === "object") {
    // Check if it has the Anthropic content format
    if (
      content.content &&
      Array.isArray(content.content) &&
      content.content.length > 0
    ) {
      const firstContent = content.content[0];
      if (firstContent.type === "text" && firstContent.text) {
        // Try to parse the inner text as JSON
        try {
          return JSON.parse(firstContent.text);
        } catch {
          // If parsing fails, return the text as-is
          return firstContent.text;
        }
      }
    }
  }

  return content;
});

// Check if we have valid content to render
const hasValidContent = computed(() => {
  // For tool observations, check toolContent instead
  if (isToolObservation.value) {
    return toolContent.value !== null && toolContent.value !== undefined;
  }

  // For regular content
  if (!props.content) return false;

  if (typeof props.content === "string") {
    const trimmed = props.content.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "null") return false;
  }

  return true;
});

// Parse content
const parsedContent = computed(() => {
  if (!props.content) return null;

  try {
    if (typeof props.content === "string") {
      // Check for explicit "null" string before parsing
      const trimmed = props.content.trim();
      if (trimmed.toLowerCase() === "null" || trimmed === "") {
        return null;
      }
      // Try to parse as JSON
      const parsed = JSON.parse(props.content);
      // If parsing results in null, return null
      if (parsed === null) {
        return null;
      }
      return parsed;
    }

    // Handle nested content structure: {content: [{type: "text", text: "..."}]}
    if (props.content && typeof props.content === "object") {
      // Check if it has the Anthropic content format
      if (
        props.content.content &&
        Array.isArray(props.content.content) &&
        props.content.content.length > 0
      ) {
        const firstContent = props.content.content[0];
        if (firstContent.type === "text" && firstContent.text) {
          // Try to parse the inner text as JSON
          try {
            const innerParsed = JSON.parse(firstContent.text);
            return innerParsed;
          } catch {
            // If parsing fails, return the text as-is
            return firstContent.text;
          }
        }
      }
    }

    return props.content;
  } catch {
    // Plain text
    return props.content;
  }
});

// Detect content type
const isMessagesArray = computed(() => {
  return (
    Array.isArray(parsedContent.value) &&
    parsedContent.value.length > 0 &&
    parsedContent.value.every(
      (item: any) => item && typeof item === "object" && "role" in item,
    )
  );
});

// Detect single message object (for output)
const isSingleMessage = computed(() => {
  return (
    parsedContent.value &&
    typeof parsedContent.value === "object" &&
    !Array.isArray(parsedContent.value) &&
    "role" in parsedContent.value
  );
});

// Detect content parts array (OpenAI/Anthropic output format: [{type: 'text', text: '...'}])
// This handles cases where the output is just an array of content parts without a role wrapper
const isContentPartsArray = computed(() => {
  return (
    Array.isArray(parsedContent.value) &&
    parsedContent.value.length > 0 &&
    parsedContent.value.every(
      (item: any) =>
        item &&
        typeof item === "object" &&
        "type" in item &&
        (item.type === "text" ||
          item.type === "image_url" ||
          item.type === "image"),
    )
  );
});

// Check if content should be rendered as messages (any format)
const shouldRenderAsMessages = computed(() => {
  return (
    isMessagesArray.value || isSingleMessage.value || isContentPartsArray.value
  );
});

const isPlainText = computed(() => {
  // If parsedContent is different from original content, it means we successfully parsed JSON
  if (typeof props.content === "string") {
    try {
      JSON.parse(props.content);
      return false; // It's valid JSON, not plain text
    } catch {
      return true; // Can't parse as JSON, so it's plain text
    }
  }
  return false;
});

// Helper function to format content (handles string, array of parts, or object)
const formatContent = (content: any): string => {
  // Handle array content (OpenAI multimodal format: [{type: 'text', text: '...'}, {type: 'image_url', image_url: {...}}])
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part.type === "text" && part.text) {
        parts.push(part.text);
      } else if (part.type === "image_url" && part.image_url?.url) {
        parts.push(`[Image: ${part.image_url.url}]`);
      } else if (part.type === "image" && part.source) {
        // Handle Anthropic-style image content
        parts.push(`[Image: ${part.source.type || "base64"}]`);
      } else {
        // Fallback for unknown part types
        parts.push(JSON.stringify(part));
      }
    }
    return parts.join("\n\n");
  } else if (typeof content === "string") {
    return content;
  } else if (content) {
    return JSON.stringify(content, null, 2);
  }
  return "";
};

// Stringified versions for CodeQueryEditor (expects string query prop)
const toolContentJson = computed(() => {
  if (toolContent.value === null || toolContent.value === undefined) return "";
  return JSON.stringify(toolContent.value, null, 2);
});

const parsedContentJson = computed(() => {
  if (parsedContent.value === null || parsedContent.value === undefined)
    return "";
  return JSON.stringify(parsedContent.value, null, 2);
});

// Extract messages
const parsedMessages = computed(() => {
  // Handle array of messages (input format)
  if (isMessagesArray.value) {
    return (parsedContent.value as any[]).map((msg: any) => ({
      role: msg.role || "unknown",
      content: formatContent(msg.content),
    }));
  }

  // Handle single message object (output format: {role: 'assistant', content: '...'})
  if (isSingleMessage.value) {
    const msg = parsedContent.value as any;
    return [
      {
        role: msg.role || "assistant",
        content: formatContent(msg.content),
      },
    ];
  }

  // Handle direct content parts array (output format: [{type: 'text', text: '...'}])
  if (isContentPartsArray.value) {
    return [
      {
        role: "assistant",
        content: formatContent(parsedContent.value),
      },
    ];
  }

  return [];
});

// Get text content for truncation
const fullText = computed(() => {
  if (typeof props.content === "string") {
    return props.content;
  }
  if (props.content) {
    return JSON.stringify(props.content, null, 2);
  }
  return "";
});

// Calculate content stats for truncation
const contentStats = computed(() => {
  let text = "";

  if (shouldRenderAsMessages.value) {
    // For messages, concatenate all message contents
    text = parsedMessages.value
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n");
  } else {
    text = fullText.value;
  }

  const lines = text.split("\n");
  const chars = text.length;

  const previewLines = lines.slice(0, INITIAL_LINE_LIMIT);
  const previewText = previewLines.join("\n");
  const remainingChars = chars - previewText.length;

  return {
    totalLines: lines.length,
    totalChars: chars,
    shouldTruncate: lines.length > INITIAL_LINE_LIMIT,
    previewText,
    remainingChars,
  };
});

// Preview messages (first 15 lines worth)
const previewMessages = computed(() => {
  if (!shouldRenderAsMessages.value) return [];

  let lineCount = 0;
  const preview: any[] = [];

  for (const msg of parsedMessages.value) {
    const msgLines = msg.content.split("\n").length;
    if (lineCount + msgLines > INITIAL_LINE_LIMIT) {
      // Include partial message if possible
      const remainingLines = INITIAL_LINE_LIMIT - lineCount;
      if (remainingLines > 0) {
        const truncatedContent = msg.content
          .split("\n")
          .slice(0, remainingLines)
          .join("\n");
        preview.push({
          ...msg,
          content: truncatedContent + "...",
        });
      }
      break;
    }
    preview.push(msg);
    lineCount += msgLines;
  }

  return preview;
});

// Message item helpers (was previously in MessageItem render function)
const roleColor = (role: string) => {
  const colors: Record<string, string> = {
    user: "rgba(25, 118, 210, 0.1)",
    assistant: "rgba(76, 175, 80, 0.1)",
    system: "rgba(255, 152, 0, 0.1)",
    tool: "rgba(156, 39, 176, 0.1)",
  };
  return colors[role] || "rgba(158, 158, 158, 0.1)";
};

const roleLabel = (role: string) => {
  const labels: Record<string, string> = {
    user: "User",
    assistant: "Assistant",
    system: "System",
    tool: "Tool",
  };
  return labels[role] || role;
};

const toMarkdown = (content: string): string => {
  return content.replace(/\[Image: (https?:\/\/[^\]]+)\]/g, "![Image]($1)");
};

const isMessageJson = (content: string): boolean => {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
};

const stringifyMessageContent = (content: string): string => {
  return JSON.stringify(JSON.parse(content), null, 2);
};

const renderMarkdown = (content: string): string => {
  const markdownContent = toMarkdown(content);
  return DOMPurify.sanitize(marked.parse(markdownContent) as string);
};
</script>

<style scoped lang="scss">
.llm-content-renderer {
  width: 100%;
}

.tool-content {
  .tool-metadata {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
}

.messages-view {
  .message-item {
    .message-content {
      font-size: 13px;
      line-height: 1.6;

      :deep(p) {
        margin: 0 0 8px 0;

        &:last-child {
          margin-bottom: 0;
        }
      }

      :deep(img) {
        max-width: 50%;
        max-height: 400px;
        object-fit: contain;
        display: block;
        margin: 8px 0;
        border-radius: 4px;
      }

      :deep(pre) {
        background-color: rgba(0, 0, 0, 0.05);
        padding: 8px;
        border-radius: 4px;
        overflow-x: auto;
        margin: 8px 0;
      }

      :deep(code) {
        font-family: monospace;
        font-size: 12px;
        background-color: rgba(0, 0, 0, 0.05);
        padding: 2px 4px;
        border-radius: 3px;
      }

      :deep(pre code) {
        background-color: transparent;
        padding: 0;
      }

      :deep(ul),
      :deep(ol) {
        margin: 8px 0;
        padding-left: 24px;
      }

      :deep(li) {
        margin: 4px 0;
      }

      :deep(a) {
        color: var(--q-primary);
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }
      }

      :deep(blockquote) {
        border-left: 3px solid var(--o2-border-color);
        margin: 8px 0;
        padding-left: 12px;
        color: var(--o2-text-secondary);
      }

      :deep(table) {
        border-collapse: collapse;
        width: 100%;
        margin: 8px 0;

        th,
        td {
          border: 1px solid var(--o2-border-color);
          padding: 6px 8px;
          text-align: left;
        }

        th {
          background-color: rgba(0, 0, 0, 0.05);
        }
      }
    }

    .message-content-json {
      font-size: 13px;
    }
  }
}

.text-content {
  .plain-text-content {
    margin: 0;
    padding: 0.5rem;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: monospace;
    font-size: 13px;
    line-height: 1.5;
    background-color: var(--o2-code-bg);
    border-radius: 4px;
    overflow-x: auto;
  }
}

.expand-indicator,
.collapse-btn {
  text-align: center;
}

.json-viewer-editor {
  height: 300px;
  max-height: 500px;
  min-height: 100px;
  width: 100%;
  border-radius: 4px;
  overflow: hidden;
}
</style>

<style lang="scss">
/* Unscoped — needed because innerHTML-injected nodes don't get the scoped attribute */
.llm-content-renderer .messages-view .message-item .message-content {
  h1,
  h2,
  h3,
  h4 {
    font-weight: 600;
    margin: 10px 0 6px 0;
    line-height: 1.4;
  }

  h1 {
    font-size: 1.15rem;
  }

  h2 {
    font-size: 1.05rem;
  }

  h3 {
    font-size: 0.95rem;
  }

  h4 {
    font-size: 0.875rem;
  }
}
</style>
