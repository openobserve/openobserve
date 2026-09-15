<template>
  <div
    class="chat-container rounded-surface text-text-body bg-card-glass-solid shadow-hover-shadow flex h-full w-full flex-col overflow-hidden shadow-md"
    :class="[{ 'chat-open': isOpen }]"
  >
    <div v-if="isOpen" class="chat-content-wrapper flex h-full flex-col bg-transparent">
      <div
        class="chat-header border-separator bg-surface-base z-2 flex shrink-0 items-end justify-between border-b px-3 pt-0 pb-1"
        :style="{ height: headerHeight ? headerHeight + 'px' : '' }"
      >
        <div class="chat-title flex w-full items-center justify-between font-bold">
          <div class="flex min-w-0 items-center gap-2">
            <div class="inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full">
              <img :src="o2AiTitleLogo" class="h-full w-full object-cover" />
            </div>

            <ODropdown @update:open="(v) => v && loadHistory()">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="sm"
                  class="chat-title-dropdown rounded-default hover:bg-interactive-hover-bg flex h-8 min-h-8 max-w-40 min-w-0 items-center overflow-hidden px-3 py-1.5 transition-colors duration-200"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="chat-title-text text-text-body block min-w-0 truncate text-sm font-medium"
                    >
                      {{ displayedTitle || t("common.newChat") }}
                      <OTooltip
                        v-if="displayedTitle && displayedTitle.length > 25"
                        :sideOffset="8"
                        side="bottom"
                        align="center"
                        :content="raw(displayedTitle)"
                      />
                    </span>
                    <OIcon name="arrow-drop-down" size="md" class="flex-shrink-0" />
                  </div>
                </OButton>
              </template>
              <div class="history-menu-container relative flex max-h-112.5 w-75 flex-col">
                <OSearchInput
                  v-model="historySearchTerm"
                  :placeholder="t('aiAssistant.searchChatHistory')"
                  class="sticky top-0 z-2 shrink-0 p-2"
                />
                <div
                  class="history-list-container max-h-87.5 flex-1 overflow-x-hidden overflow-y-auto"
                >
                  <ODropdownItem
                    v-for="chat in filteredChatHistory"
                    :key="chat.id"
                    class="history-item group relative"
                    @select="loadChat(chat.id)"
                  >
                    <div class="flex w-full items-center justify-between">
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
                        class="delete-history-btn opacity-0 transition-opacity duration-200 group-hover:opacity-100 max-md:opacity-100"
                        @click.stop="deleteChat(chat.id)"
                      >
                        <OIcon name="delete" size="sm" />
                        <OTooltip :content="t('aiAssistant.deleteChatTooltip')" />
                      </OButton>
                    </div>
                  </ODropdownItem>
                  <div
                    v-if="filteredChatHistory.length === 0"
                    class="text-text-muted p-2 text-center"
                  >
                    {{ t("aiAssistant.noMatchingChatsFound") }}
                  </div>
                </div>

                <!-- Clear all conversations button -->
                <div
                  v-if="filteredChatHistory.length > 0"
                  class="clear-all-container bg-surface-base shrink-0"
                >
                  <ODropdownSeparator />
                  <OButton
                    variant="ghost-destructive"
                    class="clear-all-btn text-compact w-full justify-start px-3 py-1.5"
                    @click.stop="clearAllConversations"
                  >
                    <template #icon-left>
                      <OIcon name="delete-sweep" size="sm" />
                    </template>
                    {{ t("aiAssistant.clearAllConversations") }}
                  </OButton>
                </div>
              </div>
            </ODropdown>
          </div>

          <div class="chat-header-actions flex shrink-0 items-center gap-1">
            <!-- Edit title button -->
            <OButton
              v-if="currentChatId"
              variant="ghost"
              size="icon-sm"
              @click.stop="openEditTitleDialog"
            >
              <OIcon name="edit" size="sm" />
              <OTooltip :content="t('aiAssistant.editTitleTooltip')" />
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
                :content="
                  t('common.collapseExpandShortcut', {
                    action: store.state.isAiChatExpanded
                      ? t('common.collapse')
                      : t('common.expand'),
                    shortcut: isMac ? '⌘' : 'Ctrl+',
                  })
                "
              />
            </OButton>
            <OButton variant="ghost" size="icon-sm" @click="$emit('close')">
              <OIcon name="close" size="sm" />
            </OButton>
          </div>
        </div>
      </div>

      <!-- History Panel -->
      <ODrawer
        data-test="o2-ai-chat-history-drawer"
        bleed
        v-model:open="showHistory"
        size="sm"
        :title="t('aiAssistant.chatHistory')"
      >
        <ul class="divide-border flex flex-col divide-y">
          <li
            v-for="chat in chatHistory"
            :key="chat.id"
            :data-test="`o2-ai-chat-history-item-${chat.id}`"
            class="hover:bg-muted/50 flex cursor-pointer flex-col px-3 py-2"
            @click="loadChat(chat.id)"
          >
            <span class="text-sm">{{ chat.title }}</span>
            <span class="text-muted-foreground block text-xs">
              {{ new Date(chat.timestamp).toLocaleString() }}
            </span>
            <span class="text-muted-foreground block text-xs">
              {{ t("aiAssistant.modelLabel") }} {{ chat.model }}
            </span>
          </li>
        </ul>
      </ODrawer>

      <!-- Edit Title Dialog -->
      <ODialog
        data-test="o2-ai-chat-edit-title-dialog"
        v-model:open="showEditTitleDialog"
        size="sm"
        :title="t('aiAssistant.editChatTitle')"
        :secondary-button-label="t('common.cancel')"
        :primary-button-label="t('common.save')"
        @click:secondary="showEditTitleDialog = false"
        @click:primary="saveEditedTitle"
      >
        <OInput
          v-model="editingTitle"
          autofocus
          @keyup.enter="saveEditedTitle"
          :placeholder="t('aiAssistant.enterChatTitle')"
        />
      </ODialog>

      <!-- Delete Chat Confirmation Dialog -->
      <ConfirmDialog
        v-model="showDeleteChatConfirmDialog"
        :title="t('aiAssistant.deleteChat')"
        :message="t('aiAssistant.deleteChatConfirmMessage')"
        @update:ok="confirmDeleteChat"
        @update:cancel="showDeleteChatConfirmDialog = false"
      />

      <!-- Clear All Conversations Confirmation Dialog -->
      <ConfirmDialog
        v-model="showClearAllConfirmDialog"
        :title="t('aiAssistant.clearAllConversationsTitle')"
        :message="t('aiAssistant.clearAllConversationsMessage')"
        @update:ok="confirmClearAllConversations"
        @update:cancel="showClearAllConfirmDialog = false"
      />

      <!-- Image Preview Dialog -->
      <ODialog
        data-test="o2-ai-chat-image-preview-dialog"
        v-model:open="showImagePreview"
        @update:open="(v) => !v && closeImagePreview()"
        size="lg"
        :title="raw(previewImage?.filename)"
      >
        <div class="flex justify-center">
          <img
            v-if="previewImage"
            :src="'data:' + previewImage.mimeType + ';base64,' + previewImage.data"
            :alt="previewImage.filename"
            class="max-h-[80vh] max-w-full object-contain"
          />
        </div>
      </ODialog>

      <div
        class="chat-content relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent"
      >
        <div
          class="messages-container mx-auto flex min-h-0 w-full max-w-225 flex-1 flex-col gap-4 overflow-y-auto bg-transparent p-2"
          ref="messagesContainer"
          @scroll="checkIfShouldAutoScroll"
        >
          <div
            v-if="chatMessages.length === 0"
            class="welcome-section rounded-default mb-0 flex flex-1 items-center justify-center bg-transparent p-0"
          >
            <!-- Home tab: rich V2 welcome -->
            <O2AIHomeWelcome v-if="centeredStart" @select-prompt="selectWelcomePrompt" />
            <!-- Sidepanel: minimal logo + title -->
            <div v-else class="flex h-full w-full flex-col items-center justify-center">
              <div class="flex flex-col items-center gap-2">
                <img :src="o2AiTitleLogo" />
                <div class="flex items-center gap-2">
                  <span class="text-sm font-[600]">{{
                    t("aiAssistant.welcome.taglineHighlight")
                  }}</span>
                  <!-- Same shared Beta tag as the Workflows screens. -->
                  <BetaBadge />
                </div>
              </div>
            </div>
          </div>
          <div
            v-for="(message, index) in processedMessages"
            :key="index"
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
                  <div
                    v-if="block.type === 'tool_call'"
                    class="tool-call-item text-text-secondary rounded-default text-compact mb-2 flex max-w-full min-w-0 flex-col px-3 py-2"
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
                      <span class="tool-call-name flex-1 font-medium">
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
                        class="navigation-icon ms-auto cursor-pointer opacity-70 transition-opacity duration-200 hover:opacity-100"
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
                      class="tool-call-details border-border-default mt-2.5 flex min-w-0 flex-col gap-2 border-t pt-2.5"
                      @click.stop
                    >
                      <!-- Error details for failed tool calls -->
                      <template v-if="block.success === false">
                        <div v-if="block.resultMessage" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("common.error")
                          }}</span>
                          <span
                            class="detail-value text-status-negative max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                            >{{ block.resultMessage }}</span
                          >
                        </div>
                        <div v-if="block.errorType" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("common.type")
                          }}</span>
                          <code
                            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                            >{{ block.errorType }}</code
                          >
                        </div>
                        <div v-if="block.suggestion" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.suggestion")
                          }}</span>
                          <span
                            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words italic opacity-85 select-text"
                            >{{ block.suggestion }}</span
                          >
                        </div>
                      </template>
                      <!-- Summary details for successful tool calls with summary -->
                      <template v-if="block.success !== false && block.summary">
                        <div
                          v-if="block.summary.count !== undefined"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.results")
                          }}</span>
                          <span
                            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                            >{{ block.summary.count }} {{ t("aiAssistant.recordsSuffix") }}</span
                          >
                        </div>
                        <div
                          v-if="block.summary.took !== undefined"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("common.duration")
                          }}</span>
                          <span
                            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                            >{{ block.summary.took }}{{ t("aiAssistant.ms") }}</span
                          >
                        </div>
                        <!-- CLI tool summary (return_code / stdout_lines / stderr_lines / truncated) -->
                        <div
                          v-if="block.summary.return_code !== undefined"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.exitCode")
                          }}</span>
                          <code
                            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                            >{{ block.summary.return_code }}</code
                          >
                        </div>
                        <div
                          v-if="block.summary.stdout_lines !== undefined"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.stdout")
                          }}</span>
                          <span
                            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                            >{{ block.summary.stdout_lines }} {{ t("aiAssistant.lines") }}</span
                          >
                        </div>
                        <div
                          v-if="block.summary.stderr_lines"
                          class="detail-item flex flex-col gap-1"
                        >
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.stderr")
                          }}</span>
                          <span
                            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                            >{{ block.summary.stderr_lines }} {{ t("aiAssistant.lines") }}</span
                          >
                        </div>
                        <div v-if="block.summary.truncated" class="detail-item flex flex-col gap-1">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("common.output")
                          }}</span>
                          <span
                            class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                            >{{ t("aiAssistant.truncatedLabel") }}</span
                          >
                        </div>
                      </template>
                      <!-- Existing context details -->
                      <div
                        v-if="getToolCallDisplayData(block.context)?.query"
                        class="detail-item flex flex-col gap-1"
                      >
                        <div class="detail-header flex items-center justify-between">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("common.query")
                          }}</span>
                          <OButton
                            variant="ghost"
                            size="icon-xs-circle"
                            class="copy-btn opacity-60 hover:opacity-100"
                            @click.stop="
                              copyToClipboard(getToolCallDisplayData(block.context)?.query, t)
                            "
                          >
                            <OIcon name="content-copy" size="sm" />
                            <OTooltip :content="t('aiAssistant.copyQuery')" />
                          </OButton>
                        </div>
                        <code
                          class="detail-value query-value rounded-default cursor-text p-2 font-mono text-xs break-all whitespace-pre-wrap select-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >{{ getToolCallDisplayData(block.context)?.query }}</code
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.stream"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                          t("aiAssistant.stream")
                        }}</span>
                        <code
                          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                          >{{ getToolCallDisplayData(block.context)?.stream }}</code
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.type"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                          t("common.type")
                        }}</span>
                        <code
                          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                          >{{ getToolCallDisplayData(block.context)?.type }}</code
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.start_time"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                          t("aiAssistant.start")
                        }}</span>
                        <span
                          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                          >{{
                            formatTimestamp(getToolCallDisplayData(block.context)?.start_time)
                          }}</span
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.end_time"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                          t("aiAssistant.end")
                        }}</span>
                        <span
                          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                          >{{
                            formatTimestamp(getToolCallDisplayData(block.context)?.end_time)
                          }}</span
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.from !== undefined"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                          t("aiAssistant.from")
                        }}</span>
                        <span
                          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                          >{{ getToolCallDisplayData(block.context)?.from }}</span
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.size !== undefined"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                          t("aiAssistant.size")
                        }}</span>
                        <span
                          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                          >{{ getToolCallDisplayData(block.context)?.size }}</span
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.query_type"
                        class="detail-item flex flex-col gap-1"
                      >
                        <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                          t("aiAssistant.queryType")
                        }}</span>
                        <code
                          class="detail-value max-w-full min-w-0 text-xs [overflow-wrap:anywhere] break-words select-text"
                          >{{ getToolCallDisplayData(block.context)?.query_type }}</code
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.vrl"
                        class="detail-item flex flex-col gap-1"
                      >
                        <div class="detail-header flex items-center justify-between">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.welcome.taglineVrl")
                          }}</span>
                          <OButton
                            variant="ghost"
                            size="icon-xs-circle"
                            class="copy-btn opacity-60 hover:opacity-100"
                            @click.stop="
                              copyToClipboard(getToolCallDisplayData(block.context)?.vrl, t)
                            "
                          >
                            <OIcon name="content-copy" size="sm" />
                            <OTooltip :content="t('aiAssistant.copyVrl')" />
                          </OButton>
                        </div>
                        <code
                          class="detail-value query-value rounded-default cursor-text p-2 font-mono text-xs break-all whitespace-pre-wrap select-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >{{ getToolCallDisplayData(block.context)?.vrl }}</code
                        >
                      </div>
                      <div
                        v-if="getToolCallDisplayData(block.context)?.command"
                        class="detail-item flex flex-col gap-1"
                      >
                        <div class="detail-header flex items-center justify-between">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.command")
                          }}</span>
                          <OButton
                            variant="ghost"
                            size="icon-xs-circle"
                            class="copy-btn opacity-60 hover:opacity-100"
                            @click.stop="
                              copyToClipboard(getToolCallDisplayData(block.context)?.command, t)
                            "
                          >
                            <OIcon name="content-copy" size="sm" />
                            <OTooltip :content="t('aiAssistant.copyCommand')" />
                          </OButton>
                        </div>
                        <code
                          class="detail-value query-value rounded-default cursor-text p-2 font-mono text-xs break-all whitespace-pre-wrap select-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >{{ getToolCallDisplayData(block.context)?.command }}</code
                        >
                      </div>
                      <!-- Tool response: SearchSQL hits -->
                      <template v-if="block.response && block.response.hits">
                        <div class="detail-item flex flex-col gap-1">
                          <div class="detail-header flex items-center justify-between">
                            <span
                              class="detail-label text-2xs font-semibold uppercase opacity-60"
                              >{{ t("aiAssistant.results") }}</span
                            >
                            <OButton
                              variant="ghost"
                              size="icon-xs-circle"
                              class="copy-btn opacity-60 hover:opacity-100"
                              @click.stop="
                                copyToClipboard(JSON.stringify(block.response.hits, null, 2), t)
                              "
                            >
                              <OIcon name="content-copy" size="sm" />
                              <OTooltip :content="t('aiAssistant.copyResults')" />
                            </OButton>
                          </div>
                          <div
                            class="tool-response-hits rounded-default flex max-h-50 flex-col gap-1 overflow-y-auto px-2 py-1.5 font-mono text-xs [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >
                            <div
                              v-for="(hit, hIdx) in block.response.hits"
                              :key="hIdx"
                              class="tool-response-hit [&:not(:last-child)]:border-border-default flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1"
                            >
                              <span
                                v-for="(val, key) in hit"
                                :key="key"
                                class="hit-field cursor-text break-all select-text"
                              >
                                <span class="hit-key font-semibold opacity-60">{{ key }}:</span>
                                {{ val }}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div class="tool-response-meta mt-1 flex flex-wrap gap-1.5">
                          <span v-if="block.response.total !== undefined" class="context-tag"
                            >{{ t("aiAssistant.total") }} {{ block.response.total }}</span
                          >
                          <span v-if="block.response.took !== undefined" class="context-tag"
                            >{{ t("aiAssistant.took") }} {{ block.response.took
                            }}{{ t("aiAssistant.ms") }}</span
                          >
                          <span v-if="block.response.hits_truncated" class="context-tag"
                            >{{ t("aiAssistant.showingFirst") }}
                            {{ block.response.hits.length }}</span
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
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.inputEvents")
                          }}</span>
                          <div
                            class="tool-response-hits rounded-default flex max-h-50 flex-col gap-1 overflow-y-auto px-2 py-1.5 font-mono text-xs [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >
                            <div
                              v-for="(evt, eIdx) in block.response.input"
                              :key="eIdx"
                              class="tool-response-hit [&:not(:last-child)]:border-border-default flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1"
                            >
                              <span
                                v-for="(val, key) in evt"
                                :key="key"
                                class="hit-field cursor-text break-all select-text"
                              >
                                <span class="hit-key font-semibold opacity-60">{{ key }}:</span>
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
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("common.output")
                          }}</span>
                          <div
                            class="tool-response-hits rounded-default flex max-h-50 flex-col gap-1 overflow-y-auto px-2 py-1.5 font-mono text-xs [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >
                            <div
                              v-for="(res, rIdx) in block.response.output"
                              :key="rIdx"
                              class="tool-response-hit [&:not(:last-child)]:border-border-default flex flex-wrap gap-x-3 gap-y-1 py-0.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1"
                            >
                              <template v-if="res.event">
                                <span
                                  v-for="(val, key) in res.event"
                                  :key="key"
                                  class="hit-field cursor-text break-all select-text"
                                >
                                  <span class="hit-key font-semibold opacity-60">{{ key }}:</span>
                                  {{
                                    typeof val === "string" && val.length > 120
                                      ? val.substring(0, 120) + "..."
                                      : val
                                  }}
                                </span>
                              </template>
                              <span
                                v-if="res.message"
                                class="hit-field text-status-negative cursor-text break-all select-text"
                              >
                                <span class="hit-key font-semibold opacity-60">{{
                                  t("aiAssistant.errorLabel")
                                }}</span>
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
                            <span
                              class="detail-label text-2xs font-semibold uppercase opacity-60"
                              >{{ t("aiAssistant.items") }}</span
                            >
                            <OButton
                              variant="ghost"
                              size="icon-xs-circle"
                              class="copy-btn opacity-60 hover:opacity-100"
                              @click.stop="
                                copyToClipboard(JSON.stringify(block.response.items, null, 2), t)
                              "
                            >
                              <OIcon name="content-copy" size="sm" />
                              <OTooltip :content="t('aiAssistant.copyItems')" />
                            </OButton>
                          </div>
                          <div
                            class="tool-response-hits rounded-default flex max-h-50 flex-col gap-1 overflow-y-auto px-2 py-1.5 font-mono text-xs [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
                          >
                            <div
                              v-for="(item, iIdx) in block.response.items"
                              :key="iIdx"
                              class="tool-response-list-item [&:not(:last-child)]:border-border-default flex flex-col gap-0.5 py-1 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-1.5"
                            >
                              <div
                                v-for="(val, key) in item"
                                :key="key"
                                class="hit-field cursor-text break-all select-text"
                              >
                                <span class="hit-key font-semibold opacity-60">{{ key }}:</span>
                                {{ typeof val === "object" ? JSON.stringify(val) : val }}
                              </div>
                            </div>
                          </div>
                        </div>
                      </template>
                      <!-- Tool response: generic fallback (string or other) -->
                      <div v-else-if="block.response" class="detail-item flex flex-col gap-1">
                        <div class="detail-header flex items-center justify-between">
                          <span class="detail-label text-2xs font-semibold uppercase opacity-60">{{
                            t("aiAssistant.response")
                          }}</span>
                          <OButton
                            variant="ghost"
                            size="icon-xs-circle"
                            class="copy-btn opacity-60 hover:opacity-100"
                            @click.stop="
                              copyToClipboard(
                                typeof block.response === 'string'
                                  ? block.response
                                  : JSON.stringify(block.response, null, 2),
                                t,
                              )
                            "
                          >
                            <OIcon name="content-copy" size="sm" />
                            <OTooltip :content="t('aiAssistant.copyResponse')" />
                          </OButton>
                        </div>
                        <code
                          class="detail-value query-value rounded-default cursor-text p-2 font-mono text-xs break-all whitespace-pre-wrap select-text [background:color-mix(in_srgb,var(--color-text-heading)_5%,transparent)]"
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
                    class="log-entry-item rounded-default text-text-secondary dark:bg-surface-panel dark:border-border-default dark:hover:bg-surface-panel dark:hover:border-text-secondary mb-1 flex cursor-pointer flex-col px-2.5 py-1.5 text-xs [background:color-mix(in_srgb,var(--color-info)_8%,transparent)] hover:[background:color-mix(in_srgb,var(--color-info)_12%,transparent)] dark:border"
                    @click="toggleLogEntryExpanded(index, blockIndex)"
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
                            @click="retryGeneration(message)"
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
                        @click="openImagePreview(img)"
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
                    @click="likeCodeBlock(index)"
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
                    @click="dislikeCodeBlock(index)"
                  >
                    <OIcon name="thumb-down-off-alt" size="xs" />
                    <OTooltip :content="t('aiAssistant.notHelpful')" />
                  </OButton>
                </div>
              </div>
            </div>
          </div>
          <!-- Tool call indicator - shows outside message box -->
          <div
            v-if="activeToolCall"
            class="tool-call-indicator rounded-default border-border-default my-2 flex items-center border px-4 py-3 [background:var(--color-chat-bubble-user)]"
          >
            <div class="tool-call-content flex w-full items-center gap-3">
              <OSpinner variant="dots" size="xs" />
              <div class="tool-call-info flex min-w-0 flex-1 flex-col gap-1.5">
                <span class="tool-call-message text-text-secondary text-sm font-semibold">{{
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
                      class="context-query rounded-default bg-surface-base border-border-default text-text-body dark:text-text-secondary block max-w-full overflow-hidden border px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
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
                      class="context-query rounded-default bg-surface-base border-border-default text-text-body dark:text-text-secondary block max-w-full overflow-hidden border px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
                      >{{
                        truncateQuery(getToolCallDisplayData(activeToolCall.context)?.vrl)
                      }}</code
                    >
                  </div>
                  <span
                    v-if="getToolCallDisplayData(activeToolCall.context)?.stream"
                    class="context-tag text-2xs rounded-default text-ai-accent dark:text-text-secondary inline-flex items-center px-2 py-1 font-medium [background:color-mix(in_srgb,var(--color-ai-accent)_10%,transparent)] dark:[background:color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)]"
                  >
                    {{ t("aiAssistant.streamPrefix") }}
                    {{ getToolCallDisplayData(activeToolCall.context)?.stream }}
                  </span>
                  <span
                    v-if="getToolCallDisplayData(activeToolCall.context)?.query_type"
                    class="context-tag text-2xs rounded-default text-ai-accent dark:text-text-secondary inline-flex items-center px-2 py-1 font-medium [background:color-mix(in_srgb,var(--color-ai-accent)_10%,transparent)] dark:[background:color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)]"
                  >
                    {{ t("aiAssistant.typePrefix") }}
                    {{ getToolCallDisplayData(activeToolCall.context)?.query_type }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- Standalone loading indicator - only shown when loading with no tool calls -->
          <div
            v-if="isLoading && !activeToolCall"
            class="tool-call-indicator rounded-default border-border-default my-2 flex items-center border px-4 py-3 [background:var(--color-chat-bubble-user)]"
          >
            <div class="tool-call-content flex w-full items-center gap-3">
              <OSpinner variant="dots" size="xs" />
              <span class="tool-call-message text-text-secondary text-sm font-semibold">{{
                currentAnalyzingMessage
              }}</span>
            </div>
          </div>
        </div>

        <!-- Scroll to bottom button -->
        <div
          v-show="showScrollToBottom"
          class="scroll-to-bottom-container pointer-events-none absolute bottom-2.5 left-1/2 z-1000 -translate-x-1/2 [transition:all_0.3s_ease]"
        >
          <OButton
            variant="ghost"
            size="icon-sm"
            class="scroll-to-bottom-btn border-text-link! text-text-link! bg-surface-base! dark:border-ai-accent! dark:text-ai-accent! dark:bg-surface-base! hover:border-text-link! hover:text-text-link! hover:bg-surface-base! dark:hover:border-ai-accent! dark:hover:text-ai-accent! dark:hover:bg-surface-base! pointer-events-auto border-2! shadow-sm [backdrop-filter:blur(0.5rem)] transition-all duration-300 hover:scale-110 hover:shadow-md active:scale-100"
            @click="scrollToBottomSmooth"
          >
            <OIcon name="arrow-downward" size="sm" />
            <OTooltip side="top" align="center" :content="t('aiAssistant.scrollToBottom')" />
          </OButton>
        </div>
      </div>

      <!-- Fixed loading indicator above input - only shown when scrolled up -->
      <div
        v-if="(isLoading || activeToolCall) && showScrollToBottom"
        class="fixed-analyzing-indicator rounded-default border-border-default mx-4 mb-2 flex items-center justify-center border px-4 py-3 shadow-sm [background:var(--color-chat-bubble-user)]"
      >
        <!-- Show tool call if active -->
        <div
          v-if="activeToolCall"
          class="analyzing-content flex w-full max-w-225 items-center gap-3"
        >
          <OSpinner variant="dots" size="xs" />
          <span class="analyzing-message text-theme-accent text-sm font-medium">{{
            activeToolCall.message
          }}</span>
        </div>
        <!-- Show analyzing message if loading but no active tool call -->
        <div
          v-else-if="isLoading"
          class="analyzing-content flex w-full max-w-225 items-center gap-3"
        >
          <OSpinner variant="dots" size="xs" />
          <span class="analyzing-message text-theme-accent text-sm font-medium">{{
            currentAnalyzingMessage
          }}</span>
        </div>
      </div>

      <div class="chat-input-container relative mx-auto my-2 w-full max-w-225 shrink-0 px-2">
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
          class="unified-input-box rounded-default bg-surface-base border-border-default focus-within:ring-accent flex flex-col gap-3 border px-2 py-1 transition-all duration-200 focus-within:border-transparent focus-within:ring-2"
          @dragover="handleDragOver"
          @drop="handleDrop"
          @paste="handlePaste"
        >
          <!-- Image preview strip -->
          <div
            v-if="pendingImages.length > 0"
            class="image-preview-strip mb-2 flex flex-wrap gap-2 py-2"
          >
            <div
              v-for="(img, index) in pendingImages"
              :key="index"
              class="image-preview-item relative inline-block"
            >
              <img
                :src="'data:' + img.mimeType + ';base64,' + img.data"
                :alt="img.filename"
                class="preview-image rounded-default border-border-default h-16 w-16 border object-cover [transition:transform_0.2s_ease] hover:scale-105"
              />
              <OButton
                variant="ghost"
                size="icon-xs-circle"
                class="image-remove-btn bg-status-negative! hover:bg-status-negative! absolute! -top-1.5! -right-1.5! z-10 h-5! min-h-5! w-5! min-w-5! p-0!"
                @click.stop="removeImage(index)"
              >
                <OIcon name="close" size="xs" />
              </OButton>
              <OTooltip
                :content="
                  t('common.fileWithSize', {
                    name: img.filename,
                    size: (img.size / 1024).toFixed(0),
                  })
                "
              />
            </div>
          </div>

          <RichTextInput
            ref="chatInput"
            v-model="inputMessage"
            :placeholder="raw(inputPlaceholder)"
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
                class="auto-nav-toggle-btn rounded-default hover:bg-surface-subtle flex items-center gap-1.5 px-2 py-1 transition-all duration-200"
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
                  class="auto-nav-label ms-1 text-xs font-medium"
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
                variant="primary"
                size="icon-xs-circle"
                class="send-button hover:bg-gradient-ai!"
              >
                <OIcon name="arrow-upward" size="sm" />
              </OButton>

              <!-- Stop button - shown when loading/streaming -->
              <OButton
                v-if="isLoading"
                @click="cancelCurrentRequest"
                variant="ghost"
                size="icon-xs-circle"
                class="stop-button shadow-status-negative/30! hover:shadow-status-negative/40! active:shadow-status-negative/30! bg-gradient-danger! hover:bg-gradient-danger-hover! shadow-lg! [transition:all_0.3s_ease]! hover:-translate-y-px! hover:shadow-lg! active:translate-y-0! active:shadow-md!"
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
import {
  defineComponent,
  ref,
  reactive,
  onMounted,
  nextTick,
  watch,
  computed,
  onUnmounted,
  type Ref,
} from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRouter, useRoute } from "vue-router";
import { useTypewriterPlaceholder } from "@/components/ai-assistant/welcome/useTypewriterPlaceholder";
import "highlight.js/styles/github.css";
import "highlight.js/styles/github-dark.css";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import useAiChat from "@/composables/useAiChat";
import { getImageURL, getUUIDv7 } from "@/utils/zincutils";
import { ChatMessage, ContentBlock, NavigationAction } from "@/ts/interfaces/chat";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import RichTextInput, { ReferenceChip } from "@/components/RichTextInput.vue";
import O2AIConfirmDialog from "@/components/O2AIConfirmDialog.vue";
import O2AIHomeWelcome from "@/components/ai-assistant/welcome/O2AIHomeWelcome.vue";
import { useChatHistory } from "@/composables/useChatHistory";
import { useChatImages } from "@/composables/useChatImages";
import { useChatHistoryList } from "@/composables/useChatHistoryList";
import { useTypewriter } from "@/composables/useTypewriter";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";
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
import { UNAUTHORIZED_MESSAGE_KEY } from "@/utils/authErrors";
import { extractFrames, extractTailFrames } from "@/components/O2AIChat.framing";
import {
  reduce,
  type ReducerCtx,
  type StreamEffect,
  type StreamPhase,
  type StreamState,
} from "@/components/O2AIChat.reducer";
import {
  buildNavigationRoute,
  generateNavigationFromToolResult as generateNavigation,
  navigationPageName,
} from "@/components/O2AIChat.navigation";
import {
  createPreview,
  formatLogEntryContent,
  getLanguageDisplay,
  parseLogEntries,
  processHtmlBlock,
  processMessageContent,
  processTextBlock,
  renderMarkdown,
} from "@/components/O2AIChat.content";
import {
  formatContextKey,
  formatContextValue,
  formatToolCallMessage as formatToolCall,
  getToolCallDisplayData,
  hasToolCallDetails,
  truncateQuery,
  type ToolCallBlock,
} from "@/components/O2AIChat.toolcall";

const { fetchAiChat, submitFeedback } = useAiChat();
const { emit: emitDashboardEvent } = useAiDashboardEvents();

// --- Shared, cross-instance streaming registry ---
// O2AIChat is instantiated more than once (the Home page's inline AI tab and
// the sidebar panel in MainLayout are SEPARATE component instances). When the
// user starts a chat on Home and navigates to another page, the Home instance
// unmounts and the sidebar instance mounts — a brand new setup() scope.
//
// For an in-flight stream to keep rendering after that hand-off, the detach/
// re-attach bookkeeping MUST live outside setup() so both instances see the
// same live array + AbortController. When these were per-instance, the sidebar
// instance's map was empty, so loadChat() never re-attached and fell back to
// the stale IndexedDB snapshot — the stream kept running but its text never
// rendered in the new instance. Module scope is what makes the hand-off work.
const backgroundStreams = new Set<AbortController>();
const MAX_BACKGROUND_STREAMS = 3;

// Map sessionId → live stream context for re-attachment when a (possibly
// different) instance loads the same session. loadChat swaps chatMessages.value
// back to `msgs` so processStream's isActive() becomes true again and the UI
// updates in real-time.
const backgroundStreamMap = new Map<
  string,
  {
    msgs: ChatMessage[];
    controller: AbortController;
    chatId: number | null;
  }
>();

// Cross-instance streaming status, keyed by sessionId. processStream runs in the
// closure of the instance that STARTED it, so its completion resets isLoading on
// THAT instance's ref — not on a different instance that re-attached to the same
// stream (e.g. the sidebar taking over from the Home tab). Each instance watches
// this shared reactive map for its current session and clears its own streaming
// UI when the background turn finishes, so the sidebar's loading indicator
// doesn't hang forever after re-attaching. true = streaming, false/absent = done.
const sessionStreamingState = reactive<Record<string, boolean>>({});

// Detached streams deliberately outlive the component that started them, and
// this registry is module scope, so nothing else will ever stop them. Call when
// the turn is no longer authorized for what it is writing — org switch, logout
// — never for ordinary navigation, which is the case detaching exists for.
const abortBackgroundStreams = () => {
  for (const controller of backgroundStreams) controller.abort();
  backgroundStreams.clear();
  backgroundStreamMap.clear();
  for (const key of Object.keys(sessionStreamingState)) {
    delete sessionStreamingState[key];
  }
};

export default defineComponent({
  name: "O2AIChat",
  components: {
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
    const route = useRoute();
    const inputMessage = ref(props.aiChatInputContext ? props.aiChatInputContext : "");
    const chatMessages = ref<ChatMessage[]>([]);
    const isLoading = ref(false);
    const messagesContainer = ref<HTMLElement | null>(null);
    const chatInput = ref<any>(null); // RichTextInput component instance
    const currentStreamingMessage = ref("");
    const currentTextSegment = ref(""); // Track current text segment (resets after each tool call)
    const currentChatId = ref<number | null>(null);
    const currentSessionId = ref<string | null>(null); // UUID v7 for tracking all API calls in this chat session
    const lastTraceId = ref<string | null>(null); // OTEL trace_id from last workflow for feedback correlation
    const store = useStore();
    const { isDark } = useTheme();
    const { t } = useI18nTyped();
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
        ? typewriterPlaceholder.value || t("common.writeYourPrompt")
        : t("common.writeYourPrompt"),
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
      t,
    );

    const currentChatTimestamp = ref<string | null>(null);
    const saveHistoryLoading = ref(false);
    const shouldAutoScroll = ref(true);
    const showScrollToBottom = ref(false);

    // Tool confirmation state (from AI agent — confirmation-required actions, inline in chat)
    const pendingConfirmation = ref<{
      tool: string;
      args: Record<string, any>;
      message: I18nText;
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

    const {
      currentAnalyzingMessage,
      startAnalyzingRotation,
      stopAnalyzingRotation,
      aiGeneratedTitle,
      displayedTitle,
      isTypingTitle,
      animateTitle,
      resetTitleState,
      clearTitleInterval,
      displayedStreamingContent,
      typewriterAnimationId,
      resetTypewriterState,
      animateStreamingText,
    } = useTypewriter(currentTextSegment, t);

    const {
      showHistory,
      chatHistory,
      historySearchTerm,
      filteredChatHistory,
      loadHistory,
      openHistory,
      showEditTitleDialog,
      editingTitle,
      openEditTitleDialog,
      saveEditedTitle,
      showDeleteChatConfirmDialog,
      chatToDelete,
      deleteChat,
      confirmDeleteChat,
      showClearAllConfirmDialog,
      clearAllConversations,
      confirmClearAllConversations,
    } = useChatHistoryList({
      loadHistoryFromDb: dbLoadHistory,
      deleteChatById: dbDeleteChatById,
      clearAllHistory: dbClearAllHistory,
      updateChatTitle: dbUpdateChatTitle,
      currentChatId,
      displayedTitle,
      aiGeneratedTitle,
      addNewChat: () => addNewChat(),
    });

    // Track expanded tool calls by message index and block index
    const expandedToolCalls = ref<Set<string>>(new Set());

    // Track expanded log entries by message index and block index
    const expandedLogEntries = ref<Set<string>>(new Set());

    // Active tool call state - for showing tool progress outside message box
    const activeToolCall = ref<{
      tool: string;
      message: I18nText;
      context: Record<string, any>;
      call_id?: string;
    } | null>(null);

    // AbortController for managing request cancellation - allows users to stop ongoing AI requests
    const currentAbortController = ref<AbortController | null>(null);

    // NOTE: backgroundStreams / backgroundStreamMap / MAX_BACKGROUND_STREAMS are
    // declared at MODULE scope (above defineComponent), not here. They must be
    // shared across all O2AIChat instances so an in-flight stream started on the
    // Home tab keeps rendering after navigating to a page where the sidebar
    // instance takes over. See the comment on their declaration for why.

    // Throttle save during streaming to prevent data loss on page reload
    const lastStreamingSaveTime = ref<number>(0);
    const STREAMING_SAVE_INTERVAL = 3000; // Save at most every 3 seconds during streaming

    const {
      pendingImages,
      imageInputRef,
      showImagePreview,
      previewImage,
      triggerImageUpload,
      handleImageSelect,
      removeImage,
      clearPendingImages,
      handleDragOver,
      handleDrop,
      handlePaste,
      openImagePreview,
      closeImagePreview,
    } = useChatImages(
      chatInput,
      inputMessage,
      () => focusInput(),
      t,
    );

    // Context references for rich text input chips
    const contextReferences = ref<ReferenceChip[]>([]);

    // Component readiness tracking
    const componentReady = ref(false);
    const pendingChips = ref<ReferenceChip[]>([]);

    // Set true in onUnmounted so watchers firing during teardown don't re-attach
    // a just-detached stream back to this dying instance (see chatUpdated watch).
    const isUnmounting = ref(false);

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
          message: t("toastMessages.components.responseGenerationStopped"),
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
              lastMessage.content = raw(
                lastMessage.content + "\n\n_[" + t("aiAssistant.responseStoppedByUser") + "]_",
              );
            }
          }
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

    watch(
      () => props.aiChatInputContext,
      (newAiChatInputContext: string) => {
        if (newAiChatInputContext) {
          // Create a reference chip from the context
          const contextChip: ReferenceChip = {
            id: `context-${Date.now()}`,
            // Not translated: this filename is spliced verbatim into the
            // `--- Log Entry ---` delimiter of the prompt sent to the LLM, so the
            // delimiter must stay stable across locales.
            filename: raw("Log Entry"),
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
            content: t("aiAssistant.backendConnectionError"),
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

      const postConfirmation = async (approved: boolean) => {
        try {
          const orgId = store.state.selectedOrganization.identifier;
          const res = await fetch(
            `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${ctxSessionId}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ approved }),
            },
          );
          // A silent failure leaves the agent paused with nobody left to answer it.
          if (!res.ok) {
            console.error(
              approved
                ? `Auto-approval not registered (HTTP ${res.status}) for session ${ctxSessionId}`
                : `Auto-deny not registered (HTTP ${res.status}) for background stream ${ctxSessionId}`,
            );
          }
        } catch (error) {
          console.error(
            approved
              ? "Error auto-confirming navigation:"
              : "Error auto-denying confirmation for background stream:",
            error,
          );
        }
      };

      const seedState = (): StreamState => ({
        messages: msgs,
        activeToolCall: activeToolCall.value,
        textSegment,
        streamingMsg,
        title: ctxTitle,
        lastTraceId: lastTraceId.value,
        ownerUnavailable: streamOwnerUnavailable.value,
        pendingConfirmation: pendingConfirmation.value,
        messageComplete,
        halted: false,
      });

      // A detached stream must not write a ref the original would have left untouched.
      const setIfChanged = <T,>(target: Ref<T>, value: T) => {
        if (target.value !== value) target.value = value;
      };

      const commitState = (state: StreamState) => {
        textSegment = state.textSegment;
        streamingMsg = state.streamingMsg;
        ctxTitle = state.title;
        messageComplete = state.messageComplete;
        setIfChanged(activeToolCall, state.activeToolCall);
        setIfChanged(lastTraceId, state.lastTraceId);
        setIfChanged(streamOwnerUnavailable, state.ownerUnavailable);
        setIfChanged(pendingConfirmation, state.pendingConfirmation);
      };

      const buildCtx = (phase: StreamPhase): ReducerCtx => ({
        isActive: isActive(),
        autoNavigationEnabled: isAutoNavigationEnabled.value,
        phase,
        t,
        generateNavigation: generateNavigationFromToolResult,
      });

      const runEffects = async (effects: StreamEffect[]) => {
        for (const effect of effects) {
          switch (effect.kind) {
            case "scroll":
              if (!effect.whenActive || isActive()) await scrollToBottom();
              break;
            case "save":
              await saveCtx();
              break;
            case "throttledSave":
              await throttledSaveCtx(effect.force);
              break;
            case "navigate":
              await handleNavigationAction(effect.action);
              break;
            case "confirmPost":
              await postConfirmation(effect.approved);
              break;
            case "dashboardEvent":
              emitDashboardEvent(effect.payload);
              break;
            case "animateTitle":
              aiGeneratedTitle.value = effect.title;
              animateTitle(effect.title);
              break;
            case "syncSegments":
              syncStreamingRefs();
              break;
            case "animateText":
              if (!typewriterAnimationId.value) animateStreamingText();
              break;
            case "finalizeText":
              if (typewriterAnimationId.value) {
                cancelAnimationFrame(typewriterAnimationId.value);
                typewriterAnimationId.value = null;
              }
              displayedStreamingContent.value = "";
              syncStreamingRefs();
              break;
          }
        }
      };

      const applyEvent = async (data: any, phase: StreamPhase) => {
        const state = seedState();
        const effects = reduce(state, data, buildCtx(phase));
        commitState(state);
        await runEffects(effects);
        return state.halted;
      };
      // --- End stream context ---

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new chunk to existing buffer
          buffer += decoder.decode(value, { stream: true });

          const { events, rest } = extractFrames(buffer);
          buffer = rest;

          for (const jsonStr of events) {
            try {
              const data = JSON.parse(jsonStr);

              if (await applyEvent(data, "stream")) return;
            } catch (jsonError) {
              console.debug("JSON parse error:", jsonError, "for line:", jsonStr);
              continue;
            }
          }
        }

        for (const jsonStr of extractTailFrames(buffer)) {
          try {
            const data = JSON.parse(jsonStr);

            if (await applyEvent(data, "tailFlush")) return;
          } catch (e) {
            console.debug("Error processing remaining buffer:", e);
            continue;
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

    // Logout has to kill the foreground turn too, not just the detached ones.
    // MainLayout.signout() fires this as a window event because it lives in the
    // Options API half of that file and can't reach setup scope directly (same
    // pattern as o2:home-switch-tab).
    const abortAllStreams = () => {
      abortBackgroundStreams();
      if (currentAbortController.value) {
        currentAbortController.value.abort();
        currentAbortController.value = null;
      }
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
        description: t("shortcuts.actions.aiChatClose"),
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

    /** Resolve the pendingConfirmation block — mark as success or failure */
    const resolveConfirmationBlock = (approved: boolean) => {
      for (const msg of chatMessages.value) {
        if (msg.contentBlocks) {
          for (const block of msg.contentBlocks) {
            if (block.pendingConfirmation) {
              block.pendingConfirmation = false;
              if (!approved) {
                block.success = false;
                block.resultMessage = t("aiAssistant.aiChat.actionCancelledByUser");
              }
              return;
            }
          }
        }
      }
    };

    // Set by processStream when a session's owning replica is gone. The stream has
    // already returned 200 by then, so sendMessage reads this once it ends.
    const streamOwnerUnavailable = ref(false);

    // Shown after a successful restore: only the dialogue came back, not the tool
    // results, files or permission decisions from before the interruption.
    const RESTORED_NOTICE =
      "This conversation was interrupted and has been restored. Earlier messages are preserved, but any files, queries or other actions from before the interruption were not carried over.";

    // Keyed on the explicit server code, never guessed from a generic failure:
    // restoring means abandoning the current session.
    const isSessionOwnerUnavailable = (errorBody: unknown): boolean => {
      // `unknown`, not `any` — narrow before reading, or a non-object body throws.
      if (typeof errorBody !== "object" || errorBody === null) return false;
      const body = errorBody as { code?: unknown; detail?: { code?: unknown } };
      const code = body.detail?.code ?? body.code;
      return code === "session_owner_unavailable";
    };

    /** Surface a message inline in the transcript, as stream errors are shown. */
    const appendErrorBlock = (message: string, recoverable = false) => {
      const block: ContentBlock = { type: "error", message: raw(message), recoverable };
      const msgs = chatMessages.value;
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        if (!last.contentBlocks) last.contentBlocks = [];
        last.contentBlocks.push(block);
      } else {
        msgs.push({ role: "assistant", content: raw(""), contentBlocks: [block] });
      }
    };

    /**
     * POST a confirmation answer and report whether it landed. The response used
     * to be discarded, so an answer reaching a replica with no record of the
     * pending confirmation 404'd invisibly while the agent auto-denied on timeout.
     */
    const sendConfirmation = async (sessionId: string, approved: boolean): Promise<boolean> => {
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const res = await fetch(
          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${sessionId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ approved }),
          },
        );

        if (!res.ok) {
          console.error(
            `Confirmation not registered (HTTP ${res.status}) for session ${sessionId}`,
          );
          appendErrorBlock(
            approved
              ? "Your approval could not be delivered — the assistant may have already cancelled this action. Please check the result before retrying."
              : "Your response could not be delivered — the assistant may have already cancelled this action.",
          );
          return false;
        }
        return true;
      } catch (error) {
        console.error("Error sending confirmation:", error);
        appendErrorBlock(
          "Your response could not be delivered. Please check your connection and try again.",
        );
        return false;
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

      await sendConfirmation(currentSessionId.value, true);
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

      await sendConfirmation(currentSessionId.value, false);
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

      await sendConfirmation(currentSessionId.value, true);
      pendingConfirmation.value = null;
    };

    const generateNavigationFromToolResult = (
      toolName: string,
      callArgs: any,
      responseBody: any,
    ): NavigationAction | null => generateNavigation(toolName, callArgs, responseBody, t);

    const handleNavigationAction = async (action: NavigationAction) => {
      // Detach the stream before navigating: the route change can unmount/
      // recreate this component, and onUnmounted aborts currentAbortController
      // to avoid leaking requests. Without detaching first, that abort races
      // an in-flight opencode turn and kills any tool calls still queued
      // after this navigation (e.g. create dashboard -> create alert -> nav).
      // detachCurrentStream() moves the controller to backgroundStreams so
      // processStream keeps running and the turn finishes in the background.
      detachCurrentStream();

      const pageName = navigationPageName(action);

      // Perform navigation FIRST
      const target = buildNavigationRoute(
        action,
        store.state.selectedOrganization.identifier,
      );
      if (target) {
        await router.push({ path: target.path, query: target.query });
      }

      // Use setTimeout to add message AFTER navigation fully completes and settles
      setTimeout(async () => {
        try {
          // Add success message AFTER navigation completes
          const successMessage = t("aiAssistant.navigatedTo", { page: pageName });
          let lastMessage = chatMessages.value[chatMessages.value.length - 1];

          if (!lastMessage || lastMessage.role !== "assistant") {
            // Create new assistant message
            chatMessages.value.push({
              role: "assistant",
              content: raw(successMessage),
              contentBlocks: [{ type: "text", text: successMessage }],
            });
          } else {
            // Append to existing assistant message
            if (lastMessage.content) {
              lastMessage.content = raw(lastMessage.content + "\n\n" + successMessage);
            } else {
              lastMessage.content = raw(successMessage);
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

            // Prime the typewriter from whatever the stream has accumulated so
            // far, in THIS fresh instance. processStream only syncs the segment
            // refs and (re)starts the animation on the NEXT chunk that arrives
            // while isActive(); text already streamed before we re-attached
            // would otherwise sit invisible until the next delta. Reveal the
            // existing text instantly, then let the ongoing stream continue.
            const lastMsg = chatMessages.value[chatMessages.value.length - 1];
            if (lastMsg?.role === "assistant" && lastMsg.contentBlocks?.length) {
              const lastBlock = lastMsg.contentBlocks[lastMsg.contentBlocks.length - 1];
              if (lastBlock?.type === "text" && lastBlock.text) {
                currentStreamingMessage.value = lastMsg.content || lastBlock.text;
                currentTextSegment.value = lastBlock.text;
                // Instant reveal (no per-char catch-up) for the backlog.
                displayedStreamingContent.value = lastBlock.text;
              }
            }
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
        content: raw(backendMessage), // Use backend message with full context
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

      // Mint the session id here rather than inside the try below. A new chat
      // has none yet, and the cleanup on every exit path has to clear the flag
      // for the SAME id we set it on — otherwise an instance that re-attached
      // never sees the streaming->done transition and spins forever.
      if (!currentSessionId.value) {
        currentSessionId.value = getUUIDv7();
      }
      const streamSessionId = currentSessionId.value;

      // Mark this session as actively streaming in the cross-instance registry
      // so that if another instance re-attaches, it knows when to stop showing
      // its own loading indicator (see sessionStreamingState declaration).
      sessionStreamingState[streamSessionId] = true;

      // Create new AbortController for this request - enables cancellation via Stop button
      currentAbortController.value = new AbortController();

      // Reseed state for this turn: at most one restore attempt, and a pending
      // notice to show once the replacement request succeeds.
      let hasReseeded = false;
      let reseedNotice = false;

      // Clear any flag left by a previous turn that threw or was aborted before
      // the clear at the end of the try block — a stale `true` abandons a healthy
      // session.
      streamOwnerUnavailable.value = false;

      try {
        // Don't add empty assistant message here - wait for actual content
        await scrollToLoadingIndicator(); // Scroll directly to loading indicator

        let response: any;
        try {
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

          // The session is gone but the transcript is still here, so resend under
          // a fresh session and let the server seed it from those messages.
          // Deliberately narrow — this code only, once only.
          if (isSessionOwnerUnavailable(errorBody) && !hasReseeded) {
            hasReseeded = true;
            console.warn(
              `Session ${currentSessionId.value} is no longer available; restoring the conversation in a new session.`,
            );

            // A NEW id — reusing the old one would be refused again. streamSessionId
            // (captured above) stays pinned to the original, and cleanup keys off it.
            currentSessionId.value = getUUIDv7();
            reseedNotice = true;

            response = await fetchAiChat(
              chatMessages.value,
              "",
              store.state.selectedOrganization.identifier,
              currentAbortController.value?.signal,
              undefined,
              currentSessionId.value,
              hasImages ? messagesToSend : undefined,
            );
          }
        }

        // Re-check: the reseed above may have produced a fresh response.
        if (!response.ok) {
          let errorBody = null;
          try {
            errorBody = await response.json();
          } catch (_) {
            // body may not be JSON
          }
          const err: any = new Error(
            errorBody?.message ||
              t("aiAssistant.aiChat.serverErrorStatus", { status: response.status }),
          );
          err.status = response.status;
          err.errorBody = errorBody;
          throw err;
        }

        // Tell the user before the content arrives — continuing silently hides
        // that the assistant lost the earlier tool results and file state.
        if (reseedNotice) {
          reseedNotice = false;
          appendErrorBlock(RESTORED_NOTICE, true);
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        const reader = response.body.getReader();

        // Capture the controller, messages ref, and sessionId so we can detect
        // detachment and clean up after processStream
        const streamController = currentAbortController.value;
        const streamMsgs = chatMessages.value;

        await processStream(reader);

        // The streaming counterpart of the pre-stream 409 above: once the stream
        // has opened the failure arrives as an SSE event inside a 200, so
        // response.ok can no longer be branched on. Same recovery.
        //
        // Only while this turn is still on screen — if the user switched chats
        // mid-stream, restoring would clobber THAT conversation's session id and
        // transcript instead. They can resend from the affected chat.
        const stillOnScreen = chatMessages.value === streamMsgs;
        if (streamOwnerUnavailable.value && !hasReseeded && stillOnScreen) {
          streamOwnerUnavailable.value = false;
          hasReseeded = true;

          if (streamController) backgroundStreams.delete(streamController);
          if (streamSessionId) backgroundStreamMap.delete(streamSessionId);

          // The cross-instance streaming registry has to follow the new id, or
          // another instance re-attaching never sees this stream finish.
          const restoredSessionId = getUUIDv7();
          currentSessionId.value = restoredSessionId;
          sessionStreamingState[restoredSessionId] = true;

          const retry: any = await fetchAiChat(
            chatMessages.value,
            "",
            store.state.selectedOrganization.identifier,
            currentAbortController.value?.signal,
            undefined,
            currentSessionId.value,
            hasImages ? messagesToSend : undefined,
          );

          if (retry && !retry.cancelled && retry.ok && retry.body) {
            // Announced only once the replacement request is accepted, as on the
            // pre-stream path — otherwise the claim can turn out to be false.
            appendErrorBlock(RESTORED_NOTICE, true);
            await processStream(retry.body.getReader());
          } else if (!(retry && retry.cancelled)) {
            // The retry failed — non-OK, no body, or null (a network error).
            // hasReseeded blocks any further attempt, so staying quiet here would
            // end the turn with no answer and no explanation. A cancel is silent.
            appendErrorBlock(
              "This conversation was interrupted and could not be restored. Please try sending your message again.",
            );
          }

          // The restored turn is done either way; clear its entry, or a
          // re-attaching instance shows a loading indicator forever.
          sessionStreamingState[restoredSessionId] = false;
          backgroundStreamMap.delete(restoredSessionId);
        }
        streamOwnerUnavailable.value = false;

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
          errorMessage = t(UNAUTHORIZED_MESSAGE_KEY);
        } else if (error.message && error.message !== "No response body") {
          errorMessage = error.message;
        } else {
          errorMessage = t("aiAssistant.aiChat.serverResponseError");
        }
        chatMessages.value.push({
          role: "assistant",
          content: raw(errorMessage),
        });
        await saveToHistory(); // Save after error
      }

      isLoading.value = false;
      activeToolCall.value = null;
      stopAnalyzingRotation();

      // Mark the session's stream as finished in the cross-instance registry so
      // any OTHER instance that re-attached to it (e.g. the sidebar) can clear
      // its own loading indicator. Runs on all exit paths (success/abort/error).
      // Uses the id captured before the request, not currentSessionId — by the
      // time an early failure lands here the user may have switched chats, and
      // clearing the wrong session leaves the real one flagged as streaming.
      sessionStreamingState[streamSessionId] = false;

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
          // A turn started under the old org must not keep streaming and
          // writing chat history after the switch.
          abortBackgroundStreams();
          addNewChat();
          if (props.isOpen) {
            loadHistory();
          }
        }
      },
    );

    // When this instance has re-attached to a stream that another instance
    // started (its processStream completion runs in the OTHER instance's
    // closure and can't reset our isLoading), watch the shared streaming
    // registry and clear our own streaming UI once that session finishes.
    watch(
      () => (currentSessionId.value ? sessionStreamingState[currentSessionId.value] : undefined),
      (isStreaming) => {
        // React to the session going false, not to a true->false transition: an
        // instance that re-attached mid-stream never observed the `true`, so it
        // would see undefined->false and skip the cleanup, spinning forever.
        // isLoading guards against acting when we aren't showing a stream.
        if (isStreaming === false && isLoading.value) {
          isLoading.value = false;
          activeToolCall.value = null;
          stopAnalyzingRotation();
          // The owning instance's processStream already wrote the final text
          // into the message blocks, so this instance only clears its own
          // typewriter UI.
          resetTypewriterState();
          // Reflect the completed turn into the sync handshake + history so a
          // later mount reads the finished chat, not a mid-stream snapshot.
          store.dispatch("setCurrentChatTimestamp", currentChatId.value);
          nextTick(() => scrollToBottom());
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
            focusInput();
          }, 100);
        });
      }

      // Load query history from localStorage
      loadQueryHistory();

      // Load auto navigation preferences from localStorage
      loadAutoNavigationPreferences();

      window.addEventListener("o2:abort-ai-streams", abortAllStreams);
    });

    onUnmounted(() => {
      window.removeEventListener("o2:abort-ai-streams", abortAllStreams);
      // Mark unmounting FIRST so any reactive watcher that fires during teardown
      // (e.g. our own chatUpdated watch, triggered by the dispatch below) does
      // not re-attach the just-detached stream back to this dying instance.
      isUnmounting.value = true;

      // Detach (not abort) any in-flight request: every mount site except
      // MainLayout's sidebar is behind a v-if (Home's AI tab, the query-editor
      // panels), so ordinary navigation tears this instance down and used to
      // kill the answer mid-word. Unmount is the only hook that knows the
      // component is actually going away — a route watcher can't tell the
      // difference between "leaving" and "the page updated its query string".
      const wasStreaming = !!currentAbortController.value;
      detachCurrentStream();
      // detachCurrentStream early-returns when no controller is set, so clear the
      // rotation interval directly rather than relying on that path.
      stopAnalyzingRotation();

      // Home runs the chat in its own inline tab with the sidebar closed. If we
      // leave Home mid-stream, open the sidebar so its instance can re-attach
      // and keep rendering. Skip when we're still on Home (the user only
      // switched Home tabs) — MainLayout keeps the sidebar closed there, so
      // opening it would show the panel and the Home AI tab at once.
      if (
        wasStreaming &&
        props.centeredStart &&
        route.name !== "home" &&
        !store.state.isAiChatEnabled
      ) {
        store.dispatch("setIsAiChatEnabled", true);
      }

      // Note: background streams are intentionally NOT aborted here.
      // detachCurrentStream() moves a turn's controller into backgroundStreams
      // specifically so it keeps running after this component instance goes
      // away (e.g. navigation, logout); aborting them on unmount would defeat
      // that guarantee in exactly the scenario it exists for.

      // Clean up typewriter animation to prevent memory leaks
      if (typewriterAnimationId.value) {
        cancelAnimationFrame(typewriterAnimationId.value);
        typewriterAnimationId.value = null;
      }

      // Clean up title animation interval
      clearTitleInterval();

      // Clean up the trailing-edge streaming render timer. This matters more
      // here than a typical unmount cleanup: we intentionally let the stream
      // keep running (see detachCurrentStream above), so displayedStreamingContent
      // may still be ticking as this instance dies and a flush is often pending.
      // Left alone it fires after unmount and writes into this dead instance's
      // chatMessages, keeping the whole setup closure alive across the routine
      // home <-> sidebar hand-off.
      if (streamingRenderFlushTimer) {
        clearTimeout(streamingRenderFlushTimer);
        streamingRenderFlushTimer = null;
      }
      pendingStreamingRenderContent = null;

      // We use separate O2AIChat instances (home inline tab + sidebar) and sync
      // them via the store: publish which chat is current + a "chatUpdated" pulse
      // so the SURVIVING instance loads it (its chatUpdated watch calls loadChat).
      //
      // CRITICAL: this dying instance must NOT call loadChat()/addNewChat() on
      // itself here. detachCurrentStream() (above) just registered the in-flight
      // turn in backgroundStreamMap for the survivor to re-attach to; calling
      // loadChat() on ourselves would immediately re-attach it back to THIS
      // instance and delete the map entry, so the survivor then finds nothing
      // and falls back to the stale IndexedDB snapshot — the exact reason the
      // streamed text stopped rendering after navigating away mid-stream.
      // Only publish the handoff state; let the survivor act on it.
      store.dispatch("setCurrentChatTimestamp", currentChatId.value);
      store.dispatch("setChatUpdated", true);
    });
    //this watch is added to make sure that the chat gets updated
    // when the component is unmounted so that the main layout component can load the correct chat
    watch(chatUpdated, (newChatUpdated: boolean) => {
      // A dying instance must not react to the handoff pulse it just published —
      // otherwise it re-attaches its own detached stream and steals it from the
      // surviving instance. Let the survivor handle it.
      if (isUnmounting.value) return;
      if (newChatUpdated && store.state.currentChatTimestamp) {
        loadChat(store.state.currentChatTimestamp);
      }
      if (newChatUpdated && !store.state.currentChatTimestamp) {
        addNewChat();
      }
      store.dispatch("setChatUpdated", false);
    });

    // Writing displayedStreamingContent into chatMessages triggers a
    // re-render of the message list, which re-runs formatMessage() ->
    // marked.parse() (incl. hljs.highlight for code blocks) over the WHOLE
    // accumulated text, not just the new characters. The typewriter ticks
    // every ~8ms; re-parsing/re-highlighting full markdown at that rate is
    // O(n^2) over a response and eventually can't keep up with
    // requestAnimationFrame, so the page appears to hang with data already
    // in memory but not painted, then "snaps" to the final text once the
    // stream ends and the last write goes through. Throttle how often the
    // expensive reactive write happens, independent of how often the cheap
    // per-character animation ref ticks; the animation itself stays smooth.
    const STREAMING_RENDER_INTERVAL = 80; // ms between reactive markdown re-renders
    let lastStreamingRenderTime = 0;
    let pendingStreamingRenderContent: string | null = null;
    let streamingRenderFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushStreamingRenderNow = (content: string) => {
      lastStreamingRenderTime = Date.now();
      pendingStreamingRenderContent = null;
      if (streamingRenderFlushTimer) {
        clearTimeout(streamingRenderFlushTimer);
        streamingRenderFlushTimer = null;
      }

      const lastMessage = chatMessages.value[chatMessages.value.length - 1];
      if (lastMessage && lastMessage.role === "assistant" && lastMessage.contentBlocks) {
        const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
        if (lastBlock && lastBlock.type === "text") {
          // Additive-only: the stream handler writes the FULL accumulated
          // textSegment into this block as it arrives; the typewriter only
          // reveals a prefix of it. Never let a lagging/stalled typewriter
          // reveal (or an empty reset) shorten what's already rendered — that
          // was a source of "text arrived but nothing/less showed". Only grow.
          if ((content?.length || 0) >= (lastBlock.text?.length || 0)) {
            lastBlock.text = content;
          }
        }
      }
    };

    // Watch for typewriter animation updates to refresh the displayed text
    watch(displayedStreamingContent, (newContent) => {
      if (!isLoading.value) return;
      // Don't overwrite existing text with empty string when displayedStreamingContent
      // is reset (e.g., on tool_call). The reset signals "new segment starts" not
      // "clear previous content".
      if (!newContent) return;

      const now = Date.now();
      if (now - lastStreamingRenderTime >= STREAMING_RENDER_INTERVAL) {
        flushStreamingRenderNow(newContent);
        return;
      }

      // Trailing edge: make sure the latest content always lands even if
      // ticks keep arriving faster than the interval.
      pendingStreamingRenderContent = newContent;
      if (!streamingRenderFlushTimer) {
        const delay = STREAMING_RENDER_INTERVAL - (now - lastStreamingRenderTime);
        streamingRenderFlushTimer = setTimeout(() => {
          streamingRenderFlushTimer = null;
          if (pendingStreamingRenderContent !== null) {
            flushStreamingRenderNow(pendingStreamingRenderContent);
          }
        }, delay);
      }
    });

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

    const formatTime = (timestamp: string) => {
      const date = new Date(timestamp);
      return date.toLocaleString();
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

    const formatToolCallMessage = (block: ToolCallBlock) => formatToolCall(block, t);

    const formatTimestamp = (timestamp: number) => {
      if (!timestamp || timestamp === 0) return t("aiAssistant.aiChat.notSpecified");
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
          message: t("toastMessages.components.thanksForYourFeedback"),
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
          message: t("toastMessages.components.thanksForYourFeedback"),
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

    return {
      raw,
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
      sendConfirmation,
      // Session restore
      isSessionOwnerUnavailable,
      appendErrorBlock,
      streamOwnerUnavailable,
      currentSessionId,
      // Auto navigation
      isAutoNavigationEnabled,
      processedMessages,
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
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel border must not scale with text or it smears at fractional zoom */
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
}
.dark .tool-call-item.pending-confirmation {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  border-color: color-mix(in srgb, var(--color-warning) 25%, transparent);
}

.tool-call-item.pending-navigation {
  cursor: default;
  background: color-mix(in srgb, var(--color-info) 8%, transparent);
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel border must not scale with text or it smears at fractional zoom */
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
  /* The hover gradient is `hover:bg-gradient-ai!` on the button itself. It used to
     be restated here, then dropped when the template briefly carried the gradient
     unconditionally — and main later moved the button back to variant="primary",
     so between the two changes the gradient stopped painting at all. */
  box-shadow: var(--shadow-glow-xl-geom) color-mix(in srgb, var(--color-ai-accent) 40%, transparent) !important;
  transform: translateY(-0.0625rem) !important;
}
.send-button:active:not(.disabled):not([disabled]):not(:disabled) {
  transform: translateY(0) !important;
  /* Pressed keeps the accent, dimmer than hover — NOT --shadow-glow, which is a
     neutral black ring and turns the press state grey. */
  box-shadow: var(--shadow-glow-press-geom)
    color-mix(in srgb, var(--color-ai-accent) 30%, transparent) !important;
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
