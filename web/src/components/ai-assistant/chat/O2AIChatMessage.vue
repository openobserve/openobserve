<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import type { ChatMessage, ContentBlock, NavigationAction } from "@/ts/interfaces/chat";
import {
  formatLogEntryContent,
  getLanguageDisplay,
  processHtmlBlock,
  processTextBlock,
  type RenderedBlock,
} from "@/components/O2AIChat.content";
import { copyToClipboard } from "@/utils/clipboard";
import O2AIChatToolCallBlock from "./O2AIChatToolCallBlock.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

// ContentBlock has no log_entry member, but parseLogEntries puts them into user messages.
type LogEntryBlock = { type: "log_entry"; preview: string; content: string };
type ProcessedMessage = Omit<ChatMessage, "contentBlocks"> & {
  blocks: RenderedBlock[];
  contentBlocks: Array<ContentBlock | LogEntryBlock>;
};
type ImageAttachment = NonNullable<ChatMessage["images"]>[number];

const props = defineProps<{
  message: ProcessedMessage;
  index: number;
  isLoading: boolean;
  currentAnalyzingMessage: string;
  expandedToolCalls: Set<string>;
  expandedLogEntries: Set<string>;
}>();

const emit = defineEmits<{
  (e: "toggle-tool-call", blockIndex: number): void;
  (e: "toggle-log-entry", blockIndex: number): void;
  (e: "navigate", action: NavigationAction): void;
  (e: "retry", message: ProcessedMessage): void;
  (e: "like"): void;
  (e: "dislike"): void;
  (e: "preview-image", img: ImageAttachment): void;
}>();

const { t } = useI18nTyped();

// Positional key shape must match the shell's toggleLogEntryExpanded.
const isLogEntryExpanded = (blockIndex: number) =>
  props.expandedLogEntries.has(`${props.index}-${blockIndex}`);
</script>

<template>
  <div
    class="message rounded-default border-border-default shadow-text-heading/10 border p-3 shadow-md"
    :class="[
      message.role,
      message.role === 'user'
        ? 'text-text-body dark:text-text-secondary ms-10 w-[calc(100%-2.5rem)] [background:var(--color-chat-bubble-ai)]'
        : 'bg-surface-base text-text-body dark:text-text-secondary ms-0 w-full',
      { 'error-message': message.content.startsWith('Error:') },
    ]"
  >
    <div class="message-content flex w-full items-start gap-1.5">
      <div
        v-if="message.role === 'user'"
        class="text-text-inverse inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full [background:var(--color-gradient-ai)]"
      >
        <OIcon size="sm" name="person" class="text-text-inverse" />
      </div>
      <div
        class="message-blocks flex max-w-full min-w-0 flex-1 flex-col gap-0 overflow-x-auto bg-transparent wrap-break-word [word-wrap:break-word]"
      >
        <!-- Loading indicator inside message box for empty assistant messages -->
        <div
          v-if="
            message.role === 'assistant' &&
            (!message.contentBlocks || message.contentBlocks.length === 0) &&
            (!message.content || message.content.trim() === '') &&
            isLoading
          "
          class="inline-loading text-text-secondary flex items-center gap-2.5 py-2 text-sm"
        >
          <OSpinner variant="dots" size="sm" />
          <span>{{ currentAnalyzingMessage }}</span>
        </div>
        <!-- Render contentBlocks in sequence (interleaved tool calls + text) -->
        <template
          v-for="(block, blockIndex) in message.contentBlocks"
          :key="'cb-' + blockIndex"
        >
          <!-- Tool call block - expandable -->
          <O2AIChatToolCallBlock
            v-if="block.type === 'tool_call'"
            :block="block"
            :message-index="index"
            :block-index="blockIndex"
            :expanded-keys="expandedToolCalls"
            @toggle="emit('toggle-tool-call', blockIndex)"
            @navigate="(action: NavigationAction) => emit('navigate', action)"
          />
          <!-- Log Entry block - expandable -->
          <div
            v-else-if="block.type === 'log_entry'"
            class="log-entry-item rounded-default text-text-secondary dark:bg-surface-panel dark:border-border-default dark:hover:bg-surface-panel dark:hover:border-text-secondary mb-1 flex cursor-pointer flex-col px-2.5 py-1.5 text-xs [background:color-mix(in_srgb,var(--color-info)_8%,transparent)] hover:[background:color-mix(in_srgb,var(--color-info)_12%,transparent)] dark:border"
            @click="emit('toggle-log-entry', blockIndex)"
          >
            <div class="log-entry-header flex items-center gap-1.5">
              <OIcon name="description" size="xs" />
              <span
                class="log-entry-info flex-1 overflow-hidden text-xs font-medium text-ellipsis whitespace-nowrap"
              >
                {{ block.preview }}
              </span>
              <OIcon
                :name="
                  isLogEntryExpanded(blockIndex) ? 'expand-less' : 'expand-more'
                "
                size="sm"
                class="expand-icon opacity-60 transition-transform duration-200"
              />
            </div>
            <!-- Expandable details -->
            <div
              v-if="isLogEntryExpanded(blockIndex)"
              class="log-entry-details mt-2.5"
              @click.stop
            >
              <div
                class="log-entry-content rounded-default bg-surface-base border-border-default dark:bg-surface-panel relative overflow-hidden border shadow-sm dark:shadow-sm"
              >
                <OButton
                  variant="ghost"
                  size="icon-xs-circle"
                  class="copy-btn rounded-default absolute top-2 right-2 z-1 px-2 py-1 opacity-60 [background:color-mix(in_srgb,var(--color-text-heading)_10%,transparent)] hover:opacity-100 hover:[background:color-mix(in_srgb,var(--color-text-heading)_8%,transparent)] dark:hover:[background:color-mix(in_srgb,var(--color-text-heading)_15%,transparent)]"
                  @click.stop="copyToClipboard(block.content, t)"
                >
                  <OIcon name="content-copy" size="sm" />
                  <OTooltip :content="t('aiAssistant.copyContent')" />
                </OButton>
                <code
                  class="log-entry-code text-2xs bg-surface-base text-text-body dark:text-text-secondary block max-h-75 cursor-text overflow-y-auto p-3 pe-10 font-mono leading-relaxed whitespace-pre-wrap select-text [word-wrap:break-word] dark:[background:var(--color-syntax-bg)]"
                  v-html="formatLogEntryContent(block.content)"
                ></code>
              </div>
            </div>
          </div>
          <!-- Stream-level error block -->
          <div
            v-else-if="block.type === 'error'"
            class="stream-error-block rounded-default border-border-default text-compact text-text-secondary mb-2 flex flex-col border-s-3 px-3 py-2.5 [background:color-mix(in_srgb,var(--color-status-negative)_6%,transparent)] dark:[background:color-mix(in_srgb,var(--color-status-negative)_10%,transparent)]"
          >
            <div class="stream-error-header flex items-center gap-2">
              <OIcon name="warning" size="sm" />
              <span class="stream-error-message text-status-negative font-medium">{{
                block.message
              }}</span>
            </div>
            <div
              v-if="block.suggestion"
              class="stream-error-suggestion mt-1.5 ps-6 text-xs italic opacity-85"
            >
              {{ block.suggestion }}
            </div>
            <div
              v-if="block.recoverable"
              class="stream-error-recoverable text-2xs mt-1 ps-6 opacity-70"
            >
              {{ t("aiAssistant.errorMayBeTemporary") }}
            </div>
          </div>
          <!-- Navigation block - standalone navigation button -->
          <div
            v-else-if="block.type === 'navigation' && block.navigationAction"
            class="navigation-block my-1 [background:color-mix(in_srgb,var(--color-info)_8%,transparent)] dark:[background:color-mix(in_srgb,var(--color-info)_12%,transparent)]"
          >
            <OButton
              variant="primary"
              size="xs"
              class="navigation-block-btn text-compact"
              @click="emit('navigate', block.navigationAction)"
            >
              <template #icon-left><OIcon :name="'open-in-new'" size="sm" /></template>
              {{ block.navigationAction.label }}
            </OButton>
          </div>
          <!-- Text block - render with markdown processing -->
          <template v-else-if="block.type === 'text' && block.text">
            <template
              v-for="(textBlock, tbIndex) in processTextBlock(block.text)"
              :key="'tb-' + blockIndex + '-' + tbIndex"
            >
              <div
                v-if="textBlock.type === 'code'"
                class="code-block rounded-default m-0 overflow-hidden"
              >
                <div
                  class="code-block-header bg-surface-subtle flex items-center justify-between px-2 py-1"
                >
                  <span
                    v-if="textBlock.language"
                    class="code-type-label rounded-default text-theme-accent dark:text-text-secondary px-1.5 py-0.5 text-xs font-semibold [background:color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)]"
                  >
                    {{ getLanguageDisplay(textBlock.language) }}
                  </span>
                  <OButton
                    variant="ghost"
                    size="xs"
                    class="copy-button"
                    @click="copyToClipboard(textBlock.content, t)"
                  >
                    <OIcon size="sm" name="content-copy" />
                    <span class="ms-1">{{ t("common.copy") }}</span>
                  </OButton>
                </div>
                <span class="generated-code-block">
                  <code
                    :class="['hljs', textBlock.language]"
                    v-html="textBlock.highlightedContent"
                  ></code>
                </span>
                <div
                  class="code-block-footer flex w-full items-center justify-between px-2 py-1"
                >
                  <OButton
                    variant="ghost"
                    size="xs"
                    class="retry-button"
                    @click="emit('retry', message)"
                  >
                    <OIcon size="sm" name="refresh" />
                    <span class="ms-1">{{ t("common.retry") }}</span>
                  </OButton>
                </div>
              </div>
              <div
                v-else
                class="text-block w-full max-w-full wrap-break-word [&:not(:last-child)]:mb-1"
                v-html="processHtmlBlock(textBlock.content)"
              ></div>
            </template>
          </template>
        </template>
        <!-- Fallback for messages without contentBlocks (user messages or old assistant messages) -->
        <template v-if="!message.contentBlocks || message.contentBlocks.length === 0">
          <!-- Display images for user messages -->
          <div
            v-if="message.role === 'user' && message.images && message.images.length > 0"
            class="message-images mb-2 flex flex-wrap gap-2"
          >
            <div
              v-for="(img, imgIndex) in message.images"
              :key="'img-' + imgIndex"
              class="message-image-item"
            >
              <img
                :src="'data:' + img.mimeType + ';base64,' + img.data"
                :alt="img.filename"
                class="rounded-default border-border-default max-h-37.5 max-w-50 cursor-pointer border object-contain [transition:transform_0.2s_ease,box-shadow_0.2s_ease] hover:scale-102 hover:shadow-md"
                @click="emit('preview-image', img)"
              />
              <OTooltip :content="raw(img.filename)" />
            </div>
          </div>
          <template v-for="(block, blockIndex) in message.blocks" :key="'fb-' + blockIndex">
            <div
              v-if="block.type === 'code'"
              class="code-block rounded-default m-0 overflow-hidden"
            >
              <div
                class="code-block-header bg-surface-subtle flex items-center justify-between px-2 py-1"
              >
                <span
                  v-if="block.language"
                  class="code-type-label rounded-default text-theme-accent dark:text-text-secondary px-1.5 py-0.5 text-xs font-semibold [background:color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)]"
                >
                  {{ getLanguageDisplay(block.language) }}
                </span>
                <OButton
                  variant="ghost"
                  size="xs"
                  class="copy-button"
                  @click="copyToClipboard(block.content, t)"
                >
                  <OIcon size="sm" name="content-copy" />
                  <span class="ms-1">{{ t("common.copy") }}</span>
                </OButton>
              </div>
              <span class="generated-code-block">
                <code
                  :class="['hljs', block.language]"
                  v-html="block.highlightedContent"
                ></code>
              </span>
            </div>
            <div
              v-else
              class="text-block w-full max-w-full wrap-break-word [&:not(:last-child)]:mb-1"
              v-html="processHtmlBlock(block.content)"
            ></div>
          </template>
        </template>
        <!-- Feedback buttons for assistant messages -->
        <div
          v-if="
            message.role === 'assistant' && message.content && message.content.trim() !== ''
          "
          class="feedback-buttons mt-1 flex items-center gap-0.5 *:transition-opacity *:duration-200 [&>*:hover]:opacity-100"
          :class="message.feedback ? '*:opacity-100' : '*:opacity-50'"
        >
          <OButton
            variant="ghost"
            size="icon-xs-circle"
            :disabled="message.feedback === 'thumbs_up'"
            :class="message.feedback === 'thumbs_up' ? 'text-accent opacity-100!' : ''"
            data-test="o2-ai-chat-thumbs-up-btn"
            @click="emit('like')"
          >
            <OIcon name="thumb-up-off-alt" size="xs" />
            <OTooltip :content="t('aiAssistant.helpful')" />
          </OButton>
          <OButton
            variant="ghost"
            size="icon-xs-circle"
            :disabled="message.feedback === 'thumbs_down'"
            :class="message.feedback === 'thumbs_down' ? 'text-accent opacity-100!' : ''"
            data-test="o2-ai-chat-thumbs-down-btn"
            @click="emit('dislike')"
          >
            <OIcon name="thumb-down-off-alt" size="xs" />
            <OTooltip :content="t('aiAssistant.notHelpful')" />
          </OButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* keep(generated-content): markdown/log/code markup is injected with v-html, so
   it carries no scope attribute and cannot take utility classes — it can only be
   reached from here through :deep().
   keep(lib-override:hljs): highlight.js emits its own .hljs-* class names; the
   token mapping below mirrors lib/core/Code/OCodeBlock.vue exactly (D6). */

/* ============================================================
   keep(generated-content) — markdown rendered from v-html inside .text-block.
   `!important` retained: these fight the global base-elements typography layer.
   ============================================================ */
.text-block :deep(h1) {
  font-size: var(--text-2xl) !important;
  font-weight: 600 !important;
  margin: 1rem 0 0.5rem 0 !important;
  line-height: 1.3 !important;
}
.text-block :deep(h2) {
  font-size: var(--text-xl) !important;
  font-weight: 600 !important;
  margin: 0.875rem 0 0.4375rem 0 !important;
  line-height: 1.3 !important;
}
.text-block :deep(h3) {
  font-size: var(--text-lg) !important;
  font-weight: 600 !important;
  margin: 0.75rem 0 0.375rem 0 !important;
  line-height: 1.3 !important;
}
.text-block :deep(h4) {
  font-size: var(--text-base) !important;
  font-weight: 600 !important;
  margin: 0.625rem 0 0.3125rem 0 !important;
  line-height: 1.3 !important;
}
.text-block :deep(h5) {
  font-size: var(--text-sm) !important;
  font-weight: 600 !important;
  margin: 0.5rem 0 0.25rem 0 !important;
  line-height: 1.3 !important;
}
.text-block :deep(h6) {
  font-size: var(--text-xs) !important;
  font-weight: 600 !important;
  margin: 0.5rem 0 0.25rem 0 !important;
  line-height: 1.3 !important;
}

.text-block :deep(table) {
  max-width: 100%;
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  overflow-x: auto;
  display: block;
  white-space: nowrap;
}
.text-block :deep(th),
.text-block :deep(td) {
  padding: 0.5rem 0.75rem;
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel border must not scale with text or it smears at fractional zoom */
  border: 1px solid var(--color-border-default);
  word-wrap: break-word;
  overflow-wrap: break-word;
  text-overflow: ellipsis;
  overflow: hidden;
}

.text-block :deep(p),
.text-block :deep(div),
.text-block :deep(span) {
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
  max-width: 100%;
}

.text-block :deep(ol) {
  list-style-type: decimal;
  padding-left: 1.5em;
  margin: 0.5em 0;
}
.text-block :deep(ul) {
  list-style-type: disc;
  padding-left: 1.5em;
  margin: 0.5em 0;
}
.text-block :deep(li) {
  margin: 0.25em 0;
}

/* ============================================================
   keep(generated-content) — code blocks.
   .generated-code-block is emitted BOTH from the template and by the markdown
   renderer (which rewrites <pre> into <span class="generated-code-block">), so
   it must be reachable through :deep() either way. The background/border are
   set here rather than as utilities because they have to beat .hljs below,
   which is unlayered and would otherwise win over @layer utilities.
   ============================================================ */
.message-blocks :deep(.generated-code-block),
.text-block :deep(pre) {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  margin: 0;
  padding: 0;
  line-height: 1.4;
  max-width: 100%;
  overflow-x: auto;
}
.message-blocks :deep(.generated-code-block code),
.text-block :deep(pre code) {
  display: block;
  padding: 0.5rem;
  margin: 0;
  max-width: 100%;
  background-color: var(--color-surface-base);
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel border must not scale with text or it smears at fractional zoom */
  border: 1px solid var(--color-border-subtle);
  border-top: none;
}

/* Markdown lists can nest a fenced block; hljs sets the palette, these two
   only need the reset. */
.text-block :deep(ul pre),
.text-block :deep(ol pre) {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  margin: 0;
  padding: 0;
}

/* ============================================================
   keep(generated-content) — formatLogEntryContent() emits these json spans.
   ============================================================ */
.log-entry-code :deep(.json-key) {
  color: var(--color-json-key);
  font-weight: 600;
}
.log-entry-code :deep(.json-string) {
  color: var(--color-json-string);
}
.log-entry-code :deep(.json-number) {
  color: var(--color-json-number);
}
.log-entry-code :deep(.json-boolean) {
  color: var(--color-json-boolean);
  font-weight: 600;
}
.log-entry-code :deep(.json-null) {
  color: var(--color-json-null);
  font-weight: 600;
}

/* ============================================================
   keep(lib-override:hljs) — highlight.js output. Token mapping mirrors
   lib/core/Code/OCodeBlock.vue (D6); tokens flip via dark.css, so one rule set
   covers both themes.
   ============================================================ */
.message-blocks :deep(.hljs) {
  display: block;
  overflow-x: auto;
  padding: 0.5em;
  color: var(--color-syntax-text);
  background: var(--color-syntax-bg);
}
.message-blocks :deep(.hljs-doctag),
.message-blocks :deep(.hljs-keyword),
.message-blocks :deep(.hljs-meta .hljs-keyword),
.message-blocks :deep(.hljs-template-tag),
.message-blocks :deep(.hljs-template-variable),
.message-blocks :deep(.hljs-type),
.message-blocks :deep(.hljs-variable.language_) {
  color: var(--color-syntax-keyword);
}
.message-blocks :deep(.hljs-title),
.message-blocks :deep(.hljs-title.class_),
.message-blocks :deep(.hljs-title.class_.inherited__),
.message-blocks :deep(.hljs-title.function_) {
  color: var(--color-syntax-function);
}
.message-blocks :deep(.hljs-attr),
.message-blocks :deep(.hljs-attribute),
.message-blocks :deep(.hljs-literal),
.message-blocks :deep(.hljs-meta),
.message-blocks :deep(.hljs-number),
.message-blocks :deep(.hljs-operator),
.message-blocks :deep(.hljs-variable),
.message-blocks :deep(.hljs-selector-attr),
.message-blocks :deep(.hljs-selector-class),
.message-blocks :deep(.hljs-selector-id) {
  color: var(--color-syntax-number);
}
.message-blocks :deep(.hljs-regexp),
.message-blocks :deep(.hljs-string),
.message-blocks :deep(.hljs-meta .hljs-string) {
  color: var(--color-syntax-string);
}
.message-blocks :deep(.hljs-built_in),
.message-blocks :deep(.hljs-symbol) {
  color: var(--color-syntax-builtin);
}
.message-blocks :deep(.hljs-comment),
.message-blocks :deep(.hljs-code),
.message-blocks :deep(.hljs-formula) {
  color: var(--color-syntax-comment);
}
.message-blocks :deep(.hljs-name),
.message-blocks :deep(.hljs-quote),
.message-blocks :deep(.hljs-selector-tag),
.message-blocks :deep(.hljs-selector-pseudo) {
  color: var(--color-syntax-tag);
}
.message-blocks :deep(.hljs-subst) {
  color: var(--color-syntax-text);
}
.message-blocks :deep(.hljs-section) {
  color: var(--color-syntax-number);
  font-weight: 600;
}
.message-blocks :deep(.hljs-bullet) {
  color: var(--color-syntax-bullet);
}
.message-blocks :deep(.hljs-emphasis) {
  color: var(--color-syntax-text);
  font-style: italic;
}
.message-blocks :deep(.hljs-strong) {
  color: var(--color-syntax-text);
  font-weight: 600;
}
.message-blocks :deep(.hljs-addition) {
  color: var(--color-syntax-addition-fg);
  background-color: var(--color-syntax-addition-bg);
}
.message-blocks :deep(.hljs-deletion) {
  color: var(--color-syntax-deletion-fg);
  background-color: var(--color-syntax-deletion-bg);
}
</style>
