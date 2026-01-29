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
  <div class="llm-content-renderer">
    <!-- Tool-specific rendering -->
    <div v-if="isToolObservation" class="tool-content">
      <div v-if="toolMetadata" class="tool-metadata q-mb-sm">
        <q-badge v-if="toolMetadata.name" :label="`Tool: ${toolMetadata.name}`" color="orange" class="q-mr-sm" />
        <q-badge v-if="toolMetadata.callId" :label="`Call ID: ${toolMetadata.callId}`" color="grey" />
      </div>
      <div class="tool-data">
        <VueJsonPretty :data="toolContent" :deep="3" :showLength="true" />
      </div>
    </div>

    <!-- Regular content rendering -->
    <div v-else class="content-wrapper">
      <!-- Truncated view -->
      <div v-if="!isExpanded && contentStats.shouldTruncate">
        <div v-if="isMessagesArray" class="messages-view">
          <MessageBubble
            v-for="(msg, idx) in previewMessages"
            :key="idx"
            :message="msg"
          />
        </div>
        <div v-else-if="isPlainText" class="text-content">
          <pre class="plain-text-content">{{ contentStats.previewText }}</pre>
        </div>
        <div v-else class="json-content">
          <VueJsonPretty :data="parsedContent" :deep="3" :showLength="true" />
        </div>

        <div class="expand-indicator q-mt-sm">
          <q-btn
            flat
            dense
            color="primary"
            size="sm"
            @click="isExpanded = true"
          >
            ...expand ({{ contentStats.remainingChars }} more characters)
          </q-btn>
        </div>
      </div>

      <!-- Full content view -->
      <div v-else>
        <div v-if="isMessagesArray" class="messages-view">
          <MessageBubble
            v-for="(msg, idx) in parsedMessages"
            :key="idx"
            :message="msg"
          />
        </div>
        <div v-else-if="isPlainText" class="text-content">
          <pre class="plain-text-content">{{ fullText }}</pre>
        </div>
        <div v-else class="json-content">
          <VueJsonPretty :data="parsedContent" :deep="3" :showLength="true" />
        </div>

        <div v-if="contentStats.shouldTruncate" class="collapse-btn q-mt-sm">
          <q-btn
            flat
            dense
            color="primary"
            size="sm"
            @click="isExpanded = false"
          >
            Collapse
          </q-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import VueJsonPretty from 'vue-json-pretty';
import 'vue-json-pretty/lib/styles.css';

const INITIAL_LINE_LIMIT = 15;

const props = defineProps({
  content: {
    type: [String, Object, Array],
    default: null,
  },
  observationType: {
    type: String,
    default: 'SPAN',
  },
  contentType: {
    type: String as () => 'input' | 'output',
    default: 'input',
  },
  span: {
    type: Object,
    default: null,
  },
});

const isExpanded = ref(false);

// Tool observation type handling
const isToolObservation = computed(() => {
  return props.observationType === 'TOOL';
});

const toolMetadata = computed(() => {
  if (!isToolObservation.value || !props.span) return null;
  return {
    name: props.span._o2_llm_tool_name,
    callId: props.span._o2_llm_tool_call_id,
  };
});

const toolContent = computed(() => {
  if (!isToolObservation.value || !props.span) return null;
  if (props.contentType === 'input') {
    return props.span._o2_llm_tool_call_arguments;
  } else {
    return props.span._o2_llm_tool_call_result;
  }
});

// Parse content
const parsedContent = computed(() => {
  if (!props.content) return null;

  try {
    if (typeof props.content === 'string') {
      // Try to parse as JSON
      return JSON.parse(props.content);
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
      (item: any) => item && typeof item === 'object' && 'role' in item
    )
  );
});

const isPlainText = computed(() => {
  // If parsedContent is different from original content, it means we successfully parsed JSON
  if (typeof props.content === 'string') {
    try {
      JSON.parse(props.content);
      return false; // It's valid JSON, not plain text
    } catch {
      return true; // Can't parse as JSON, so it's plain text
    }
  }
  return false;
});

// Extract messages
const parsedMessages = computed(() => {
  if (!isMessagesArray.value) return [];
  return (parsedContent.value as any[]).map((msg: any) => ({
    role: msg.role || 'unknown',
    content: msg.content || JSON.stringify(msg),
  }));
});

// Get text content for truncation
const fullText = computed(() => {
  if (typeof props.content === 'string') {
    return props.content;
  }
  if (props.content) {
    return JSON.stringify(props.content, null, 2);
  }
  return '';
});

// Calculate content stats for truncation
const contentStats = computed(() => {
  let text = '';

  if (isMessagesArray.value) {
    // For messages, concatenate all message contents
    text = parsedMessages.value
      .map((m: any) => `${m.role}: ${m.content}`)
      .join('\n');
  } else {
    text = fullText.value;
  }

  const lines = text.split('\n');
  const chars = text.length;

  const previewLines = lines.slice(0, INITIAL_LINE_LIMIT);
  const previewText = previewLines.join('\n');
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
  if (!isMessagesArray.value) return [];

  let lineCount = 0;
  const preview: any[] = [];

  for (const msg of parsedMessages.value) {
    const msgLines = msg.content.split('\n').length;
    if (lineCount + msgLines > INITIAL_LINE_LIMIT) {
      // Include partial message if possible
      const remainingLines = INITIAL_LINE_LIMIT - lineCount;
      if (remainingLines > 0) {
        const truncatedContent = msg.content.split('\n').slice(0, remainingLines).join('\n');
        preview.push({
          ...msg,
          content: truncatedContent + '...',
        });
      }
      break;
    }
    preview.push(msg);
    lineCount += msgLines;
  }

  return preview;
});
</script>

<script lang="ts">
// Message Bubble Component
import { defineComponent, h } from 'vue';
import VueJsonPretty from 'vue-json-pretty';

const MessageBubble = defineComponent({
  name: 'MessageBubble',
  props: {
    message: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    const roleColor = (role: string) => {
      const colors: Record<string, string> = {
        user: 'rgba(25, 118, 210, 0.1)',
        assistant: 'rgba(76, 175, 80, 0.1)',
        system: 'rgba(255, 152, 0, 0.1)',
        tool: 'rgba(156, 39, 176, 0.1)',
      };
      return colors[role] || 'rgba(158, 158, 158, 0.1)';
    };

    const parseContent = (content: string) => {
      try {
        return { isJson: true, data: JSON.parse(content) };
      } catch {
        return { isJson: false, data: content };
      }
    };

    return () => {
      const parsed = parseContent(props.message.content);

      return h(
        'div',
        {
          class: 'message-bubble q-mb-sm q-pa-sm',
          style: {
            backgroundColor: roleColor(props.message.role),
            border: '1px solid var(--o2-border-color)',
            borderRadius: '8px',
          },
        },
        [
          h('div', { class: 'message-role text-caption text-bold q-mb-xs' }, props.message.role),
          parsed.isJson
            ? h(VueJsonPretty, {
                data: parsed.data,
                deep: 3,
                showLength: true,
                class: 'message-content-json',
              })
            : h('pre', {
                class: 'message-content',
                style: {
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '13px',
                  lineHeight: '1.5',
                },
                textContent: parsed.data,
              }),
        ]
      );
    };
  },
});

export default {
  components: {
    MessageBubble,
    VueJsonPretty,
  },
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
  .message-bubble {
    .message-content {
      font-size: 13px;
      line-height: 1.5;
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

// vue-json-pretty customization
:deep(.vjs-tree) {
  font-size: 13px;
  line-height: 1.5;

  .vjs-key {
    color: #0288d1; // Blue for keys
    font-weight: 500;
  }

  .vjs-value-string {
    color: var(--o2-text-primary); // Match main text color
  }

  .vjs-value-number {
    color: #f57c00; // Orange for numbers
  }

  .vjs-value-boolean {
    color: #7b1fa2; // Purple for booleans
  }

  .vjs-value-null {
    color: #757575; // Gray for null
  }

  .vjs-tree-brackets {
    color: #9ca3af;
  }

  .vjs-tree-content {
    padding-left: 1em;
  }
}
</style>
