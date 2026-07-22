<template>
  <div
    class="chat-container w-full h-full flex flex-col overflow-hidden rounded-default text-text-body bg-card-glass-solid [box-shadow:0_0_5px_1px_var(--color-hover-shadow)]"
    :class="[{ 'chat-open': isOpen }]"
  >
    <div v-if="isOpen" class="chat-content-wrapper flex flex-col h-full bg-transparent">
      <div
        class="chat-header flex justify-between items-end shrink-0 z-2 px-3 pt-0 pb-1 border-b border-separator bg-surface-base"
        :style="{ height: headerHeight ? headerHeight + 'px' : '' }"
      >
        <div class="chat-title flex justify-between items-center w-full font-bold">
          <div class="flex items-center gap-2">
            <div class="inline-flex w-6 h-6 rounded-full overflow-hidden">
              <img :src="o2AiTitleLogo" class="w-full h-full object-cover" />
            </div>

            <ODropdown @update:open="(v) => v && loadHistory()">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="sm"
                  class="chat-title-dropdown flex items-center overflow-hidden max-w-52.5 h-8 min-h-8 px-3 py-1.5 rounded-default transition-colors duration-200 hover:bg-interactive-hover-bg"
                >
                  <div class="flex items-center gap-2 max-w-55">
                    <span
                      class="chat-title-text text-sm font-medium truncate block max-w-45 text-text-body"
                    >
                      {{ displayedTitle || "New Chat" }}
                      <OTooltip
                        v-if="displayedTitle && displayedTitle.length > 25"
                        :sideOffset="8"
                        side="bottom"
                        align="center"
                        :content="displayedTitle"
                      />
                    </span>
                    <OIcon name="arrow-drop-down" size="md" class="flex-shrink-0" />
                  </div>
                </OButton>
              </template>
              <!-- History menu with search -->
              <div class="history-menu-container relative max-h-112.5 flex flex-col w-75">
                <div
                  class="search-history-bar-sticky sticky top-0 z-2 bg-surface-base p-2 border-b border-separator shrink-0"
                >
                  <OSearchInput
                    v-model="historySearchTerm"
                    placeholder="Search chat history"
                    class="mt-1"
                  />
                </div>
                <div
                  class="history-list-container flex-1 overflow-y-auto overflow-x-hidden max-h-87.5 min-w-50 w-75 max-w-75 border border-border-default"
                >
                  <ODropdownItem
                    v-for="chat in filteredChatHistory"
                    :key="chat.id"
                    class="history-item relative group"
                    @select="loadChat(chat.id)"
                  >
                    <div class="flex items-center justify-between w-full">
                      <div class="flex-1 overflow-hidden">
                        <div class="text-compact truncate">
                          {{ chat.title }}
                        </div>
                        <div class="text-2xs text-text-secondary">
                          {{ formatTime(chat.timestamp) }}
                        </div>
                      </div>
                      <OButton
                        variant="ghost"
                        size="icon-xs-circle"
                        class="delete-history-btn opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                        @click.stop="deleteChat(chat.id)"
                      >
                        <OIcon name="delete" size="sm" />
                        <OTooltip content="Delete chat" />
                      </OButton>
                    </div>
                  </ODropdownItem>
                  <div
                    v-if="filteredChatHistory.length === 0"
                    class="text-center text-text-muted p-2"
                  >
                    No matching chats found
                  </div>
                </div>

                <!-- Clear all conversations button -->
                <div
                  v-if="filteredChatHistory.length > 0"
                  class="clear-all-container bg-surface-base p-2 border-t border-separator shrink-0"
                >
                  <ODropdownSeparator />
                  <OButton
                    variant="ghost"
                    class="clear-all-btn w-full text-[var(--color-status-negative)] text-compact hover:bg-[color-mix(in_srgb,var(--color-status-negative)_10%,transparent)]"
                    @click.stop="clearAllConversations"
                  >
                    <template #icon-left>
                      <OIcon name="delete-sweep" size="sm" />
                    </template>
                    Clear all conversations
                  </OButton>
                </div>
              </div>
            </ODropdown>
          </div>

          <div class="flex items-center gap-1 chat-header-actions">
            <!-- Edit title button -->
            <OButton
              v-if="currentChatId"
              variant="ghost"
              size="icon-sm"
              @click.stop="openEditTitleDialog"
            >
              <OIcon name="edit" size="sm" />
              <OTooltip content="Edit title" />
            </OButton>
            <OButton variant="ghost" size="icon-sm" @click="addNewChat">
              <OIcon name="add" size="sm" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              data-test="ai-chat-expand-btn"
              @click="toggleExpand"
            >
              <OIcon
                :name="store.state.isAiChatExpanded ? 'close-fullscreen' : 'open-in-full'"
                size="sm"
              />
              <OTooltip
                :content="`${store.state.isAiChatExpanded ? 'Collapse' : 'Expand'} (${isMac ? '⌘' : 'Ctrl+'}B)`"
              />
            </OButton>
            <OButton variant="ghost" size="icon-sm" @click="$emit('close')">
              <OIcon name="close" size="sm" />
            </OButton>
          </div>
        </div>
      </div>
      <OSeparator class="bg-separator" />

      <!-- History Panel -->
      <ODrawer
        data-test="o2-ai-chat-history-drawer"
        bleed
        v-model:open="showHistory"
        size="sm"
        title="Chat History"
      >
        <ul class="flex flex-col divide-y divide-border">
          <li
            v-for="chat in chatHistory"
            :key="chat.id"
            :data-test="`o2-ai-chat-history-item-${chat.id}`"
            class="flex flex-col px-3 py-2 cursor-pointer hover:bg-muted/50"
            @click="loadChat(chat.id)"
          >
            <span class="text-sm">{{ chat.title }}</span>
            <span class="block text-xs text-muted-foreground">
              {{ new Date(chat.timestamp).toLocaleString() }}
            </span>
            <span class="block text-xs text-muted-foreground"> Model: {{ chat.model }} </span>
          </li>
        </ul>
      </ODrawer>

      <!-- Edit Title Dialog -->
      <ODialog
        data-test="o2-ai-chat-edit-title-dialog"
        v-model:open="showEditTitleDialog"
        size="sm"
        title="Edit Chat Title"
        secondary-button-label="Cancel"
        primary-button-label="Save"
        @click:secondary="showEditTitleDialog = false"
        @click:primary="saveEditedTitle"
      >
        <OInput
          v-model="editingTitle"
          autofocus
          @keyup.enter="saveEditedTitle"
          placeholder="Enter chat title"
        />
      </ODialog>

      <!-- Delete Chat Confirmation Dialog -->
      <ConfirmDialog
        v-model="showDeleteChatConfirmDialog"
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This action cannot be undone."
        @update:ok="confirmDeleteChat"
        @update:cancel="showDeleteChatConfirmDialog = false"
      />

      <!-- Clear All Conversations Confirmation Dialog -->
      <ConfirmDialog
        v-model="showClearAllConfirmDialog"
        title="Clear All Conversations"
        message="Are you sure you want to clear all conversations? This action cannot be undone."
        @update:ok="confirmClearAllConversations"
        @update:cancel="showClearAllConfirmDialog = false"
      />

      <!-- Image Preview Dialog -->
      <ODialog
        data-test="o2-ai-chat-image-preview-dialog"
        v-model:open="showImagePreview"
        @update:open="(v) => !v && closeImagePreview()"
        size="lg"
        :title="previewImage?.filename"
      >
        <div class="flex justify-center">
          <img
            v-if="previewImage"
            :src="'data:' + previewImage.mimeType + ';base64,' + previewImage.data"
            :alt="previewImage.filename"
            class="max-w-full max-h-[80vh] object-contain"
          />
        </div>
      </ODialog>

      <div
        class="chat-content relative flex flex-col flex-1 min-h-0 overflow-hidden bg-transparent"
      >
        <div
          class="messages-container flex flex-col flex-1 min-h-0 overflow-y-auto gap-4 p-2 w-full max-w-225 mx-auto bg-transparent"
          ref="messagesContainer"
          @scroll="checkIfShouldAutoScroll"
        >
          <div
            v-if="chatMessages.length === 0"
            class="welcome-section flex flex-1 items-center justify-center rounded-default"
            :class="
              centeredStart
                ? 'p-0 mb-0 bg-transparent'
                : 'p-6 mb-6 [background:linear-gradient(to_right,color-mix(in_srgb,var(--color-theme-accent)_5%,transparent),color-mix(in_srgb,var(--color-theme-accent)_10%,transparent))]'
            "
          >
            <!-- Home tab: rich V2 welcome -->
            <O2AIHomeWelcome v-if="centeredStart" @select-prompt="selectWelcomePrompt" />
            <!-- Sidepanel: minimal logo + title -->
            <div v-else class="flex flex-col items-center justify-center h-full w-full">
              <div class="flex flex-col items-center">
                <img :src="o2AiTitleLogo" />
                <div class="relative inline-block">
                  <span class="text-sm font-[600] ml-7.5 text-center">O2 Assistant</span>
                  <!-- Same shared Beta tag as the Workflows screens. -->
                  <BetaBadge class="ml-2" />
                </div>
              </div>
            </div>
          </div>
          <div
            v-for="(message, index) in processedMessages"
            :key="index"
            class="message p-3 rounded-default border border-border-default [box-shadow:0_1px_2px_color-mix(in_srgb,var(--color-text-heading)_10%,transparent)]"
            :class="[
              message.role,
              message.role === 'user'
                ? 'ml-10 w-[calc(100%-2.5rem)] [background:var(--color-chat-bubble-ai)] text-text-body dark:text-text-secondary'
                : 'ml-0 w-full bg-surface-base text-text-body dark:text-text-secondary',
              { 'error-message': message.content.startsWith('Error:') },
            ]"
          >
            <div class="message-content flex items-start gap-1.5 w-full">
              <div
                v-if="message.role === 'user'"
                class="inline-flex items-center justify-center w-6 h-6 rounded-full text-text-inverse [background:var(--color-gradient-ai)] shrink-0"
              >
                <OIcon size="sm" name="person" class="text-text-inverse" />
              </div>
              <div
                class="message-blocks flex flex-col flex-1 gap-0 min-w-0 max-w-full overflow-x-auto [word-wrap:break-word] wrap-break-word bg-transparent"
              >
                <!-- Loading indicator inside message box for empty assistant messages -->
                <div
                  v-if="
                    message.role === 'assistant' &&
                    (!message.contentBlocks || message.contentBlocks.length === 0) &&
                    (!message.content || message.content.trim() === '') &&
                    isLoading
                  "
                  class="inline-loading flex items-center gap-2.5 py-2 text-text-secondary text-sm"
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
                  <div
                    v-if="block.type === 'tool_call'"
                    class="tool-call-item flex flex-col px-3 py-2 rounded-default text-compact mb-2"
                    :class="[
                      { 'has-details': hasToolCallDetails(block) },
                      {
                        error: block.success === false && !block.pendingConfirmation,
                      },
                      {
                        'pending-confirmation':
                          block.pendingConfirmation && block.tool !== 'navigation_action',
                      },
                      {
                        'pending-navigation':
                          block.pendingConfirmation && block.tool === 'navigation_action',
                      },
                    ]"
                    @click="
                      hasToolCallDetails(block) &&
                      !block.pendingConfirmation &&
                      toggleToolCallExpanded(index, blockIndex)
                    "
                  >
                    <div class="tool-call-header flex items-center gap-2">
                      <OIcon
                        :name="
                          block.pendingConfirmation
                            ? block.tool === 'navigation_action'
                              ? 'open-in-new'
                              : 'help-outline'
                            : block.success === false
                              ? 'error'
                              : 'check-circle'
                        "
                        size="sm"
                        :class="
                          block.pendingConfirmation
                            ? block.tool === 'navigation_action'
                              ? 'text-accent'
                              : 'text-warning'
                            : block.success === false
                              ? 'text-status-negative'
                              : 'text-status-positive'
                        "
                      />
                      <span class="tool-call-name font-medium flex-1">
                        {{ formatToolCallMessage(block).text
                        }}<strong v-if="formatToolCallMessage(block).highlight">{{
                          formatToolCallMessage(block).highlight
                        }}</strong
                        >{{ formatToolCallMessage(block).suffix }}
                      </span>
                      <!-- Navigation icon -->
                      <OIcon
                        v-if="block.navigationAction && !block.pendingConfirmation"
                        name="open-in-new"
                        size="xs"
                        class="navigation-icon cursor-pointer ml-auto opacity-70 transition-opacity duration-200 hover:opacity-100"
                        @click.stop="handleNavigationAction(block.navigationAction)"
                      >
                        <OTooltip :content="block.navigationAction.label" />
                      </OIcon>
                      <OIcon
                        v-if="hasToolCallDetails(block) && !block.pendingConfirmation"
                        :name="
                          isToolCallExpanded(index, blockIndex) ? 'expand-less' : 'expand-more'
                        "
                        size="sm"
                        class="expand-icon opacity-60 transition-transform duration-200"
                      />
                    </div>
                    <!-- Expandable details -->
                    <div
                      v-if="isToolCallExpanded(index, blockIndex)"
                      class="tool-call-details mt-2.5 pt-2.5 border-t border-border-default flex flex-col gap-2"
                      @click.stop
                    >
                      <!-- Error details for failed tool calls -->
                      <template v-if="block.success === false">
                        <div v-if="block.resultMessage" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Error</span
                          >
                          <span class="detail-value text-xs select-text text-status-negative">{{
                            block.resultMessage
                          }}</span>
                        </div>
                        <div v-if="block.errorType" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Type</span
                          >
                          <code class="detail-value text-xs select-text">{{
                            block.errorType
                          }}</code>
                        </div>
                        <div v-if="block.suggestion" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Suggestion</span
                          >
                          <span class="detail-value text-xs select-text italic opacity-85">{{
                            block.suggestion
                          }}</span>
                        </div>
                      </template>
                      <!-- Summary details for successful tool calls with summary -->
                      <template v-if="block.success !== false && block.summary">
                        <div
                          v-if="block.summary.count !== undefined"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Results</span
                          >
                          <span class="detail-value text-xs select-text"
                            >{{ block.summary.count }} records</span
                          >
                        </div>
                        <div
                          v-if="block.summary.took !== undefined"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Duration</span
                          >
                          <span class="detail-value text-xs select-text"
                            >{{ block.summary.took }}ms</span
                          >
                        </div>
                        <!-- CLI tool summary (return_code / stdout_lines / stderr_lines / truncated) -->
                        <div
                          v-if="block.summary.return_code !== undefined"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Exit code</span
                          >
                          <code class="detail-value text-xs select-text">{{
                            block.summary.return_code
                          }}</code>
                        </div>
                        <div
                          v-if="block.summary.stdout_lines !== undefined"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Stdout</span
                          >
                          <span class="detail-value text-xs select-text"
                            >{{ block.summary.stdout_lines }} lines</span
                          >
                        </div>
                        <div
                          v-if="block.summary.stderr_lines"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Stderr</span
                          >
                          <span class="detail-value text-xs select-text"
                            >{{ block.summary.stderr_lines }} lines</span
                          >
                        </div>
                        <div v-if="block.summary.truncated" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Output</span
                          >
                          <span class="detail-value text-xs select-text">truncated</span>
                        </div>
                      </template>
                      <!-- Existing context details -->
                      <div
                        v-if="getToolCallDisplayData(block.context)?.query"
                        class="detail-item flex flex-col gap-1"
                      >
                        <div class="detail-header flex items-center justify-between">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Query</span
                          >
                          <OButton
                            variant="ghost"
                            size="icon-xs-circle"
                            class="copy-btn opacity-60 hover:opacity-100"
                            @click.stop="
                              copyToClipboard(getToolCallDisplayData(block.context)?.query)
                            "
                          >
                            <OIcon name="content-copy" size="sm" />
                            <OTooltip content="Copy query" />
                          </OButton>
                        </div>
                        <code
                          class="detail-value query-value text-xs select-text font-mono p-2 rounded-default whitespace-pre-wrap break-all cursor-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >{{ getToolCallDisplayData(block.context)?.query }}</code
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.stream"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                          >Stream</span
                        >
                        <code class="detail-value text-xs select-text">{{
                          getToolCallDisplayData(block.context)?.stream
                        }}</code>
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.type"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                          >Type</span
                        >
                        <code class="detail-value text-xs select-text">{{
                          getToolCallDisplayData(block.context)?.type
                        }}</code>
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.start_time"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                          >Start</span
                        >
                        <span class="detail-value text-xs select-text">{{
                          formatTimestamp(getToolCallDisplayData(block.context)?.start_time)
                        }}</span>
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.end_time"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                          >End</span
                        >
                        <span class="detail-value text-xs select-text">{{
                          formatTimestamp(getToolCallDisplayData(block.context)?.end_time)
                        }}</span>
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.from !== undefined"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                          >From</span
                        >
                        <span class="detail-value text-xs select-text">{{
                          getToolCallDisplayData(block.context)?.from
                        }}</span>
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.size !== undefined"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                          >Size</span
                        >
                        <span class="detail-value text-xs select-text">{{
                          getToolCallDisplayData(block.context)?.size
                        }}</span>
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.query_type"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                          >Query Type</span
                        >
                        <code class="detail-value text-xs select-text">{{
                          getToolCallDisplayData(block.context)?.query_type
                        }}</code>
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.vrl"
                        class="detail-item flex flex-col gap-1"
                      >
                        <div class="detail-header flex items-center justify-between">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >VRL</span
                          >
                          <OButton
                            variant="ghost"
                            size="icon-xs-circle"
                            class="copy-btn opacity-60 hover:opacity-100"
                            @click.stop="
                              copyToClipboard(getToolCallDisplayData(block.context)?.vrl)
                            "
                          >
                            <OIcon name="content-copy" size="sm" />
                            <OTooltip content="Copy VRL" />
                          </OButton>
                        </div>
                        <code
                          class="detail-value query-value text-xs select-text font-mono p-2 rounded-default whitespace-pre-wrap break-all cursor-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >{{ getToolCallDisplayData(block.context)?.vrl }}</code
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.command"
                        class="detail-item flex flex-col gap-1"
                      >
                        <div class="detail-header flex items-center justify-between">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Command</span
                          >
                          <OButton
                            variant="ghost"
                            size="icon-xs-circle"
                            class="copy-btn opacity-60 hover:opacity-100"
                            @click.stop="
                              copyToClipboard(getToolCallDisplayData(block.context)?.command)
                            "
                          >
                            <OIcon name="content-copy" size="sm" />
                            <OTooltip content="Copy command" />
                          </OButton>
                        </div>
                        <code
                          class="detail-value query-value text-xs select-text font-mono p-2 rounded-default whitespace-pre-wrap break-all cursor-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >{{ getToolCallDisplayData(block.context)?.command }}</code
                        >
                      </div>
                      <!-- Tool response: SearchSQL hits -->
                      <template v-if="block.response && block.response.hits">
                        <div class="detail-item flex flex-col gap-1">
                          <div class="detail-header flex items-center justify-between">
                            <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                              >Results</span
                            >
                            <OButton
                              variant="ghost"
                              size="icon-xs-circle"
                              class="copy-btn opacity-60 hover:opacity-100"
                              @click.stop="
                                copyToClipboard(JSON.stringify(block.response.hits, null, 2))
                              "
                            >
                              <OIcon name="content-copy" size="sm" />
                              <OTooltip content="Copy results" />
                            </OButton>
                          </div>
                          <div
                            class="tool-response-hits flex flex-col gap-1 text-xs font-mono px-2 py-1.5 rounded-default max-h-50 overflow-y-auto [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >
                            <div
                              v-for="(hit, hIdx) in block.response.hits"
                              :key="hIdx"
                              class="tool-response-hit flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border-default [&:not(:last-child)]:pb-1"
                            >
                              <span
                                v-for="(val, key) in hit"
                                :key="key"
                                class="hit-field break-all select-text cursor-text"
                              >
                                <span class="hit-key opacity-60 font-semibold">{{ key }}:</span>
                                {{ val }}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div class="tool-response-meta flex flex-wrap gap-1.5 mt-1">
                          <span v-if="block.response.total !== undefined" class="context-tag"
                            >Total: {{ block.response.total }}</span
                          >
                          <span v-if="block.response.took !== undefined" class="context-tag"
                            >Took: {{ block.response.took }}ms</span
                          >
                          <span v-if="block.response.hits_truncated" class="context-tag"
                            >Showing first {{ block.response.hits.length }}</span
                          >
                        </div>
                      </template>
                      <!-- Tool response: testFunction input/output -->
                      <template
                        v-else-if="
                          block.response && (block.response.input || block.response.output)
                        "
                      >
                        <div v-if="block.response.input" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Input Events</span
                          >
                          <div
                            class="tool-response-hits flex flex-col gap-1 text-xs font-mono px-2 py-1.5 rounded-default max-h-50 overflow-y-auto [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >
                            <div
                              v-for="(evt, eIdx) in block.response.input"
                              :key="eIdx"
                              class="tool-response-hit flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border-default [&:not(:last-child)]:pb-1"
                            >
                              <span
                                v-for="(val, key) in evt"
                                :key="key"
                                class="hit-field break-all select-text cursor-text"
                              >
                                <span class="hit-key opacity-60 font-semibold">{{ key }}:</span>
                                {{
                                  typeof val === "string" && val.length > 120
                                    ? val.substring(0, 120) + "..."
                                    : val
                                }}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div v-if="block.response.output" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Output</span
                          >
                          <div
                            class="tool-response-hits flex flex-col gap-1 text-xs font-mono px-2 py-1.5 rounded-default max-h-50 overflow-y-auto [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >
                            <div
                              v-for="(res, rIdx) in block.response.output"
                              :key="rIdx"
                              class="tool-response-hit flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border-default [&:not(:last-child)]:pb-1"
                            >
                              <template v-if="res.event">
                                <span
                                  v-for="(val, key) in res.event"
                                  :key="key"
                                  class="hit-field break-all select-text cursor-text"
                                >
                                  <span class="hit-key opacity-60 font-semibold">{{ key }}:</span>
                                  {{
                                    typeof val === "string" && val.length > 120
                                      ? val.substring(0, 120) + "..."
                                      : val
                                  }}
                                </span>
                              </template>
                              <span
                                v-if="res.message"
                                class="hit-field break-all select-text cursor-text text-status-negative"
                              >
                                <span class="hit-key opacity-60 font-semibold">error:</span>
                                {{ res.message }}
                              </span>
                            </div>
                          </div>
                        </div>
                      </template>
                      <!-- Tool response: list items from normalized { total, items } -->
                      <template
                        v-else-if="
                          block.response &&
                          block.response.items &&
                          Array.isArray(block.response.items)
                        "
                      >
                        <div
                          v-if="block.response.items.length > 0"
                          class="detail-item flex flex-col gap-1"
                        >
                          <div class="detail-header flex items-center justify-between">
                            <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                              >Items</span
                            >
                            <OButton
                              variant="ghost"
                              size="icon-xs-circle"
                              class="copy-btn opacity-60 hover:opacity-100"
                              @click.stop="
                                copyToClipboard(JSON.stringify(block.response.items, null, 2))
                              "
                            >
                              <OIcon name="content-copy" size="sm" />
                              <OTooltip content="Copy items" />
                            </OButton>
                          </div>
                          <div
                            class="tool-response-hits flex flex-col gap-1 text-xs font-mono px-2 py-1.5 rounded-default max-h-50 overflow-y-auto [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >
                            <div
                              v-for="(item, iIdx) in block.response.items"
                              :key="iIdx"
                              class="tool-response-list-item flex flex-col gap-0.5 py-1 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border-default [&:not(:last-child)]:pb-1.5"
                            >
                              <div
                                v-for="(val, key) in item"
                                :key="key"
                                class="hit-field break-all select-text cursor-text"
                              >
                                <span class="hit-key opacity-60 font-semibold">{{ key }}:</span>
                                {{ typeof val === "object" ? JSON.stringify(val) : val }}
                              </div>
                            </div>
                          </div>
                        </div>
                      </template>
                      <!-- Tool response: generic fallback (string or other) -->
                      <div v-else-if="block.response" class="detail-item flex flex-col gap-1">
                        <div class="detail-header flex items-center justify-between">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60"
                            >Response</span
                          >
                          <OButton
                            variant="ghost"
                            size="icon-xs-circle"
                            class="copy-btn opacity-60 hover:opacity-100"
                            @click.stop="
                              copyToClipboard(
                                typeof block.response === 'string'
                                  ? block.response
                                  : JSON.stringify(block.response, null, 2),
                              )
                            "
                          >
                            <OIcon name="content-copy" size="sm" />
                            <OTooltip content="Copy response" />
                          </OButton>
                        </div>
                        <code
                          class="detail-value query-value text-xs select-text font-mono p-2 rounded-default whitespace-pre-wrap break-all cursor-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >{{
                            typeof block.response === "string"
                              ? block.response
                              : JSON.stringify(block.response, null, 2)
                          }}</code
                        >
                      </div>
                    </div>
                  </div>
                  <!-- Log Entry block - expandable -->
                  <div
                    v-else-if="block.type === 'log_entry'"
                    class="log-entry-item flex flex-col px-2.5 py-1.5 rounded-default text-xs mb-1 cursor-pointer text-text-secondary [background:color-mix(in_srgb,var(--color-info)_8%,transparent)] hover:[background:color-mix(in_srgb,var(--color-info)_12%,transparent)] dark:bg-surface-panel dark:border dark:border-border-default dark:hover:bg-surface-panel dark:hover:border-text-secondary"
                    @click="toggleLogEntryExpanded(index, blockIndex)"
                  >
                    <div class="log-entry-header flex items-center gap-1.5">
                      <OIcon name="description" size="xs" />
                      <span
                        class="log-entry-info flex-1 font-medium text-xs overflow-hidden text-ellipsis whitespace-nowrap"
                      >
                        {{ block.preview }}
                      </span>
                      <OIcon
                        :name="
                          isLogEntryExpanded(index, blockIndex) ? 'expand-less' : 'expand-more'
                        "
                        size="sm"
                        class="expand-icon opacity-60 transition-transform duration-200"
                      />
                    </div>
                    <!-- Expandable details -->
                    <div
                      v-if="isLogEntryExpanded(index, blockIndex)"
                      class="log-entry-details mt-2.5"
                      @click.stop
                    >
                      <div
                        class="log-entry-content relative rounded-default border overflow-hidden bg-surface-base border-border-default [box-shadow:0_2px_8px_color-mix(in_srgb,var(--color-black)_8%,transparent)] dark:bg-surface-panel dark:[box-shadow:0_2px_8px_color-mix(in_srgb,var(--color-black)_20%,transparent)]"
                      >
                        <OButton
                          variant="ghost"
                          size="icon-xs-circle"
                          class="copy-btn opacity-60 hover:opacity-100 absolute top-2 right-2 z-1 rounded-default px-2 py-1 [background:color-mix(in_srgb,var(--color-text-heading)_10%,transparent)] hover:[background:color-mix(in_srgb,var(--color-text-heading)_8%,transparent)] dark:hover:[background:color-mix(in_srgb,var(--color-text-heading)_15%,transparent)]"
                          @click.stop="copyToClipboard(block.content)"
                        >
                          <OIcon name="content-copy" size="sm" />
                          <OTooltip content="Copy content" />
                        </OButton>
                        <code
                          class="log-entry-code block font-mono text-2xs leading-relaxed p-3 pr-10 whitespace-pre-wrap [word-wrap:break-word] select-text cursor-text max-h-75 overflow-y-auto bg-surface-base text-text-body dark:[background:var(--color-syntax-bg)] dark:text-text-secondary"
                          v-html="formatLogEntryContent(block.content)"
                        ></code>
                      </div>
                    </div>
                  </div>
                  <!-- Stream-level error block -->
                  <div
                    v-else-if="block.type === 'error'"
                    class="stream-error-block flex flex-col px-3 py-2.5 rounded-default border-l-3 border-border-default mb-2 text-compact text-text-secondary [background:color-mix(in_srgb,var(--color-status-negative)_6%,transparent)] dark:[background:color-mix(in_srgb,var(--color-status-negative)_10%,transparent)]"
                  >
                    <div class="stream-error-header flex items-center gap-2">
                      <OIcon name="warning" size="sm" />
                      <span class="stream-error-message font-medium text-status-negative">{{
                        block.message
                      }}</span>
                    </div>
                    <div
                      v-if="block.suggestion"
                      class="stream-error-suggestion mt-1.5 pl-6 italic text-xs opacity-85"
                    >
                      {{ block.suggestion }}
                    </div>
                    <div
                      v-if="block.recoverable"
                      class="stream-error-recoverable mt-1 pl-6 text-2xs opacity-70"
                    >
                      This error may be temporary. You can try again.
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
                      @click="handleNavigationAction(block.navigationAction)"
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
                          class="code-block-header flex items-center justify-between px-2 py-1 bg-surface-subtle"
                        >
                          <span
                            v-if="textBlock.language"
                            class="code-type-label text-xs font-semibold px-1.5 py-0.5 rounded-default text-theme-accent dark:text-text-secondary [background:color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)]"
                          >
                            {{ getLanguageDisplay(textBlock.language) }}
                          </span>
                          <OButton
                            variant="ghost"
                            size="xs"
                            class="copy-button"
                            @click="copyToClipboard(textBlock.content)"
                          >
                            <OIcon size="sm" name="content-copy" />
                            <span class="ml-1">Copy</span>
                          </OButton>
                        </div>
                        <span class="generated-code-block">
                          <code
                            :class="['hljs', textBlock.language]"
                            v-html="textBlock.highlightedContent"
                          ></code>
                        </span>
                        <div
                          class="code-block-footer flex items-center justify-between w-full px-2 py-1"
                        >
                          <OButton
                            variant="ghost"
                            size="xs"
                            class="retry-button"
                            @click="retryGeneration(message)"
                          >
                            <OIcon size="sm" name="refresh" />
                            <span class="ml-1">Retry</span>
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
                    class="message-images flex flex-wrap gap-2 mb-2"
                  >
                    <div
                      v-for="(img, imgIndex) in message.images"
                      :key="'img-' + imgIndex"
                      class="message-image-item"
                    >
                      <img
                        :src="'data:' + img.mimeType + ';base64,' + img.data"
                        :alt="img.filename"
                        class="max-w-50 max-h-37.5 object-contain rounded-default border border-border-default cursor-pointer [transition:transform_0.2s_ease,box-shadow_0.2s_ease] hover:scale-102 hover:shadow-[0_4px_12px_color-mix(in_srgb,var(--color-black)_15%,transparent)]"
                        @click="openImagePreview(img)"
                      />
                      <OTooltip :content="img.filename" />
                    </div>
                  </div>
                  <template v-for="(block, blockIndex) in message.blocks" :key="'fb-' + blockIndex">
                    <div
                      v-if="block.type === 'code'"
                      class="code-block rounded-default m-0 overflow-hidden"
                    >
                      <div
                        class="code-block-header flex items-center justify-between px-2 py-1 bg-surface-subtle"
                      >
                        <span
                          v-if="block.language"
                          class="code-type-label text-xs font-semibold px-1.5 py-0.5 rounded-default text-theme-accent dark:text-text-secondary [background:color-mix(in_srgb,var(--color-theme-accent)_10%,transparent)]"
                        >
                          {{ getLanguageDisplay(block.language) }}
                        </span>
                        <OButton
                          variant="ghost"
                          size="xs"
                          class="copy-button"
                          @click="copyToClipboard(block.content)"
                        >
                          <OIcon size="sm" name="content-copy" />
                          <span class="ml-1">Copy</span>
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
                  class="feedback-buttons flex items-center gap-0.5 mt-1 *:transition-opacity *:duration-200 [&>*:hover]:opacity-100"
                  :class="message.feedback ? '*:opacity-100' : '*:opacity-50'"
                >
                  <OButton
                    variant="ghost"
                    size="icon-xs-circle"
                    :disabled="message.feedback === 'thumbs_up'"
                    :class="message.feedback === 'thumbs_up' ? 'text-accent opacity-100!' : ''"
                    data-test="o2-ai-chat-thumbs-up-btn"
                    @click="likeCodeBlock(index)"
                  >
                    <OIcon name="thumb-up-off-alt" size="xs" />
                    <OTooltip content="Helpful" />
                  </OButton>
                  <OButton
                    variant="ghost"
                    size="icon-xs-circle"
                    :disabled="message.feedback === 'thumbs_down'"
                    :class="message.feedback === 'thumbs_down' ? 'text-accent opacity-100!' : ''"
                    data-test="o2-ai-chat-thumbs-down-btn"
                    @click="dislikeCodeBlock(index)"
                  >
                    <OIcon name="thumb-down-off-alt" size="xs" />
                    <OTooltip content="Not helpful" />
                  </OButton>
                </div>
              </div>
            </div>
          </div>
          <!-- Completed tool calls during streaming - keep progress visible
               so each step stays on screen instead of flashing away while it
               sits in pendingToolCalls waiting for the assistant's text. -->
          <div
            v-for="(block, pIdx) in pendingToolCalls"
            v-show="block.type === 'tool_call'"
            :key="'pending-tc-' + pIdx"
            class="tool-call-indicator flex items-center rounded-default border border-border-default [background:var(--color-chat-bubble-user)] px-4 py-2 my-1"
          >
            <div class="tool-call-content flex items-center gap-3 w-full">
              <OIcon :name="block.success === false ? 'error' : 'check-circle'" size="sm" />
              <div class="tool-call-info flex flex-col flex-1 min-w-0 gap-1.5">
                <span
                  class="tool-call-message text-sm font-medium opacity-85 text-text-secondary"
                  >{{ block.message }}</span
                >
              </div>
            </div>
          </div>
          <!-- Tool call indicator - shows outside message box -->
          <div
            v-if="activeToolCall"
            class="tool-call-indicator flex items-center rounded-default border border-border-default [background:var(--color-chat-bubble-user)] px-4 py-3 my-2"
          >
            <div class="tool-call-content flex items-center gap-3 w-full">
              <OSpinner variant="dots" size="xs" />
              <div class="tool-call-info flex flex-col flex-1 min-w-0 gap-1.5">
                <span class="tool-call-message text-sm font-semibold text-text-secondary">{{
                  activeToolCall.message
                }}</span>
                <div
                  v-if="getToolCallDisplayData(activeToolCall.context)"
                  class="tool-call-context flex flex-wrap items-center gap-2"
                >
                  <div
                    v-if="getToolCallDisplayData(activeToolCall.context)?.query"
                    class="context-item w-full"
                  >
                    <code
                      class="context-query block font-mono text-xs px-3 py-2 rounded-default whitespace-pre-wrap break-all max-w-full overflow-hidden bg-surface-base border border-border-default text-text-body dark:text-text-secondary"
                      >{{
                        truncateQuery(getToolCallDisplayData(activeToolCall.context)?.query)
                      }}</code
                    >
                  </div>
                  <div
                    v-if="
                      getToolCallDisplayData(activeToolCall.context)?.vrl &&
                      !getToolCallDisplayData(activeToolCall.context)?.query
                    "
                    class="context-item w-full"
                  >
                    <code
                      class="context-query block font-mono text-xs px-3 py-2 rounded-default whitespace-pre-wrap break-all max-w-full overflow-hidden bg-surface-base border border-border-default text-text-body dark:text-text-secondary"
                      >{{
                        truncateQuery(getToolCallDisplayData(activeToolCall.context)?.vrl)
                      }}</code
                    >
                  </div>
                  <span
                    v-if="getToolCallDisplayData(activeToolCall.context)?.stream"
                    class="context-tag inline-flex items-center text-2xs px-2 py-1 rounded-default font-medium text-ai-accent dark:text-text-secondary [background:color-mix(in_srgb,var(--color-ai-accent)_10%,transparent)] dark:[background:color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)]"
                  >
                    Stream:
                    {{ getToolCallDisplayData(activeToolCall.context)?.stream }}
                  </span>
                  <span
                    v-if="getToolCallDisplayData(activeToolCall.context)?.query_type"
                    class="context-tag inline-flex items-center text-2xs px-2 py-1 rounded-default font-medium text-ai-accent dark:text-text-secondary [background:color-mix(in_srgb,var(--color-ai-accent)_10%,transparent)] dark:[background:color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)]"
                  >
                    Type:
                    {{ getToolCallDisplayData(activeToolCall.context)?.query_type }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- Standalone loading indicator - only shown when loading with no tool calls -->
          <div
            v-if="isLoading && !activeToolCall"
            class="tool-call-indicator flex items-center rounded-default border border-border-default [background:var(--color-chat-bubble-user)] px-4 py-3 my-2"
          >
            <div class="tool-call-content flex items-center gap-3 w-full">
              <OSpinner variant="dots" size="xs" />
              <span class="tool-call-message text-sm font-semibold text-text-secondary">{{
                currentAnalyzingMessage
              }}</span>
            </div>
          </div>
        </div>

        <!-- Scroll to bottom button -->
        <div
          v-show="showScrollToBottom"
          class="scroll-to-bottom-container absolute bottom-2.5 left-1/2 -translate-x-1/2 z-1000 pointer-events-none [transition:all_0.3s_ease]"
        >
          <OButton
            variant="ghost"
            size="icon-sm"
            class="scroll-to-bottom-btn transition-all duration-300 pointer-events-auto [backdrop-filter:blur(0.5rem)] shadow-[0_2px_8px_color-mix(in_srgb,var(--color-black)_20%,transparent)] border-2! border-text-link! text-text-link! bg-surface-base! dark:border-ai-accent! dark:text-ai-accent! dark:bg-surface-base! hover:scale-110 hover:shadow-[0_4px_12px_color-mix(in_srgb,var(--color-black)_30%,transparent)] hover:border-text-link! hover:text-text-link! hover:bg-surface-base! dark:hover:border-ai-accent! dark:hover:text-ai-accent! dark:hover:bg-surface-base! active:scale-100"
            @click="scrollToBottomSmooth"
          >
            <OIcon name="arrow-downward" size="sm" />
            <OTooltip side="top" align="center" content="Scroll to bottom" />
          </OButton>
        </div>
      </div>

      <!-- Fixed loading indicator above input - only shown when scrolled up -->
      <div
        v-if="(isLoading || activeToolCall) && showScrollToBottom"
        class="fixed-analyzing-indicator flex items-center justify-center px-4 py-3 mx-4 mb-2 rounded-default border border-border-default [background:var(--color-chat-bubble-user)] [box-shadow:0_2px_8px_color-mix(in_srgb,var(--color-black)_8%,transparent)]"
      >
        <!-- Show tool call if active -->
        <div
          v-if="activeToolCall"
          class="analyzing-content flex items-center gap-3 w-full max-w-225"
        >
          <OSpinner variant="dots" size="xs" />
          <span class="analyzing-message text-sm font-medium text-theme-accent">{{
            activeToolCall.message
          }}</span>
        </div>
        <!-- Show analyzing message if loading but no active tool call -->
        <div
          v-else-if="isLoading"
          class="analyzing-content flex items-center gap-3 w-full max-w-225"
        >
          <OSpinner variant="dots" size="xs" />
          <span class="analyzing-message text-sm font-medium text-theme-accent">{{
            currentAnalyzingMessage
          }}</span>
        </div>
      </div>

      <div class="chat-input-container relative shrink-0 w-full max-w-225 mx-auto my-2 px-2">
        <!-- Confirmation dialog -->
        <O2AIConfirmDialog
          :visible="pendingConfirmation !== null"
          :confirmation="pendingConfirmation"
          @confirm="handleToolConfirm"
          @cancel="handleToolCancel"
          @always-confirm="handleToolAlwaysConfirm"
        />

        <!-- Hidden file input for image upload -->
        <input
          ref="imageInputRef"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          class="hidden"
          @change="handleImageSelect"
        />

        <div
          v-if="!pendingConfirmation"
          class="unified-input-box flex flex-col gap-3 px-2 py-1 rounded-default transition-all duration-200 bg-surface-base border border-border-default focus-within:border-transparent focus-within:[box-shadow:0_0_0_2px_var(--color-accent)]"
          @dragover="handleDragOver"
          @drop="handleDrop"
          @paste="handlePaste"
        >
          <!-- Image preview strip -->
          <div
            v-if="pendingImages.length > 0"
            class="image-preview-strip flex flex-wrap gap-2 py-2 mb-2"
          >
            <div
              v-for="(img, index) in pendingImages"
              :key="index"
              class="image-preview-item relative inline-block"
            >
              <img
                :src="'data:' + img.mimeType + ';base64,' + img.data"
                :alt="img.filename"
                class="preview-image w-16 h-16 object-cover rounded-default border border-border-default [transition:transform_0.2s_ease] hover:scale-105"
              />
              <OButton
                variant="ghost"
                size="icon-xs-circle"
                class="image-remove-btn absolute! -top-1.5! -right-1.5! w-5! h-5! min-w-5! min-h-5! p-0! bg-status-negative! z-10 hover:bg-status-negative!"
                @click.stop="removeImage(index)"
              >
                <OIcon name="close" size="xs" />
              </OButton>
              <OTooltip :content="`${img.filename} (${(img.size / 1024).toFixed(0)}KB)`" />
            </div>
          </div>

          <RichTextInput
            ref="chatInput"
            v-model="inputMessage"
            :placeholder="inputPlaceholder"
            :disabled="isLoading"
            :theme="store.state.theme"
            :references="contextReferences"
            :borderless="true"
            @keydown="handleKeyDown"
            @submit="sendMessage"
            @update:references="handleReferencesUpdate"
          />

          <!-- Bottom bar with buttons -->
          <div class="input-bottom-bar flex items-center justify-between pt-2">
            <div class="flex items-center gap-2">
              <!-- Image upload button -->
              <OButton
                v-if="!isLoading"
                @click.stop="triggerImageUpload"
                variant="ghost"
                size="icon-sm"
                class="image-upload-btn opacity-70 transition-opacity duration-200 hover:opacity-100"
              >
                <OIcon name="image" size="sm" class="text-icon-color" />
                <OTooltip :content="t('aiAssistant.attachImageTooltip')" />
              </OButton>
              <div v-else class="w-8"></div>

              <!-- Auto navigation toggle button -->
              <OButton
                v-if="!isLoading"
                @click.stop="isAutoNavigationEnabled = !isAutoNavigationEnabled"
                variant="ghost"
                size="sm"
                class="auto-nav-toggle-btn flex items-center gap-1.5 px-2 py-1 rounded-default transition-all duration-200 hover:bg-surface-subtle"
              >
                <OIcon
                  :name="isAutoNavigationEnabled ? 'check-circle' : 'radio-button-unchecked'"
                  size="sm"
                  :class="[
                    'auto-nav-icon',
                    isAutoNavigationEnabled ? 'text-theme-accent!' : 'text-icon-color',
                  ]"
                />
                <span
                  class="auto-nav-label ml-1 text-xs font-medium"
                  :class="isAutoNavigationEnabled ? 'text-theme-accent' : 'text-text-secondary'"
                  >{{ t("aiAssistant.autoNavigation.label") }}</span
                >
                <OTooltip
                  :content="
                    isAutoNavigationEnabled
                      ? t('aiAssistant.autoNavigation.enabledTooltip')
                      : t('aiAssistant.autoNavigation.disabledTooltip')
                  "
                />
              </OButton>
            </div>

            <div class="flex items-center gap-2">
              <!-- Send button - shown when not loading -->
              <OButton
                v-if="!isLoading"
                :disabled="!inputMessage.trim() && pendingImages.length === 0"
                @click="sendMessage"
                variant="ai-gradient"
                size="icon-xs-circle"
                class="send-button bg-(image:--color-gradient-ai)! [transition:all_0.3s_ease]! shadow-[0_4px_15px_0_color-mix(in_srgb,var(--color-ai-accent)_30%,transparent)]!"
              >
                <OIcon name="send" size="sm" />
              </OButton>

              <!-- Stop button - shown when loading/streaming -->
              <OButton
                v-if="isLoading"
                @click="cancelCurrentRequest"
                variant="ghost"
                size="icon-xs-circle"
                class="stop-button bg-(image:--color-gradient-danger)! [transition:all_0.3s_ease]! shadow-[0_4px_15px_0_color-mix(in_srgb,var(--color-status-negative)_30%,transparent)]! hover:bg-(image:--color-gradient-danger-hover)! hover:shadow-[0_6px_20px_0_color-mix(in_srgb,var(--color-status-negative)_40%,transparent)]! hover:-translate-y-px! active:translate-y-0! active:shadow-[0_2px_10px_0_color-mix(in_srgb,var(--color-status-negative)_30%,transparent)]!"
              >
                <OIcon name="stop" size="sm" />
              </OButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, nextTick, watch, computed, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useTypewriterPlaceholder } from "@/components/ai-assistant/welcome/useTypewriterPlaceholder";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import "highlight.js/styles/github-dark.css";
import { marked } from "marked";
import { MarkedOptions } from "marked";
import DOMPurify from "dompurify";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import useAiChat from "@/composables/useAiChat";
import { getImageURL, getUUIDv7 } from "@/utils/zincutils";
import { chartColor } from "@/utils/chartTheme";
import {
  ChatMessage,
  ChatHistoryEntry,
  ContentBlock,
  NavigationAction,
  ImageAttachment,
  MAX_IMAGE_SIZE_BYTES,
  ALLOWED_IMAGE_TYPES,
} from "@/ts/interfaces/chat";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import RichTextInput, { ReferenceChip } from "@/components/RichTextInput.vue";
import O2AIConfirmDialog from "@/components/O2AIConfirmDialog.vue";
import O2AIHomeWelcome from "@/components/ai-assistant/welcome/O2AIHomeWelcome.vue";
import { useChatHistory } from "@/composables/useChatHistory";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { useAiDashboardEvents, getDashboardEventType } from "@/composables/useAiDashboardEvents";
import OButton from "@/lib/core/Button/OButton.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { UNAUTHORIZED_MESSAGE, isAuthError } from "@/utils/authErrors";

const { fetchAiChat, submitFeedback } = useAiChat();
const { emit: emitDashboardEvent } = useAiDashboardEvents();

// Register VRL as a JavaScript alias (type assertion)
hljs.registerLanguage("vrl", () => hljs.getLanguage("javascript") as any);

// Configure marked options with custom language support
const markedOptions = {
  breaks: true,
  gfm: true,
  langPrefix: "hljs language-",
  headerIds: false,
  mangle: false,
  sanitize: false, // Allow HTML in markdown
  highlight: (code: string, lang: string) => {
    if (lang === "vrl") {
      return hljs.highlight(code, { language: "javascript" }).value;
    }
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
} as MarkedOptions;

marked.setOptions(markedOptions);

// Function to render markdown content
function renderMarkdown(content: any) {
  return marked.parse(content);
}

export default defineComponent({
  name: "O2AIChat",
  components: {
    OSeparator,
    OButton,
    BetaBadge,
    ConfirmDialog,
    RichTextInput,
    O2AIConfirmDialog,
    O2AIHomeWelcome,
    ODropdown,
    ODropdownItem,
    ODropdownSeparator,
    ODrawer,
    ODialog,
    OSpinner,
    OIcon,
    OTooltip,
    OInput,
    OSearchInput,
  },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    headerHeight: {
      type: Number,
      default: 0,
    },
    //this will be used to set the input message if the user sends the data from any page by clicking on the ai chat button
    aiChatInputContext: {
      type: String,
      default: "",
    },
    appendMode: {
      type: Boolean,
      default: true,
    },
    aiChatPayload: {
      type: Object as () => {
        text: string;
        autoSend: boolean;
        id: number;
      } | null,
      default: null,
    },
    centeredStart: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const router = useRouter();
    const inputMessage = ref(props.aiChatInputContext ? props.aiChatInputContext : "");
    const chatMessages = ref<ChatMessage[]>([]);
    const isLoading = ref(false);
    const messagesContainer = ref<HTMLElement | null>(null);
    const chatInput = ref<any>(null); // RichTextInput component instance
    const currentStreamingMessage = ref("");
    const currentTextSegment = ref(""); // Track current text segment (resets after each tool call)
    const showHistory = ref(false);
    // `model` is stored on persisted entries but missing from the shared interface
    const chatHistory = ref<(ChatHistoryEntry & { model?: string })[]>([]);
    const currentChatId = ref<number | null>(null);
    const currentSessionId = ref<string | null>(null); // UUID v7 for tracking all API calls in this chat session
    const lastTraceId = ref<string | null>(null); // OTEL trace_id from last workflow for feedback correlation
    const store = useStore();
    const { isDark } = useTheme();
    const { t } = useI18n();
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const chatUpdated = computed(() => store.state.chatUpdated);

    // Typewriter placeholder — only animates on the home tab (centeredStart) when no chat is open.
    // On the sidepanel the placeholder stays static ("Write your prompt").
    const typewriterPrompts = computed(() => [
      t("aiAssistant.placeholderRotation.one"),
      t("aiAssistant.placeholderRotation.two"),
      t("aiAssistant.placeholderRotation.three"),
    ]);
    const typewriterEnabled = computed(
      () => !!props.centeredStart && chatMessages.value.length === 0,
    );
    const { placeholder: typewriterPlaceholder } = useTypewriterPlaceholder(typewriterPrompts, {
      enabled: typewriterEnabled,
      typeSpeedMs: 85,
      eraseSpeedMs: 45,
      holdMs: 2800,
      initialDelayMs: 500,
    });
    const inputPlaceholder = computed(() =>
      props.centeredStart && chatMessages.value.length === 0
        ? typewriterPlaceholder.value || "Write your prompt"
        : "Write your prompt",
    );

    // Chat history composable
    const {
      saveToHistory: dbSaveToHistory,
      loadHistory: dbLoadHistory,
      loadChat: dbLoadChat,
      deleteChatById: dbDeleteChatById,
      clearAllHistory: dbClearAllHistory,
      updateChatTitle: dbUpdateChatTitle,
    } = useChatHistory(
      () => store.state.userInfo.email ?? "",
      () => store.state.selectedOrganization.identifier ?? "",
    );

    const currentChatTimestamp = ref<string | null>(null);
    const saveHistoryLoading = ref(false);
    const historySearchTerm = ref("");
    const shouldAutoScroll = ref(true);
    const showScrollToBottom = ref(false);

    // Edit title state
    const showEditTitleDialog = ref(false);
    const editingTitle = ref("");

    // Clear all confirmation state
    const showClearAllConfirmDialog = ref(false);

    // Delete individual chat confirmation state
    const showDeleteChatConfirmDialog = ref(false);
    const chatToDelete = ref<number | null>(null);

    // Tool confirmation state (from AI agent — confirmation-required actions, inline in chat)
    const pendingConfirmation = ref<{
      tool: string;
      args: Record<string, any>;
      message: string;
      navAction?: NavigationAction;
    } | null>(null);

    // Auto navigation state - per chat ID
    // Stores chat ID -> boolean mapping for auto navigation preference
    const autoNavigationPreferences = ref<Map<number, boolean>>(new Map());

    // Pending auto navigation preference for new chats (before chat ID is created)
    const pendingAutoNavigation = ref(true);

    // Current chat's auto navigation state (defaults to true)
    const isAutoNavigationEnabled = computed({
      get: () => {
        if (!currentChatId.value) return pendingAutoNavigation.value;
        return autoNavigationPreferences.value.get(currentChatId.value) ?? true;
      },
      set: (value: boolean) => {
        if (currentChatId.value) {
          autoNavigationPreferences.value.set(currentChatId.value, value);
          saveAutoNavigationPreferences();
        } else {
          // Store temporarily for new chats
          pendingAutoNavigation.value = value;
        }
      },
    });

    // AI-generated chat title state
    const aiGeneratedTitle = ref<string | null>(null);
    const displayedTitle = ref<string>("");
    const isTypingTitle = ref(false);
    const titleAnimationId = ref<number>(0); // Used to cancel stale animations

    // Track expanded tool calls by message index and block index
    const expandedToolCalls = ref<Set<string>>(new Set());

    // Track expanded log entries by message index and block index
    const expandedLogEntries = ref<Set<string>>(new Set());

    // Active tool call state - for showing tool progress outside message box
    const activeToolCall = ref<{
      tool: string;
      message: string;
      context: Record<string, any>;
      call_id?: string;
    } | null>(null);

    // Pending tool calls - stores tool calls that arrive before text content to avoid empty message boxes
    const pendingToolCalls = ref<ContentBlock[]>([]);

    // AbortController for managing request cancellation - allows users to stop ongoing AI requests
    const currentAbortController = ref<AbortController | null>(null);

    // Background streams: when the user switches sessions while streaming,
    // the detached stream continues in background and saves to IndexedDB on completion.
    const backgroundStreams = new Set<AbortController>();
    const MAX_BACKGROUND_STREAMS = 3;

    // Map sessionId → live stream context for re-attachment when user navigates back.
    // This allows loadChat to swap chatMessages.value back to the live array so that
    // processStream's isActive() becomes true again and the UI updates in real-time.
    const backgroundStreamMap = new Map<
      string,
      {
        msgs: ChatMessage[];
        controller: AbortController;
        chatId: number | null;
      }
    >();

    // Typewriter animation state for LLM responses
    const displayedStreamingContent = ref("");
    const typewriterAnimationId = ref<number | null>(null);
    const TYPEWRITER_SPEED = 8; // ms per character - fast like ChatGPT (5-10ms range)

    // Throttle save during streaming to prevent data loss on page reload
    const lastStreamingSaveTime = ref<number>(0);
    const STREAMING_SAVE_INTERVAL = 3000; // Save at most every 3 seconds during streaming

    // Pending images for current message
    const pendingImages = ref<ImageAttachment[]>([]);
    const imageInputRef = ref<HTMLInputElement | null>(null);
    // Image preview dialog state
    const showImagePreview = ref(false);
    const previewImage = ref<ImageAttachment | null>(null);

    // Context references for rich text input chips
    const contextReferences = ref<ReferenceChip[]>([]);

    // Component readiness tracking
    const componentReady = ref(false);
    const pendingChips = ref<ReferenceChip[]>([]);

    // Analyzing messages for loading indicator
    const ANALYZING_MESSAGES = [
      "Analyzing...",
      "Thinking...",
      "Processing...",
      "Examining data...",
      "Reviewing context...",
      "Formulating response...",
      "Checking details...",
      "Gathering insights...",
      "Evaluating options...",
      "Synthesizing information...",
      "Working on it...",
      "Almost there...",
      "Diving deeper...",
      "Connecting the dots...",
      "Crunching numbers...",
      "Exploring possibilities...",
      "Refining answer...",
      "Still thinking...",
      "Making progress...",
      "Piecing together...",
    ];
    const currentAnalyzingMessage = ref(ANALYZING_MESSAGES[0]);
    const analyzingRotationInterval = ref<NodeJS.Timeout | null>(null);

    /**
     * Start rotating the analyzing message every 5 seconds
     */
    const startAnalyzingRotation = () => {
      currentAnalyzingMessage.value =
        ANALYZING_MESSAGES[Math.floor(Math.random() * ANALYZING_MESSAGES.length)];
      analyzingRotationInterval.value = setInterval(() => {
        currentAnalyzingMessage.value =
          ANALYZING_MESSAGES[Math.floor(Math.random() * ANALYZING_MESSAGES.length)];
      }, 5000);
    };

    /**
     * Stop rotating the analyzing message
     */
    const stopAnalyzingRotation = () => {
      if (analyzingRotationInterval.value) {
        clearInterval(analyzingRotationInterval.value);
        analyzingRotationInterval.value = null;
      }
    };

    // Interval ID for title animation
    let titleIntervalId: ReturnType<typeof setInterval> | null = null;

    /**
     * Animate title with typewriter effect
     * Characters appear one by one from left to right
     * Uses setInterval for reliable timing with Vue reactivity
     */
    const animateTitle = (title: string) => {
      // Clear any existing animation
      if (titleIntervalId) {
        clearInterval(titleIntervalId);
        titleIntervalId = null;
      }

      // Increment animation ID to track this animation
      const currentAnimationId = ++titleAnimationId.value;

      isTypingTitle.value = true;
      displayedTitle.value = "";
      let charIndex = 0;

      titleIntervalId = setInterval(() => {
        // Check if this animation was superseded
        if (titleAnimationId.value !== currentAnimationId) {
          if (titleIntervalId) {
            clearInterval(titleIntervalId);
            titleIntervalId = null;
          }
          return;
        }

        if (charIndex < title.length) {
          displayedTitle.value = title.slice(0, charIndex + 1);
          charIndex++;
        } else {
          // Animation complete
          if (titleIntervalId) {
            clearInterval(titleIntervalId);
            titleIntervalId = null;
          }
          isTypingTitle.value = false;
        }
      }, 30); // 30ms per character
    };

    /**
     * Reset title state for new chat
     */
    const resetTitleState = () => {
      // Cancel any ongoing animation
      titleAnimationId.value++;
      if (titleIntervalId) {
        clearInterval(titleIntervalId);
        titleIntervalId = null;
      }
      aiGeneratedTitle.value = null;
      displayedTitle.value = "";
      isTypingTitle.value = false;
    };

    /**
     * Reset typewriter animation state
     */
    const resetTypewriterState = () => {
      displayedStreamingContent.value = "";
      if (typewriterAnimationId.value) {
        cancelAnimationFrame(typewriterAnimationId.value);
        typewriterAnimationId.value = null;
      }
    };

    /**
     * Animate text reveal with typewriter effect
     * Skips animation for code blocks (reveals them instantly)
     */
    const animateStreamingText = () => {
      const target = currentTextSegment.value;
      const current = displayedStreamingContent.value;

      if (current.length >= target.length) {
        // Caught up, stop animation
        if (typewriterAnimationId.value) {
          cancelAnimationFrame(typewriterAnimationId.value);
          typewriterAnimationId.value = null;
        }
        return;
      }

      // Check if we're at the start of a code block - if so, skip to end of code block
      const remaining = target.slice(current.length);
      const codeBlockStart = remaining.match(/^```[\w]*/);

      if (codeBlockStart) {
        // Find the closing ``` and reveal entire code block instantly
        const codeBlockEnd = remaining.indexOf("```", codeBlockStart[0].length);
        if (codeBlockEnd !== -1) {
          const endPos = codeBlockEnd + 3;
          displayedStreamingContent.value = target.slice(0, current.length + endPos);
        } else {
          // Code block not complete yet, reveal opening and wait
          displayedStreamingContent.value = target.slice(
            0,
            current.length + codeBlockStart[0].length,
          );
        }
      } else {
        // Regular text - reveal one character
        displayedStreamingContent.value = target.slice(0, current.length + 1);
      }

      // Schedule next frame
      typewriterAnimationId.value = requestAnimationFrame(() => {
        setTimeout(animateStreamingText, TYPEWRITER_SPEED);
      });
    };

    // Query history functionality
    const queryHistory = ref<string[]>([]);
    const historyIndex = ref(-1);
    const HISTORY_KEY = "ai-chat-query-history";
    const MAX_HISTORY_SIZE = 10;

    const capabilities = [
      "1. Create a SQL query for me",
      "2. Convert this SPL query to SQL",
      "3. What is happening on this log line",
      "4. Write a VRL function to parse these log lines",
      "5. What are golden signals for observability",
      "6. How to monitor kubernetes cluster",
      "7. How to monitor docker containers",
      "8. How to monitor aws services",
      "9. How to monitor azure services",
      "10. How to monitor google cloud services",
    ];

    const formatMessage = (content: string) => {
      try {
        return renderMarkdown(content);
      } catch (e) {
        console.error("Error formatting message:", e);
        return content;
      }
    };

    const getScrollThreshold = () => {
      return 50; // Fixed 50px threshold for all screens
    };

    const checkIfShouldAutoScroll = () => {
      if (!messagesContainer.value) return;

      const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value;
      const threshold = getScrollThreshold();
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - threshold;

      shouldAutoScroll.value = isAtBottom;

      // Show scroll to bottom button when user scrolls up significantly
      // Only show if there's enough content to scroll and user is not at bottom
      const hasScrollableContent = scrollHeight > clientHeight + 100; // At least 100px more content
      const isScrolledUp = scrollTop + clientHeight < scrollHeight - 100; // 100px from bottom

      showScrollToBottom.value = hasScrollableContent && isScrolledUp;
    };

    const scrollToBottom = async () => {
      await nextTick();
      if (messagesContainer.value && shouldAutoScroll.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
      }
    };

    const scrollToBottomSmooth = async () => {
      await nextTick();
      if (messagesContainer.value) {
        messagesContainer.value.scrollTo({
          top: messagesContainer.value.scrollHeight,
          behavior: "smooth",
        });
        // Hide the button immediately when user clicks it
        showScrollToBottom.value = false;
        // Reset auto-scroll when user manually scrolls to bottom
        shouldAutoScroll.value = true;
      }
    };

    const scrollToLoadingIndicator = async () => {
      await nextTick();
      const loadingElement = document.getElementById("loading-indicator");
      if (loadingElement) {
        loadingElement.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    };

    /**
     * Cancels the currently ongoing AI chat request if one exists
     * This will stop the streaming response and clean up the request state
     * Shows a user-friendly notification about the cancellation
     *
     * Called when user clicks the "Stop" button during message generation
     */
    const cancelCurrentRequest = async () => {
      if (currentAbortController.value) {
        currentAbortController.value.abort();
        currentAbortController.value = null;

        // Show user notification about successful cancellation
        toast({
          message: "Response generation stopped",
          variant: "info",
        });

        // Update UI state to reflect cancellation
        isLoading.value = false;
        activeToolCall.value = null;
        stopAnalyzingRotation();

        // Immediately show all buffered text (like ChatGPT's "Stop generating")
        displayedStreamingContent.value = currentTextSegment.value;
        if (typewriterAnimationId.value) {
          cancelAnimationFrame(typewriterAnimationId.value);
          typewriterAnimationId.value = null;
        }

        // Handle partial message cleanup
        if (chatMessages.value.length > 0) {
          const lastMessage = chatMessages.value[chatMessages.value.length - 1];
          if (lastMessage.role === "assistant") {
            if (!lastMessage.content) {
              // Remove empty assistant message that was added for streaming
              chatMessages.value.pop();
            } else if (currentStreamingMessage.value) {
              // Update final text in contentBlocks to show all buffered content
              if (lastMessage.contentBlocks) {
                const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
                if (lastBlock && lastBlock.type === "text") {
                  lastBlock.text = currentTextSegment.value;
                }
              }
              // Keep partial content but indicate it was cancelled
              lastMessage.content += "\n\n_[Response stopped by user]_";
            }
          }
        }

        // Persist any tool calls that completed before the user hit Stop.
        // During the tool phase (before the assistant streams text) completed
        // steps sit in pendingToolCalls and aren't attached to a message yet,
        // so without this they'd vanish on cancel. Runs after the partial-
        // message cleanup above so the empty-assistant-message pop can't drop
        // the message we attach them to.
        if (pendingToolCalls.value.length) {
          const lastMessage = chatMessages.value[chatMessages.value.length - 1];
          if (lastMessage && lastMessage.role === "assistant") {
            if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
            // Tools ran before any text, so place them ahead of it.
            lastMessage.contentBlocks.unshift(...pendingToolCalls.value);
          } else {
            const stoppedNote = "_[Response stopped by user]_";
            chatMessages.value.push({
              role: "assistant",
              content: stoppedNote,
              contentBlocks: [...pendingToolCalls.value, { type: "text", text: stoppedNote }],
            });
          }
          pendingToolCalls.value = [];
        }

        // Reset streaming state
        currentStreamingMessage.value = "";
        currentTextSegment.value = "";
        displayedStreamingContent.value = "";

        // Save the current state including cancellation
        await saveToHistory();

        // Scroll to show the final state
        await scrollToBottom();
      }
    };

    // Process any pending chips that were queued before component was ready
    const processPendingChips = () => {
      if (pendingChips.value.length > 0) {
        nextTick(() => {
          if (chatInput.value && typeof chatInput.value.insertChip === "function") {
            // Focus input first to ensure cursor is positioned correctly
            focusInput();

            // Only clear if appendMode is false and there are no existing chips
            // Check DOM directly for existing chips instead of relying on reactive state
            const inputElement = chatInput.value.$el || chatInput.value;
            const editableDiv =
              inputElement?.querySelector(".rich-text-input") ||
              inputElement?.querySelector("[contenteditable]");
            const hasExistingChips = editableDiv?.querySelector(".reference-chip") !== null;
            const hasExistingText = editableDiv?.textContent?.trim().length > 0;

            // Only clear if:
            // 1. appendMode is false (user wants to replace content)
            // 2. AND there are no existing chips
            // 3. AND there is no existing text
            if (!props.appendMode && !hasExistingChips && !hasExistingText) {
              if (chatInput.value && typeof chatInput.value.clear === "function") {
                chatInput.value.clear();
              }
              inputMessage.value = "";
            }

            // Insert all pending chips at the cursor position
            pendingChips.value.forEach((chip) => {
              chatInput.value.insertChip(chip);
            });
            pendingChips.value = [];
          }
        });
      }
    };

    // Helper to create a better preview of content
    const createPreview = (content: string, maxLength: number = 40): string => {
      // Clean up content
      let preview = content.trim();

      // Try to detect JSON and create a meaningful preview
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === "object" && parsed !== null) {
          // For objects, show first few keys
          const keys = Object.keys(parsed);
          if (keys.length > 0) {
            const firstKeys = keys
              .slice(0, 3)
              .map((k) => {
                const val = parsed[k];
                if (typeof val === "string") {
                  const truncatedVal = val.length > 8 ? val.substring(0, 8) + "..." : val;
                  return k + ': "' + truncatedVal + '"';
                }
                return k + ": " + String(val).substring(0, 8);
              })
              .join(", ");
            const moreKeys = keys.length > 3 ? ", ..." : "";
            preview = "{" + firstKeys + moreKeys + "}";
          }
        }
      } catch {
        // Not JSON, use plain text preview
        // Replace newlines and multiple spaces with single space
        preview = preview.replace(/\s+/g, " ");
      }

      // Truncate if still too long
      if (preview.length > maxLength) {
        preview = preview.substring(0, maxLength) + "...";
      }

      return preview;
    };

    watch(
      () => props.aiChatInputContext,
      (newAiChatInputContext: string) => {
        if (newAiChatInputContext) {
          // Create a reference chip from the context
          const contextChip: ReferenceChip = {
            id: `context-${Date.now()}`,
            filename: "Log Entry",
            preview: createPreview(newAiChatInputContext, 10),
            fullContent: newAiChatInputContext,
            charCount: newAiChatInputContext.length,
            type: "context",
          };

          // Always queue the chip first for consistent behavior
          pendingChips.value.push(contextChip);

          // If component is ready, process immediately with proper timing
          if (
            componentReady.value &&
            chatInput.value &&
            typeof chatInput.value.insertChip === "function"
          ) {
            // Use a small delay to ensure input is focused and ready
            nextTick(() => {
              setTimeout(() => {
                processPendingChips();
              }, 50);
            });
          }
          // If component not ready, chips will be processed when componentReady becomes true
          // No fallback text needed - avoids flickering when chat opens
        }
      },
    );

    // Atomic payload watcher — text + autoSend arrive together, no timing race
    watch(
      () => props.aiChatPayload,
      (payload) => {
        if (!payload?.text) return;
        if (payload.autoSend) {
          inputMessage.value = payload.text;
          nextTick(() => {
            setTimeout(() => {
              sendMessage();
            }, 50);
          });
        }
      },
    );

    //fetchInitialMessage is called when the component is mounted and the isOpen prop is true

    const fetchInitialMessage = async () => {
      isLoading.value = true;
      try {
        chatMessages.value = [];
      } catch (error) {
        chatMessages.value = [
          {
            role: "assistant",
            content: "Error: Unable to connect to backend",
          },
        ];
        console.error("Error fetching initial message:", error);
      }
      isLoading.value = false;
      stopAnalyzingRotation();
      scrollToBottom();
    };

    const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder();
      let buffer = "";
      let messageComplete = false;

      // --- Stream context: captured at call time ---
      // When the user switches sessions mid-stream, chatMessages.value gets
      // replaced with a new array. This captured reference keeps the stream
      // writing to the ORIGINAL array so data isn't lost.
      const msgs = chatMessages.value;
      let ctxSessionId = currentSessionId.value;
      let ctxChatId = currentChatId.value;
      let ctxTitle: string | undefined = aiGeneratedTitle.value || undefined;

      // Local streaming accumulators (synced to refs only when active)
      let streamingMsg = currentStreamingMessage.value;
      let textSegment = currentTextSegment.value;

      const isActive = () => chatMessages.value === msgs;

      const syncStreamingRefs = () => {
        if (isActive()) {
          currentStreamingMessage.value = streamingMsg;
          currentTextSegment.value = textSegment;
        }
      };

      // Context-aware save: uses captured metadata when detached
      const saveCtx = async () => {
        if (msgs.length === 0) return;
        if (!ctxSessionId) {
          ctxSessionId = getUUIDv7();
          if (isActive()) currentSessionId.value = ctxSessionId;
        }
        const title = isActive() ? aiGeneratedTitle.value || undefined : ctxTitle;
        const chatId = isActive() ? currentChatId.value : ctxChatId;
        const resultId = await dbSaveToHistory(msgs, ctxSessionId, title, chatId);
        if (!chatId && resultId) {
          if (isActive()) {
            currentChatId.value = resultId;
            // Carry the new-chat preference onto the chat id. Persist the actual
            // value (ON by default) so an explicit user disable is honored.
            autoNavigationPreferences.value.set(resultId, pendingAutoNavigation.value);
            saveAutoNavigationPreferences();
          } else {
            ctxChatId = resultId;
          }
        }
      };

      let lastSaveTime = lastStreamingSaveTime.value;
      const throttledSaveCtx = async (force = false) => {
        const now = Date.now();
        if (force || now - lastSaveTime >= STREAMING_SAVE_INTERVAL) {
          lastSaveTime = now;
          if (isActive()) lastStreamingSaveTime.value = now;
          await saveCtx();
        }
      };

      // Local finalizeTextBlock: operates on captured msgs, not chatMessages.value
      const localFinalizeTextBlock = () => {
        if (textSegment) {
          const lm = msgs[msgs.length - 1];
          if (lm && lm.role === "assistant" && lm.contentBlocks) {
            const lb = lm.contentBlocks[lm.contentBlocks.length - 1];
            if (lb && lb.type === "text") {
              lb.text = textSegment;
            }
          }
        }
        if (isActive()) {
          if (typewriterAnimationId.value) {
            cancelAnimationFrame(typewriterAnimationId.value);
            typewriterAnimationId.value = null;
          }
          displayedStreamingContent.value = "";
        }
        textSegment = "";
        syncStreamingRefs();
      };
      // --- End stream context ---

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new chunk to existing buffer
          buffer += decoder.decode(value, { stream: true });

          // Process each line that starts with 'data: '
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep last potentially incomplete line

          for (const line of lines) {
            if (line.trim().startsWith("data: ")) {
              try {
                // Extract everything after 'data: ' and before any line break
                const jsonStr = line.substring(line.indexOf("{"));

                // Skip empty or invalid JSON strings
                if (!jsonStr || !jsonStr.trim()) continue;

                // Try to parse the JSON, handling potential errors
                try {
                  const data = JSON.parse(jsonStr);

                  // Handle title events - AI-generated chat title from first message
                  if (data && data.type === "title") {
                    ctxTitle = data.title;
                    if (isActive()) {
                      aiGeneratedTitle.value = data.title;
                      animateTitle(data.title);
                    }
                    continue;
                  }

                  // Handle confirmation_required events - add inline confirmation block in chat
                  if (data && data.type === "confirmation_required") {
                    localFinalizeTextBlock();

                    // When detached, auto-deny confirmations to unblock the stream
                    if (!isActive()) {
                      try {
                        const orgId = store.state.selectedOrganization.identifier;
                        await fetch(
                          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${ctxSessionId}`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ approved: false }),
                          },
                        );
                      } catch (error) {
                        console.error(
                          "Error auto-denying confirmation for background stream:",
                          error,
                        );
                      }
                      continue;
                    }

                    // Check if this is a navigation action and auto navigation is enabled
                    if (data.tool === "navigation_action" && isAutoNavigationEnabled.value) {
                      // Auto-approve navigation without showing confirmation
                      try {
                        const orgId = store.state.selectedOrganization.identifier;
                        await fetch(
                          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${ctxSessionId}`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ approved: true }),
                          },
                        );
                      } catch (error) {
                        console.error("Error auto-confirming navigation:", error);
                      }
                      continue;
                    }

                    // data.message is always set by the backend:
                    // - Navigation: validated label (e.g. "View in Logs")
                    // - Other tools: "Confirm execution of {tool}?"
                    const confirmBlock: ContentBlock = {
                      type: "tool_call",
                      tool: data.tool,
                      message: activeToolCall.value?.message || data.message,
                      context: activeToolCall.value?.context || {},
                      call_id: data.call_id || activeToolCall.value?.call_id || undefined,
                      pendingConfirmation: true,
                      confirmationMessage: data.message,
                      confirmationArgs: data.args || {},
                    };
                    activeToolCall.value = null;

                    let lastMessage = msgs[msgs.length - 1];
                    if (lastMessage && lastMessage.role === "assistant") {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(confirmBlock);
                    } else {
                      msgs.push({
                        role: "assistant",
                        content: "",
                        contentBlocks: [...pendingToolCalls.value, confirmBlock],
                      });
                      pendingToolCalls.value = [];
                    }
                    pendingConfirmation.value = {
                      tool: data.tool,
                      args: data.args || {},
                      message: data.message || `Confirm execution of ${data.tool}?`,
                    };
                    await scrollToBottom();
                    continue;
                  }

                  // Handle tool_call events - show spinner indicator, don't add to chat yet
                  if (data && data.type === "tool_call") {
                    // If there's already an active tool call, complete it first
                    if (activeToolCall.value) {
                      const completedToolBlock: ContentBlock = {
                        type: "tool_call",
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context,
                        call_id: activeToolCall.value.call_id,
                      };
                      let lastMessage = msgs[msgs.length - 1];
                      if (lastMessage && lastMessage.role === "assistant") {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                    }

                    // Show active indicator (blue spinner box) - don't add to chat yet
                    if (isActive()) {
                      activeToolCall.value = {
                        tool: data.tool,
                        message: data.message,
                        context: data.context || {},
                        call_id: data.call_id || undefined,
                      };
                    }

                    localFinalizeTextBlock();
                    if (isActive()) await scrollToBottom();
                    continue;
                  }

                  // Handle error events - display error message to user
                  if (data && data.type === "error") {
                    // Complete any active tool call first
                    let lastMessage = msgs[msgs.length - 1];
                    if (activeToolCall.value) {
                      const completedToolBlock: ContentBlock = {
                        type: "tool_call",
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context,
                        call_id: activeToolCall.value.call_id,
                      };
                      if (lastMessage && lastMessage.role === "assistant") {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                      if (isActive()) activeToolCall.value = null;
                    }

                    // Format error message with suggestion if available
                    // Handle case where error/message might be an object instead of string
                    const rawError = data.error ?? data.message ?? "An unexpected error occurred";
                    const errorText =
                      typeof rawError === "string" ? rawError : JSON.stringify(rawError, null, 2);

                    // Check if this is an authorization/access error
                    const authErr = isAuthError(errorText, data.error_type);
                    let errorMessage = authErr ? UNAUTHORIZED_MESSAGE : `Error: ${errorText}`;
                    if (data.suggestion && !authErr) {
                      errorMessage += `\n\n${data.suggestion}`;
                    }

                    // Get or create assistant message for error (reuse lastMessage)
                    lastMessage = msgs[msgs.length - 1];
                    if (!lastMessage || lastMessage.role !== "assistant") {
                      msgs.push({
                        role: "assistant",
                        content: errorMessage,
                        contentBlocks: [
                          ...pendingToolCalls.value,
                          { type: "text", text: errorMessage },
                        ],
                      });
                      pendingToolCalls.value = [];
                    } else {
                      // Append error to existing message
                      if (lastMessage.content) {
                        lastMessage.content += "\n\n" + errorMessage;
                      } else {
                        lastMessage.content = errorMessage;
                      }
                      if (!lastMessage.contentBlocks) {
                        lastMessage.contentBlocks = [];
                      }
                      lastMessage.contentBlocks.push({
                        type: "text",
                        text: errorMessage,
                      });
                      // Clear pending tool calls to avoid leaking into later messages
                      pendingToolCalls.value = [];
                    }

                    // Reset streaming state
                    textSegment = "";
                    syncStreamingRefs();

                    // Save error message to history
                    await saveCtx();
                    if (isActive()) await scrollToBottom();

                    // Stop processing further as error occurred
                    return;
                  }

                  // Handle complete events - complete any active tool call
                  if (data && data.type === "complete") {
                    // Capture trace_id for feedback correlation
                    if (data.trace_id && isActive()) {
                      lastTraceId.value = data.trace_id;
                    }
                    if (activeToolCall.value) {
                      const completedToolBlock: ContentBlock = {
                        type: "tool_call",
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context,
                        call_id: activeToolCall.value.call_id,
                      };
                      let lastMessage = msgs[msgs.length - 1];
                      if (lastMessage && lastMessage.role === "assistant") {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                      if (isActive()) activeToolCall.value = null;
                    }
                    // Flush any tool calls that completed before the assistant
                    // produced text. With opencode, action-only turns (dashboard/
                    // alert creation, navigation) finish without any `message`
                    // event, so these blocks would otherwise stay stranded in
                    // pendingToolCalls and never render — the user sees progress
                    // "flash and disappear".
                    if (pendingToolCalls.value.length) {
                      let lastMessage = msgs[msgs.length - 1];
                      if (lastMessage && lastMessage.role === "assistant") {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(...pendingToolCalls.value);
                      } else {
                        msgs.push({
                          role: "assistant",
                          content: "",
                          contentBlocks: [...pendingToolCalls.value],
                        });
                      }
                      pendingToolCalls.value = [];
                      if (isActive()) await throttledSaveCtx(true);
                    }
                    continue;
                  }

                  // Handle tool_result events - enrich tool call with result data
                  if (data && data.type === "tool_result") {
                    const resultData = {
                      success: data.success !== false,
                      resultMessage: data.message || "",
                      summary: data.summary || undefined,
                      errorType: data.error_type || undefined,
                      suggestion: data.suggestion || undefined,
                      details: data.details || undefined,
                      response: data.response || undefined,
                    };

                    // Generate navigation from tool result if applicable
                    let navigationAction: NavigationAction | null = null;
                    if (data.success !== false && data.call_args) {
                      navigationAction = generateNavigationFromToolResult(
                        data.tool,
                        data.call_args,
                        data,
                      );
                    }

                    // Emit dashboard event only when stream is active (foreground)
                    if (data.success !== false && isActive()) {
                      const resolvedToolName =
                        data.tool && data.tool !== "tools_call" ? data.tool : "";
                      const callArgs = data.call_args || {};
                      const dashboardEventType = getDashboardEventType(resolvedToolName);
                      if (dashboardEventType) {
                        const dashboardId =
                          callArgs.dashboard_id ||
                          callArgs.args?.dashboard_id ||
                          callArgs.request_body?.dashboard_id;
                        if (dashboardId) {
                          const folderId =
                            callArgs.folder ||
                            callArgs.args?.folder ||
                            callArgs.request_body?.folder;
                          emitDashboardEvent({
                            type: dashboardEventType,
                            dashboardId,
                            folderId,
                          });
                        } else {
                          console.warn(
                            `[O2AIChat] Could not extract dashboardId from call_args for tool "${resolvedToolName}". Skipping dashboard event.`,
                            callArgs,
                          );
                        }
                      }
                    }

                    // Match by call_id if available, fall back to tool name
                    const matchesActiveToolCall =
                      activeToolCall.value &&
                      ((data.call_id && activeToolCall.value.call_id === data.call_id) ||
                        (!data.call_id && activeToolCall.value.tool === data.tool));

                    // If active tool call matches, complete it with result data
                    if (matchesActiveToolCall) {
                      const completedToolBlock: ContentBlock = {
                        type: "tool_call",
                        tool: activeToolCall.value!.tool,
                        message: activeToolCall.value!.message,
                        context: activeToolCall.value!.context,
                        call_id: activeToolCall.value!.call_id,
                        ...resultData,
                        ...(navigationAction && { navigationAction }),
                      };
                      let lastMessage = msgs[msgs.length - 1];
                      if (lastMessage && lastMessage.role === "assistant") {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                      if (isActive()) activeToolCall.value = null;
                    } else {
                      // Tool was already completed — retroactively enrich the matching block
                      const lastMessage = msgs[msgs.length - 1];
                      if (lastMessage && lastMessage.contentBlocks) {
                        for (let i = lastMessage.contentBlocks.length - 1; i >= 0; i--) {
                          const block = lastMessage.contentBlocks[i];
                          const blockMatches = data.call_id
                            ? block.call_id === data.call_id
                            : block.type === "tool_call" &&
                              block.tool === data.tool &&
                              block.success === undefined;
                          if (blockMatches) {
                            Object.assign(block, resultData);
                            if (navigationAction) {
                              block.navigationAction = navigationAction;
                            }
                            break;
                          }
                        }
                      }
                      // Also check pending tool calls
                      for (let i = pendingToolCalls.value.length - 1; i >= 0; i--) {
                        const block = pendingToolCalls.value[i];
                        const blockMatches = data.call_id
                          ? block.call_id === data.call_id
                          : block.type === "tool_call" &&
                            block.tool === data.tool &&
                            block.success === undefined;
                        if (blockMatches) {
                          Object.assign(block, resultData);
                          break;
                        }
                      }
                    }
                    if (isActive()) await scrollToBottom();
                    continue;
                  }

                  // Handle navigation_action events - check auto navigation setting
                  // (clickable buttons on tool results are generated by frontend from tool_result data)
                  if (data && data.type === "navigation_action") {
                    localFinalizeTextBlock();

                    // Skip navigation when stream is detached (background)
                    if (!isActive()) continue;

                    const navAction: NavigationAction = {
                      resource_type: data.resource_type,
                      action: data.action,
                      label: data.label,
                      target: data.target,
                    };

                    // Check if auto navigation is enabled
                    if (isAutoNavigationEnabled.value) {
                      // Auto-navigate without confirmation
                      await handleNavigationAction(navAction);
                    } else {
                      // Show confirmation dialog
                      // Store the navigation action for later use
                      const confirmBlock: ContentBlock = {
                        type: "tool_call",
                        tool: "navigation_action",
                        message: data.label || "Navigate",
                        context: { navAction },
                        pendingConfirmation: true,
                        confirmationMessage: data.label,
                        confirmationArgs: data.target || {},
                      };
                      activeToolCall.value = null;

                      let lastMessage = msgs[msgs.length - 1];
                      if (lastMessage && lastMessage.role === "assistant") {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(confirmBlock);
                      } else {
                        msgs.push({
                          role: "assistant",
                          content: "",
                          contentBlocks: [...pendingToolCalls.value, confirmBlock],
                        });
                        pendingToolCalls.value = [];
                      }

                      // Set pending confirmation with navigation action data
                      pendingConfirmation.value = {
                        tool: "navigation_action",
                        args: data.target || {},
                        message: data.label || "Navigate",
                      };

                      // Store the navigation action for later execution
                      pendingConfirmation.value.navAction = navAction;

                      await scrollToBottom();
                    }
                    continue;
                  }

                  // Handle error events - stream-level errors
                  if (data && data.type === "error") {
                    // Complete any active tool call as failed
                    if (activeToolCall.value) {
                      const failedToolBlock: ContentBlock = {
                        type: "tool_call",
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context,
                        call_id: activeToolCall.value.call_id,
                        success: false,
                        resultMessage: data.message || "Tool execution failed",
                        errorType: data.error_type || undefined,
                        suggestion: data.suggestion || undefined,
                      };
                      let lastMessage = msgs[msgs.length - 1];
                      if (lastMessage && lastMessage.role === "assistant") {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(failedToolBlock);
                      } else {
                        pendingToolCalls.value.push(failedToolBlock);
                      }
                      if (isActive()) activeToolCall.value = null;
                    }

                    // Add inline error block
                    const rawErrorMessage = data.message || data.error || "An error occurred";
                    const authErr = isAuthError(rawErrorMessage, data.error_type);
                    const errorBlock: ContentBlock = {
                      type: "error",
                      message: authErr ? UNAUTHORIZED_MESSAGE : rawErrorMessage,
                      errorType: data.error_type || undefined,
                      suggestion: authErr ? undefined : data.suggestion || undefined,
                      recoverable: authErr ? false : (data.recoverable ?? undefined),
                    };
                    let lastMessage = msgs[msgs.length - 1];
                    if (lastMessage && lastMessage.role === "assistant") {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(errorBlock);
                    } else {
                      msgs.push({
                        role: "assistant",
                        content: "",
                        contentBlocks: [...pendingToolCalls.value, errorBlock],
                      });
                      pendingToolCalls.value = [];
                    }
                    messageComplete = true;
                    if (isActive()) await scrollToBottom();
                    continue;
                  }

                  // Handle streamed deltas and full/legacy message content.
                  if (data && typeof data.content === "string") {
                    // Complete any active tool call first (add green checkmark to chat)
                    if (activeToolCall.value) {
                      const completedToolBlock: ContentBlock = {
                        type: "tool_call",
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context,
                        call_id: activeToolCall.value.call_id,
                      };
                      let lastMessage = msgs[msgs.length - 1];
                      if (lastMessage && lastMessage.role === "assistant") {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                      if (isActive()) activeToolCall.value = null;
                    }

                    const isMessageDelta = data.type === "message_delta";

                    // Format code blocks with proper line breaks for full/legacy
                    // messages. Deltas must be appended exactly as received.
                    let content = data.content;
                    if (!isMessageDelta) {
                      content = content.replace(/```(\w*)\s*([^`])/g, "```$1\n$2");
                      content = content.replace(/([^`])\s*```/g, "$1\n```");
                    }

                    if (!isMessageDelta) {
                      // Add newline separator if starting a new text segment after tool call
                      if (streamingMsg && textSegment === "") {
                        streamingMsg += "\n\n";
                      }
                      // Add newline between consecutive full/legacy message events if needed
                      else if (
                        streamingMsg &&
                        !streamingMsg.endsWith("\n") &&
                        !content.startsWith("\n")
                      ) {
                        streamingMsg += "\n\n";
                        textSegment += "\n\n";
                      }
                    }

                    // Accumulate to both total content and current segment
                    streamingMsg += content;
                    textSegment += content;
                    syncStreamingRefs();

                    // Start typewriter animation if not already running
                    if (isActive() && !typewriterAnimationId.value) {
                      animateStreamingText();
                    }

                    // Get or create assistant message
                    let lastMessage = msgs[msgs.length - 1];
                    if (!lastMessage || lastMessage.role !== "assistant") {
                      // Create new assistant message with pending tool calls + text
                      msgs.push({
                        role: "assistant",
                        content: streamingMsg,
                        contentBlocks: [
                          ...pendingToolCalls.value,
                          { type: "text", text: textSegment },
                        ],
                      });
                      pendingToolCalls.value = []; // Clear pending
                      // Save immediately when assistant message is first created to prevent data loss on reload
                      await throttledSaveCtx(true);
                    } else {
                      // Update existing assistant message's total content
                      lastMessage.content = streamingMsg;

                      // Update or add text block in contentBlocks
                      if (!lastMessage.contentBlocks) {
                        lastMessage.contentBlocks = [];
                      }

                      // Find the last text block and update it, or create new one
                      const lastBlock =
                        lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
                      if (lastBlock && lastBlock.type === "text") {
                        // Append to existing text block (same segment)
                        lastBlock.text = textSegment;
                      } else {
                        // Add new text block (after tool call - new segment)
                        lastMessage.contentBlocks.push({
                          type: "text",
                          text: textSegment,
                        });
                      }
                      // Throttled save during streaming to preserve progress
                      await throttledSaveCtx();
                    }
                    messageComplete = true;
                    if (isActive()) await scrollToBottom();
                  }
                } catch (jsonError) {
                  console.debug("JSON parse error:", jsonError, "for line:", jsonStr);
                  continue;
                }
              } catch (e) {
                console.debug("Error processing line:", e, "Line:", line);
                continue;
              }
            }
          }
        }

        // Process any remaining complete data in buffer
        if (buffer.trim()) {
          const lines = buffer.split("\n");
          for (const line of lines) {
            if (line.trim().startsWith("data: ")) {
              try {
                const jsonStr = line.substring(line.indexOf("{"));
                if (!jsonStr || !jsonStr.trim()) continue;

                const data = JSON.parse(jsonStr);

                // Handle title events
                if (data && data.type === "title") {
                  ctxTitle = data.title;
                  if (isActive()) {
                    aiGeneratedTitle.value = data.title;
                    animateTitle(data.title);
                  }
                  continue;
                }

                // Handle tool_call events
                if (data && data.type === "tool_call") {
                  if (activeToolCall.value) {
                    const completedToolBlock: ContentBlock = {
                      type: "tool_call",
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context,
                      call_id: activeToolCall.value.call_id,
                    };
                    let lastMessage = msgs[msgs.length - 1];
                    if (lastMessage && lastMessage.role === "assistant") {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                  }

                  if (isActive()) {
                    activeToolCall.value = {
                      tool: data.tool,
                      message: data.message,
                      context: data.context || {},
                      call_id: data.call_id || undefined,
                    };
                  }

                  localFinalizeTextBlock();
                  continue;
                }

                // Handle error events
                if (data && data.type === "error") {
                  let lastMessage = msgs[msgs.length - 1];
                  if (activeToolCall.value) {
                    const completedToolBlock: ContentBlock = {
                      type: "tool_call",
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context,
                      call_id: activeToolCall.value.call_id,
                    };
                    if (lastMessage && lastMessage.role === "assistant") {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                    if (isActive()) activeToolCall.value = null;
                  }

                  const rawError = data.error ?? data.message ?? "An unexpected error occurred";
                  const errorText =
                    typeof rawError === "string" ? rawError : JSON.stringify(rawError, null, 2);

                  // Check if this is an authorization/access error
                  const authErr = isAuthError(errorText, data.error_type);
                  let errorMessage = authErr ? UNAUTHORIZED_MESSAGE : `Error: ${errorText}`;
                  if (data.suggestion && !authErr) {
                    errorMessage += `\n\n${data.suggestion}`;
                  }

                  lastMessage = msgs[msgs.length - 1];
                  if (!lastMessage || lastMessage.role !== "assistant") {
                    msgs.push({
                      role: "assistant",
                      content: errorMessage,
                      contentBlocks: [
                        ...pendingToolCalls.value,
                        { type: "text", text: errorMessage },
                      ],
                    });
                    pendingToolCalls.value = [];
                  } else {
                    if (lastMessage.content) {
                      lastMessage.content += "\n\n" + errorMessage;
                    } else {
                      lastMessage.content = errorMessage;
                    }
                    if (!lastMessage.contentBlocks) {
                      lastMessage.contentBlocks = [];
                    }
                    lastMessage.contentBlocks.push({
                      type: "text",
                      text: errorMessage,
                    });
                    pendingToolCalls.value = [];
                  }

                  textSegment = "";
                  syncStreamingRefs();

                  await saveCtx();
                  if (isActive()) await scrollToBottom();
                  return;
                }

                // Handle complete events
                if (data && data.type === "complete") {
                  if (data.trace_id && isActive()) {
                    lastTraceId.value = data.trace_id;
                  }
                  if (activeToolCall.value) {
                    const completedToolBlock: ContentBlock = {
                      type: "tool_call",
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context,
                      call_id: activeToolCall.value.call_id,
                    };
                    let lastMessage = msgs[msgs.length - 1];
                    if (lastMessage && lastMessage.role === "assistant") {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                    if (isActive()) activeToolCall.value = null;
                  }
                  continue;
                }

                // Handle tool_result events
                if (data && data.type === "tool_result") {
                  const resultData = {
                    success: data.success !== false,
                    resultMessage: data.message || "",
                    summary: data.summary || undefined,
                    errorType: data.error_type || undefined,
                    suggestion: data.suggestion || undefined,
                    details: data.details || undefined,
                    response: data.response || undefined,
                  };

                  const matchesActive =
                    activeToolCall.value &&
                    ((data.call_id && activeToolCall.value.call_id === data.call_id) ||
                      (!data.call_id && activeToolCall.value.tool === data.tool));

                  if (matchesActive) {
                    const completedToolBlock: ContentBlock = {
                      type: "tool_call",
                      tool: activeToolCall.value!.tool,
                      message: activeToolCall.value!.message,
                      context: activeToolCall.value!.context,
                      call_id: activeToolCall.value!.call_id,
                      ...resultData,
                    };
                    let lastMessage = msgs[msgs.length - 1];
                    if (lastMessage && lastMessage.role === "assistant") {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                    if (isActive()) activeToolCall.value = null;
                  } else {
                    const lastMessage = msgs[msgs.length - 1];
                    if (lastMessage && lastMessage.contentBlocks) {
                      for (let i = lastMessage.contentBlocks.length - 1; i >= 0; i--) {
                        const block = lastMessage.contentBlocks[i];
                        const blockMatches = data.call_id
                          ? block.call_id === data.call_id
                          : block.type === "tool_call" &&
                            block.tool === data.tool &&
                            block.success === undefined;
                        if (blockMatches) {
                          Object.assign(block, resultData);
                          break;
                        }
                      }
                    }
                    for (let i = pendingToolCalls.value.length - 1; i >= 0; i--) {
                      const block = pendingToolCalls.value[i];
                      const blockMatches = data.call_id
                        ? block.call_id === data.call_id
                        : block.type === "tool_call" &&
                          block.tool === data.tool &&
                          block.success === undefined;
                      if (blockMatches) {
                        Object.assign(block, resultData);
                        break;
                      }
                    }
                  }
                  continue;
                }

                // Handle error events - stream-level errors
                if (data && data.type === "error") {
                  if (activeToolCall.value) {
                    const failedToolBlock: ContentBlock = {
                      type: "tool_call",
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context,
                      call_id: activeToolCall.value.call_id,
                      success: false,
                      resultMessage: data.message || "Tool execution failed",
                      errorType: data.error_type || undefined,
                      suggestion: data.suggestion || undefined,
                    };
                    let lastMessage = msgs[msgs.length - 1];
                    if (lastMessage && lastMessage.role === "assistant") {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(failedToolBlock);
                    } else {
                      pendingToolCalls.value.push(failedToolBlock);
                    }
                    if (isActive()) activeToolCall.value = null;
                  }

                  const rawErrorMessage = data.message || data.error || "An error occurred";
                  const authErr = isAuthError(rawErrorMessage, data.error_type);
                  const errorBlock: ContentBlock = {
                    type: "error",
                    message: authErr ? UNAUTHORIZED_MESSAGE : rawErrorMessage,
                    errorType: data.error_type || undefined,
                    suggestion: authErr ? undefined : data.suggestion || undefined,
                    recoverable: authErr ? false : (data.recoverable ?? undefined),
                  };
                  let lastMessage = msgs[msgs.length - 1];
                  if (lastMessage && lastMessage.role === "assistant") {
                    if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                    lastMessage.contentBlocks.push(errorBlock);
                  } else {
                    msgs.push({
                      role: "assistant",
                      content: "",
                      contentBlocks: [...pendingToolCalls.value, errorBlock],
                    });
                    pendingToolCalls.value = [];
                  }
                  messageComplete = true;
                  continue;
                }

                // Handle streamed deltas and full/legacy message content.
                if (data && typeof data.content === "string") {
                  if (activeToolCall.value) {
                    const completedToolBlock: ContentBlock = {
                      type: "tool_call",
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context,
                      call_id: activeToolCall.value.call_id,
                    };
                    let lastMessage = msgs[msgs.length - 1];
                    if (lastMessage && lastMessage.role === "assistant") {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                    if (isActive()) activeToolCall.value = null;
                  }

                  const isMessageDelta = data.type === "message_delta";

                  let content = data.content;
                  if (!isMessageDelta) {
                    content = content.replace(/```(\w*)\s*([^`])/g, "```$1\n$2");
                    content = content.replace(/([^`])\s*```/g, "$1\n```");
                  }

                  if (!isMessageDelta) {
                    if (streamingMsg && textSegment === "") {
                      streamingMsg += "\n\n";
                    } else if (
                      streamingMsg &&
                      !streamingMsg.endsWith("\n") &&
                      !content.startsWith("\n")
                    ) {
                      streamingMsg += "\n\n";
                      textSegment += "\n\n";
                    }
                  }

                  streamingMsg += content;
                  textSegment += content;
                  syncStreamingRefs();

                  if (isActive() && !typewriterAnimationId.value) {
                    animateStreamingText();
                  }

                  let lastMessage = msgs[msgs.length - 1];
                  if (!lastMessage || lastMessage.role !== "assistant") {
                    msgs.push({
                      role: "assistant",
                      content: streamingMsg,
                      contentBlocks: [
                        ...pendingToolCalls.value,
                        { type: "text", text: textSegment },
                      ],
                    });
                    pendingToolCalls.value = [];
                    await throttledSaveCtx(true);
                  } else {
                    lastMessage.content = streamingMsg;

                    if (!lastMessage.contentBlocks) {
                      lastMessage.contentBlocks = [];
                    }
                    const lastBlock =
                      lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
                    if (lastBlock && lastBlock.type === "text") {
                      lastBlock.text = textSegment;
                    } else {
                      lastMessage.contentBlocks.push({
                        type: "text",
                        text: textSegment,
                      });
                    }
                    await throttledSaveCtx();
                  }
                  messageComplete = true;
                }
              } catch (e) {
                console.debug("Error processing remaining buffer:", e);
                continue;
              }
            }
          }
        }

        // If we completed a message, save to history
        if (messageComplete) {
          if (isActive()) {
            // Immediately show all remaining text and stop typewriter animation
            displayedStreamingContent.value = textSegment;
            if (typewriterAnimationId.value) {
              cancelAnimationFrame(typewriterAnimationId.value);
              typewriterAnimationId.value = null;
            }
          }
          // Update final text in contentBlocks
          const lastMessage = msgs[msgs.length - 1];
          if (lastMessage && lastMessage.role === "assistant" && lastMessage.contentBlocks) {
            const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
            if (lastBlock && lastBlock.type === "text") {
              lastBlock.text = textSegment;
            }
          }
          await saveCtx();
        }
      } catch (error) {
        // Handle different types of errors appropriately
        if (error instanceof Error && error.name === "AbortError") {
          // Request was cancelled by user - this is expected behavior, not an error
          // Do a final save for background streams before exiting
          if (!isActive() && msgs.length > 0 && ctxSessionId) {
            await dbSaveToHistory(msgs, ctxSessionId, ctxTitle, ctxChatId);
          }
          return; // Exit gracefully without logging as error
        } else {
          // Genuine error occurred during stream processing
          console.error("Error reading stream:", error);
        }
      }
    };

    const saveToHistory = async () => {
      saveHistoryLoading.value = true;
      if (chatMessages.value.length === 0) {
        saveHistoryLoading.value = false;
        return;
      }

      try {
        // Generate session ID if not already set for this chat
        if (!currentSessionId.value) {
          currentSessionId.value = getUUIDv7();
        }

        // Prefer AI-generated title, fallback to default
        const title = aiGeneratedTitle.value || undefined;

        // Save using the composable
        const chatId = await dbSaveToHistory(
          chatMessages.value,
          currentSessionId.value,
          title,
          currentChatId.value,
        );

        // Update current chat ID if this is a new chat
        if (!currentChatId.value && chatId) {
          currentChatId.value = chatId;

          // Apply pending auto navigation preference to the new chat. Persist the
          // actual value (ON by default) so an explicit user disable is honored.
          autoNavigationPreferences.value.set(chatId, pendingAutoNavigation.value);
          saveAutoNavigationPreferences();
        }
      } catch (error) {
        console.error("Error saving chat history:", error);
      } finally {
        saveHistoryLoading.value = false;
      }
    };

    const loadHistory = async () => {
      try {
        // Load history using the composable (automatically prunes to 100 items)
        const history = await dbLoadHistory();
        chatHistory.value = history;
        return chatHistory.value;
      } catch (error) {
        console.error("Error loading chat history:", error);
        return [];
      }
    };

    /**
     * Detach the current streaming request so it continues in the background.
     * processStream's captured context (msgs) keeps writing to the old array
     * while we clear the UI for a new session. When the stream completes,
     * processStream saves to IndexedDB via saveCtx().
     */
    const detachCurrentStream = () => {
      if (!currentAbortController.value) return;

      // Move controller to background set so onUnmounted can clean it up
      // and enforce the max background stream limit.
      if (backgroundStreams.size >= MAX_BACKGROUND_STREAMS) {
        // Abort the oldest background stream to stay within limits
        const oldest = backgroundStreams.values().next().value;
        if (oldest) {
          oldest.abort();
          backgroundStreams.delete(oldest);
        }
      }
      const detachedController = currentAbortController.value;
      backgroundStreams.add(detachedController);
      currentAbortController.value = null;

      // Register for re-attachment: when user navigates back to this session,
      // loadChat swaps chatMessages.value to this live array so the UI resumes.
      if (currentSessionId.value) {
        backgroundStreamMap.set(currentSessionId.value, {
          msgs: chatMessages.value,
          controller: detachedController,
          chatId: currentChatId.value,
        });
      }

      // Clean up UI state — processStream continues silently in background
      isLoading.value = false;
      activeToolCall.value = null;
      stopAnalyzingRotation();
      if (typewriterAnimationId.value) {
        cancelAnimationFrame(typewriterAnimationId.value);
        typewriterAnimationId.value = null;
      }
      currentStreamingMessage.value = "";
      currentTextSegment.value = "";
      displayedStreamingContent.value = "";
    };

    const toggleExpand = () => {
      if (!store.state.isAiChatEnabled) {
        // Closed → Open inline sidebar
        store.dispatch("setIsAiChatEnabled", true);
        store.dispatch("setIsAiChatExpanded", false);
      } else if (!store.state.isAiChatExpanded) {
        // Inline sidebar → Expanded overlay
        store.dispatch("setIsAiChatExpanded", true);
      } else {
        // Expanded overlay → Back to inline sidebar
        store.dispatch("setIsAiChatExpanded", false);
      }
      window.dispatchEvent(new Event("resize"));
    };

    useShortcuts([
      {
        id: "aiChatClose",
        key: "escape",
        description: "Close AI chat",
        // Escape must close the chat even while typing a message in its input.
        allowInInput: true,
        handler: () => {
          if (store.state.isAiChatEnabled) {
            store.dispatch("setIsAiChatEnabled", false);
            store.dispatch("setIsAiChatExpanded", false);
            window.dispatchEvent(new Event("resize"));
          }
        },
      },
      {
        id: "aiChatExpand",
        key: "ctrl+b",
        keyForMac: "meta+b",
        description: "Expand/collapse AI chat",
        handler: toggleExpand,
      },
    ]);

    const addNewChat = () => {
      detachCurrentStream();

      chatMessages.value = [];
      currentChatId.value = null;
      currentSessionId.value = null; // Will be generated on first save
      lastTraceId.value = null; // Reset trace correlation for new chat
      showHistory.value = false;
      currentChatTimestamp.value = null;
      shouldAutoScroll.value = true; // Reset auto-scroll for new chat
      resetTitleState(); // Clear AI-generated title for new chat
      resetTypewriterState(); // Clear typewriter animation state for new chat
      pendingAutoNavigation.value = true; // Auto navigation is ON by default for new chats
      showScrollToBottom.value = false; // Reset scroll-to-bottom button for new chat
      store.dispatch("setCurrentChatTimestamp", null);
      store.dispatch("setChatUpdated", true);
    };

    const openHistory = async () => {
      showHistory.value = true;
      await loadHistory();
    };

    const openEditTitleDialog = () => {
      editingTitle.value = displayedTitle.value || "";
      showEditTitleDialog.value = true;
    };

    const saveEditedTitle = async () => {
      if (!currentChatId.value || !editingTitle.value.trim()) {
        showEditTitleDialog.value = false;
        return;
      }

      try {
        // Update title using the composable
        const success = await dbUpdateChatTitle(currentChatId.value, editingTitle.value.trim());

        if (success) {
          // Update the displayed title
          displayedTitle.value = editingTitle.value.trim();
          aiGeneratedTitle.value = editingTitle.value.trim();

          // Reload history to reflect changes
          loadHistory();
        }
      } catch (error) {
        console.error("Error updating chat title:", error);
      } finally {
        showEditTitleDialog.value = false;
      }
    };

    const deleteChat = (chatId: number) => {
      chatToDelete.value = chatId;
      showDeleteChatConfirmDialog.value = true;
    };

    const confirmDeleteChat = async () => {
      if (!chatToDelete.value) return;

      try {
        // Delete chat using the composable
        const success = await dbDeleteChatById(chatToDelete.value);

        if (success) {
          // If the deleted chat is the current one, reset to new chat
          if (currentChatId.value === chatToDelete.value) {
            addNewChat();
          }

          // Reload history to reflect changes
          loadHistory();
        }
      } catch (error) {
        console.error("Error deleting chat:", error);
      } finally {
        // Reset state
        chatToDelete.value = null;
        showDeleteChatConfirmDialog.value = false;
      }
    };

    const clearAllConversations = () => {
      showClearAllConfirmDialog.value = true;
    };

    /** Resolve the pendingConfirmation block — mark as success or failure */
    const resolveConfirmationBlock = (approved: boolean) => {
      for (const msg of chatMessages.value) {
        if (msg.contentBlocks) {
          for (const block of msg.contentBlocks) {
            if (block.pendingConfirmation) {
              block.pendingConfirmation = false;
              if (!approved) {
                block.success = false;
                block.resultMessage = "Action cancelled by user";
              }
              return;
            }
          }
        }
      }
    };

    const handleToolConfirm = async () => {
      resolveConfirmationBlock(true);

      // Check if this is a navigation action
      if (pendingConfirmation.value?.tool === "navigation_action") {
        const navAction = pendingConfirmation.value?.navAction;
        if (navAction) {
          await handleNavigationAction(navAction);
        }
        pendingConfirmation.value = null;
        return;
      }

      if (!currentSessionId.value) return;

      try {
        const orgId = store.state.selectedOrganization.identifier;
        await fetch(
          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${currentSessionId.value}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ approved: true }),
          },
        );
      } catch (error) {
        console.error("Error confirming action:", error);
      }
      pendingConfirmation.value = null;
    };

    const handleToolCancel = async () => {
      resolveConfirmationBlock(false);

      // Check if this is a navigation action
      if (pendingConfirmation.value?.tool === "navigation_action") {
        // Just clear the confirmation, don't navigate
        pendingConfirmation.value = null;
        return;
      }

      if (!currentSessionId.value) return;

      try {
        const orgId = store.state.selectedOrganization.identifier;
        await fetch(
          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${currentSessionId.value}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ approved: false }),
          },
        );
      } catch (error) {
        console.error("Error cancelling action:", error);
      }
      pendingConfirmation.value = null;
    };

    const handleToolAlwaysConfirm = async () => {
      // Enable auto navigation for this chat
      isAutoNavigationEnabled.value = true;

      // Then proceed with confirmation
      resolveConfirmationBlock(true);

      // Check if this is a navigation action
      if (pendingConfirmation.value?.tool === "navigation_action") {
        const navAction = pendingConfirmation.value?.navAction;
        if (navAction) {
          await handleNavigationAction(navAction);
        }
        pendingConfirmation.value = null;
        return;
      }

      if (!currentSessionId.value) return;

      try {
        const orgId = store.state.selectedOrganization.identifier;
        await fetch(
          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${currentSessionId.value}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ approved: true }),
          },
        );
      } catch (error) {
        console.error("Error confirming action:", error);
      }
      pendingConfirmation.value = null;
    };

    // Generate navigation action from tool result data (generic, pattern-based)
    //
    // Expected backend response format:
    // - Search tools: Must have SQL query in callArgs.request_body.query.sql
    // - Create/Get/Update/Delete tools: Must return {resource}_id in response
    //   Examples: alert_id, dashboard_id, pipeline_id, stream_id, etc.
    //   Optional fields: name, folder (will use 'default' if not provided)
    const generateNavigationFromToolResult = (
      toolName: string,
      callArgs: any,
      responseBody: any,
    ): NavigationAction | null => {
      if (!callArgs) {
        return null;
      }

      // Pattern 1: Search tools (has SQL query) → load_query navigation
      const requestBody = callArgs.request_body || {};
      const query = requestBody.query || {};
      const sql = query.sql || "";

      if (sql) {
        const streamType = callArgs.stream_type || "logs";
        let streamName = callArgs.stream_name || "";

        // If stream_name is not in callArgs, try to extract it from the SQL query
        if (!streamName) {
          // Extract stream name from FROM clause (handles quoted and unquoted table names)
          const fromMatch = sql.match(/FROM\s+["']?([^"'\s,()]+)["']?/i);
          if (fromMatch) {
            streamName = fromMatch[1];
          }
        }

        const vrlFunction =
          query.functionContent || requestBody.function || requestBody.functionContent;

        // Don't generate navigation if time range is missing
        if (query.start_time === undefined || query.end_time === undefined) {
          return null;
        }

        // Don't generate navigation if stream name is still missing
        if (!streamName) {
          return null;
        }

        const target: any = {
          query: sql,
          sql_mode: true,
          from: query.start_time,
          to: query.end_time,
          stream: streamName.split(","),
        };

        if (vrlFunction) {
          target.functionContent = vrlFunction;
        }

        return {
          resource_type: streamType,
          action: "load_query",
          label: `View in ${streamType.charAt(0).toUpperCase() + streamType.slice(1)}`,
          target,
        };
      }

      // Pattern 2: Create/Get tools (has ID) → navigate_direct
      // Extract resource type from tool name (CreateAlert → alert, GetDashboard → dashboard, createPipeline → pipeline)
      const resourceTypeMatch = toolName.match(/^(create|get|update|delete)(.+)$/i);
      if (!resourceTypeMatch) return null;

      const resourceType = resourceTypeMatch[2].toLowerCase(); // Alert → alert, Dashboard → dashboard, Pipeline → pipeline

      // Parse response data - it might be in different formats
      let parsedResponse: any = {};
      if (responseBody) {
        // If responseBody has a 'response' field (from SRE agent tool_result event)
        if (responseBody.response) {
          let responseData = responseBody.response;
          // If response is a JSON string, parse it
          if (typeof responseData === "string") {
            try {
              responseData = JSON.parse(responseData);
            } catch (e) {
              console.warn("[Navigation] Failed to parse response string:", e);
            }
          }
          // Extract from versioned response (v8, v7, etc.) for dashboards
          if (typeof responseData === "object" && responseData !== null) {
            parsedResponse =
              responseData.v8 ||
              responseData.v7 ||
              responseData.v6 ||
              responseData.v5 ||
              responseData;
          } else {
            parsedResponse = responseData;
          }
        }
        // If responseBody has 'content' array (MCP format)
        else if (
          responseBody.content &&
          Array.isArray(responseBody.content) &&
          responseBody.content[0]?.text
        ) {
          try {
            const textContent = responseBody.content[0].text;
            const parsed = JSON.parse(textContent);
            // Extract from versioned response (v8, v7, etc.)
            parsedResponse = parsed.v8 || parsed.v7 || parsed.v6 || parsed.v5 || parsed;
          } catch (e) {
            console.warn("[Navigation] Failed to parse content text:", e);
          }
        }
        // Otherwise use responseBody as-is
        else {
          parsedResponse = responseBody;
        }
      }

      // Merge data from parsed response, call args, and call args request_body for ID/field lookup
      const requestBodyFromArgs = (callArgs || {}).request_body || {};
      const data = {
        ...parsedResponse,
        ...(callArgs || {}),
        ...requestBodyFromArgs,
      };

      // Standard pattern: {resource}_id (e.g., alert_id, dashboard_id, pipeline_id)
      const resourceIdField = `${resourceType}_id`;
      let resourceId = data[resourceIdField] || data.id;

      // Also check camelCase variants (dashboardId, alertId)
      if (!resourceId) {
        const camelCaseField = resourceType + "Id";
        resourceId = data[camelCaseField];
      }

      if (!resourceId) {
        return null;
      }

      // Build target with consistent {resource}_id pattern
      const target: any = {
        [resourceIdField]: resourceId, // e.g., alert_id, dashboard_id, pipeline_id
      };

      // Add name if available (required for some resources like alerts)
      const name = data.name;
      if (name) {
        target.name = name;
      }

      // Add folder if available (default to 'default' for resources that use folders)
      const folder = data.folder;
      if (folder || resourceType === "alert" || resourceType === "dashboard") {
        target.folder = folder || "default";
      }

      return {
        resource_type: resourceType,
        action: "navigate_direct",
        label: `View ${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}`,
        target,
      };
    };

    const handleNavigationAction = async (action: NavigationAction) => {
      // Helper to encode strings for URL (same as search history)
      const encodeForUrl = (str: string) => btoa(unescape(encodeURIComponent(str)));

      // Extract page name for success message
      let pageName = action.label || "";
      if (!pageName) {
        // Fallback: use target name or resource type
        pageName =
          action.target.name ||
          action.resource_type.charAt(0).toUpperCase() + action.resource_type.slice(1);
      }

      // Perform navigation FIRST
      if (action.action === "load_query") {
        const targetPath = `/${action.resource_type}`;
        const target = action.target;

        // Build query object similar to SearchHistory goToLogs function
        const queryParams: Record<string, string> = {
          org_identifier: store.state.selectedOrganization.identifier,
          stream_type: action.resource_type, // logs, metrics, traces
          refresh: "0",
          sql_mode: target.sql_mode?.toString() || "false",
          quick_mode: "false",
          show_histogram: "true",
          type: "ai_chat_query",
        };

        // Add stream (comma-separated if array)
        if (target.stream) {
          queryParams.stream = Array.isArray(target.stream)
            ? target.stream.join(",")
            : target.stream;
        }

        // Add time range (prefer absolute from/to over period)
        if (target.from !== undefined && target.to !== undefined) {
          queryParams.from = target.from.toString();
          queryParams.to = target.to.toString();
        } else if (target.period) {
          queryParams.period = target.period;
        }

        // Add base64 encoded query
        if (target.query) {
          queryParams.query = encodeForUrl(
            typeof target.query === "string" ? target.query : JSON.stringify(target.query),
          );
        }

        // Add VRL function if present
        if (target.functionContent) {
          queryParams.functionContent = encodeForUrl(target.functionContent);
          queryParams.fn_editor = "true";
        } else {
          queryParams.fn_editor = "false";
        }

        // Navigate using same pattern as search history
        await router.push({
          path: targetPath,
          query: queryParams,
        });
      } else if (action.action === "navigate_direct") {
        // Direct navigation - build proper URLs based on resource type
        let path = action.target.path || `/${action.resource_type}`;
        // navigate_direct always carries the record form of `query`
        const targetQuery = action.target.query as Record<string, any> | undefined;
        const queryParams: Record<string, string> = {
          org_identifier: store.state.selectedOrganization.identifier,
          ...targetQuery,
        };

        // Resource-type-specific URL handling
        if (action.resource_type === "alert") {
          path = "/alerts";
          const alertId = action.target.alert_id || targetQuery?.alert_id;
          if (alertId) {
            // Navigate to specific alert with update action
            queryParams.action = "update";
            queryParams.alert_id = alertId;
            queryParams.name = action.target.name || targetQuery?.name;
          }
          queryParams.folder = action.target.folder || targetQuery?.folder || "default";
        } else if (action.resource_type === "dashboard") {
          // Dashboards use /dashboards/view path
          path = "/dashboards/view";
          queryParams.dashboard =
            action.target.dashboard_id || action.target.dashboardId || targetQuery?.dashboardId;
          queryParams.folder = action.target.folder || targetQuery?.folder || "default";
          queryParams.tab = action.target.tab || "tab-1";
          queryParams.refresh = "Off";
          queryParams.period = "15m";
          queryParams.print = "false";
        } else if (action.resource_type === "pipeline") {
          // Pipelines use /pipeline/pipelines/edit path
          path = "/pipeline/pipelines/edit";
          queryParams.id = action.target.pipeline_id || action.target.id || targetQuery?.id;
          queryParams.name = action.target.name || targetQuery?.name;
        }

        await router.push({ path, query: queryParams });
      }

      // Use setTimeout to add message AFTER navigation fully completes and settles
      setTimeout(async () => {
        try {
          // Add success message AFTER navigation completes
          const successMessage = `Successfully navigated to ${pageName}`;
          let lastMessage = chatMessages.value[chatMessages.value.length - 1];

          if (!lastMessage || lastMessage.role !== "assistant") {
            // Create new assistant message
            chatMessages.value.push({
              role: "assistant",
              content: successMessage,
              contentBlocks: [{ type: "text", text: successMessage }],
            });
          } else {
            // Append to existing assistant message
            if (lastMessage.content) {
              lastMessage.content += "\n\n" + successMessage;
            } else {
              lastMessage.content = successMessage;
            }
            if (!lastMessage.contentBlocks) {
              lastMessage.contentBlocks = [];
            }
            lastMessage.contentBlocks.push({
              type: "text",
              text: successMessage,
            });
          }

          // Save to history after adding message
          await saveToHistory();
          await scrollToBottom();
        } catch (error) {
          console.error("Error adding navigation success message:", error);
        }
      }, 500);
    };

    const confirmClearAllConversations = async () => {
      try {
        // Clear all history using the composable
        const success = await dbClearAllHistory();

        if (success) {
          // Reset to new chat
          addNewChat();

          // Clear the chat history array
          chatHistory.value = [];
        }
      } catch (error) {
        console.error("Error clearing all conversations:", error);
      } finally {
        showClearAllConfirmDialog.value = false;
      }
    };

    const loadChat = async (chatId: number) => {
      try {
        if (chatId == null) {
          addNewChat();
          return;
        }

        // Detach any in-progress stream so it continues in the background
        detachCurrentStream();

        // Load chat using the composable
        const chat = await dbLoadChat(chatId);

        if (chat) {
          // Check if this session has an active background stream.
          // If so, re-attach by using the LIVE array that processStream is writing to
          // instead of the stale IndexedDB snapshot. Setting chatMessages.value to the
          // same array makes processStream's isActive() true again, so UI updates resume.
          const bgCtx = chat.sessionId ? backgroundStreamMap.get(chat.sessionId) : null;

          if (bgCtx) {
            // Re-attach: use the live streaming array
            chatMessages.value = bgCtx.msgs;
            currentChatId.value = bgCtx.chatId || chatId;
            currentSessionId.value = chat.sessionId || null;

            // Move controller back to foreground
            currentAbortController.value = bgCtx.controller;
            backgroundStreams.delete(bgCtx.controller);
            backgroundStreamMap.delete(chat.sessionId!);

            // Restore streaming UI state so loading indicator shows
            isLoading.value = true;
            startAnalyzingRotation();
          } else {
            // Normal load from IndexedDB snapshot (no active stream)
            const formattedMessages = chat.messages.map((msg: any) => ({
              role: msg.role,
              content: msg.content,
              ...(msg.contentBlocks ? { contentBlocks: msg.contentBlocks } : {}),
              ...(msg.images ? { images: msg.images } : {}),
              ...(msg.feedback ? { feedback: msg.feedback } : {}),
            }));

            chatMessages.value = formattedMessages;
            currentChatId.value = chatId;
            currentSessionId.value = chat.sessionId || null;
          }

          showHistory.value = false;
          shouldAutoScroll.value = true;

          // Load title from history (no animation for existing chats)
          displayedTitle.value = chat.title || "";
          aiGeneratedTitle.value = chat.title || null;
          isTypingTitle.value = false;

          if (chatId !== store.state.currentChatTimestamp) {
            store.dispatch("setCurrentChatTimestamp", chatId);
            store.dispatch("setChatUpdated", true);
          }

          // Scroll to bottom after loading chat
          await nextTick();
          scrollToBottom();
        }
      } catch (error) {
        console.error("Error loading chat:", error);
      }
    };

    /**
     * Sends a message to the AI chat service with streaming response handling
     * Creates a new AbortController for each request to enable cancellation
     * Manages the complete request lifecycle from user input to streaming response
     */
    const sendMessage = async () => {
      // Allow sending with text or images (or both)
      const hasText = inputMessage.value.trim().length > 0;
      const hasImages = pendingImages.value.length > 0;
      if ((!hasText && !hasImages) || isLoading.value) return;

      // Get the message for backend (with unwrapped chips)
      let backendMessage = inputMessage.value;
      if (chatInput.value && typeof chatInput.value.getMessageForBackend === "function") {
        backendMessage = chatInput.value.getMessageForBackend();
      }

      // Use the plain text message for display
      const userMessage = inputMessage.value;
      const messagesToSend = [...pendingImages.value]; // Capture images before clearing

      // Add to query history before clearing input
      if (hasText) {
        addToHistory(userMessage);
      }

      // Push user message with images for display
      // But we'll use backendMessage for the API call
      chatMessages.value.push({
        role: "user",
        content: backendMessage, // Use backend message with full context
        ...(hasImages && { images: messagesToSend }),
      });
      inputMessage.value = "";
      contextReferences.value = []; // Clear reference chips
      if (chatInput.value && typeof chatInput.value.clear === "function") {
        chatInput.value.clear(); // Clear the rich text input
      }
      clearPendingImages(); // Clear pending images after capturing
      shouldAutoScroll.value = true; // Reset auto-scroll for new message
      await scrollToBottom(); // Scroll after user message
      await saveToHistory(); // Save after user message

      isLoading.value = true;
      currentStreamingMessage.value = "";
      currentTextSegment.value = "";
      resetTypewriterState(); // Reset typewriter animation for new message
      startAnalyzingRotation(); // Start rotating analyzing messages

      // Create new AbortController for this request - enables cancellation via Stop button
      currentAbortController.value = new AbortController();

      try {
        // Don't add empty assistant message here - wait for actual content
        await scrollToLoadingIndicator(); // Scroll directly to loading indicator

        let response: any;
        try {
          // Ensure session ID exists for tracking this chat session
          if (!currentSessionId.value) {
            currentSessionId.value = getUUIDv7();
          }

          // Pass abort signal, session ID, and images to enable request cancellation and multimodal support
          response = await fetchAiChat(
            chatMessages.value,
            "",
            store.state.selectedOrganization.identifier,
            currentAbortController.value.signal,
            undefined, // explicitContext
            currentSessionId.value, // sessionId for x-o2-session-id header
            hasImages ? messagesToSend : undefined, // images for multimodal queries
          );
        } catch (error) {
          console.error("Error fetching AI chat:", error);
          return;
        }

        // Check if request was cancelled before processing response
        if (response && response.cancelled) {
          return;
        }

        if (!response.ok) {
          // Read the actual error body before throwing
          let errorBody = null;
          try {
            errorBody = await response.json();
          } catch (_) {
            // body may not be JSON
          }
          const err: any = new Error(errorBody?.message || `Server error (${response.status})`);
          err.status = response.status;
          err.errorBody = errorBody;
          throw err;
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        const reader = response.body.getReader();

        // Capture the controller, messages ref, and sessionId so we can detect
        // detachment and clean up after processStream
        const streamController = currentAbortController.value;
        const streamMsgs = chatMessages.value;
        const streamSessionId = currentSessionId.value;

        await processStream(reader);

        // Remove controller from background set and clean up re-attachment map
        if (streamController) backgroundStreams.delete(streamController);
        if (streamSessionId) backgroundStreamMap.delete(streamSessionId);

        // Only update UI/store if stream was NOT detached (session is still the same)
        const wasDetached = chatMessages.value !== streamMsgs;
        if (!wasDetached) {
          store.dispatch("setCurrentChatTimestamp", currentChatId.value);
          store.dispatch("setChatUpdated", true);
        }
      } catch (error: any) {
        // Remove the empty assistant message that was added before the error
        //this will impact in the case of error showing empty message above the error message in the chat
        if (
          chatMessages.value.length > 0 &&
          chatMessages.value[chatMessages.value.length - 1].role === "assistant" &&
          !chatMessages.value[chatMessages.value.length - 1].content
        ) {
          chatMessages.value.pop();
        }
        let errorMessage: string;
        if (error.status === 403) {
          errorMessage = UNAUTHORIZED_MESSAGE;
        } else if (error.message && error.message !== "No response body") {
          errorMessage = error.message;
        } else {
          errorMessage = "Error: Unable to get response from the server. Please try again later.";
        }
        chatMessages.value.push({
          role: "assistant",
          content: errorMessage,
        });
        await saveToHistory(); // Save after error
      }

      isLoading.value = false;
      activeToolCall.value = null;
      stopAnalyzingRotation();

      // Clean up AbortController after request completion (success or error)
      currentAbortController.value = null;

      await scrollToBottom();
    };

    const selectCapability = (capability: string) => {
      // Remove the number prefix and set as input
      inputMessage.value = capability.replace(/^\d+\.\s/, "");
    };

    const selectWelcomePrompt = (prompt: string) => {
      inputMessage.value = prompt;
      nextTick(() => {
        chatInput.value?.focus?.();
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault(); // Prevent the default enter behavior
        sendMessage();
      } else if (e.key === "Backspace") {
        // Handle backspace for RichTextInput (contenteditable)
        const target = e.target as HTMLElement;
        const contenteditable =
          target.closest('[contenteditable="true"]') ||
          target.querySelector('[contenteditable="true"]');

        if (contenteditable) {
          // Check if cursor is right after an image reference span
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) return;

          const range = selection.getRangeAt(0);
          const cursorNode = range.startContainer;
          let imageRefSpan: Element | null = null;

          // Case 1: Cursor is in a text node at position 0, check previous sibling
          if (cursorNode.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
            const prevSibling = cursorNode.previousSibling;
            if (prevSibling && (prevSibling as Element).classList?.contains("image-reference")) {
              imageRefSpan = prevSibling as Element;
            }
          }
          // Case 2: Cursor is in an element node, check the child before cursor
          else if (cursorNode.nodeType === Node.ELEMENT_NODE && range.startOffset > 0) {
            const element = cursorNode as Element;
            const prevChild = element.childNodes[range.startOffset - 1];
            if (prevChild && (prevChild as Element).classList?.contains("image-reference")) {
              imageRefSpan = prevChild as Element;
            }
          }

          // If we found an image reference to delete
          if (imageRefSpan) {
            e.preventDefault();

            // Extract filename from the span text
            const refText = imageRefSpan.textContent || "";
            const match = refText.match(/@\[([^\]]+)\]/);

            if (match) {
              const filename = match[1];

              // Remove the associated image from pendingImages
              const imageIndex = pendingImages.value.findIndex((img) => img.filename === filename);
              if (imageIndex !== -1) {
                pendingImages.value.splice(imageIndex, 1);
              }
            }

            // Remove the span element
            imageRefSpan.remove();

            // Trigger input event to update model
            if (contenteditable) {
              contenteditable.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }
        } else {
          // Legacy textarea handling
          const textarea = e.target as HTMLTextAreaElement;
          const cursorPos = textarea.selectionStart;
          const text = inputMessage.value;

          // Find if cursor is at the end of a @[filename] pattern
          const textBeforeCursor = text.substring(0, cursorPos);
          const match = textBeforeCursor.match(/@\[([^\]]+)\]$/);

          if (match) {
            e.preventDefault();
            const filename = match[1];
            const refStart = cursorPos - match[0].length;

            // Remove the entire @[filename] reference from text
            inputMessage.value = text.substring(0, refStart) + text.substring(cursorPos);

            // Remove the associated image from pendingImages
            const imageIndex = pendingImages.value.findIndex((img) => img.filename === filename);
            if (imageIndex !== -1) {
              pendingImages.value.splice(imageIndex, 1);
            }

            // Set cursor position after the deletion
            nextTick(() => {
              textarea.selectionStart = textarea.selectionEnd = refStart;
            });
          }
        }
      } else if (e.key === "ArrowUp") {
        const target = e.target as HTMLElement;
        const textarea = target.tagName === "TEXTAREA" ? (target as HTMLTextAreaElement) : null;
        if (textarea && isOnFirstLine(textarea)) {
          e.preventDefault();
          navigateHistory("up");
        }
      } else if (e.key === "ArrowDown" && historyIndex.value > -1) {
        e.preventDefault();
        navigateHistory("down");
      }
    };

    // Check if cursor is on the first line of textarea
    const isOnFirstLine = (textarea: HTMLTextAreaElement) => {
      if (!textarea) return false;

      const cursorPosition = textarea.selectionStart;
      const textBeforeCursor = textarea.value.substring(0, cursorPosition);

      // Check if there are any newlines before cursor position
      return !textBeforeCursor.includes("\n");
    };

    // Navigate through query history
    const navigateHistory = (direction: "up" | "down") => {
      if (queryHistory.value.length === 0) return;

      if (direction === "up") {
        if (historyIndex.value < queryHistory.value.length - 1) {
          historyIndex.value++;
          inputMessage.value = queryHistory.value[historyIndex.value];
        }
      } else if (direction === "down") {
        if (historyIndex.value > 0) {
          historyIndex.value--;
          inputMessage.value = queryHistory.value[historyIndex.value];
        } else if (historyIndex.value === 0) {
          historyIndex.value = -1;
          inputMessage.value = "";
        }
      }
    };

    const focusInput = () => {
      if (chatInput.value) {
        // For RichTextInput component, call its focusInput method
        if (typeof chatInput.value.focusInput === "function") {
          chatInput.value.focusInput();
        } else {
          // Fallback for other input types
          chatInput.value.focus();
        }
      }
    };

    // Handle reference chip updates from RichTextInput
    const handleReferencesUpdate = (refs: ReferenceChip[]) => {
      contextReferences.value = refs;
    };

    // Image handling functions
    const triggerImageUpload = () => {
      imageInputRef.value?.click();
    };

    const handleImageSelect = async (event: Event) => {
      const input = event.target as HTMLInputElement;
      const files = input.files;
      if (!files) return;

      for (const file of Array.from(files)) {
        await addImage(file);
      }
      // Reset input so the same file can be selected again
      input.value = "";
    };

    const addImage = async (file: File): Promise<boolean> => {
      // Validate file size first (before reading)
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        toast({
          variant: "error",
          message: `Image exceeds 2MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
        });
        return false;
      }

      // Basic file type check for immediate feedback (backend will detect actual type)
      if (!ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
        toast({
          variant: "error",
          message: "Only PNG and JPEG images are supported",
        });
        return false;
      }

      // Convert to base64
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = (e.target?.result as string).split(",")[1]; // Remove data:image/...;base64, prefix
          const imageRef = `@[${file.name}]`;

          // Use file.type for display - backend will detect and correct actual mime type
          pendingImages.value.push({
            data: base64,
            mimeType: file.type as "image/png" | "image/jpeg",
            filename: file.name,
            size: file.size,
          });

          // Insert image reference at cursor position
          // Check if we're using RichTextInput (contenteditable)
          const contenteditable =
            chatInput.value?.$el?.querySelector('[contenteditable="true"]') ||
            chatInput.value?.$el?.querySelector(".rich-text-input");

          if (contenteditable) {
            // RichTextInput - insert at cursor position in contenteditable
            const selection = window.getSelection();
            const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

            // Create a non-editable span for the image reference
            const imageRefSpan = document.createElement("span");
            imageRefSpan.contentEditable = "false";
            imageRefSpan.className = "image-reference";
            imageRefSpan.style.cssText = `display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; margin: 0 2px; background: ${chartColor("--color-status-success-bg")}; border: 1px solid ${chartColor("--color-success-200")}; border-radius: 4px; font-size: var(--text-compact); color: ${chartColor("--color-status-success-text")}; user-select: none;`;

            // Add image icon
            const imageIcon = document.createElement("span");
            imageIcon.textContent = "🖼️";
            imageIcon.style.cssText = "font-size: var(--text-xs);";

            // Add filename text
            const filenameText = document.createElement("span");
            filenameText.textContent = file.name;

            // Add remove button
            const removeBtn = document.createElement("button");
            removeBtn.textContent = "×";
            removeBtn.style.cssText = `display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; padding: 0; margin-left: 2px; background: transparent; border: none; border-radius: 3px; font-size: var(--text-base); line-height: 1; cursor: pointer; color: ${chartColor("--color-status-success-text")}; transition: all 0.15s ease;`;
            removeBtn.onmouseover = () => {
              removeBtn.style.background = chartColor("--color-status-negative");
              removeBtn.style.color = chartColor("--color-white");
            };
            removeBtn.onmouseout = () => {
              removeBtn.style.background = "transparent";
              removeBtn.style.color = chartColor("--color-status-success-text");
            };
            removeBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();

              // Find and remove the image from pendingImages
              const imageIndex = pendingImages.value.findIndex((img) => img.filename === file.name);
              if (imageIndex !== -1) {
                pendingImages.value.splice(imageIndex, 1);
              }

              // Remove the span
              imageRefSpan.remove();

              // Trigger input event
              contenteditable.dispatchEvent(new Event("input", { bubbles: true }));
            };

            imageRefSpan.appendChild(imageIcon);
            imageRefSpan.appendChild(filenameText);
            imageRefSpan.appendChild(removeBtn);

            if (range && contenteditable.contains(range.startContainer)) {
              // Insert at cursor position
              range.deleteContents();

              // Add space before if needed
              const textBefore = range.startContainer.textContent || "";
              if (
                textBefore.length > 0 &&
                !textBefore.endsWith(" ") &&
                !textBefore.endsWith("\n")
              ) {
                range.insertNode(document.createTextNode(" "));
              }

              range.insertNode(imageRefSpan);

              // Add space after for cursor positioning
              const spaceAfter = document.createTextNode(" ");
              range.setStartAfter(imageRefSpan);
              range.insertNode(spaceAfter);

              // Move cursor after the space
              range.setStartAfter(spaceAfter);
              range.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(range);
            } else {
              // No selection or selection outside - append to end
              const spaceNeeded =
                contenteditable.textContent &&
                !contenteditable.textContent.endsWith(" ") &&
                !contenteditable.textContent.endsWith("\n");
              if (spaceNeeded) {
                contenteditable.appendChild(document.createTextNode(" "));
              }
              contenteditable.appendChild(imageRefSpan);
              const spaceAfter = document.createTextNode(" ");
              contenteditable.appendChild(spaceAfter);

              // Move cursor to end
              const newRange = document.createRange();
              newRange.setStartAfter(spaceAfter);
              newRange.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(newRange);
            }

            // Trigger input event to update model
            contenteditable.dispatchEvent(new Event("input", { bubbles: true }));
            focusInput();
          } else {
            // Legacy textarea fallback
            const textarea = chatInput.value?.$el?.querySelector(
              "textarea",
            ) as HTMLTextAreaElement | null;
            if (textarea) {
              const start = textarea.selectionStart || 0;
              const end = textarea.selectionEnd || 0;
              const text = inputMessage.value;
              const before = text.substring(0, start);
              const after = text.substring(end);

              // Add space before if needed
              const needsSpaceBefore =
                before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
              const needsSpaceAfter =
                after.length > 0 && !after.startsWith(" ") && !after.startsWith("\n");

              const insertion =
                (needsSpaceBefore ? " " : "") + imageRef + (needsSpaceAfter ? " " : "");
              inputMessage.value = before + insertion + after;

              // Set cursor position after the inserted reference
              nextTick(() => {
                const newPos = start + insertion.length;
                textarea.setSelectionRange(newPos, newPos);
                textarea.focus();
              });
            } else {
              // Final fallback: append to end
              const currentText = inputMessage.value;
              const separator =
                currentText && !currentText.endsWith(" ") && !currentText.endsWith("\n") ? " " : "";
              inputMessage.value = currentText + separator + imageRef + " ";
            }
          }

          resolve(true);
        };
        reader.onerror = () => {
          toast({
            variant: "error",
            message: `Failed to read image: ${file.name}`,
          });
          resolve(false);
        };
        reader.readAsDataURL(file);
      });
    };

    const removeImage = (index: number) => {
      // Get the filename before removing
      const image = pendingImages.value[index];
      if (image) {
        const imageRef = `@[${image.filename}]`;

        // Check if we're using RichTextInput (contenteditable)
        const contenteditable =
          chatInput.value?.$el?.querySelector('[contenteditable="true"]') ||
          chatInput.value?.$el?.querySelector(".rich-text-input");

        if (contenteditable) {
          // Find and remove all image reference spans with this filename
          const imageRefSpans = contenteditable.querySelectorAll(".image-reference");
          imageRefSpans.forEach((span: Element) => {
            if (span.textContent === imageRef) {
              span.remove();
            }
          });

          // Trigger input event to update model
          contenteditable.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          // Legacy textarea - remove from text
          inputMessage.value = inputMessage.value
            .replace(new RegExp(`\\s*${escapeRegExp(imageRef)}\\s*`, "g"), " ")
            .trim();
        }
      }
      pendingImages.value.splice(index, 1);
    };

    // Helper to escape special regex characters
    const escapeRegExp = (str: string) => {
      return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    };

    const clearPendingImages = () => {
      pendingImages.value = [];
    };

    // Handle drag and drop for images
    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleDrop = async (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const files = event.dataTransfer?.files;
      if (!files) return;

      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          await addImage(file);
        }
      }
    };

    // Handle paste for images
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            await addImage(file);
          }
        }
      }
    };

    // Open image preview dialog
    const openImagePreview = (img: ImageAttachment) => {
      previewImage.value = img;
      showImagePreview.value = true;
    };

    const closeImagePreview = () => {
      showImagePreview.value = false;
      previewImage.value = null;
    };

    // Load query history from localStorage
    const loadQueryHistory = () => {
      try {
        const stored = localStorage.getItem(HISTORY_KEY);
        if (stored) {
          queryHistory.value = JSON.parse(stored);
        }
      } catch (error) {
        console.error("Error loading query history:", error);
        queryHistory.value = [];
      }
    };

    // Save query history to localStorage
    const saveQueryHistory = () => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(queryHistory.value));
      } catch (error) {
        console.error("Error saving query history:", error);
      }
    };

    // Auto navigation preferences localStorage functions
    const AUTO_NAV_KEY = "ai-chat-auto-navigation";

    const loadAutoNavigationPreferences = () => {
      try {
        const stored = localStorage.getItem(AUTO_NAV_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          autoNavigationPreferences.value = new Map(
            Object.entries(data).map(([k, v]) => [parseInt(k), v as boolean]),
          );
        }
      } catch (error) {
        console.error("Error loading auto navigation preferences:", error);
        autoNavigationPreferences.value = new Map();
      }
    };

    const saveAutoNavigationPreferences = () => {
      try {
        const data = Object.fromEntries(autoNavigationPreferences.value);
        localStorage.setItem(AUTO_NAV_KEY, JSON.stringify(data));
      } catch (error) {
        console.error("Error saving auto navigation preferences:", error);
      }
    };

    // Add query to history
    const addToHistory = (query: string) => {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) return;

      // Remove if already exists to avoid duplicates
      const existingIndex = queryHistory.value.indexOf(trimmedQuery);
      if (existingIndex > -1) {
        queryHistory.value.splice(existingIndex, 1);
      }

      // Add to beginning of array
      queryHistory.value.unshift(trimmedQuery);

      // Keep only last MAX_HISTORY_SIZE entries
      if (queryHistory.value.length > MAX_HISTORY_SIZE) {
        queryHistory.value = queryHistory.value.slice(0, MAX_HISTORY_SIZE);
      }

      saveQueryHistory();
      historyIndex.value = -1; // Reset index
    };

    // Watch for isOpen changes to fetch initial message when opened
    watch(
      () => props.isOpen,
      (newValue) => {
        if (newValue) {
          if (chatMessages.value.length === 0) {
            fetchInitialMessage();
          }
          loadHistory(); // Load history when chat is opened

          // Mark component as ready and process any pending chips
          // Use a slight delay to ensure RichTextInput is fully mounted
          nextTick(() => {
            setTimeout(() => {
              componentReady.value = true;
              processPendingChips();
              focusInput();
            }, 100);
          });
        }
      },
    );

    // Auto-focus input when chat is expanded
    watch(
      () => store.state.isAiChatExpanded,
      (isExpanded) => {
        if (isExpanded) {
          nextTick(() => {
            setTimeout(() => {
              focusInput();
            }, 150);
          });
        }
      },
    );

    // Watch for organization switches — reset current chat and reload history
    // scoped to the new org so users never see cross-org chat history.
    watch(
      () => store.state.selectedOrganization?.identifier,
      (newOrgId, oldOrgId) => {
        if (newOrgId && newOrgId !== oldOrgId) {
          addNewChat();
          if (props.isOpen) {
            loadHistory();
          }
        }
      },
    );

    // Only fetch initial message if component starts as open
    onMounted(() => {
      if (props.isOpen) {
        fetchInitialMessage();
        loadHistory(); // Load history on mount if chat is open
        loadChat(store.state.currentChatTimestamp);

        // Mark component as ready and process any pending chips
        // Use a slight delay to ensure RichTextInput is fully mounted
        nextTick(() => {
          setTimeout(() => {
            componentReady.value = true;
            processPendingChips();
          }, 100);
        });
      }

      // Load query history from localStorage
      loadQueryHistory();

      // Load auto navigation preferences from localStorage
      loadAutoNavigationPreferences();
    });

    onUnmounted(() => {
      // Cancel any ongoing requests when component is unmounted to prevent memory leaks
      if (currentAbortController.value) {
        currentAbortController.value.abort();
        currentAbortController.value = null;
      }

      // Abort all background streams to prevent memory leaks
      for (const controller of backgroundStreams) {
        controller.abort();
      }
      backgroundStreams.clear();
      backgroundStreamMap.clear();

      // Clean up typewriter animation to prevent memory leaks
      if (typewriterAnimationId.value) {
        cancelAnimationFrame(typewriterAnimationId.value);
        typewriterAnimationId.value = null;
      }

      // Clean up title animation interval
      if (titleIntervalId) {
        clearInterval(titleIntervalId);
        titleIntervalId = null;
      }

      //this step is added because we are using seperate instances of o2 ai chat component to make sync between them
      //whenever a new chat is created or a new message is sent, the currentChatTimestamp is set to the chatId
      //so we need to make sure that the currentChatTimestamp is set to the correct chatId
      //and the chat gets updated when the component is unmounted so that the main layout component can load the correct chat
      store.dispatch("setCurrentChatTimestamp", currentChatId.value);
      store.dispatch("setChatUpdated", true);
      if (store.state.currentChatTimestamp) {
        loadChat(store.state.currentChatTimestamp);
      }
      if (!store.state.currentChatTimestamp) {
        addNewChat();
      }
    });
    //this watch is added to make sure that the chat gets updated
    // when the component is unmounted so that the main layout component can load the correct chat
    watch(chatUpdated, (newChatUpdated: boolean) => {
      if (newChatUpdated && store.state.currentChatTimestamp) {
        loadChat(store.state.currentChatTimestamp);
      }
      if (newChatUpdated && !store.state.currentChatTimestamp) {
        addNewChat();
      }
      store.dispatch("setChatUpdated", false);
    });

    // Watch for typewriter animation updates to refresh the displayed text
    watch(displayedStreamingContent, (newContent) => {
      if (!isLoading.value) return;
      // Don't overwrite existing text with empty string when displayedStreamingContent
      // is reset (e.g., on tool_call). The reset signals "new segment starts" not
      // "clear previous content".
      if (!newContent) return;

      const lastMessage = chatMessages.value[chatMessages.value.length - 1];
      if (lastMessage && lastMessage.role === "assistant" && lastMessage.contentBlocks) {
        const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
        if (lastBlock && lastBlock.type === "text") {
          lastBlock.text = newContent;
        }
      }
    });

    // Filter markdown headers - convert # and ## to smaller formatting
    // This should only process actual markdown headers, not code block comments
    const filterMarkdownHeaders = (content: string): string => {
      // First, protect code blocks by temporarily replacing them
      const codeBlocks: string[] = [];
      let filtered = content.replace(/```[\s\S]*?```/g, (match) => {
        codeBlocks.push(match);
        return `___CODE_BLOCK_${codeBlocks.length - 1}___`;
      });

      // Convert ## headers to bold with colon (only outside code blocks)
      filtered = filtered.replace(/^## (.+)$/gm, "**$1:**");

      // Convert # headers to bold with colon (only outside code blocks)
      filtered = filtered.replace(/^# (.+)$/gm, "**$1:**");

      // Restore code blocks
      filtered = filtered.replace(/___CODE_BLOCK_(\d+)___/g, (_match, index) => {
        return codeBlocks[parseInt(index)];
      });

      return filtered;
    };

    // Process text block and return array of code/text blocks for rendering
    const processTextBlock = (text: string) => {
      // Filter headers before processing
      const filteredContent = filterMarkdownHeaders(text);
      const tokens = marked.lexer(filteredContent);
      const blocks = [];

      for (const token of tokens) {
        if (token.type === "code") {
          let codeText = token.text.trim();
          while (
            codeText.startsWith("--") ||
            codeText.startsWith("//") ||
            codeText.startsWith("#")
          ) {
            codeText = codeText.split("\n").slice(1).join("\n").trim();
          }

          const highlightedContent =
            token.lang && hljs.getLanguage(token.lang)
              ? DOMPurify.sanitize(hljs.highlight(codeText, { language: token.lang }).value)
              : DOMPurify.sanitize(hljs.highlightAuto(codeText).value);

          blocks.push({
            type: "code",
            language: token.lang || "",
            content: codeText,
            highlightedContent,
          });
        } else {
          blocks.push({
            type: "text",
            content: marked.parser([token]),
          });
        }
      }

      return blocks;
    };

    const processMessageContent = (content: string) => {
      // Filter headers before processing
      const filteredContent = filterMarkdownHeaders(content);
      const tokens = marked.lexer(filteredContent);
      const blocks = [];

      for (const token of tokens) {
        if (token.type === "code") {
          // Remove comments at the beginning of code blocks
          let codeText = token.text.trim();
          while (
            codeText.startsWith("--") ||
            codeText.startsWith("//") ||
            codeText.startsWith("#")
          ) {
            codeText = codeText.split("\n").slice(1).join("\n").trim();
          }

          const highlightedContent =
            token.lang && hljs.getLanguage(token.lang)
              ? DOMPurify.sanitize(hljs.highlight(codeText, { language: token.lang }).value)
              : DOMPurify.sanitize(hljs.highlightAuto(codeText).value);

          blocks.push({
            type: "code",
            language: token.lang || "",
            content: codeText,
            highlightedContent,
          });
        } else {
          blocks.push({
            type: "text",
            content: marked.parser([token]),
          });
        }
      }

      return blocks;
    };

    // Helper to format JSON with syntax highlighting
    const formatLogEntryContent = (content: string): string => {
      try {
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, 2);
        // Apply syntax highlighting
        const highlighted = formatted.replace(
          /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
          (match) => {
            let cls = "json-number";
            if (/^"/.test(match)) {
              if (/:$/.test(match)) {
                cls = "json-key";
              } else {
                cls = "json-string";
              }
            } else if (/true|false/.test(match)) {
              cls = "json-boolean";
            } else if (/null/.test(match)) {
              cls = "json-null";
            }
            return `<span class="${cls}">${match}</span>`;
          },
        );
        return DOMPurify.sanitize(highlighted);
      } catch {
        // Not JSON, return plain text with HTML escaping
        return DOMPurify.sanitize(
          content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;")
            .replace(/\n/g, "<br>"),
        );
      }
    };

    // Parse log entries from message content and maintain order
    const parseLogEntries = (content: string) => {
      const logEntryPattern = /--- (.+?) (?:\(lines (\d+)-(\d+)\) )?---\n([\s\S]*?)\n--- end ---/g;
      const orderedBlocks: any[] = [];
      let lastIndex = 0;
      let match;

      // Reset regex state
      logEntryPattern.lastIndex = 0;

      while ((match = logEntryPattern.exec(content)) !== null) {
        const [fullMatch, filename, lineStart, lineEnd, logContent] = match;
        const matchIndex = match.index;

        // Add text before this log entry (if any)
        if (matchIndex > lastIndex) {
          const textBefore = content.substring(lastIndex, matchIndex).trim();
          if (textBefore) {
            orderedBlocks.push({
              type: "text",
              text: textBefore,
            });
          }
        }

        // Add the log entry
        orderedBlocks.push({
          type: "log_entry",
          filename,
          lineStart: lineStart ? parseInt(lineStart) : undefined,
          lineEnd: lineEnd ? parseInt(lineEnd) : undefined,
          content: logContent.trim(),
          preview: createPreview(logContent.trim(), 60),
        });

        lastIndex = matchIndex + fullMatch.length;
      }

      // Add any remaining text after the last log entry
      if (lastIndex < content.length) {
        const textAfter = content.substring(lastIndex).trim();
        if (textAfter) {
          orderedBlocks.push({
            type: "text",
            text: textAfter,
          });
        }
      }

      return orderedBlocks;
    };

    const processedMessages = computed(() => {
      return chatMessages.value.map((message) => {
        // For user messages, check for log entries
        if (message.role === "user") {
          const orderedBlocks = parseLogEntries(message.content);

          // If we have ordered blocks from parsing, combine them with existing contentBlocks
          const combinedContentBlocks =
            orderedBlocks.length > 0
              ? [...orderedBlocks, ...(message.contentBlocks || [])]
              : message.contentBlocks || [];

          return {
            ...message,
            blocks: orderedBlocks.length > 0 ? [] : processMessageContent(message.content),
            contentBlocks: combinedContentBlocks,
          };
        }

        // For assistant messages, keep as is
        return {
          ...message,
          blocks: processMessageContent(message.content),
          contentBlocks: message.contentBlocks || [],
        };
      });
    });

    const retryGeneration = async (message: any) => {
      if (!message || message.role !== "assistant") return;

      // Find the index of this assistant message
      const messageIndex = chatMessages.value.findIndex((m) => m.content === message.content);
      if (messageIndex === -1) return;

      // Find the corresponding user message that came before this assistant message
      let userMessageIndex = messageIndex - 1;
      while (userMessageIndex >= 0) {
        if (chatMessages.value[userMessageIndex].role === "user") {
          // Set the user message and trigger send without removing previous messages
          inputMessage.value = chatMessages.value[userMessageIndex].content;
          await sendMessage();
          break;
        }
        userMessageIndex--;
      }
    };

    const getLanguageDisplay = (lang: string) => {
      const languageMap: { [key: string]: string } = {
        js: "JavaScript",
        javascript: "JavaScript",
        ts: "TypeScript",
        typescript: "TypeScript",
        python: "Python",
        py: "Python",
        sql: "SQL",
        vrl: "VRL",
        json: "JSON",
        css: "CSS",
        scss: "SCSS",
        bash: "Bash",
        shell: "Shell",
        yaml: "YAML",
        yml: "YAML",
        markdown: "Markdown",
        md: "Markdown",
      };

      const normalizedLang = lang.toLowerCase();
      return languageMap[normalizedLang] || lang.toUpperCase();
    };

    const processHtmlBlock = (content: string) => {
      // Sanitize HTML to prevent XSS attacks
      const sanitized = DOMPurify.sanitize(content);
      // Replace pre tags with span and add our custom class
      return sanitized
        .replace(/<pre([^>]*)>/g, '<span class="generated-code-block"$1>')
        .replace(/<\/pre>/g, "</span>");
    };

    const formatTime = (timestamp: string) => {
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    // Tool call context formatting helpers
    const truncateQuery = (query: string) => {
      if (!query) return "";
      const maxLength = 100;
      if (query.length <= maxLength) return query;
      return query.substring(0, maxLength) + "...";
    };

    const formatContextKey = (key: string) => {
      // Convert snake_case to Title Case
      return key
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    };

    const formatContextValue = (value: any) => {
      if (typeof value === "string") {
        // Truncate long strings
        if (value.length > 30) return value.substring(0, 30) + "...";
        return value;
      }
      return String(value);
    };

    // Tool call expansion helpers
    const toggleToolCallExpanded = (messageIndex: number, blockIndex: number) => {
      const key = `${messageIndex}-${blockIndex}`;
      if (expandedToolCalls.value.has(key)) {
        expandedToolCalls.value.delete(key);
      } else {
        expandedToolCalls.value.add(key);
      }
    };

    const isToolCallExpanded = (messageIndex: number, blockIndex: number) => {
      return expandedToolCalls.value.has(`${messageIndex}-${blockIndex}`);
    };

    // Log entry expansion helpers
    const toggleLogEntryExpanded = (messageIndex: number, blockIndex: number) => {
      const key = `${messageIndex}-${blockIndex}`;
      if (expandedLogEntries.value.has(key)) {
        expandedLogEntries.value.delete(key);
      } else {
        expandedLogEntries.value.add(key);
      }
    };

    const isLogEntryExpanded = (messageIndex: number, blockIndex: number) => {
      return expandedLogEntries.value.has(`${messageIndex}-${blockIndex}`);
    };

    // Extract display fields from tool call context (handles different tool schemas)
    const getToolCallDisplayData = (context: any) => {
      if (!context) return null;

      const data: Record<string, any> = {};

      // Handle nested request_body.query structure (SearchSQL, ExtractPatterns)
      if (context.request_body?.query) {
        const q = context.request_body.query;
        if (q.sql) data.query = q.sql;
        if (q.start_time) data.start_time = q.start_time;
        if (q.end_time) data.end_time = q.end_time;
        if (q.from !== undefined) data.from = q.from;
        if (q.size !== undefined) data.size = q.size;
        if (q.query_type) data.query_type = q.query_type;
        if (q.vrl) data.vrl = q.vrl;
      }

      // Handle testFunction context (VRL validation)
      if (context.vrl) data.vrl = context.vrl;
      if (context.request_body?.function) data.vrl = context.request_body.function;

      // Handle flat SQL from SearchSQL enriched context
      if (context.sql) data.query = context.sql;

      // Handle flat structure (StreamSchema, etc.)
      if (context.stream_name) data.stream = context.stream_name;
      if (context.type) data.type = context.type;

      // CLI tools: surface the command string
      if (context.command) data.command = context.command;

      return Object.keys(data).length > 0 ? data : null;
    };

    // `response` is stamped onto blocks by the stream handler but is not part
    // of the shared ContentBlock interface.
    const hasToolCallDetails = (block: ContentBlock & { response?: Record<string, any> }) => {
      // Show details for failed tools, successful tools with summary, tools with context data, or tools with response
      if (block.success === false) return true;
      if (block.summary) return true;
      if (block.response) return true;
      return getToolCallDisplayData(block.context) !== null;
    };

    const formatToolCallMessage = (block: ContentBlock & { response?: Record<string, any> }) => {
      // Show error message for failed tools
      // Tool-specific messages (both success and error)
      if (block.tool === "testFunction") {
        if (block.success === false) {
          return { text: "VRL validation failed", highlight: null, suffix: "" };
        }
        return { text: "Validated VRL", highlight: null, suffix: "" };
      }
      if (block.tool === "SearchSQL") {
        if (block.success === false) {
          return { text: "Query failed", highlight: null, suffix: "" };
        }
        if (block.response?.total !== undefined) {
          const streamType = block.context?.type || "logs";
          return {
            text: `Queried ${streamType} `,
            highlight: `(${block.response.total} results)`,
            suffix: "",
          };
        }
      }
      if (block.tool === "StreamSchema" && block.context?.stream_name) {
        return {
          text: "Fetched ",
          highlight: block.context.stream_name,
          suffix: " stream schema",
        };
      }
      if (block.tool === "GetIncident" && block.context?.incident_id) {
        return {
          text: "Retrieved incident ",
          highlight: block.context.incident_id,
          suffix: "",
        };
      }
      if (block.tool === "GetAlert" && block.context?.alert_id) {
        return {
          text: "Fetched alert ",
          highlight: block.context.alert_id,
          suffix: "",
        };
      }
      if (block.tool === "GetDashboard" && block.context?.dashboard_id) {
        return {
          text: "Fetched dashboard ",
          highlight: block.context.dashboard_id,
          suffix: "",
        };
      }
      // List tools: show count from normalized { total, items } response
      if (block.response?.total !== undefined && block.success !== false) {
        const base = block.message || block.tool || "Listed";
        return {
          text: base + " ",
          highlight: `(Found ${block.response.total})`,
          suffix: "",
        };
      }
      // Generic fallback
      if (block.success === false && block.resultMessage) {
        // Truncate long error messages for the header
        const msg =
          block.resultMessage.length > 60
            ? block.resultMessage.substring(0, 60) + "..."
            : block.resultMessage;
        return { text: msg, highlight: null, suffix: "" };
      }
      if (block.success !== false && block.summary?.count !== undefined) {
        const base = block.message || block.tool || "Tool";
        return {
          text: base + " ",
          highlight: `(${block.summary.count} results)`,
          suffix: "",
        };
      }
      return { text: block.message, highlight: null, suffix: "" };
    };

    const formatTimestamp = (timestamp: number) => {
      if (!timestamp || timestamp === 0) return "Not specified";
      // Timestamp is in microseconds, convert to milliseconds
      const ms = timestamp > 1e15 ? timestamp / 1000 : timestamp;
      const date = new Date(ms);
      return date.toLocaleString();
    };

    const likeCodeBlock = async (messageIndex: number) => {
      const message = chatMessages.value[messageIndex];
      if (!message || message.feedback === "thumbs_up") return;
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId) return;
      // Each user+assistant pair = 1 query turn, so queryIndex = floor(index / 2)
      const queryIndex = Math.floor(messageIndex / 2);
      const success = await submitFeedback(
        "thumbs_up",
        orgId,
        currentSessionId.value || undefined,
        queryIndex,
        lastTraceId.value || undefined,
      );
      if (success) {
        message.feedback = "thumbs_up";
        await saveToHistory();
        toast({
          variant: "success",
          message: "Thanks for your feedback!",
        });
      }
    };

    const dislikeCodeBlock = async (messageIndex: number) => {
      const message = chatMessages.value[messageIndex];
      if (!message || message.feedback === "thumbs_down") return;
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId) return;
      const queryIndex = Math.floor(messageIndex / 2);
      const success = await submitFeedback(
        "thumbs_down",
        orgId,
        currentSessionId.value || undefined,
        queryIndex,
        lastTraceId.value || undefined,
      );
      if (success) {
        message.feedback = "thumbs_down";
        await saveToHistory();
        toast({
          variant: "success",
          message: "Thanks for your feedback!",
        });
      }
    };
    const o2AiTitleLogo = computed(() => {
      return isDark.value
        ? getImageURL("images/common/o2_ai_logo_dark.svg")
        : getImageURL("images/common/o2_ai_logo.svg");
    });
    const getGenerateAiIcon = computed(() => {
      return getImageURL("images/common/ai_icon_dark.svg");
    });

    const filteredChatHistory = computed(() => {
      if (!historySearchTerm.value) {
        return chatHistory.value;
      }
      const searchTerm = historySearchTerm.value.toLowerCase();
      return chatHistory.value.filter((chat) => chat.title.toLowerCase().includes(searchTerm));
    });

    return {
      inputMessage,
      chatMessages,
      isLoading,
      currentAnalyzingMessage,
      sendMessage,
      handleKeyDown,
      focusInput,
      messagesContainer,
      chatInput,
      formatMessage,
      capabilities,
      selectCapability,
      selectWelcomePrompt,
      inputPlaceholder,
      showHistory,
      chatHistory,
      currentChatId,
      addNewChat,
      toggleExpand,
      openHistory,
      loadChat,
      showEditTitleDialog,
      editingTitle,
      openEditTitleDialog,
      saveEditedTitle,
      deleteChat,
      confirmDeleteChat,
      showDeleteChatConfirmDialog,
      chatToDelete,
      clearAllConversations,
      showClearAllConfirmDialog,
      confirmClearAllConversations,
      // Tool confirmation
      pendingConfirmation,
      handleToolConfirm,
      handleToolCancel,
      handleToolAlwaysConfirm,
      handleNavigationAction,
      // Auto navigation
      isAutoNavigationEnabled,
      processedMessages,
      pendingToolCalls,
      processTextBlock,
      copyToClipboard,
      retryGeneration,
      getLanguageDisplay,
      processHtmlBlock,
      formatTime,
      loadHistory,
      store,
      isMac,
      likeCodeBlock,
      dislikeCodeBlock,
      currentChatTimestamp,
      o2AiTitleLogo,
      getGenerateAiIcon,
      saveHistoryLoading,
      historySearchTerm,
      filteredChatHistory,
      shouldAutoScroll,
      checkIfShouldAutoScroll,
      getScrollThreshold,
      scrollToLoadingIndicator,
      scrollToBottomSmooth,
      showScrollToBottom,
      cancelCurrentRequest,
      currentAbortController,
      activeToolCall,
      truncateQuery,
      formatContextKey,
      expandedToolCalls,
      toggleToolCallExpanded,
      isToolCallExpanded,
      hasToolCallDetails,
      getToolCallDisplayData,
      formatToolCallMessage,
      formatTimestamp,
      formatContextValue,
      expandedLogEntries,
      toggleLogEntryExpanded,
      isLogEntryExpanded,
      formatLogEntryContent,
      // AI-generated title
      aiGeneratedTitle,
      displayedTitle,
      isTypingTitle,
      // Image handling
      pendingImages,
      imageInputRef,
      triggerImageUpload,
      handleImageSelect,
      removeImage,
      handleDragOver,
      handleDrop,
      handlePaste,
      // Image preview
      showImagePreview,
      previewImage,
      openImagePreview,
      closeImagePreview,
      contextReferences,
      handleReferencesUpdate,
      t,
    };
  },
});
</script>

<style scoped>
/* keep(generated-content): markdown/log/code markup is injected with v-html, so
   it carries no scope attribute and cannot take utility classes — it can only be
   reached from here through :deep().
   keep(lib-override:hljs): highlight.js emits its own .hljs-* class names; the
   token mapping below mirrors lib/core/Code/OCodeBlock.vue exactly (D6).
   keep(keyframes): @keyframes and the `animation:` that consumes it must live in
   the same block — the scoped compiler renames both together.
   keep(complex-state): .tool-call-item's status x has-details x hover matrix and
   .send-button's :not(.disabled):not([disabled]):not(:disabled) guard have no
   utility equivalent (`enabled:` covers :disabled, not the .disabled class). */

/* ============================================================
   keep(keyframes) — each consumer sits next to its @keyframes
   ============================================================ */
.tool-call-indicator {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-0.625rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fixed-analyzing-indicator {
  animation: fadeInSlide 0.3s ease;
}

@keyframes fadeInSlide {
  from {
    opacity: 0;
    transform: translateY(-0.625rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Scroll-to-bottom button entrance. Rises from below with a slight scale-up, so
   it is not the same curve as fadeIn/fadeInSlide above (those drop from above). */
.scroll-to-bottom-btn {
  animation: fadeInUp 0.3s ease;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(0.625rem) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* ============================================================
   keep(complex-state) — tool call status matrix.
   Status tint x (has-details) hover x light/dark. Each status maps to its
   semantic token; the light/dark pairs differ only in mix strength, so dark
   overrides just the percentage.
   ============================================================ */
.tool-call-item {
  background: color-mix(in srgb, var(--color-status-positive) 8%, transparent);
  color: var(--color-text-secondary);
}
.dark .tool-call-item {
  background: color-mix(in srgb, var(--color-status-positive) 12%, transparent);
}
.tool-call-item.has-details {
  cursor: pointer;
}
.tool-call-item.has-details:hover {
  background: color-mix(in srgb, var(--color-status-positive) 12%, transparent);
}
.dark .tool-call-item.has-details:hover {
  background: color-mix(in srgb, var(--color-status-positive) 18%, transparent);
}

.tool-call-item.error {
  background: color-mix(in srgb, var(--color-status-negative) 8%, transparent);
}
.dark .tool-call-item.error {
  background: color-mix(in srgb, var(--color-status-negative) 12%, transparent);
}
.tool-call-item.error.has-details:hover {
  background: color-mix(in srgb, var(--color-status-negative) 15%, transparent);
}
.dark .tool-call-item.error.has-details:hover {
  background: color-mix(in srgb, var(--color-status-negative) 22%, transparent);
}

.tool-call-item.timeout {
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
}
.dark .tool-call-item.timeout {
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
}
.tool-call-item.timeout.has-details:hover {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
}
.dark .tool-call-item.timeout.has-details:hover {
  background: color-mix(in srgb, var(--color-warning) 22%, transparent);
}

.tool-call-item.pending-confirmation {
  cursor: default;
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
}
.dark .tool-call-item.pending-confirmation {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  border-color: color-mix(in srgb, var(--color-warning) 25%, transparent);
}

.tool-call-item.pending-navigation {
  cursor: default;
  background: color-mix(in srgb, var(--color-info) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-info) 30%, transparent);
}
.dark .tool-call-item.pending-navigation {
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-info) 25%, transparent);
}

/* ============================================================
   keep(complex-state) — send button.
   The enabled guard is a .disabled CLASS plus [disabled] plus :disabled;
   Tailwind's `enabled:` variant only covers the last two.
   ============================================================ */
.send-button:hover:not(.disabled):not([disabled]):not(:disabled) {
  background: var(--color-gradient-ai) !important;
  box-shadow: 0 0.375rem 1.25rem 0 color-mix(in srgb, var(--color-ai-accent) 40%, transparent) !important;
  transform: translateY(-0.0625rem) !important;
}
.send-button:active:not(.disabled):not([disabled]):not(:disabled) {
  transform: translateY(0) !important;
  box-shadow: 0 0.125rem 0.625rem 0 color-mix(in srgb, var(--color-ai-accent) 30%, transparent) !important;
}

/* ============================================================
   keep(generated-content) — RichTextInput is a child component, so its
   internals carry no scope attribute of ours.
   ============================================================ */
.unified-input-box :deep(.rich-text-input-wrapper) {
  width: 100%;
  min-height: 2.5rem;
}
.unified-input-box :deep(.rich-text-input) {
  padding: 0.25rem 0;
}

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
