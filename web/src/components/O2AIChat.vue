<template>
  <div class="chat-container" :class="[{ 'chat-open': isOpen }, store.state.theme == 'dark' ? 'dark-mode' : 'light-mode']" 
  >
    <div v-if="isOpen" class="chat-content-wrapper" :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
      <div class="chat-header" :style="{ height:  headerHeight ? headerHeight + 'px' : '' }">
        <div class="chat-title tw:flex tw:justify-between tw:items-center tw:w-full">

          <div class="tw:flex tw:items-center tw:gap-2">
            <q-avatar size="24px">
              <img :src="o2AiTitleLogo" />
            </q-avatar>

            <q-btn
              flat
              dense
              no-caps
              class="chat-title-dropdown"
              @click="loadHistory"
            >
              <div class="tw:flex tw:items-center tw:gap-2 tw:max-w-[220px]">
                <span class="chat-title-text tw:text-[14px] tw:font-medium tw:truncate tw:block">
                  {{ displayedTitle || 'New Chat' }}
                  <q-tooltip
                    v-if="displayedTitle && displayedTitle.length > 25"
                    :delay="500"
                    anchor="bottom middle"
                    self="top middle"
                    :offset="[0, 8]"
                  >
                    {{ displayedTitle }}
                  </q-tooltip>
                </span>
                <q-icon name="arrow_drop_down" size="20px" class="tw:flex-shrink-0" />
              </div>
              <q-menu>
                <!-- History menu with search -->
                <div class="history-menu-container">
                  <div class="search-history-bar-sticky">
                    <q-input
                      v-model="historySearchTerm"
                      placeholder="Search chat history"
                      dense
                      borderless
                      class="tw:mt-1"
                    >
                      <template #prepend>
                        <q-icon name="search" />
                      </template>
                    </q-input>
                  </div>
                  <div class="history-list-container">
                    <q-list style="min-width: 200px; width: 300px; max-width: 300px; border: 1px solid var(--q-separator-color);" padding>
                      <q-item
                        v-for="chat in filteredChatHistory"
                        :key="chat.id"
                        clickable
                        v-ripple
                        v-close-popup
                        @click="loadChat(chat.id)"
                        dense
                        class="history-item"
                      >
                        <q-item-section>
                          <div class="tw:flex tw:items-center tw:justify-between tw:w-full">
                            <div class="tw:flex-1 tw:overflow-hidden">
                              <div class="tw:text-[13px] tw:truncate">{{ chat.title }}</div>
                              <div class="tw:text-[11px] tw:text-gray-500">{{ formatTime(chat.timestamp) }}</div>
                            </div>
                            <q-btn
                              flat
                              round
                              dense
                              size="xs"
                              icon="delete"
                              class="delete-history-btn"
                              @click.stop="deleteChat(chat.id)"
                            >
                              <q-tooltip :delay="500">Delete chat</q-tooltip>
                            </q-btn>
                          </div>
                        </q-item-section>
                      </q-item>
                      <q-item v-if="filteredChatHistory.length === 0">
                        <q-item-section class="text-center text-grey">
                          No matching chats found
                        </q-item-section>
                      </q-item>
                    </q-list>
                  </div>

                  <!-- Clear all conversations button -->
                  <div v-if="filteredChatHistory.length > 0" class="clear-all-container">
                    <q-separator />
                    <q-btn
                      flat
                      no-caps
                      class="clear-all-btn"
                      icon="delete_sweep"
                      label="Clear all conversations"
                      @click.stop="clearAllConversations"
                    />
                  </div>
                </div>
              </q-menu>
            </q-btn>
          </div>

          <div>
            <!-- Edit title button -->
            <q-btn
              v-if="currentChatId"
              flat
              round
              dense
              size="md"
              icon="edit"
              @click.stop="openEditTitleDialog"
            >
              <q-tooltip :delay="500">Edit title</q-tooltip>
            </q-btn>
            <q-btn flat round dense size="md" icon="add" @click="addNewChat" />
            <q-btn flat round dense size="md" icon="close" @click="$emit('close')" />
          </div>
        </div>
      </div>
      <q-separator class="tw:bg-[#DBDBDB]" />

      <!-- History Panel -->
      <q-dialog v-model="showHistory" position="right">
        <q-card style="width: 350px; max-width: 100vw; height: 100vh;">
          <q-card-section class="row items-center q-pb-none">
            <div class="text-h6">Chat History</div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>

          <q-card-section class="q-pa-md" style="max-height: calc(100vh - 70px); overflow: auto;">
            <q-list separator>
              <q-item
                v-for="chat in chatHistory"
                :key="chat.id"
                clickable
                v-ripple
                @click="loadChat(chat.id)"
              >
                <q-item-section>
                  <q-item-label>{{ chat.title }}</q-item-label>
                  <q-item-label caption>
                    {{ new Date(chat.timestamp).toLocaleString() }}
                  </q-item-label>
                  <q-item-label caption>
                    Model: {{ chat.model }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Edit Title Dialog -->
      <q-dialog v-model="showEditTitleDialog">
        <q-card style="min-width: 350px">
          <q-card-section>
            <div class="text-h6">Edit Chat Title</div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            <q-input
              v-model="editingTitle"
              dense
              borderless
              autofocus
              @keyup.enter="saveEditedTitle"
              placeholder="Enter chat title"
            />
          </q-card-section>

          <q-card-actions align="right" class="q-px-md q-pb-md">
            <q-btn
              label="Cancel"
              class="o2-secondary-button"
              no-caps
              v-close-popup
            />
            <q-btn
              label="Save"
              class="o2-primary-button q-ml-sm"
              no-caps
              @click="saveEditedTitle"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

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
      <q-dialog v-model="showImagePreview" @hide="closeImagePreview">
        <q-card class="image-preview-dialog" style="max-width: 90vw; max-height: 90vh;">
          <q-card-section class="row items-center q-pb-none">
            <div class="text-subtitle1">{{ previewImage?.filename }}</div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>
          <q-card-section class="q-pa-md tw:flex tw:justify-center">
            <img
              v-if="previewImage"
              :src="'data:' + previewImage.mimeType + ';base64,' + previewImage.data"
              :alt="previewImage.filename"
              style="max-width: 100%; max-height: 80vh; object-fit: contain;"
            />
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Edit Title Dialog -->
      <q-dialog v-model="showEditTitleDialog">
        <q-card style="min-width: 350px">
          <q-card-section>
            <div class="text-h6">Edit Chat Title</div>
          </q-card-section>

          <q-card-section class="q-pt-none">
            <q-input
              v-model="editingTitle"
              dense
              borderless
              autofocus
              @keyup.enter="saveEditedTitle"
              placeholder="Enter chat title"
            />
          </q-card-section>

          <q-card-actions align="right" class="q-px-md q-pb-md">
            <q-btn
              label="Cancel"
              class="o2-secondary-button"
              no-caps
              v-close-popup
            />
            <q-btn
              label="Save"
              class="o2-primary-button q-ml-sm"
              no-caps
              @click="saveEditedTitle"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

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
      <q-dialog v-model="showImagePreview" @hide="closeImagePreview">
        <q-card class="image-preview-dialog" style="max-width: 90vw; max-height: 90vh;">
          <q-card-section class="row items-center q-pb-none">
            <div class="text-subtitle1">{{ previewImage?.filename }}</div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>
          <q-card-section class="q-pa-md tw:flex tw:justify-center">
            <img
              v-if="previewImage"
              :src="'data:' + previewImage.mimeType + ';base64,' + previewImage.data"
              :alt="previewImage.filename"
              style="max-width: 100%; max-height: 80vh; object-fit: contain;"
            />
          </q-card-section>
        </q-card>
      </q-dialog>


      <div class="chat-content " :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
        <div class="messages-container " ref="messagesContainer" @scroll="checkIfShouldAutoScroll">
          <div v-if="chatMessages.length === 0" class="welcome-section ">
            <div class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full ">
              <img :src="o2AiTitleLogo" />
              <div class="tw:relative tw:inline-block">
                <span class="tw:text-[14px] tw:font-[600] tw:ml-[30px] tw:text-center">O2 Assistant</span>
                <span class="o2-ai-beta-text tw:ml-[8px]">BETA</span>
              </div>
            </div>
          </div>
          <div v-for="(message, index) in processedMessages" 
            :key="index" 
            class="message" 
            :class="[
              message.role,
              { 'error-message': message.content.startsWith('Error:') }
            ]">
            <div class="message-content" >
              <q-avatar v-if="message.role === 'user'" size="24px" :class="store.state.theme == 'dark' ? 'dark-user-avatar' : 'light-user-avatar'">
                <q-icon size="16px" name="person" :color="store.state.theme == 'dark' ? 'white' : '#4a5568'" />
              </q-avatar>
              <div class="message-blocks" style="background-color: transparent;" :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
                <!-- Loading indicator inside message box for empty assistant messages -->
                <div v-if="message.role === 'assistant' && (!message.contentBlocks || message.contentBlocks.length === 0) && (!message.content || message.content.trim() === '') && isLoading" class="inline-loading">
                  <q-spinner-dots color="primary" size="1.5em" />
                  <span>{{ currentAnalyzingMessage }}</span>
                </div>
                <!-- Render contentBlocks in sequence (interleaved tool calls + text) -->
                <template v-for="(block, blockIndex) in message.contentBlocks" :key="'cb-' + blockIndex">
                  <!-- Tool call block - expandable -->
                  <div
                    v-if="block.type === 'tool_call'"
                    class="tool-call-item"
                    :class="[
                      store.state.theme == 'dark' ? 'dark-mode' : 'light-mode',
                      { 'has-details': hasToolCallDetails(block) },
                      { 'error': block.success === false && !block.pendingConfirmation },
                      { 'pending-confirmation': block.pendingConfirmation && block.tool !== 'navigation_action' },
                      { 'pending-navigation': block.pendingConfirmation && block.tool === 'navigation_action' },
                    ]"
                    @click="hasToolCallDetails(block) && !block.pendingConfirmation && toggleToolCallExpanded(index, blockIndex)"
                  >
                    <div class="tool-call-header">
                      <q-icon
                        :name="block.pendingConfirmation ? (block.tool === 'navigation_action' ? 'open_in_new' : 'help_outline') : (block.success === false ? 'error' : 'check_circle')"
                        size="14px"
                        :color="block.pendingConfirmation ? (block.tool === 'navigation_action' ? 'primary' : 'warning') : (block.success === false ? 'negative' : 'positive')"
                      />
                      <span class="tool-call-name">
                        {{ formatToolCallMessage(block).text }}<strong v-if="formatToolCallMessage(block).highlight">{{ formatToolCallMessage(block).highlight }}</strong>{{ formatToolCallMessage(block).suffix }}
                      </span>
                      <!-- Navigation icon -->
                      <q-icon
                        v-if="block.navigationAction && !block.pendingConfirmation"
                        name="open_in_new"
                        size="14px"
                        color="primary"
                        class="navigation-icon"
                        @click.stop="handleNavigationAction(block.navigationAction)"
                      >
                        <q-tooltip>{{ block.navigationAction.label }}</q-tooltip>
                      </q-icon>
                      <q-icon
                        v-if="hasToolCallDetails(block) && !block.pendingConfirmation"
                        :name="isToolCallExpanded(index, blockIndex) ? 'expand_less' : 'expand_more'"
                        size="16px"
                        class="expand-icon"
                      />
                    </div>
                    <!-- Expandable details -->
                    <div v-if="isToolCallExpanded(index, blockIndex)" class="tool-call-details" @click.stop>
                      <!-- Error details for failed tool calls -->
                      <template v-if="block.success === false">
                        <div v-if="block.resultMessage" class="detail-item">
                          <span class="detail-label">Error</span>
                          <span class="detail-value tool-error-message">{{ block.resultMessage }}</span>
                        </div>
                        <div v-if="block.errorType" class="detail-item">
                          <span class="detail-label">Type</span>
                          <code class="detail-value">{{ block.errorType }}</code>
                        </div>
                        <div v-if="block.suggestion" class="detail-item">
                          <span class="detail-label">Suggestion</span>
                          <span class="detail-value tool-suggestion">{{ block.suggestion }}</span>
                        </div>
                      </template>
                      <!-- Summary details for successful tool calls with summary -->
                      <template v-if="block.success !== false && block.summary">
                        <div v-if="block.summary.count !== undefined" class="detail-item">
                          <span class="detail-label">Results</span>
                          <span class="detail-value">{{ block.summary.count }} records</span>
                        </div>
                        <div v-if="block.summary.took !== undefined" class="detail-item">
                          <span class="detail-label">Duration</span>
                          <span class="detail-value">{{ block.summary.took }}ms</span>
                        </div>
                      </template>
                      <!-- Existing context details -->
                      <div v-if="getToolCallDisplayData(block.context)?.query" class="detail-item">
                        <div class="detail-header">
                          <span class="detail-label">Query</span>
                          <q-btn
                            flat
                            dense
                            size="xs"
                            icon="content_copy"
                            class="copy-btn"
                            @click.stop="copyToClipboard(getToolCallDisplayData(block.context)?.query)"
                          >
                            <q-tooltip>Copy query</q-tooltip>
                          </q-btn>
                        </div>
                        <code class="detail-value query-value">{{ getToolCallDisplayData(block.context)?.query }}</code>
                      </div>
                      <div v-if="getToolCallDisplayData(block.context)?.stream" class="detail-item">
                        <span class="detail-label">Stream</span>
                        <code class="detail-value">{{ getToolCallDisplayData(block.context)?.stream }}</code>
                      </div>
                      <div v-if="getToolCallDisplayData(block.context)?.type" class="detail-item">
                        <span class="detail-label">Type</span>
                        <code class="detail-value">{{ getToolCallDisplayData(block.context)?.type }}</code>
                      </div>
                      <div v-if="getToolCallDisplayData(block.context)?.start_time" class="detail-item">
                        <span class="detail-label">Start</span>
                        <span class="detail-value">{{ formatTimestamp(getToolCallDisplayData(block.context)?.start_time) }}</span>
                      </div>
                      <div v-if="getToolCallDisplayData(block.context)?.end_time" class="detail-item">
                        <span class="detail-label">End</span>
                        <span class="detail-value">{{ formatTimestamp(getToolCallDisplayData(block.context)?.end_time) }}</span>
                      </div>
                      <div v-if="getToolCallDisplayData(block.context)?.from !== undefined" class="detail-item">
                        <span class="detail-label">From</span>
                        <span class="detail-value">{{ getToolCallDisplayData(block.context)?.from }}</span>
                      </div>
                      <div v-if="getToolCallDisplayData(block.context)?.size !== undefined" class="detail-item">
                        <span class="detail-label">Size</span>
                        <span class="detail-value">{{ getToolCallDisplayData(block.context)?.size }}</span>
                      </div>
                      <div v-if="getToolCallDisplayData(block.context)?.query_type" class="detail-item">
                        <span class="detail-label">Query Type</span>
                        <code class="detail-value">{{ getToolCallDisplayData(block.context)?.query_type }}</code>
                      </div>
                      <div v-if="getToolCallDisplayData(block.context)?.vrl" class="detail-item">
                        <div class="detail-header">
                          <span class="detail-label">VRL</span>
                          <q-btn
                            flat
                            dense
                            size="xs"
                            icon="content_copy"
                            class="copy-btn"
                            @click.stop="copyToClipboard(getToolCallDisplayData(block.context)?.vrl)"
                          >
                            <q-tooltip>Copy VRL</q-tooltip>
                          </q-btn>
                        </div>
                        <code class="detail-value query-value">{{ getToolCallDisplayData(block.context)?.vrl }}</code>
                      </div>
                      <!-- Tool response: SearchSQL hits -->
                      <template v-if="block.response && block.response.hits">
                        <div class="detail-item">
                          <div class="detail-header">
                            <span class="detail-label">Results</span>
                            <q-btn
                              flat
                              dense
                              size="xs"
                              icon="content_copy"
                              class="copy-btn"
                              @click.stop="copyToClipboard(JSON.stringify(block.response.hits, null, 2))"
                            >
                              <q-tooltip>Copy results</q-tooltip>
                            </q-btn>
                          </div>
                          <div class="tool-response-hits">
                            <div v-for="(hit, hIdx) in block.response.hits" :key="hIdx" class="tool-response-hit">
                              <span v-for="(val, key) in hit" :key="key" class="hit-field">
                                <span class="hit-key">{{ key }}:</span> {{ val }}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div class="tool-response-meta">
                          <span v-if="block.response.total !== undefined" class="context-tag">Total: {{ block.response.total }}</span>
                          <span v-if="block.response.took !== undefined" class="context-tag">Took: {{ block.response.took }}ms</span>
                          <span v-if="block.response.hits_truncated" class="context-tag">Showing first {{ block.response.hits.length }}</span>
                        </div>
                      </template>
                      <!-- Tool response: testFunction input/output -->
                      <template v-else-if="block.response && (block.response.input || block.response.output)">
                        <div v-if="block.response.input" class="detail-item">
                          <span class="detail-label">Input Events</span>
                          <div class="tool-response-hits">
                            <div v-for="(evt, eIdx) in block.response.input" :key="eIdx" class="tool-response-hit">
                              <span v-for="(val, key) in evt" :key="key" class="hit-field">
                                <span class="hit-key">{{ key }}:</span> {{ typeof val === 'string' && val.length > 120 ? val.substring(0, 120) + '...' : val }}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div v-if="block.response.output" class="detail-item">
                          <span class="detail-label">Output</span>
                          <div class="tool-response-hits">
                            <div v-for="(res, rIdx) in block.response.output" :key="rIdx" class="tool-response-hit">
                              <template v-if="res.event">
                                <span v-for="(val, key) in res.event" :key="key" class="hit-field">
                                  <span class="hit-key">{{ key }}:</span> {{ typeof val === 'string' && val.length > 120 ? val.substring(0, 120) + '...' : val }}
                                </span>
                              </template>
                              <span v-if="res.message" class="hit-field hit-error">
                                <span class="hit-key">error:</span> {{ res.message }}
                              </span>
                            </div>
                          </div>
                        </div>
                      </template>
                      <!-- Tool response: generic fallback (string or other) -->
                      <div v-else-if="block.response" class="detail-item">
                        <div class="detail-header">
                          <span class="detail-label">Response</span>
                          <q-btn
                            flat
                            dense
                            size="xs"
                            icon="content_copy"
                            class="copy-btn"
                            @click.stop="copyToClipboard(typeof block.response === 'string' ? block.response : JSON.stringify(block.response, null, 2))"
                          >
                            <q-tooltip>Copy response</q-tooltip>
                          </q-btn>
                        </div>
                        <code class="detail-value query-value">{{ typeof block.response === 'string' ? block.response : JSON.stringify(block.response, null, 2) }}</code>
                      </div>
                    </div>
                  </div>
                  <!-- Log Entry block - expandable -->
                  <div
                    v-else-if="block.type === 'log_entry'"
                    class="log-entry-item"
                    :class="[
                      store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'
                    ]"
                    @click="toggleLogEntryExpanded(index, blockIndex)"
                  >
                    <div class="log-entry-header">
                      <q-icon
                        name="description"
                        size="14px"
                        color="primary"
                      />
                      <span class="log-entry-info">
                        {{ block.preview }}
                      </span>
                      <q-icon
                        :name="isLogEntryExpanded(index, blockIndex) ? 'expand_less' : 'expand_more'"
                        size="16px"
                        class="expand-icon"
                      />
                    </div>
                    <!-- Expandable details -->
                    <div v-if="isLogEntryExpanded(index, blockIndex)" class="log-entry-details" @click.stop>
                      <div class="log-entry-content">
                        <q-btn
                          flat
                          dense
                          size="xs"
                          icon="content_copy"
                          class="copy-btn"
                          @click.stop="copyToClipboard(block.content)"
                        >
                          <q-tooltip>Copy content</q-tooltip>
                        </q-btn>
                        <code class="log-entry-code" v-html="formatLogEntryContent(block.content)"></code>
                      </div>
                    </div>
                  </div>
                  <!-- Stream-level error block -->
                  <div
                    v-else-if="block.type === 'error'"
                    class="stream-error-block"
                    :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'"
                  >
                    <div class="stream-error-header">
                      <q-icon name="warning" size="16px" color="negative" />
                      <span class="stream-error-message">{{ block.message }}</span>
                    </div>
                    <div v-if="block.suggestion" class="stream-error-suggestion">
                      {{ block.suggestion }}
                    </div>
                    <div v-if="block.recoverable" class="stream-error-recoverable">
                      This error may be temporary. You can try again.
                    </div>
                  </div>
                  <!-- Navigation block - standalone navigation button -->
                  <div
                    v-else-if="block.type === 'navigation' && block.navigationAction"
                    class="navigation-block"
                    :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'"
                  >
                    <q-btn
                      dense
                      no-caps
                      unelevated
                      color="primary"
                      :icon="'open_in_new'"
                      :label="block.navigationAction.label"
                      class="navigation-block-btn"
                      @click="handleNavigationAction(block.navigationAction)"
                    />
                  </div>
                  <!-- Text block - render with markdown processing -->
                  <template v-else-if="block.type === 'text' && block.text">
                    <template v-for="(textBlock, tbIndex) in processTextBlock(block.text)" :key="'tb-' + blockIndex + '-' + tbIndex">
                      <div v-if="textBlock.type === 'code'" class="code-block">
                        <div class="code-block-header code-block-theme">
                          <span v-if="textBlock.language" class="code-type-label">
                            {{ getLanguageDisplay(textBlock.language) }}
                          </span>
                          <q-btn
                            flat
                            dense
                            class="copy-button"
                            no-caps
                            color="primary"
                            @click="copyToClipboard(textBlock.content)"
                          >
                            <div class="tw:flex tw:items-center">
                              <q-icon size="16px" name="content_copy" />
                              <span class="tw:ml-1">Copy</span>
                            </div>
                          </q-btn>
                        </div>
                        <span class="generated-code-block">
                          <code :class="['hljs', textBlock.language]" v-html="textBlock.highlightedContent"></code>
                        </span>
                        <div class="code-block-footer code-block-theme tw:flex tw:items-center tw:justify-between tw:w-full">
                          <q-btn
                            flat
                            dense
                            class="retry-button"
                            no-caps
                            color="primary"
                            @click="retryGeneration(message)"
                          >
                            <div class="tw:flex tw:items-center">
                              <q-icon size="16px" name="refresh" />
                              <span class="tw:ml-1">Retry</span>
                            </div>
                          </q-btn>
                        </div>
                      </div>
                      <div v-else class="text-block" v-html="processHtmlBlock(textBlock.content)"></div>
                    </template>
                  </template>
                </template>
                <!-- Fallback for messages without contentBlocks (user messages or old assistant messages) -->
                <template v-if="!message.contentBlocks || message.contentBlocks.length === 0">
                  <!-- Display images for user messages -->
                  <div v-if="message.role === 'user' && message.images && message.images.length > 0" class="message-images tw:flex tw:flex-wrap tw:gap-2 tw:mb-2">
                    <div
                      v-for="(img, imgIndex) in message.images"
                      :key="'img-' + imgIndex"
                      class="message-image-item"
                    >
                      <img
                        :src="'data:' + img.mimeType + ';base64,' + img.data"
                        :alt="img.filename"
                        class="tw:max-w-[200px] tw:max-h-[150px] tw:object-contain tw:rounded tw:border tw:border-gray-300 tw:cursor-pointer"
                        @click="openImagePreview(img)"
                      />
                      <q-tooltip>{{ img.filename }}</q-tooltip>
                    </div>
                  </div>
                  <template v-for="(block, blockIndex) in message.blocks" :key="'fb-' + blockIndex">
                    <div v-if="block.type === 'code'" class="code-block">
                      <div class="code-block-header code-block-theme">
                        <span v-if="block.language" class="code-type-label">
                          {{ getLanguageDisplay(block.language) }}
                        </span>
                        <q-btn
                          flat
                          dense
                          class="copy-button"
                          no-caps
                          color="primary"
                          @click="copyToClipboard(block.content)"
                        >
                          <div class="tw:flex tw:items-center">
                            <q-icon size="16px" name="content_copy" />
                            <span class="tw:ml-1">Copy</span>
                          </div>
                        </q-btn>
                      </div>
                      <span class="generated-code-block">
                        <code :class="['hljs', block.language]" v-html="block.highlightedContent"></code>
                      </span>
                    </div>
                    <div v-else class="text-block" v-html="processHtmlBlock(block.content)"></div>
                  </template>
                </template>
                <!-- Feedback buttons for assistant messages -->
                <div v-if="message.role === 'assistant' && message.content && message.content.trim() !== ''" class="feedback-buttons">
                  <q-btn
                    flat
                    dense
                    round
                    size="xs"
                    @click="likeCodeBlock(index)"
                  >
                    <q-icon :name="outlinedThumbUpOffAlt" size="14px" />
                    <q-tooltip>Helpful</q-tooltip>
                  </q-btn>
                  <q-btn
                    flat
                    dense
                    round
                    size="xs"
                    @click="dislikeCodeBlock(index)"
                  >
                    <q-icon :name="outlinedThumbDownOffAlt" size="14px" />
                    <q-tooltip>Not helpful</q-tooltip>
                  </q-btn>
                </div>
              </div>
            </div>
          </div>
          <!-- Tool call indicator - shows outside message box -->
          <div v-if="activeToolCall" class="tool-call-indicator" :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
            <div class="tool-call-content">
              <q-spinner-dots color="primary" size="1.5em" />
              <div class="tool-call-info">
                <span class="tool-call-message">{{ activeToolCall.message }}</span>
                <div v-if="getToolCallDisplayData(activeToolCall.context)" class="tool-call-context">
                  <div v-if="getToolCallDisplayData(activeToolCall.context)?.query" class="context-item">
                    <code class="context-query">{{ truncateQuery(getToolCallDisplayData(activeToolCall.context)?.query) }}</code>
                  </div>
                  <div v-if="getToolCallDisplayData(activeToolCall.context)?.vrl && !getToolCallDisplayData(activeToolCall.context)?.query" class="context-item">
                    <code class="context-query">{{ truncateQuery(getToolCallDisplayData(activeToolCall.context)?.vrl) }}</code>
                  </div>
                  <span v-if="getToolCallDisplayData(activeToolCall.context)?.stream" class="context-tag">
                    Stream: {{ getToolCallDisplayData(activeToolCall.context)?.stream }}
                  </span>
                  <span v-if="getToolCallDisplayData(activeToolCall.context)?.query_type" class="context-tag">
                    Type: {{ getToolCallDisplayData(activeToolCall.context)?.query_type }}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <!-- Standalone loading indicator - only shown when loading with no tool calls -->
          <div v-if="isLoading && !activeToolCall" class="tool-call-indicator" :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
            <div class="tool-call-content">
              <q-spinner-dots color="primary" size="1.5em" />
              <span class="tool-call-message">{{ currentAnalyzingMessage }}</span>
            </div>
          </div>
        </div>
        
        <!-- Scroll to bottom button -->
        <div 
          v-show="showScrollToBottom" 
          class="scroll-to-bottom-container"
        >
          <q-btn
            round
            flat
            icon="arrow_downward"
            class="scroll-to-bottom-btn"
            @click="scrollToBottomSmooth"
            size="sm"
          >
            <q-tooltip anchor="top middle" self="bottom middle">
              Scroll to bottom
            </q-tooltip>
          </q-btn>
        </div>
      </div>

      <!-- Fixed loading indicator above input - only shown when scrolled up -->
      <div
        v-if="(isLoading || activeToolCall) && showScrollToBottom"
        class="fixed-analyzing-indicator"
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'"
      >
        <!-- Show tool call if active -->
        <div v-if="activeToolCall" class="analyzing-content">
          <q-spinner-dots color="primary" size="1.5em" />
          <span class="analyzing-message">{{ activeToolCall.message }}</span>
        </div>
        <!-- Show analyzing message if loading but no active tool call -->
        <div v-else-if="isLoading" class="analyzing-content">
          <q-spinner-dots color="primary" size="1.5em" />
          <span class="analyzing-message">{{ currentAnalyzingMessage }}</span>
        </div>
      </div>

      <div class="chat-input-container q-ma-md">
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
          style="display: none;"
          @change="handleImageSelect"
        />

        <div
          v-if="!pendingConfirmation"
          class="unified-input-box"
          :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'"
          @dragover="handleDragOver"
          @drop="handleDrop"
          @paste="handlePaste"
        >
          <!-- Image preview strip -->
          <div v-if="pendingImages.length > 0" class="image-preview-strip">
            <div
              v-for="(img, index) in pendingImages"
              :key="index"
              class="image-preview-item"
            >
              <img
                :src="'data:' + img.mimeType + ';base64,' + img.data"
                :alt="img.filename"
                class="preview-image"
              />
              <q-btn
                round
                dense
                flat
                size="xs"
                class="image-remove-btn"
                @click.stop="removeImage(index)"
              >
                <q-icon name="close" size="12px" color="white" />
              </q-btn>
              <q-tooltip>{{ img.filename }} ({{ (img.size / 1024).toFixed(0) }}KB)</q-tooltip>
            </div>
          </div>

          <RichTextInput
            ref="chatInput"
            v-model="inputMessage"
            :placeholder="'Write your prompt'"
            :disabled="isLoading"
            :theme="store.state.theme"
            :references="contextReferences"
            :borderless="true"
            @keydown="handleKeyDown"
            @submit="sendMessage"
            @update:references="handleReferencesUpdate"
          />

          <!-- Bottom bar with buttons -->
          <div class="input-bottom-bar">
            <div class="tw:flex tw:items-center tw:gap-2">
              <!-- Image upload button -->
              <q-btn
                v-if="!isLoading"
                @click.stop="triggerImageUpload"
                round
                dense
                flat
                size="sm"
                class="image-upload-btn"
              >
                <q-icon name="image" size="18px" :color="store.state.theme == 'dark' ? 'white' : 'grey-7'" />
                <q-tooltip>Attach images (PNG, JPEG, max 2MB)</q-tooltip>
              </q-btn>
              <div v-else class="tw:w-8"></div>

              <!-- Auto navigation toggle button -->
              <q-btn
                v-if="!isLoading"
                @click.stop="isAutoNavigationEnabled = !isAutoNavigationEnabled"
                dense
                flat
                no-caps
                size="sm"
                class="auto-nav-toggle-btn"
                :class="{ 'auto-nav-enabled': isAutoNavigationEnabled }"
              >
                <q-icon
                  :name="isAutoNavigationEnabled ? 'check_circle' : 'radio_button_unchecked'"
                  size="14px"
                  :color="!isAutoNavigationEnabled ? (store.state.theme == 'dark' ? 'grey-5' : 'grey-7') : undefined"
                  class="auto-nav-icon"
                />
                <span class="auto-nav-label tw:ml-1">Auto Navigation</span>
                <q-tooltip>
                  {{ isAutoNavigationEnabled ? 'Auto navigation enabled - O2 Assistant will auto navigate without confirmation' : 'Auto navigation disabled - O2 Assistant will ask before navigating' }}
                </q-tooltip>
              </q-btn>
            </div>

            <div class="tw:flex tw:items-center tw:gap-2">
              <!-- Send button - shown when not loading -->
              <q-btn
                v-if="!isLoading"
                :disable="!inputMessage.trim() && pendingImages.length === 0"
                @click="sendMessage"
                round
                dense
                flat
                size="sm"
                class="send-button"
              >
                <q-icon name="send" size="16px" color="white" />
              </q-btn>

              <!-- Stop button - shown when loading/streaming -->
              <q-btn
                v-if="isLoading"
                @click="cancelCurrentRequest"
                round
                dense
                flat
                size="sm"
                class="stop-button"
              >
                <q-icon name="stop" size="16px" color="white" />
              </q-btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, nextTick, watch, computed, onUnmounted } from 'vue';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import 'highlight.js/styles/github-dark.css';
import { marked } from 'marked';
import { MarkedOptions } from 'marked';
import DOMPurify from 'dompurify';
import { useQuasar } from 'quasar';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import useAiChat from '@/composables/useAiChat';
import { outlinedThumbUpOffAlt, outlinedThumbDownOffAlt } from '@quasar/extras/material-icons-outlined';
import { getImageURL, getUUIDv7 } from '@/utils/zincutils';
import { ChatMessage, ChatHistoryEntry, ToolCall, ContentBlock, ImageAttachment, NavigationAction, MAX_IMAGE_SIZE_BYTES, ALLOWED_IMAGE_TYPES } from '@/types/chat';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import RichTextInput, { ReferenceChip } from '@/components/RichTextInput.vue';
import O2AIConfirmDialog from '@/components/O2AIConfirmDialog.vue';
import { useChatHistory } from '@/composables/useChatHistory';

const { fetchAiChat, submitFeedback } = useAiChat();

// Register VRL as a JavaScript alias (type assertion)
hljs.registerLanguage('vrl', () => hljs.getLanguage('javascript') as any);

// Configure marked options with custom language support
const markedOptions = {
  breaks: true,
  gfm: true,
  langPrefix: 'hljs language-',
  headerIds: false,
  mangle: false,
  sanitize: false, // Allow HTML in markdown
  highlight: (code: string, lang: string) => {
    if (lang === 'vrl') {
      return hljs.highlight(code, { language: 'javascript' }).value;
    }
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  }
} as MarkedOptions;

marked.setOptions(markedOptions);

// Function to render markdown content
function renderMarkdown(content: any) {
  return marked.parse(content);
}

export default defineComponent({
  name: 'O2AIChat',
  components: {
    ConfirmDialog,
    RichTextInput,
    O2AIConfirmDialog,
  },
  props: {
    isOpen: {
      type: Boolean,
      default: false
    },
    headerHeight: {
      type: Number,
      default: 0,
    },
    //this will be used to set the input message if the user sends the data from any page by clicking on the ai chat button
    aiChatInputContext: {
      type: String,
      default: ''
    },
    appendMode: {
      type: Boolean,
      default: true
    }
  },
  setup(props) {
    const $q = useQuasar();
    const inputMessage = ref(props.aiChatInputContext ? props.aiChatInputContext : '');
    const chatMessages = ref<ChatMessage[]>([]);
    const isLoading = ref(false);
    const messagesContainer = ref<HTMLElement | null>(null);
    const chatInput = ref<any>(null); // RichTextInput component instance
    const scrollTimeoutId = ref<ReturnType<typeof setTimeout> | null>(null);
    const currentStreamingMessage = ref('');
    const currentTextSegment = ref(''); // Track current text segment (resets after each tool call)
    const showHistory = ref(false);
    const chatHistory = ref<ChatHistoryEntry[]>([]);
    const currentChatId = ref<number | null>(null);
    const currentSessionId = ref<string | null>(null); // UUID v7 for tracking all API calls in this chat session
    const lastTraceId = ref<string | null>(null); // OTEL trace_id from last workflow for feedback correlation
    const store = useStore ();
    const router = useRouter();
    const chatUpdated = computed(() => store.state.chatUpdated);

    // Chat history composable
    const {
      saveToHistory: dbSaveToHistory,
      loadHistory: dbLoadHistory,
      loadChat: dbLoadChat,
      deleteChatById: dbDeleteChatById,
      clearAllHistory: dbClearAllHistory,
      updateChatTitle: dbUpdateChatTitle,
    } = useChatHistory();

    const currentChatTimestamp = ref<string | null>(null);
    const saveHistoryLoading = ref(false);
    const historySearchTerm = ref('');
    const shouldAutoScroll = ref(true);
    const showScrollToBottom = ref(false);

    // Edit title state
    const showEditTitleDialog = ref(false);
    const editingTitle = ref('');

    // Clear all confirmation state
    const showClearAllConfirmDialog = ref(false);

    // Delete individual chat confirmation state
    const showDeleteChatConfirmDialog = ref(false);
    const chatToDelete = ref<number | null>(null);

    // Tool confirmation state (from AI agent — confirmation-required actions, inline in chat)
    const pendingConfirmation = ref<{ tool: string; args: Record<string, any>; message: string; navAction?: NavigationAction } | null>(null);

    // Auto navigation state - per chat ID
    // Stores chat ID -> boolean mapping for auto navigation preference
    const autoNavigationPreferences = ref<Map<number, boolean>>(new Map());

    // Pending auto navigation preference for new chats (before chat ID is created)
    const pendingAutoNavigation = ref(false);

    // Current chat's auto navigation state
    const isAutoNavigationEnabled = computed({
      get: () => {
        if (!currentChatId.value) return pendingAutoNavigation.value;
        return autoNavigationPreferences.value.get(currentChatId.value) ?? false;
      },
      set: (value: boolean) => {
        if (currentChatId.value) {
          autoNavigationPreferences.value.set(currentChatId.value, value);
          saveAutoNavigationPreferences();
        } else {
          // Store temporarily for new chats
          pendingAutoNavigation.value = value;
        }
      }
    });

    // AI-generated chat title state
    const aiGeneratedTitle = ref<string | null>(null);
    const displayedTitle = ref<string>('');
    const isTypingTitle = ref(false);
    const titleAnimationId = ref<number>(0); // Used to cancel stale animations

    // Track expanded tool calls by message index and block index
    const expandedToolCalls = ref<Set<string>>(new Set());

    // Track expanded log entries by message index and block index
    const expandedLogEntries = ref<Set<string>>(new Set());

    // Active tool call state - for showing tool progress outside message box
    const activeToolCall = ref<{ tool: string; message: string; context: Record<string, any> } | null>(null);

    // Pending tool calls - stores tool calls that arrive before text content to avoid empty message boxes
    const pendingToolCalls = ref<ContentBlock[]>([]);

    // AbortController for managing request cancellation - allows users to stop ongoing AI requests
    const currentAbortController = ref<AbortController | null>(null);

    // Typewriter animation state for LLM responses
    const displayedStreamingContent = ref('');
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
      "Piecing together..."
    ];
    const currentAnalyzingMessage = ref(ANALYZING_MESSAGES[0]);
    const analyzingRotationInterval = ref<NodeJS.Timeout | null>(null);

    /**
     * Start rotating the analyzing message every 5 seconds
     */
    const startAnalyzingRotation = () => {
      currentAnalyzingMessage.value = ANALYZING_MESSAGES[Math.floor(Math.random() * ANALYZING_MESSAGES.length)];
      analyzingRotationInterval.value = setInterval(() => {
        currentAnalyzingMessage.value = ANALYZING_MESSAGES[Math.floor(Math.random() * ANALYZING_MESSAGES.length)];
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
      displayedTitle.value = '';
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
      displayedTitle.value = '';
      isTypingTitle.value = false;
    };

    /**
     * Reset typewriter animation state
     */
    const resetTypewriterState = () => {
      displayedStreamingContent.value = '';
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
        const codeBlockEnd = remaining.indexOf('```', codeBlockStart[0].length);
        if (codeBlockEnd !== -1) {
          const endPos = codeBlockEnd + 3;
          displayedStreamingContent.value = target.slice(0, current.length + endPos);
        } else {
          // Code block not complete yet, reveal opening and wait
          displayedStreamingContent.value = target.slice(0, current.length + codeBlockStart[0].length);
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
    const HISTORY_KEY = 'ai-chat-query-history';
    const MAX_HISTORY_SIZE = 10;
    
    const modelConfig: any = {
      openai: [
        'gpt-4.1'
      ],
      groq: [
        'llama-3.3-70b-versatile',
        'meta-llama/llama-4-scout-17b-16e-instruct',
        'meta-llama/llama-4-maverick-17b-128e-instruct'
      ],
      xai: [
        'xai/grok-3-mini-beta',
        'xai/grok-3-latest'
      ]
    };

    const capabilities = [
      '1. Create a SQL query for me',
      '2. Convert this SPL query to SQL',
      '3. What is happening on this log line',
      '4. Write a VRL function to parse these log lines',
      '5. What are golden signals for observability',
      '6. How to monitor kubernetes cluster',
      '7. How to monitor docker containers',
      '8. How to monitor aws services',
      '9. How to monitor azure services',
      '10. How to monitor google cloud services'
    ];

    const formatMessage = (content: string) => {
      try {
        return renderMarkdown(content);
      } catch (e) {
        console.error('Error formatting message:', e);
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
          behavior: 'smooth'
        });
        // Hide the button immediately when user clicks it
        showScrollToBottom.value = false;
        // Reset auto-scroll when user manually scrolls to bottom
        shouldAutoScroll.value = true;
      }
    };


    const scrollToLoadingIndicator = async () => {
      await nextTick();
      const loadingElement = document.getElementById('loading-indicator');
      if (loadingElement) {
        loadingElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
        $q.notify({
          message: 'Response generation stopped',
          color: 'secondary',
          position: 'bottom',
          timeout: 2000,
          icon: 'stop'
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
          if (lastMessage.role === 'assistant') {
            if (!lastMessage.content) {
              // Remove empty assistant message that was added for streaming
              chatMessages.value.pop();
            } else if (currentStreamingMessage.value) {
              // Update final text in contentBlocks to show all buffered content
              if (lastMessage.contentBlocks) {
                const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
                if (lastBlock && lastBlock.type === 'text') {
                  lastBlock.text = currentTextSegment.value;
                }
              }
              // Keep partial content but indicate it was cancelled
              lastMessage.content += '\n\n_[Response stopped by user]_';
            }
          }
        }

        // Reset streaming state
        currentStreamingMessage.value = '';
        currentTextSegment.value = '';
        displayedStreamingContent.value = '';

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
          if (chatInput.value && typeof chatInput.value.insertChip === 'function') {
            // Focus input first to ensure cursor is positioned correctly
            focusInput();

            // Only clear if appendMode is false and there are no existing chips
            // Check DOM directly for existing chips instead of relying on reactive state
            const inputElement = chatInput.value.$el || chatInput.value;
            const editableDiv = inputElement?.querySelector('.rich-text-input') || inputElement?.querySelector('[contenteditable]');
            const hasExistingChips = editableDiv?.querySelector('.reference-chip') !== null;
            const hasExistingText = editableDiv?.textContent?.trim().length > 0;

            // Only clear if:
            // 1. appendMode is false (user wants to replace content)
            // 2. AND there are no existing chips
            // 3. AND there is no existing text
            if (!props.appendMode && !hasExistingChips && !hasExistingText) {
              if (chatInput.value && typeof chatInput.value.clear === 'function') {
                chatInput.value.clear();
              }
              inputMessage.value = '';
            }

            // Insert all pending chips at the cursor position
            pendingChips.value.forEach(chip => {
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
        if (typeof parsed === 'object' && parsed !== null) {
          // For objects, show first few keys
          const keys = Object.keys(parsed);
          if (keys.length > 0) {
            const firstKeys = keys.slice(0, 3).map(k => {
              const val = parsed[k];
              if (typeof val === 'string') {
                const truncatedVal = val.length > 8 ? val.substring(0, 8) + '...' : val;
                return k + ': "' + truncatedVal + '"';
              }
              return k + ': ' + String(val).substring(0, 8);
            }).join(', ');
            const moreKeys = keys.length > 3 ? ', ...' : '';
            preview = '{' + firstKeys + moreKeys + '}';
          }
        }
      } catch {
        // Not JSON, use plain text preview
        // Replace newlines and multiple spaces with single space
        preview = preview.replace(/\s+/g, ' ');
      }

      // Truncate if still too long
      if (preview.length > maxLength) {
        preview = preview.substring(0, maxLength) + '...';
      }

      return preview;
    };

    watch(() => props.aiChatInputContext, (newAiChatInputContext: string) => {
      if(newAiChatInputContext) {
        // Create a reference chip from the context
        const contextChip: ReferenceChip = {
          id: `context-${Date.now()}`,
          filename: 'Log Entry',
          preview: createPreview(newAiChatInputContext, 10),
          fullContent: newAiChatInputContext,
          charCount: newAiChatInputContext.length,
          type: 'context'
        };

        // Always queue the chip first for consistent behavior
        pendingChips.value.push(contextChip);

        // If component is ready, process immediately with proper timing
        if (componentReady.value && chatInput.value && typeof chatInput.value.insertChip === 'function') {
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
    });


    //fetchInitialMessage is called when the component is mounted and the isOpen prop is true

    const fetchInitialMessage = async () => {
      isLoading.value = true;
      try {
        chatMessages.value = [];
      } catch (error) {
        chatMessages.value = [{
          role: 'assistant',
          content: 'Error: Unable to connect to backend'
        }];
        console.error('Error fetching initial message:', error);
      }
      isLoading.value = false;
      stopAnalyzingRotation();
      scrollToBottom();
    };

    const processStream = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder();
      let buffer = '';
      let messageComplete = false;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new chunk to existing buffer
          buffer += decoder.decode(value, { stream: true });
          
          // Process each line that starts with 'data: '
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep last potentially incomplete line
          
          for (const line of lines) {
            if (line.trim().startsWith('data: ')) {
              try {
                // Extract everything after 'data: ' and before any line break
                const jsonStr = line.substring(line.indexOf('{'));
                
                // Skip empty or invalid JSON strings
                if (!jsonStr || !jsonStr.trim()) continue;
                
                // Try to parse the JSON, handling potential errors
                try {
                  const data = JSON.parse(jsonStr);

                  // Handle title events - AI-generated chat title from first message
                  if (data && data.type === 'title') {
                    aiGeneratedTitle.value = data.title;
                    animateTitle(data.title);
                    continue;
                  }

                  // Handle confirmation_required events - add inline confirmation block in chat
                  if (data && data.type === 'confirmation_required') {
                    // Check if this is a navigation action and auto navigation is enabled
                    if (data.tool === 'navigation_action' && isAutoNavigationEnabled.value) {
                      // Auto-approve navigation without showing confirmation
                      try {
                        const orgId = store.state.selectedOrganization.identifier;
                        await fetch(
                          `${store.state.API_ENDPOINT}/api/${orgId}/ai/confirm/${currentSessionId.value}`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ approved: true }),
                          }
                        );
                      } catch (error) {
                        console.error('Error auto-confirming navigation:', error);
                      }
                      continue;
                    }

                    // data.message is always set by the backend:
                    // - Navigation: validated label (e.g. "View in Logs")
                    // - Other tools: "Confirm execution of {tool}?"
                    const confirmBlock: ContentBlock = {
                      type: 'tool_call',
                      tool: data.tool,
                      message: activeToolCall.value?.message || data.message,
                      context: activeToolCall.value?.context || {},
                      pendingConfirmation: true,
                      confirmationMessage: data.message,
                      confirmationArgs: data.args || {},
                    };
                    activeToolCall.value = null;

                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(confirmBlock);
                    } else {
                      chatMessages.value.push({
                        role: 'assistant',
                        content: '',
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
                  if (data && data.type === 'tool_call') {
                    // If there's already an active tool call, complete it first
                    if (activeToolCall.value) {
                      const completedToolBlock: ContentBlock = {
                        type: 'tool_call',
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context
                      };
                      let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant') {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                    }

                    // Show active indicator (blue spinner box) - don't add to chat yet
                    activeToolCall.value = {
                      tool: data.tool,
                      message: data.message,
                      context: data.context || {}
                    };

                    // Finalize any in-progress text block before resetting
                    // (typewriter animation may not have caught up yet)
                    if (currentTextSegment.value) {
                      const lm = chatMessages.value[chatMessages.value.length - 1];
                      if (lm && lm.role === 'assistant' && lm.contentBlocks) {
                        const lb = lm.contentBlocks[lm.contentBlocks.length - 1];
                        if (lb && lb.type === 'text') {
                          lb.text = currentTextSegment.value;
                        }
                      }
                    }
                    // Stop typewriter and reset for next segment
                    if (typewriterAnimationId.value) {
                      cancelAnimationFrame(typewriterAnimationId.value);
                      typewriterAnimationId.value = null;
                    }
                    currentTextSegment.value = '';
                    displayedStreamingContent.value = '';
                    await scrollToBottom();
                    continue;
                  }

                  // Handle error events - display error message to user
                  if (data && data.type === 'error') {
                    // Complete any active tool call first
                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (activeToolCall.value) {
                      const completedToolBlock: ContentBlock = {
                        type: 'tool_call',
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context
                      };
                      if (lastMessage && lastMessage.role === 'assistant') {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                      activeToolCall.value = null;
                    }

                    // Format error message with suggestion if available
                    // Handle case where error/message might be an object instead of string
                    const rawError = data.error ?? data.message ?? 'An unexpected error occurred';
                    const errorText = typeof rawError === 'string' ? rawError : JSON.stringify(rawError, null, 2);

                    let errorMessage = `Error: ${errorText}`;
                    if (data.suggestion) {
                      errorMessage += `\n\n${data.suggestion}`;
                    }

                    // Get or create assistant message for error (reuse lastMessage)
                    lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (!lastMessage || lastMessage.role !== 'assistant') {
                      chatMessages.value.push({
                        role: 'assistant',
                        content: errorMessage,
                        contentBlocks: [...pendingToolCalls.value, { type: 'text', text: errorMessage }]
                      });
                      pendingToolCalls.value = [];
                    } else {
                      // Append error to existing message
                      if (lastMessage.content) {
                        lastMessage.content += '\n\n' + errorMessage;
                      } else {
                        lastMessage.content = errorMessage;
                      }
                      if (!lastMessage.contentBlocks) {
                        lastMessage.contentBlocks = [];
                      }
                      lastMessage.contentBlocks.push({ type: 'text', text: errorMessage });
                      // Clear pending tool calls to avoid leaking into later messages
                      pendingToolCalls.value = [];
                    }

                    // Reset streaming state
                    currentTextSegment.value = '';

                    // Save error message to history
                    await saveToHistory();
                    await scrollToBottom();

                    // Stop processing further as error occurred
                    return;
                  }

                  // Handle complete events - complete any active tool call and flush navigation
                  if (data && data.type === 'complete') {
                    // Capture trace_id for feedback correlation
                    if (data.trace_id) {
                      lastTraceId.value = data.trace_id;
                    }
                    if (activeToolCall.value) {
                      const completedToolBlock: ContentBlock = {
                        type: 'tool_call',
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context
                      };
                      let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant') {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                      activeToolCall.value = null;
                    }

                    await scrollToBottom();
                    continue;
                  }

                  // Handle tool_result events - enrich tool call with result data
                  if (data && data.type === 'tool_result') {
                    const resultData = {
                      success: data.success !== false,
                      resultMessage: data.message || '',
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
                        data
                      );
                    }

                    // If active tool call matches, complete it with result data
                    if (activeToolCall.value && activeToolCall.value.tool === data.tool) {
                      const completedToolBlock: ContentBlock = {
                        type: 'tool_call',
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context,
                        ...resultData,
                        ...(navigationAction && { navigationAction })
                      };
                      let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant') {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                      activeToolCall.value = null;
                    } else {
                      // Tool was already completed — retroactively enrich the matching block
                      const lastMessage = chatMessages.value[chatMessages.value.length - 1];
                      if (lastMessage && lastMessage.contentBlocks) {
                        for (let i = lastMessage.contentBlocks.length - 1; i >= 0; i--) {
                          const block = lastMessage.contentBlocks[i];
                          if (block.type === 'tool_call' && block.tool === data.tool && block.success === undefined) {
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
                        if (block.type === 'tool_call' && block.tool === data.tool && block.success === undefined) {
                          Object.assign(block, resultData);
                          break;
                        }
                      }
                    }
                    await scrollToBottom();
                    continue;
                  }

                  // Handle navigation_action events - check auto navigation setting
                  // (clickable buttons on tool results are generated by frontend from tool_result data)
                  if (data && data.type === 'navigation_action') {
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
                        type: 'tool_call',
                        tool: 'navigation_action',
                        message: data.label || 'Navigate',
                        context: { navAction },
                        pendingConfirmation: true,
                        confirmationMessage: data.label,
                        confirmationArgs: data.target || {},
                      };
                      activeToolCall.value = null;

                      let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant') {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(confirmBlock);
                      } else {
                        chatMessages.value.push({
                          role: 'assistant',
                          content: '',
                          contentBlocks: [...pendingToolCalls.value, confirmBlock],
                        });
                        pendingToolCalls.value = [];
                      }

                      // Set pending confirmation with navigation action data
                      pendingConfirmation.value = {
                        tool: 'navigation_action',
                        args: data.target || {},
                        message: data.label || 'Navigate',
                      };

                      // Store the navigation action for later execution
                      pendingConfirmation.value.navAction = navAction;

                      await scrollToBottom();
                    }
                    continue;
                  }

                  // Handle error events - stream-level errors
                  if (data && data.type === 'error') {
                    // Complete any active tool call as failed
                    if (activeToolCall.value) {
                      const failedToolBlock: ContentBlock = {
                        type: 'tool_call',
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context,
                        success: false,
                        resultMessage: data.message || 'Tool execution failed',
                        errorType: data.error_type || undefined,
                        suggestion: data.suggestion || undefined,
                      };
                      let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant') {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(failedToolBlock);
                      } else {
                        pendingToolCalls.value.push(failedToolBlock);
                      }
                      activeToolCall.value = null;
                    }

                    // Add inline error block
                    const errorBlock: ContentBlock = {
                      type: 'error',
                      message: data.message || 'An error occurred',
                      errorType: data.error_type || undefined,
                      suggestion: data.suggestion || undefined,
                      recoverable: data.recoverable ?? undefined,
                    };
                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(errorBlock);
                    } else {
                      chatMessages.value.push({
                        role: 'assistant',
                        content: '',
                        contentBlocks: [...pendingToolCalls.value, errorBlock]
                      });
                      pendingToolCalls.value = [];
                    }
                    messageComplete = true;
                    await scrollToBottom();
                    continue;
                  }

                  // Handle message content (type === 'message' or legacy format with just content)
                  if (data && typeof data.content === 'string') {
                    // Complete any active tool call first (add green checkmark to chat)
                    if (activeToolCall.value) {
                      const completedToolBlock: ContentBlock = {
                        type: 'tool_call',
                        tool: activeToolCall.value.tool,
                        message: activeToolCall.value.message,
                        context: activeToolCall.value.context
                      };
                      let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                      if (lastMessage && lastMessage.role === 'assistant') {
                        if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                        lastMessage.contentBlocks.push(completedToolBlock);
                      } else {
                        pendingToolCalls.value.push(completedToolBlock);
                      }
                      activeToolCall.value = null;
                    }

                    // Format code blocks with proper line breaks
                    let content = data.content;
                    content = content.replace(/```(\w*)\s*([^`])/g, '```$1\n$2');
                    content = content.replace(/([^`])\s*```/g, '$1\n```');

                    // Add newline separator if starting a new text segment after tool call
                    if (currentStreamingMessage.value && currentTextSegment.value === '') {
                      currentStreamingMessage.value += '\n\n';
                    }
                    // Add newline between consecutive message events if needed
                    // (when current content doesn't end with newline and new content doesn't start with newline)
                    else if (currentStreamingMessage.value &&
                             !currentStreamingMessage.value.endsWith('\n') &&
                             !content.startsWith('\n')) {
                      currentStreamingMessage.value += '\n\n';
                      currentTextSegment.value += '\n\n';
                    }

                    // Accumulate to both total content and current segment
                    currentStreamingMessage.value += content;
                    currentTextSegment.value += content;

                    // Start typewriter animation if not already running
                    if (!typewriterAnimationId.value) {
                      animateStreamingText();
                    }

                    // Get or create assistant message
                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (!lastMessage || lastMessage.role !== 'assistant') {
                      // Create new assistant message with pending tool calls + text
                      chatMessages.value.push({
                        role: 'assistant',
                        content: currentStreamingMessage.value,
                        contentBlocks: [...pendingToolCalls.value, { type: 'text', text: currentTextSegment.value }]
                      });
                      pendingToolCalls.value = []; // Clear pending
                      // Save immediately when assistant message is first created to prevent data loss on reload
                      await throttledStreamingSave(true);
                    } else {
                      // Update existing assistant message's total content
                      lastMessage.content = currentStreamingMessage.value;

                      // Update or add text block in contentBlocks
                      if (!lastMessage.contentBlocks) {
                        lastMessage.contentBlocks = [];
                      }

                      // Find the last text block and update it, or create new one
                      const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
                      if (lastBlock && lastBlock.type === 'text') {
                        // Append to existing text block (same segment)
                        lastBlock.text = currentTextSegment.value;
                      } else {
                        // Add new text block (after tool call - new segment)
                        lastMessage.contentBlocks.push({ type: 'text', text: currentTextSegment.value });
                      }
                      // Throttled save during streaming to preserve progress
                      await throttledStreamingSave();
                    }
                    messageComplete = true;
                    await scrollToBottom();
                  }
                } catch (jsonError) {
                  console.debug('JSON parse error:', jsonError, 'for line:', jsonStr);
                  continue;
                }
              } catch (e) {
                console.debug('Error processing line:', e, 'Line:', line);
                continue;
              }
            }
          }
        }

        // Process any remaining complete data in buffer
        if (buffer.trim()) {
          const lines = buffer.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('data: ')) {
              try {
                const jsonStr = line.substring(line.indexOf('{'));
                if (!jsonStr || !jsonStr.trim()) continue;

                const data = JSON.parse(jsonStr);

                // Handle title events - AI-generated chat title from first message
                if (data && data.type === 'title') {
                  aiGeneratedTitle.value = data.title;
                  animateTitle(data.title);
                  continue;
                }

                // Handle tool_call events - show spinner, don't add to chat yet
                if (data && data.type === 'tool_call') {
                  // If there's already an active tool call, complete it first
                  if (activeToolCall.value) {
                    const completedToolBlock: ContentBlock = {
                      type: 'tool_call',
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context
                    };
                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                  }

                  // Set new active tool call (shows spinner indicator)
                  activeToolCall.value = {
                    tool: data.tool,
                    message: data.message,
                    context: data.context || {}
                  };

                  // Finalize any in-progress text block before resetting
                  if (currentTextSegment.value) {
                    const lm = chatMessages.value[chatMessages.value.length - 1];
                    if (lm && lm.role === 'assistant' && lm.contentBlocks) {
                      const lb = lm.contentBlocks[lm.contentBlocks.length - 1];
                      if (lb && lb.type === 'text') {
                        lb.text = currentTextSegment.value;
                      }
                    }
                  }
                  if (typewriterAnimationId.value) {
                    cancelAnimationFrame(typewriterAnimationId.value);
                    typewriterAnimationId.value = null;
                  }
                  currentTextSegment.value = '';
                  displayedStreamingContent.value = '';
                  continue;
                }

                // Handle error events - display error message to user
                if (data && data.type === 'error') {
                  // Complete any active tool call first
                  let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                  if (activeToolCall.value) {
                    const completedToolBlock: ContentBlock = {
                      type: 'tool_call',
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context
                    };
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                    activeToolCall.value = null;
                  }

                  // Format error message with suggestion if available
                  // Handle case where error/message might be an object instead of string
                  const rawError = data.error ?? data.message ?? 'An unexpected error occurred';
                  const errorText = typeof rawError === 'string' ? rawError : JSON.stringify(rawError, null, 2);

                  let errorMessage = `Error: ${errorText}`;
                  if (data.suggestion) {
                    errorMessage += `\n\n${data.suggestion}`;
                  }

                  // Get or create assistant message for error (reuse lastMessage)
                  lastMessage = chatMessages.value[chatMessages.value.length - 1];
                  if (!lastMessage || lastMessage.role !== 'assistant') {
                    chatMessages.value.push({
                      role: 'assistant',
                      content: errorMessage,
                      contentBlocks: [...pendingToolCalls.value, { type: 'text', text: errorMessage }]
                    });
                    pendingToolCalls.value = [];
                  } else {
                    // Append error to existing message
                    if (lastMessage.content) {
                      lastMessage.content += '\n\n' + errorMessage;
                    } else {
                      lastMessage.content = errorMessage;
                    }
                    if (!lastMessage.contentBlocks) {
                      lastMessage.contentBlocks = [];
                    }
                    lastMessage.contentBlocks.push({ type: 'text', text: errorMessage });
                    // Clear pending tool calls to avoid leaking into later messages
                    pendingToolCalls.value = [];
                  }

                  // Reset streaming state
                  currentTextSegment.value = '';

                  // Save error message to history
                  await saveToHistory();
                  await scrollToBottom();

                  // Stop processing further as error occurred
                  return;
                }

                // Handle complete events - complete any active tool call
                if (data && data.type === 'complete') {
                  // Capture trace_id for feedback correlation
                  if (data.trace_id) {
                    lastTraceId.value = data.trace_id;
                  }
                  if (activeToolCall.value) {
                    const completedToolBlock: ContentBlock = {
                      type: 'tool_call',
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context
                    };
                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                    activeToolCall.value = null;
                  }
                  continue;
                }

                // Handle error events - stream-level errors
                if (data && data.type === 'error') {
                  if (activeToolCall.value) {
                    const failedToolBlock: ContentBlock = {
                      type: 'tool_call',
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context,
                      success: false,
                      resultMessage: data.message || 'Tool execution failed',
                      errorType: data.error_type || undefined,
                      suggestion: data.suggestion || undefined,
                    };
                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(failedToolBlock);
                    } else {
                      pendingToolCalls.value.push(failedToolBlock);
                    }
                    activeToolCall.value = null;
                  }

                  const errorBlock: ContentBlock = {
                    type: 'error',
                    message: data.message || 'An error occurred',
                    errorType: data.error_type || undefined,
                    suggestion: data.suggestion || undefined,
                    recoverable: data.recoverable ?? undefined,
                  };
                  let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
                    if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                    lastMessage.contentBlocks.push(errorBlock);
                  } else {
                    chatMessages.value.push({
                      role: 'assistant',
                      content: '',
                      contentBlocks: [...pendingToolCalls.value, errorBlock]
                    });
                    pendingToolCalls.value = [];
                  }
                  messageComplete = true;
                  continue;
                }

                // Handle message content
                if (data && typeof data.content === 'string') {
                  // Complete any active tool call first (add green checkmark to chat)
                  if (activeToolCall.value) {
                    const completedToolBlock: ContentBlock = {
                      type: 'tool_call',
                      tool: activeToolCall.value.tool,
                      message: activeToolCall.value.message,
                      context: activeToolCall.value.context
                    };
                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.contentBlocks) lastMessage.contentBlocks = [];
                      lastMessage.contentBlocks.push(completedToolBlock);
                    } else {
                      pendingToolCalls.value.push(completedToolBlock);
                    }
                    activeToolCall.value = null;
                  }

                  let content = data.content;
                  content = content.replace(/```(\w*)\s*([^`])/g, '```$1\n$2');
                  content = content.replace(/([^`])\s*```/g, '$1\n```');

                  // Add newline separator if starting a new text segment after tool call
                  if (currentStreamingMessage.value && currentTextSegment.value === '') {
                    currentStreamingMessage.value += '\n\n';
                  }
                  // Add newline between consecutive message events if needed
                  else if (currentStreamingMessage.value &&
                           !currentStreamingMessage.value.endsWith('\n') &&
                           !content.startsWith('\n')) {
                    currentStreamingMessage.value += '\n\n';
                    currentTextSegment.value += '\n\n';
                  }

                  currentStreamingMessage.value += content;
                  currentTextSegment.value += content;

                  // Start typewriter animation if not already running
                  if (!typewriterAnimationId.value) {
                    animateStreamingText();
                  }

                  let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                  if (!lastMessage || lastMessage.role !== 'assistant') {
                    chatMessages.value.push({
                      role: 'assistant',
                      content: currentStreamingMessage.value,
                      contentBlocks: [...pendingToolCalls.value, { type: 'text', text: currentTextSegment.value }]
                    });
                    pendingToolCalls.value = [];
                    await throttledStreamingSave(true);
                  } else {
                    lastMessage.content = currentStreamingMessage.value;

                    if (!lastMessage.contentBlocks) {
                      lastMessage.contentBlocks = [];
                    }
                    const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
                    if (lastBlock && lastBlock.type === 'text') {
                      lastBlock.text = currentTextSegment.value;
                    } else {
                      lastMessage.contentBlocks.push({ type: 'text', text: currentTextSegment.value });
                    }
                    await throttledStreamingSave();
                  }
                  messageComplete = true;
                  await scrollToBottom();
                }
              } catch (e) {
                console.debug('Error processing remaining buffer:', e);
                continue;
              }
            }
          }
        }

        // If we completed a message, save to history
        if (messageComplete) {
          // Immediately show all remaining text and stop typewriter animation
          displayedStreamingContent.value = currentTextSegment.value;
          if (typewriterAnimationId.value) {
            cancelAnimationFrame(typewriterAnimationId.value);
            typewriterAnimationId.value = null;
          }
          // Update final text in contentBlocks
          const lastMessage = chatMessages.value[chatMessages.value.length - 1];
          if (lastMessage && lastMessage.role === 'assistant' && lastMessage.contentBlocks) {
            const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
            if (lastBlock && lastBlock.type === 'text') {
              lastBlock.text = currentTextSegment.value;
            }
          }
          await saveToHistory();
        }
      } catch (error) {
        // Handle different types of errors appropriately
        if (error instanceof Error && error.name === 'AbortError') {
          // Request was cancelled by user - this is expected behavior, not an error
          return; // Exit gracefully without logging as error
        } else {
          // Genuine error occurred during stream processing
          console.error('Error reading stream:', error);
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
          currentChatId.value
        );

        // Update current chat ID if this is a new chat
        if (!currentChatId.value && chatId) {
          currentChatId.value = chatId;

          // Apply pending auto navigation preference to the new chat
          if (pendingAutoNavigation.value) {
            autoNavigationPreferences.value.set(chatId, true);
            saveAutoNavigationPreferences();
          }
        }
      } catch (error) {
        console.error('Error saving chat history:', error);
      } finally {
        saveHistoryLoading.value = false;
      }
    };

    /**
     * Throttled save for streaming - saves at most every STREAMING_SAVE_INTERVAL ms
     * This prevents data loss if the user reloads the page during streaming
     * @param force - If true, saves immediately regardless of throttle (used for first assistant message)
     */
    const throttledStreamingSave = async (force: boolean = false) => {
      const now = Date.now();
      if (force || (now - lastStreamingSaveTime.value >= STREAMING_SAVE_INTERVAL)) {
        lastStreamingSaveTime.value = now;
        await saveToHistory();
      }
    };

    const loadHistory = async () => {
      try {
        // Load history using the composable (automatically prunes to 100 items)
        const history = await dbLoadHistory();
        chatHistory.value = history;
        return chatHistory.value;
      } catch (error) {
        console.error('Error loading chat history:', error);
        return [];
      }
    };

    const addNewChat = () => {
      chatMessages.value = [];
      currentChatId.value = null;
      currentSessionId.value = null; // Will be generated on first save
      lastTraceId.value = null; // Reset trace correlation for new chat
      showHistory.value = false;
      currentChatTimestamp.value = null;
      shouldAutoScroll.value = true; // Reset auto-scroll for new chat
      resetTitleState(); // Clear AI-generated title for new chat
      resetTypewriterState(); // Clear typewriter animation state for new chat
      pendingAutoNavigation.value = false; // Reset auto navigation for new chat
      showScrollToBottom.value = false; // Reset scroll-to-bottom button for new chat
      store.dispatch('setCurrentChatTimestamp', null);
      store.dispatch('setChatUpdated', true);
    };

    const openHistory = async () => {
      showHistory.value = true;
      await loadHistory();
    };

    const openEditTitleDialog = () => {
      editingTitle.value = displayedTitle.value || '';
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
        console.error('Error updating chat title:', error);
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
        console.error('Error deleting chat:', error);
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
                block.resultMessage = 'Action cancelled by user';
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
      if (pendingConfirmation.value?.tool === 'navigation_action') {
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ approved: true }),
          }
        );
      } catch (error) {
        console.error('Error confirming action:', error);
      }
      pendingConfirmation.value = null;
    };

    const handleToolCancel = async () => {
      resolveConfirmationBlock(false);

      // Check if this is a navigation action
      if (pendingConfirmation.value?.tool === 'navigation_action') {
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ approved: false }),
          }
        );
      } catch (error) {
        console.error('Error cancelling action:', error);
      }
      pendingConfirmation.value = null;
    };

    const handleToolAlwaysConfirm = async () => {
      // Enable auto navigation for this chat
      isAutoNavigationEnabled.value = true;

      // Then proceed with confirmation
      resolveConfirmationBlock(true);

      // Check if this is a navigation action
      if (pendingConfirmation.value?.tool === 'navigation_action') {
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ approved: true }),
          }
        );
      } catch (error) {
        console.error('Error confirming action:', error);
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
    const generateNavigationFromToolResult = (toolName: string, callArgs: any, responseBody: any): NavigationAction | null => {
      if (!callArgs) {
        return null;
      }

      // Pattern 1: Search tools (has SQL query) → load_query navigation
      const requestBody = callArgs.request_body || {};
      const query = requestBody.query || {};
      const sql = query.sql || '';

      if (sql) {
        const streamType = callArgs.stream_type || 'logs';
        let streamName = callArgs.stream_name || '';

        // If stream_name is not in callArgs, try to extract it from the SQL query
        if (!streamName) {
          // Extract stream name from FROM clause (handles quoted and unquoted table names)
          const fromMatch = sql.match(/FROM\s+["']?([^"'\s,()]+)["']?/i);
          if (fromMatch) {
            streamName = fromMatch[1];
          }
        }

        const vrlFunction = query.functionContent || requestBody.function || requestBody.functionContent;

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
          stream: streamName.split(','),
        };

        if (vrlFunction) {
          target.functionContent = vrlFunction;
        }

        return {
          resource_type: streamType,
          action: 'load_query',
          label: `View in ${streamType.charAt(0).toUpperCase() + streamType.slice(1)}`,
          target
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
          if (typeof responseData === 'string') {
            try {
              responseData = JSON.parse(responseData);
            } catch (e) {
              console.warn('[Navigation] Failed to parse response string:', e);
            }
          }
          // Extract from versioned response (v8, v7, etc.) for dashboards
          if (typeof responseData === 'object' && responseData !== null) {
            parsedResponse = responseData.v8 || responseData.v7 || responseData.v6 || responseData.v5 || responseData;
          } else {
            parsedResponse = responseData;
          }
        }
        // If responseBody has 'content' array (MCP format)
        else if (responseBody.content && Array.isArray(responseBody.content) && responseBody.content[0]?.text) {
          try {
            const textContent = responseBody.content[0].text;
            const parsed = JSON.parse(textContent);
            // Extract from versioned response (v8, v7, etc.)
            parsedResponse = parsed.v8 || parsed.v7 || parsed.v6 || parsed.v5 || parsed;
          } catch (e) {
            console.warn('[Navigation] Failed to parse content text:', e);
          }
        }
        // Otherwise use responseBody as-is
        else {
          parsedResponse = responseBody;
        }
      }

      // Merge data from parsed response, call args, and call args request_body for ID/field lookup
      const requestBodyFromArgs = (callArgs || {}).request_body || {};
      const data = { ...parsedResponse, ...(callArgs || {}), ...requestBodyFromArgs };

      // Standard pattern: {resource}_id (e.g., alert_id, dashboard_id, pipeline_id)
      const resourceIdField = `${resourceType}_id`;
      let resourceId = data[resourceIdField] || data.id;

      // Also check camelCase variants (dashboardId, alertId)
      if (!resourceId) {
        const camelCaseField = resourceType + 'Id';
        resourceId = data[camelCaseField];
      }

      if (!resourceId) {
        return null;
      }

      // Build target with consistent {resource}_id pattern
      const target: any = {
        [resourceIdField]: resourceId  // e.g., alert_id, dashboard_id, pipeline_id
      };

      // Add name if available (required for some resources like alerts)
      const name = data.name;
      if (name) {
        target.name = name;
      }

      // Add folder if available (default to 'default' for resources that use folders)
      const folder = data.folder;
      if (folder || resourceType === 'alert' || resourceType === 'dashboard') {
        target.folder = folder || 'default';
      }

      return {
        resource_type: resourceType,
        action: 'navigate_direct',
        label: `View ${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}`,
        target
      };
    };

    const handleNavigationAction = async (action: NavigationAction) => {
      // Helper to encode strings for URL (same as search history)
      const encodeForUrl = (str: string) => btoa(unescape(encodeURIComponent(str)));

      // Extract page name for success message
      let pageName = action.label || '';
      if (!pageName) {
        // Fallback: use target name or resource type
        pageName = action.target.name ||
                   action.resource_type.charAt(0).toUpperCase() + action.resource_type.slice(1);
      }

      // Perform navigation FIRST
      if (action.action === 'load_query') {
        const targetPath = `/${action.resource_type}`;
        const target = action.target;

        // Build query object similar to SearchHistory goToLogs function
        const queryParams: Record<string, string> = {
          org_identifier: store.state.selectedOrganization.identifier,
          stream_type: action.resource_type, // logs, metrics, traces
          refresh: '0',
          sql_mode: target.sql_mode?.toString() || 'false',
          quick_mode: 'false',
          show_histogram: 'true',
          type: 'ai_chat_query',
        };

        // Add stream (comma-separated if array)
        if (target.stream) {
          queryParams.stream = Array.isArray(target.stream)
            ? target.stream.join(',')
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
          queryParams.query = encodeForUrl(target.query);
        }

        // Add VRL function if present
        if (target.functionContent) {
          queryParams.functionContent = encodeForUrl(target.functionContent);
          queryParams.fn_editor = 'true';
        } else {
          queryParams.fn_editor = 'false';
        }

        // Navigate using same pattern as search history
        await router.push({
          path: targetPath,
          query: queryParams
        });

      } else if (action.action === 'navigate_direct') {
        // Direct navigation - build proper URLs based on resource type
        let path = action.target.path || `/${action.resource_type}`;
        const queryParams: Record<string, string> = {
          org_identifier: store.state.selectedOrganization.identifier,
          ...action.target.query
        };

        // Resource-type-specific URL handling
        if (action.resource_type === 'alert') {
          path = '/alerts';
          const alertId = action.target.alert_id || action.target.query?.alert_id;
          if (alertId) {
            // Navigate to specific alert with update action
            queryParams.action = 'update';
            queryParams.alert_id = alertId;
            queryParams.name = action.target.name || action.target.query?.name;
          }
          queryParams.folder = action.target.folder || action.target.query?.folder || 'default';
        } else if (action.resource_type === 'dashboard') {
          // Dashboards use /dashboards/view path
          path = '/dashboards/view';
          queryParams.dashboard = action.target.dashboard_id || action.target.dashboardId || action.target.query?.dashboardId;
          queryParams.folder = action.target.folder || action.target.query?.folder || 'default';
          queryParams.tab = action.target.tab || 'tab-1';
          queryParams.refresh = 'Off';
          queryParams.period = '15m';
          queryParams.print = 'false';
        } else if (action.resource_type === 'pipeline') {
          // Pipelines use /pipeline/pipelines/edit path
          path = '/pipeline/pipelines/edit';
          queryParams.id = action.target.pipeline_id || action.target.id || action.target.query?.id;
          queryParams.name = action.target.name || action.target.query?.name;
        }

        await router.push({ path, query: queryParams });
      }

      // Use setTimeout to add message AFTER navigation fully completes and settles
      setTimeout(async () => {
        try {
          // Add success message AFTER navigation completes
          const successMessage = `Successfully navigated to ${pageName}`;
          let lastMessage = chatMessages.value[chatMessages.value.length - 1];

          if (!lastMessage || lastMessage.role !== 'assistant') {
            // Create new assistant message
            chatMessages.value.push({
              role: 'assistant',
              content: successMessage,
              contentBlocks: [{ type: 'text', text: successMessage }]
            });
          } else {
            // Append to existing assistant message
            if (lastMessage.content) {
              lastMessage.content += '\n\n' + successMessage;
            } else {
              lastMessage.content = successMessage;
            }
            if (!lastMessage.contentBlocks) {
              lastMessage.contentBlocks = [];
            }
            lastMessage.contentBlocks.push({ type: 'text', text: successMessage });
          }

          // Save to history after adding message
          await saveToHistory();
          await scrollToBottom();
        } catch (error) {
          console.error('Error adding navigation success message:', error);
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
        console.error('Error clearing all conversations:', error);
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

        // Load chat using the composable
        const chat = await dbLoadChat(chatId);

        if (chat) {
          // Ensure messages are properly formatted (including contentBlocks and images)
          const formattedMessages = chat.messages.map((msg: any) => ({
            role: msg.role,
            content: msg.content,
            ...(msg.contentBlocks ? { contentBlocks: msg.contentBlocks } : {}),
            ...(msg.images ? { images: msg.images } : {})
          }));

          chatMessages.value = formattedMessages;
          currentChatId.value = chatId;
          currentSessionId.value = chat.sessionId || null; // Restore session ID from history
          showHistory.value = false;
          shouldAutoScroll.value = true; // Reset auto-scroll when loading chat

          // Load title from history (no animation for existing chats)
          displayedTitle.value = chat.title || '';
          aiGeneratedTitle.value = chat.title || null;
          isTypingTitle.value = false;

          if (chatId !== store.state.currentChatTimestamp) {
            store.dispatch('setCurrentChatTimestamp', chatId);
            store.dispatch('setChatUpdated', true);
          }

          // Scroll to bottom after loading chat
          await nextTick(() => {
            scrollToBottom();
          });
        }
      } catch (error) {
        console.error('Error loading chat:', error);
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
      if (chatInput.value && typeof chatInput.value.getMessageForBackend === 'function') {
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
        role: 'user',
        content: backendMessage, // Use backend message with full context
        ...(hasImages && { images: messagesToSend })
      });
      inputMessage.value = '';
      contextReferences.value = []; // Clear reference chips
      if (chatInput.value && typeof chatInput.value.clear === 'function') {
        chatInput.value.clear(); // Clear the rich text input
      }
      clearPendingImages(); // Clear pending images after capturing
      shouldAutoScroll.value = true; // Reset auto-scroll for new message
      await scrollToBottom(); // Scroll after user message
      await saveToHistory(); // Save after user message

      isLoading.value = true;
      currentStreamingMessage.value = '';
      currentTextSegment.value = '';
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
            hasImages ? messagesToSend : undefined // images for multimodal queries
          );
        } catch (error) {
          console.error('Error fetching AI chat:', error);
          return;
        }

        // Check if request was cancelled before processing response
        if (response && response.cancelled) {
          return;
        }

        if (!response.ok) {
          throw response;
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        await processStream(reader);

        store.dispatch('setCurrentChatTimestamp', currentChatId.value);
        store.dispatch('setChatUpdated', true);
        
      } catch (error: any) {
        // Remove the empty assistant message that was added before the error
        //this will impact in the case of error showing empty message above the error message in the chat
        if (chatMessages.value.length > 0 && chatMessages.value[chatMessages.value.length - 1].role === 'assistant' && !chatMessages.value[chatMessages.value.length - 1].content) {
          chatMessages.value.pop();
        }
        let errorMessage = 'Error: Unable to get response from the server. Please try again later.';
        //we need to handle the 403 error seperately and show the error message to the user
        if (error.status === 403) {
          chatMessages.value.push({
            role: 'assistant',
            content: 'Unauthorized Access: You are not authorized to perform this operation, please contact your administrator.'
          });
        } else {
          // Always create a new assistant message with error since we don't pre-create empty ones
          chatMessages.value.push({
            role: 'assistant',
            content: errorMessage
          });
        }
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
      inputMessage.value = capability.replace(/^\d+\.\s/, '');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent the default enter behavior
        sendMessage();
      } else if (e.key === 'Backspace') {
        // Handle backspace for RichTextInput (contenteditable)
        const target = e.target as HTMLElement;
        const contenteditable = target.closest('[contenteditable="true"]') || target.querySelector('[contenteditable="true"]');

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
            if (prevSibling && (prevSibling as Element).classList?.contains('image-reference')) {
              imageRefSpan = prevSibling as Element;
            }
          }
          // Case 2: Cursor is in an element node, check the child before cursor
          else if (cursorNode.nodeType === Node.ELEMENT_NODE && range.startOffset > 0) {
            const element = cursorNode as Element;
            const prevChild = element.childNodes[range.startOffset - 1];
            if (prevChild && (prevChild as Element).classList?.contains('image-reference')) {
              imageRefSpan = prevChild as Element;
            }
          }

          // If we found an image reference to delete
          if (imageRefSpan) {
            e.preventDefault();

            // Extract filename from the span text
            const refText = imageRefSpan.textContent || '';
            const match = refText.match(/@\[([^\]]+)\]/);

            if (match) {
              const filename = match[1];

              // Remove the associated image from pendingImages
              const imageIndex = pendingImages.value.findIndex(img => img.filename === filename);
              if (imageIndex !== -1) {
                pendingImages.value.splice(imageIndex, 1);
              }
            }

            // Remove the span element
            imageRefSpan.remove();

            // Trigger input event to update model
            if (contenteditable) {
              contenteditable.dispatchEvent(new Event('input', { bubbles: true }));
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
            const imageIndex = pendingImages.value.findIndex(img => img.filename === filename);
            if (imageIndex !== -1) {
              pendingImages.value.splice(imageIndex, 1);
            }

            // Set cursor position after the deletion
            nextTick(() => {
              textarea.selectionStart = textarea.selectionEnd = refStart;
            });
          }
        }
      } else if (e.key === 'ArrowUp') {
        const target = e.target as HTMLElement;
        const textarea = target.tagName === 'TEXTAREA' ? target as HTMLTextAreaElement : null;
        if (textarea && isOnFirstLine(textarea)) {
          e.preventDefault();
          navigateHistory('up');
        }
      } else if (e.key === 'ArrowDown' && historyIndex.value > -1) {
        e.preventDefault();
        navigateHistory('down');
      }
    };

    // Check if cursor is on the first line of textarea
    const isOnFirstLine = (textarea: HTMLTextAreaElement) => {
      if (!textarea) return false;
      
      const cursorPosition = textarea.selectionStart;
      const textBeforeCursor = textarea.value.substring(0, cursorPosition);
      
      // Check if there are any newlines before cursor position
      return !textBeforeCursor.includes('\n');
    };

    // Navigate through query history
    const navigateHistory = (direction: 'up' | 'down') => {
      if (queryHistory.value.length === 0) return;
      
      if (direction === 'up') {
        if (historyIndex.value < queryHistory.value.length - 1) {
          historyIndex.value++;
          inputMessage.value = queryHistory.value[historyIndex.value];
        }
      } else if (direction === 'down') {
        if (historyIndex.value > 0) {
          historyIndex.value--;
          inputMessage.value = queryHistory.value[historyIndex.value];
        } else if (historyIndex.value === 0) {
          historyIndex.value = -1;
          inputMessage.value = '';
        }
      }
    };

    const focusInput = () => {
      if (chatInput.value) {
        // For RichTextInput component, call its focusInput method
        if (typeof chatInput.value.focusInput === 'function') {
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
      input.value = '';
    };

    const addImage = async (file: File): Promise<boolean> => {
      // Validate file size first (before reading)
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        $q.notify({
          type: 'negative',
          message: `Image exceeds 2MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
          position: 'top'
        });
        return false;
      }

      // Basic file type check for immediate feedback (backend will detect actual type)
      if (!ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
        $q.notify({
          type: 'negative',
          message: 'Only PNG and JPEG images are supported',
          position: 'top'
        });
        return false;
      }

      // Convert to base64
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = (e.target?.result as string).split(',')[1]; // Remove data:image/...;base64, prefix
          const imageRef = `@[${file.name}]`;

          // Use file.type for display - backend will detect and correct actual mime type
          pendingImages.value.push({
            data: base64,
            mimeType: file.type as 'image/png' | 'image/jpeg',
            filename: file.name,
            size: file.size
          });

          // Insert image reference at cursor position
          // Check if we're using RichTextInput (contenteditable)
          const contenteditable = chatInput.value?.$el?.querySelector('[contenteditable="true"]') ||
                                   chatInput.value?.$el?.querySelector('.rich-text-input');

          if (contenteditable) {
            // RichTextInput - insert at cursor position in contenteditable
            const selection = window.getSelection();
            const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

            // Create a non-editable span for the image reference
            const imageRefSpan = document.createElement('span');
            imageRefSpan.contentEditable = 'false';
            imageRefSpan.className = 'image-reference';
            imageRefSpan.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; margin: 0 2px; background: #e8f5e9; border: 1px solid #a5d6a7; border-radius: 4px; font-size: 13px; color: #2e7d32; user-select: none;';

            // Add image icon
            const imageIcon = document.createElement('span');
            imageIcon.textContent = '🖼️';
            imageIcon.style.cssText = 'font-size: 12px;';

            // Add filename text
            const filenameText = document.createElement('span');
            filenameText.textContent = file.name;

            // Add remove button
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.style.cssText = 'display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; padding: 0; margin-left: 2px; background: transparent; border: none; border-radius: 3px; font-size: 16px; line-height: 1; cursor: pointer; color: #2e7d32; transition: all 0.15s ease;';
            removeBtn.onmouseover = () => {
              removeBtn.style.background = '#c62828';
              removeBtn.style.color = 'white';
            };
            removeBtn.onmouseout = () => {
              removeBtn.style.background = 'transparent';
              removeBtn.style.color = '#2e7d32';
            };
            removeBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();

              // Find and remove the image from pendingImages
              const imageIndex = pendingImages.value.findIndex(img => img.filename === file.name);
              if (imageIndex !== -1) {
                pendingImages.value.splice(imageIndex, 1);
              }

              // Remove the span
              imageRefSpan.remove();

              // Trigger input event
              contenteditable.dispatchEvent(new Event('input', { bubbles: true }));
            };

            imageRefSpan.appendChild(imageIcon);
            imageRefSpan.appendChild(filenameText);
            imageRefSpan.appendChild(removeBtn);

            if (range && contenteditable.contains(range.startContainer)) {
              // Insert at cursor position
              range.deleteContents();

              // Add space before if needed
              const textBefore = range.startContainer.textContent || '';
              if (textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n')) {
                range.insertNode(document.createTextNode(' '));
              }

              range.insertNode(imageRefSpan);

              // Add space after for cursor positioning
              const spaceAfter = document.createTextNode(' ');
              range.setStartAfter(imageRefSpan);
              range.insertNode(spaceAfter);

              // Move cursor after the space
              range.setStartAfter(spaceAfter);
              range.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(range);
            } else {
              // No selection or selection outside - append to end
              const spaceNeeded = contenteditable.textContent &&
                                 !contenteditable.textContent.endsWith(' ') &&
                                 !contenteditable.textContent.endsWith('\n');
              if (spaceNeeded) {
                contenteditable.appendChild(document.createTextNode(' '));
              }
              contenteditable.appendChild(imageRefSpan);
              const spaceAfter = document.createTextNode(' ');
              contenteditable.appendChild(spaceAfter);

              // Move cursor to end
              const newRange = document.createRange();
              newRange.setStartAfter(spaceAfter);
              newRange.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(newRange);
            }

            // Trigger input event to update model
            contenteditable.dispatchEvent(new Event('input', { bubbles: true }));
            focusInput();
          } else {
            // Legacy textarea fallback
            const textarea = chatInput.value?.$el?.querySelector('textarea') as HTMLTextAreaElement | null;
            if (textarea) {
              const start = textarea.selectionStart || 0;
              const end = textarea.selectionEnd || 0;
              const text = inputMessage.value;
              const before = text.substring(0, start);
              const after = text.substring(end);

              // Add space before if needed
              const needsSpaceBefore = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
              const needsSpaceAfter = after.length > 0 && !after.startsWith(' ') && !after.startsWith('\n');

              const insertion = (needsSpaceBefore ? ' ' : '') + imageRef + (needsSpaceAfter ? ' ' : '');
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
              const separator = currentText && !currentText.endsWith(' ') && !currentText.endsWith('\n') ? ' ' : '';
              inputMessage.value = currentText + separator + imageRef + ' ';
            }
          }

          resolve(true);
        };
        reader.onerror = () => {
          $q.notify({
            type: 'negative',
            message: `Failed to read image: ${file.name}`,
            position: 'top'
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
        const contenteditable = chatInput.value?.$el?.querySelector('[contenteditable="true"]') ||
                                 chatInput.value?.$el?.querySelector('.rich-text-input');

        if (contenteditable) {
          // Find and remove all image reference spans with this filename
          const imageRefSpans = contenteditable.querySelectorAll('.image-reference');
          imageRefSpans.forEach((span: Element) => {
            if (span.textContent === imageRef) {
              span.remove();
            }
          });

          // Trigger input event to update model
          contenteditable.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // Legacy textarea - remove from text
          inputMessage.value = inputMessage.value
            .replace(new RegExp(`\\s*${escapeRegExp(imageRef)}\\s*`, 'g'), ' ')
            .trim();
        }
      }
      pendingImages.value.splice(index, 1);
    };

    // Helper to escape special regex characters
    const escapeRegExp = (str: string) => {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        if (file.type.startsWith('image/')) {
          await addImage(file);
        }
      }
    };

    // Handle paste for images
    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
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

    // Scroll input textarea to bottom to show latest appended content
    const scrollInputToBottom = () => {
      // Clear any pending scroll timeout
      if (scrollTimeoutId.value !== null) {
        clearTimeout(scrollTimeoutId.value);
      }

      // Set new timeout for scroll
      scrollTimeoutId.value = setTimeout(() => {
        const textarea = chatInput.value?.$el?.querySelector('textarea');
        if (!textarea) return;

        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        // Scroll all scrollable parent elements
        let element = textarea;
        while (element && element !== document.body) {
          if (element.scrollHeight > element.clientHeight) {
            element.scrollTop = element.scrollHeight;
          }
          element = element.parentElement;
        }

        scrollTimeoutId.value = null;
      }, 50);
    };

    // Load query history from localStorage
    const loadQueryHistory = () => {
      try {
        const stored = localStorage.getItem(HISTORY_KEY);
        if (stored) {
          queryHistory.value = JSON.parse(stored);
        }
      } catch (error) {
        console.error('Error loading query history:', error);
        queryHistory.value = [];
      }
    };

    // Save query history to localStorage
    const saveQueryHistory = () => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(queryHistory.value));
      } catch (error) {
        console.error('Error saving query history:', error);
      }
    };

    // Auto navigation preferences localStorage functions
    const AUTO_NAV_KEY = 'ai-chat-auto-navigation';

    const loadAutoNavigationPreferences = () => {
      try {
        const stored = localStorage.getItem(AUTO_NAV_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          autoNavigationPreferences.value = new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v as boolean]));
        }
      } catch (error) {
        console.error('Error loading auto navigation preferences:', error);
        autoNavigationPreferences.value = new Map();
      }
    };

    const saveAutoNavigationPreferences = () => {
      try {
        const data = Object.fromEntries(autoNavigationPreferences.value);
        localStorage.setItem(AUTO_NAV_KEY, JSON.stringify(data));
      } catch (error) {
        console.error('Error saving auto navigation preferences:', error);
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
    watch(() => props.isOpen, (newValue) => {
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
          }, 100);
        });
      }
    });

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

    onUnmounted(()=>{
      // Cancel any ongoing requests when component is unmounted to prevent memory leaks
      if (currentAbortController.value) {
        currentAbortController.value.abort();
        currentAbortController.value = null;
      }

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
      store.dispatch('setCurrentChatTimestamp', currentChatId.value);
      store.dispatch('setChatUpdated', true);      if ( store.state.currentChatTimestamp) {
        loadChat(store.state.currentChatTimestamp);
      }
      if(!store.state.currentChatTimestamp) {
        addNewChat();
      }
    })
    //this watch is added to make sure that the chat gets updated
    // when the component is unmounted so that the main layout component can load the correct chat
      watch(chatUpdated, (newChatUpdated: boolean) => {
        if (newChatUpdated && store.state.currentChatTimestamp) {
          loadChat(store.state.currentChatTimestamp);
        }
        if(newChatUpdated && !store.state.currentChatTimestamp) {
          addNewChat();
        }
        store.dispatch('setChatUpdated', false);
      });

    // Watch for typewriter animation updates to refresh the displayed text
    watch(displayedStreamingContent, (newContent) => {
      if (!isLoading.value) return;
      // Don't overwrite existing text with empty string when displayedStreamingContent
      // is reset (e.g., on tool_call). The reset signals "new segment starts" not
      // "clear previous content".
      if (!newContent) return;

      const lastMessage = chatMessages.value[chatMessages.value.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.contentBlocks) {
        const lastBlock = lastMessage.contentBlocks[lastMessage.contentBlocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text = newContent;
        }
      }
    });

    const copyToClipboard = async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        $q.notify({
          message: 'Code copied to clipboard',
          color: 'positive',
          position: 'top',
          timeout: 1000
        });
      } catch (err) {
        console.error('Failed to copy text: ', err);
        $q.notify({
          message: 'Failed to copy code',
          color: 'negative',
          position: 'top'
        });
      }
    };

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
      filtered = filtered.replace(/^## (.+)$/gm, '**$1:**');

      // Convert # headers to bold with colon (only outside code blocks)
      filtered = filtered.replace(/^# (.+)$/gm, '**$1:**');

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
        if (token.type === 'code') {
          let codeText = token.text.trim();
          while (codeText.startsWith('--') || codeText.startsWith('//') || codeText.startsWith('#')) {
            codeText = codeText.split('\n').slice(1).join('\n').trim();
          }

          const highlightedContent = token.lang && hljs.getLanguage(token.lang)
            ? DOMPurify.sanitize(hljs.highlight(codeText, { language: token.lang }).value)
            : DOMPurify.sanitize(hljs.highlightAuto(codeText).value);

          blocks.push({
            type: 'code',
            language: token.lang || '',
            content: codeText,
            highlightedContent
          });
        } else {
          blocks.push({
            type: 'text',
            content: marked.parser([token])
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
        if (token.type === 'code') {
          // Remove comments at the beginning of code blocks
          let codeText = token.text.trim();
          while (codeText.startsWith('--') || codeText.startsWith('//') || codeText.startsWith('#')) {
            codeText = codeText.split('\n').slice(1).join('\n').trim();
          }

          const highlightedContent = token.lang && hljs.getLanguage(token.lang)
            ? DOMPurify.sanitize(hljs.highlight(codeText, { language: token.lang }).value)
            : DOMPurify.sanitize(hljs.highlightAuto(codeText).value);

          blocks.push({
            type: 'code',
            language: token.lang || '',
            content: codeText,
            highlightedContent
          });
        } else {
          blocks.push({
            type: 'text',
            content: marked.parser([token])
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
        return formatted
          .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
            let cls = 'json-number';
            if (/^"/.test(match)) {
              if (/:$/.test(match)) {
                cls = 'json-key';
              } else {
                cls = 'json-string';
              }
            } else if (/true|false/.test(match)) {
              cls = 'json-boolean';
            } else if (/null/.test(match)) {
              cls = 'json-null';
            }
            return `<span class="${cls}">${match}</span>`;
          });
      } catch {
        // Not JSON, return plain text with HTML escaping
        return content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;')
          .replace(/\n/g, '<br>');
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
              type: 'text',
              text: textBefore
            });
          }
        }

        // Add the log entry
        orderedBlocks.push({
          type: 'log_entry',
          filename,
          lineStart: lineStart ? parseInt(lineStart) : undefined,
          lineEnd: lineEnd ? parseInt(lineEnd) : undefined,
          content: logContent.trim(),
          preview: createPreview(logContent.trim(), 60)
        });

        lastIndex = matchIndex + fullMatch.length;
      }

      // Add any remaining text after the last log entry
      if (lastIndex < content.length) {
        const textAfter = content.substring(lastIndex).trim();
        if (textAfter) {
          orderedBlocks.push({
            type: 'text',
            text: textAfter
          });
        }
      }

      return orderedBlocks;
    };

    const processedMessages = computed(() => {
      return chatMessages.value.map(message => {
        // For user messages, check for log entries
        if (message.role === 'user') {
          const orderedBlocks = parseLogEntries(message.content);

          // If we have ordered blocks from parsing, combine them with existing contentBlocks
          const combinedContentBlocks = orderedBlocks.length > 0
            ? [...orderedBlocks, ...(message.contentBlocks || [])]
            : message.contentBlocks || [];

          return {
            ...message,
            blocks: orderedBlocks.length > 0 ? [] : processMessageContent(message.content),
            contentBlocks: combinedContentBlocks
          };
        }

        // For assistant messages, keep as is
        return {
          ...message,
          blocks: processMessageContent(message.content),
          contentBlocks: message.contentBlocks || []
        };
      });
    });

    // Check if there's an assistant message in progress (for loading indicator positioning)
    const hasAssistantMessage = computed(() => {
      const lastMessage = chatMessages.value[chatMessages.value.length - 1];
      return lastMessage?.role === 'assistant';
    });

    const retryGeneration = async (message: any) => {
      if (!message || message.role !== 'assistant') return;
      
      // Find the index of this assistant message
      const messageIndex = chatMessages.value.findIndex(m => m.content === message.content);
      if (messageIndex === -1) return;

      // Find the corresponding user message that came before this assistant message
      let userMessageIndex = messageIndex - 1;
      while (userMessageIndex >= 0) {
        if (chatMessages.value[userMessageIndex].role === 'user') {
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
        'js': 'JavaScript',
        'javascript': 'JavaScript',
        'ts': 'TypeScript',
        'typescript': 'TypeScript',
        'python': 'Python',
        'py': 'Python',
        'sql': 'SQL',
        'vrl': 'VRL',
        'json': 'JSON',
        'html': 'HTML',
        'css': 'CSS',
        'scss': 'SCSS',
        'bash': 'Bash',
        'shell': 'Shell',
        'yaml': 'YAML',
        'yml': 'YAML',
        'markdown': 'Markdown',
        'md': 'Markdown'
      };
      
      const normalizedLang = lang.toLowerCase();
      return languageMap[normalizedLang] || lang.toUpperCase();
    };

    const processHtmlBlock = (content: string) => {
      // Sanitize HTML to prevent XSS attacks
      const sanitized = DOMPurify.sanitize(content);
      // Replace pre tags with span and add our custom class
      return sanitized.replace(/<pre([^>]*)>/g, '<span class="generated-code-block"$1>')
                     .replace(/<\/pre>/g, '</span>');
    };

    const formatTime = (timestamp: string) => {
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    // Tool call context formatting helpers
    const truncateQuery = (query: string) => {
      if (!query) return '';
      const maxLength = 100;
      if (query.length <= maxLength) return query;
      return query.substring(0, maxLength) + '...';
    };

    const formatContextKey = (key: string) => {
      // Convert snake_case to Title Case
      return key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    const formatContextValue = (value: any) => {
      if (typeof value === 'string') {
        // Truncate long strings
        if (value.length > 30) return value.substring(0, 30) + '...';
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

      return Object.keys(data).length > 0 ? data : null;
    };

    const hasToolCallDetails = (block: ContentBlock) => {
      // Show details for failed tools, successful tools with summary, tools with context data, or tools with response
      if (block.success === false) return true;
      if (block.success !== false && block.summary) return true;
      if (block.response) return true;
      return getToolCallDisplayData(block.context) !== null;
    };

    const formatToolCallMessage = (block: ContentBlock) => {
      // Show error message for failed tools
      // Tool-specific messages (both success and error)
      if (block.tool === 'testFunction') {
        if (block.success === false) {
          return { text: 'VRL validation failed', highlight: null, suffix: '' };
        }
        return { text: 'Validated VRL', highlight: null, suffix: '' };
      }
      if (block.tool === 'SearchSQL') {
        if (block.success === false) {
          return { text: 'Query failed', highlight: null, suffix: '' };
        }
        if (block.response?.total !== undefined) {
          return { text: 'Queried logs ', highlight: `(${block.response.total} results)`, suffix: '' };
        }
      }
      if (block.tool === 'StreamSchema' && block.context?.stream_name) {
        return { text: 'Fetched ', highlight: block.context.stream_name, suffix: ' stream schema' };
      }
      if (block.tool === 'GetIncident' && block.context?.incident_id) {
        return { text: 'Retrieved incident ', highlight: block.context.incident_id, suffix: '' };
      }
      if (block.tool === 'GetAlert' && block.context?.alert_id) {
        return { text: 'Fetched alert ', highlight: block.context.alert_id, suffix: '' };
      }
      if (block.tool === 'GetDashboard' && block.context?.dashboard_id) {
        return { text: 'Fetched dashboard ', highlight: block.context.dashboard_id, suffix: '' };
      }
      // Generic fallback
      if (block.success === false && block.resultMessage) {
        // Truncate long error messages for the header
        const msg = block.resultMessage.length > 60
          ? block.resultMessage.substring(0, 60) + '...'
          : block.resultMessage;
        return { text: msg, highlight: null, suffix: '' };
      }
      if (block.success !== false && block.summary?.count !== undefined) {
        const base = block.message || block.tool || 'Tool';
        return { text: base + ' ', highlight: `(${block.summary.count} results)`, suffix: '' };
      }
      return { text: block.message, highlight: null, suffix: '' };
    };

    const formatTimestamp = (timestamp: number) => {
      if (!timestamp || timestamp === 0) return 'Not specified';
      // Timestamp is in microseconds, convert to milliseconds
      const ms = timestamp > 1e15 ? timestamp / 1000 : timestamp;
      const date = new Date(ms);
      return date.toLocaleString();
    };

    const likeCodeBlock = async (messageIndex: number) => {
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId) return;
      // Each user+assistant pair = 1 query turn, so queryIndex = floor(index / 2)
      const queryIndex = Math.floor(messageIndex / 2);
      const success = await submitFeedback(
        'thumbs_up',
        orgId,
        currentSessionId.value || undefined,
        queryIndex,
        lastTraceId.value || undefined,
      );
      if (success) {
        $q.notify({ type: 'positive', message: 'Thanks for your feedback!', timeout: 1500 });
      }
    };

    const dislikeCodeBlock = async (messageIndex: number) => {
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId) return;
      const queryIndex = Math.floor(messageIndex / 2);
      const success = await submitFeedback(
        'thumbs_down',
        orgId,
        currentSessionId.value || undefined,
        queryIndex,
        lastTraceId.value || undefined,
      );
      if (success) {
        $q.notify({ type: 'positive', message: 'Thanks for your feedback!', timeout: 1500 });
      }
    };
    const o2AiTitleLogo = computed(() => {
      return store.state.theme == 'dark' ? getImageURL('images/common/o2_ai_logo_dark.svg') : getImageURL('images/common/o2_ai_logo.svg')
    });
    const getGenerateAiIcon = computed(()=> {
      return getImageURL('images/common/ai_icon_dark.svg')
    })

    const filteredChatHistory = computed(() => {
      if (!historySearchTerm.value) {
        return chatHistory.value;
      }
      const searchTerm = historySearchTerm.value.toLowerCase();
      return chatHistory.value.filter(chat => 
        chat.title.toLowerCase().includes(searchTerm)
      );
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
      showHistory,
      chatHistory,
      currentChatId,
      addNewChat,
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
      outlinedThumbUpOffAlt,
      outlinedThumbDownOffAlt,
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
      // Context references
      contextReferences,
      handleReferencesUpdate,
    }
  }
});
</script>

<style lang="scss" scoped>
.chat-container {
  width: 100%;
  height: calc(100vh - 50px);
  color: var(--q-primary-text);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 5px 1px var(--o2-hover-shadow);

  .chat-content-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: transparent;
  }



  .chat-header {
    padding: 0px 12px 4px 12px;
    display: flex;
    justify-content: space-between;
    align-items: end;
    border-bottom: 1px solid var(--q-separator-color);
    flex-shrink: 0;
    background: var(--q-page-background);
    z-index: 2;

    .chat-title {
      font-weight: bold;
    }

    .chat-title-dropdown {
      padding: 6px 12px;
      border-radius: 4px;
      transition: background-color 0.2s;
      max-width: 210px;
      height: 32px;
      min-height: 32px;
      display: flex;
      align-items: center;
      overflow: hidden;

      &:hover {
        background-color: var(--q-hover-color);
      }

      span {
        color: var(--q-primary-text);
      }

      .chat-title-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 180px;
      }
    }
  }

  // Chat session title with typewriter animation
  .chat-session-title {
    padding: 8px 16px;
    font-size: 14px;
    min-height: 32px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    border-bottom: 1px solid var(--q-separator-color);

    &.light-mode {
      color: #1a202c;
      background: linear-gradient(to right, rgba(99, 102, 241, 0.08), transparent);
    }

    &.dark-mode {
      color: #e2e8f0;
      background: linear-gradient(to right, rgba(99, 102, 241, 0.15), transparent);
    }

    .title-text {
      font-weight: 600;
    }

    .typing-cursor {
      animation: blink 0.7s infinite;
      margin-left: 2px;
      font-weight: 400;
    }
  }

  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  .chat-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: transparent;
    position: relative;
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: transparent;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
  }

  .welcome-section {
    padding: 24px;
    background: linear-gradient(to right, rgba(var(--q-primary-rgb), 0.05), rgba(var(--q-primary-rgb), 0.1));
    border-radius: 8px;
    margin-bottom: 24px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  // Fixed analyzing indicator above input
  .fixed-analyzing-indicator {
    padding: 12px 16px;
    margin: 0 16px 8px 16px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeInSlide 0.3s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);

    &.light-mode {
      background: linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 100%);
      border: 1px solid #d0d8e8;
    }

    &.dark-mode {
      background: linear-gradient(135deg, #1e2235 0%, #252a3d 100%);
      border: 1px solid #3a3f55;
    }

    .analyzing-content {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 900px;
      width: 100%;
    }

    .analyzing-message {
      font-size: 14px;
      font-weight: 500;
      color: var(--q-primary);
    }

    .tool-call-info {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
    }

    .tool-call-context-inline {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 4px;
    }

    .context-query-inline {
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.05);
      max-width: 500px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .context-tag-inline {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(var(--q-primary-rgb), 0.1);
      color: var(--q-primary);
      font-weight: 500;
    }
  }

  @keyframes fadeInSlide {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .chat-input-container {
    position: relative;
    flex-shrink: 0;
    max-width: 900px;
    width: calc(100% - 0px);
    margin: 8px auto;
    padding: 0 8px;
  }

  .unified-input-box {
    display: flex;
    flex-direction: column;
    padding: 4px 8px;
    border-radius: 12px;
    transition: all 0.2s ease;
    gap: 12px;

    &.light-mode {
      background: #ffffff;
      border: 1px solid #e4e7ec;

      &:focus-within {
        border: 1px solid transparent;
        box-shadow: 0 0 0 2px #667eea;
      }
    }

    &.dark-mode {
      background: #191919;
      border: 1px solid #323232;

      &:focus-within {
        border: 1px solid transparent;
        box-shadow: 0 0 0 2px #5a6ec3;
      }
    }

    :deep(.rich-text-input-wrapper) {
      width: 100%;
      min-height: 40px;
    }

    :deep(.rich-text-input) {
      padding: 4px 0;
    }
  }

  .input-bottom-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 8px;
  }

  .auto-nav-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.2s ease;

    .auto-nav-label {
      font-size: 12px;
      font-weight: 500;
    }

    &:hover {
      .light-mode & {
        background: #f3f4f6;
      }
      .dark-mode & {
        background: #374151;
      }
    }

    &.auto-nav-enabled {
      .auto-nav-icon {
        color: var(--q-primary) !important;
      }

      .auto-nav-label {
        color: var(--q-primary);
      }
    }

    .light-mode & .auto-nav-label {
      color: #6b7280;
    }
    .dark-mode & .auto-nav-label {
      color: #9ca3af;
    }
  }


.light-mode .message {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
.dark-mode .message {
  box-shadow: 0 1px 2px rgba(255, 255, 255, 0.1);
}
  .message {
    width: 100%;
    padding: 12px;
    border-radius: 8px;



    .message-content {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      width: 100%;
    }

    .message-blocks {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0;
      min-width: 0;
      max-width: 100%;
      overflow-x: auto;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .feedback-buttons {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-top: 4px;
      opacity: 0.5;
      transition: opacity 0.2s;

      &:hover {
        opacity: 1;
      }
    }

    .text-block {
      width: 100%;
      overflow-wrap: break-word;
      max-width: 100%;
      &:not(:last-child) {
        margin-bottom: 4px;
      }

      :deep(pre), :deep(.generated-code-block) {
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: break-word;
        margin: 0;
        padding: 0;
        line-height: 1.4;
        display: block;
        max-width: 100%;
        overflow-x: auto;
        
        code {
          padding: 8px;
          margin: 0;
          display: block;
          max-width: 100%;
        }
      }

      // Heading styles - appropriately sized for chat interface
      // Only applies within message-blocks, not globally
      :deep(h1) {
        font-size: 1.5rem !important;
        font-weight: 600 !important;
        margin: 16px 0 8px 0 !important;
        line-height: 1.3 !important;
      }
      :deep(h2) {
        font-size: 1.25rem !important;
        font-weight: 600 !important;
        margin: 14px 0 7px 0 !important;
        line-height: 1.3 !important;
      }
      :deep(h3) {
        font-size: 1.125rem !important;
        font-weight: 600 !important;
        margin: 12px 0 6px 0 !important;
        line-height: 1.3 !important;
      }
      :deep(h4) {
        font-size: 1rem !important;
        font-weight: 600 !important;
        margin: 10px 0 5px 0 !important;
        line-height: 1.3 !important;
      }
      :deep(h5) {
        font-size: 0.875rem !important;
        font-weight: 600 !important;
        margin: 8px 0 4px 0 !important;
        line-height: 1.3 !important;
      }
      :deep(h6) {
        font-size: 0.75rem !important;
        font-weight: 600 !important;
        margin: 8px 0 4px 0 !important;
        line-height: 1.3 !important;
      }

      // Table styling to prevent horizontal overflow
      :deep(table) {
        max-width: 100%;
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        overflow-x: auto;
        display: block;
        white-space: nowrap;
      }

      :deep(table th), :deep(table td) {
        padding: 8px 12px;
        border: 1px solid #e2e8f0;
        word-wrap: break-word;
        overflow-wrap: break-word;
        text-overflow: ellipsis;
        overflow: hidden;
      }

      // Force break long words and URLs
      :deep(p), :deep(div), :deep(span) {
        word-wrap: break-word;
        overflow-wrap: break-word;
        word-break: break-word;
        max-width: 100%;
      }

      // Restore list styling (Tailwind preflight removes it)
      :deep(ol) {
        list-style-type: decimal;
        padding-left: 1.5em;
        margin: 0.5em 0;
      }

      :deep(ul) {
        list-style-type: disc;
        padding-left: 1.5em;
        margin: 0.5em 0;
      }

      :deep(li) {
        margin: 0.25em 0;
      }
    }

    .code-block {
      border-radius: 4px;
      overflow: hidden;
      margin: 0;
    }
    // .light-mode .code-block{
    //   border: 1px solid #eee;
    // }
    // .dark-mode .code-block-header{
    //   border: 1px solid rgba(225, 225, 225, 0.14); 
    // }

    .code-block-header {
      padding: 4px 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .code-type-label {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(var(--q-primary-rgb), 0.1);
    }
    .light-mode .code-type-label{
      color: var(--q-primary);
    }
    .dark-mode .code-type-label{
      color: #e2e2e2;
    }

    .generated-code-block {
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: break-word;
      margin: 0;
      padding: 0;
      line-height: 1.4;
      code {
        padding: 8px;
        margin: 0;
        display: block;
        
      }
    }

    .dark-mode .generated-code-block{
      code {
        background-color: #181a1b;
        border: 0.5px solid #E1E1E124;
        border-top: none;
      }
    }
    .light-mode .generated-code-block{
      code {
        background-color: #ffffff;
        border: 0.5px solid #00000024 ;
        border-top: none;
        color: black;
      }
    }

    .code-block-footer {
      padding: 4px 8px;
      display: flex;
    }
  }
  .light-mode .message{
    &.user {
      background: linear-gradient(135deg, #f8f9ff 0%, #e8edff 100%);
      border: 1px solid #e0e6ff;
      border-radius: 12px;
      color: #2c3e50;
      margin-left: 40px;
      width: calc(100% - 40px);
    }

    &.assistant {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      color: var(--q-primary-text);
      margin-left: 0;
      width: 100%;
    }
  }
  .dark-mode .message{
    &.user {
      background: linear-gradient(135deg, #2a2d47 0%, #1e213a 100%);
      border: 1px solid #3a3d5c;
      border-radius: 12px;
      color: #e2e8f0;
      margin-left: 40px;
      width: calc(100% - 40px);
    }

    &.assistant {
      background: #1a1a1a;
      border: 1px solid #333333;
      border-radius: 12px;
      color: #e2e2e2;
      margin-left: 0;
      width: 100%;
    }
  }

  ul, ol {
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: break-word;
      margin: 0;
      padding: 0;
      code {
        background-color: white;
        color: black;
        
      }
    }
  }
}

// Avatar styling for user messages
.light-user-avatar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  color: white;
}

.dark-user-avatar {
  background: linear-gradient(135deg, #4c63d2 0%, #5a67d8 100%) !important;
  color: white;
}

// Send button gradient styling
.send-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  transition: all 0.3s ease !important;
  box-shadow: 0 4px 15px 0 rgba(102, 126, 234, 0.3) !important;
  
  &:hover:not(.disabled):not([disabled]):not(:disabled) {
    background: linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%) !important;
    box-shadow: 0 6px 20px 0 rgba(102, 126, 234, 0.4) !important;
    transform: translateY(-1px) !important;
  }
  
  &:active:not(.disabled):not([disabled]):not(:disabled) {
    transform: translateY(0) !important;
    box-shadow: 0 2px 10px 0 rgba(102, 126, 234, 0.3) !important;
  }

}

// Stop button gradient styling
.stop-button {
  background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%) !important;
  transition: all 0.3s ease !important;
  box-shadow: 0 4px 15px 0 rgba(245, 101, 101, 0.3) !important;

  &:hover {
    background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%) !important;
    box-shadow: 0 6px 20px 0 rgba(245, 101, 101, 0.4) !important;
    transform: translateY(-1px) !important;
  }

  &:active {
    transform: translateY(0) !important;
    box-shadow: 0 2px 10px 0 rgba(245, 101, 101, 0.3) !important;
  }
}

// Image upload button styling
.image-upload-btn {
  opacity: 0.7;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 1;
  }
}

// Image preview strip in input area
.image-preview-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
  margin-bottom: 8px;

  .image-preview-item {
    position: relative;
    display: inline-block;

    .preview-image {
      width: 64px;
      height: 64px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid #d1d5db;
      transition: transform 0.2s ease;

      &:hover {
        transform: scale(1.05);
      }
    }

    .image-remove-btn {
      position: absolute !important;
      top: -6px !important;
      right: -6px !important;
      width: 20px !important;
      height: 20px !important;
      min-width: 20px !important;
      min-height: 20px !important;
      padding: 0 !important;
      background-color: #ef4444 !important;
      z-index: 10;

      &:hover {
        background-color: #dc2626 !important;
      }
    }
  }
}

// Images in chat messages
.message-images {
  .message-image-item {
    img {
      border-radius: 8px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;

      &:hover {
        transform: scale(1.02);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
    }
  }
}

// Image preview dialog
.image-preview-dialog {
  background: var(--q-dark) !important;

  .q-card__section {
    background: transparent;
  }
}

.dark-mode .code-block-header{
  background-color: #3b3b3b;
  border: 1px 1px 0px 1px solid #e1e1e1;

}
.light-mode .code-block-header{
  background-color: #ecf0f5;

}

.model-selector{
  text-overflow: ellipsis;
}
.dark-mode-bottom-bar{
  .model-selector{
    background-color: #262626;
    border: 1px solid #3b3b3b;
    padding: 0px 4px;
    border-radius: 4px;
    padding-left: 4px;
  }

}

.light-mode-bottom-bar{
  .model-selector{
    background-color: #ffffff;
    border: 1px solid #bdbbbb;
    padding: 0px 4px;
    border-radius: 4px;
    padding-left: 4px;
  }
}
  .o2-ai-beta-text {
    position: relative;
    color: var(--q-primary);
    font-size: 8px;
    padding: 0px 4px;
    border-radius: 10px;
    text-align: center;
    border: 1px solid var(--q-primary);
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.5px;
    width: 34px;
  }

.history-menu-container {
  position: relative;
  max-height: 450px;
  display: flex;
  flex-direction: column;
  width: 300px;
}

.search-history-bar-sticky {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--q-page-background);
  padding: 8px;
  border-bottom: 1px solid var(--q-separator-color);
  flex-shrink: 0;
}

.history-list-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  max-height: 350px;
}

.history-item {
  position: relative;

  .delete-history-btn {
    opacity: 0;
    transition: opacity 0.2s;
  }

  &:hover .delete-history-btn {
    opacity: 1;
  }
}

.clear-all-container {
  background: var(--q-page-background);
  padding: 8px;
  border-top: 1px solid var(--q-separator-color);
  flex-shrink: 0;

  .clear-all-btn {
    width: 100%;
    color: var(--q-negative);
    font-size: 13px;

    &:hover {
      background-color: rgba(var(--q-negative-rgb), 0.1);
    }
  }
}

// Scroll to bottom button styling
.scroll-to-bottom-container {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  transition: all 0.3s ease;
  pointer-events: none;
}

.scroll-to-bottom-btn {
  transition: all 0.3s ease;
  animation: fadeInUp 0.3s ease;
  pointer-events: auto;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  
  body.body--light & {
    border: 2px solid #2563eb !important;
    color: #2563eb !important;
    background: rgba(255, 255, 255, 0.95) !important;
  }
  
  body.body--dark & {
    border: 2px solid #667eea !important;
    color: #667eea !important;
    background: rgba(30, 30, 30, 0.9) !important;
  }
  
  &:hover {
    transform: scale(1.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    
    body.body--light & {
      border: 2px solid #1d4ed8 !important;
      color: #1d4ed8 !important;
      background: rgba(255, 255, 255, 1) !important;
    }
    
    body.body--dark & {
      border: 2px solid #5a6fd8 !important;
      color: #5a6fd8 !important;
      background: rgba(40, 40, 40, 0.95) !important;
    }
  }
  
  &:active {
    transform: scale(1);
  }
  
  .q-icon {
    font-size: 18px;
    animation: bounce 2s infinite;
    font-weight: bold;
  }
}

// Bounce animation for the arrow icon
@keyframes bounce {
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-3px);
  }
  60% {
    transform: translateY(-2px);
  }
}

// Fade in up animation for button appearance
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}


// Tool call indicator styling
.tool-call-indicator {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-radius: 12px;
  margin: 8px 0;
  animation: fadeIn 0.3s ease;

  &.light-mode {
    background: linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 100%);
    border: 1px solid #d0d8e8;
  }

  &.dark-mode {
    background: linear-gradient(135deg, #1e2235 0%, #252a3d 100%);
    border: 1px solid #3a3f55;
  }

  .tool-call-content {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }

  .tool-call-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .tool-call-status {
    font-size: 12px;
    font-style: italic;
    opacity: 0.7;
    margin-bottom: 2px;

    .light-mode & {
      color: #6b7280;
    }

    .dark-mode & {
      color: #9ca3af;
    }
  }

  .tool-call-message {
    font-weight: 600;
    font-size: 14px;

    .light-mode & {
      color: #4a5568;
    }

    .dark-mode & {
      color: #e2e8f0;
    }
  }

  .tool-call-context {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .context-item {
    width: 100%;
  }

  .context-query {
    display: block;
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    white-space: pre-wrap;
    word-break: break-all;
    max-width: 100%;
    overflow: hidden;

    .light-mode & {
      background: #ffffff;
      color: #2d3748;
      border: 1px solid #e2e8f0;
    }

    .dark-mode & {
      background: #1a1a1a;
      color: #a0aec0;
      border: 1px solid #333;
    }
  }

  .context-tag {
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    font-weight: 500;

    .light-mode & {
      background: rgba(102, 126, 234, 0.1);
      color: #667eea;
    }

    .dark-mode & {
      background: rgba(102, 126, 234, 0.2);
      color: #a0aec0;
    }
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

// Inline loading indicator (inside message box)
.inline-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  color: #6b7280;
  font-size: 14px;
}

// Tool call item - inline in chat flow (interleaved with text)
.tool-call-item {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 8px;

  &.has-details {
    cursor: pointer;

    &:hover {
      &.light-mode {
        background: rgba(76, 175, 80, 0.12);
      }
      &.dark-mode {
        background: rgba(76, 175, 80, 0.18);
      }
    }
  }

  &.light-mode {
    background: rgba(76, 175, 80, 0.08);
    color: #4a5568;
  }

  &.dark-mode {
    background: rgba(76, 175, 80, 0.12);
    color: #a0aec0;
  }

  // Error state styling
  &.error {
    &.light-mode {
      background: rgba(244, 67, 54, 0.08);
    }
    &.dark-mode {
      background: rgba(244, 67, 54, 0.12);
    }

    &.has-details:hover {
      &.light-mode {
        background: rgba(244, 67, 54, 0.15);
      }
      &.dark-mode {
        background: rgba(244, 67, 54, 0.22);
      }
    }
  }

  // Timeout state styling
  &.timeout {
    &.light-mode {
      background: rgba(255, 152, 0, 0.08);
    }
    &.dark-mode {
      background: rgba(255, 152, 0, 0.12);
    }

    &.has-details:hover {
      &.light-mode {
        background: rgba(255, 152, 0, 0.15);
      }
      &.dark-mode {
        background: rgba(255, 152, 0, 0.22);
      }
    }
  }

  // Pending confirmation state styling (yellow/amber)
  &.pending-confirmation {
    cursor: default;

    &.light-mode {
      background: rgba(255, 193, 7, 0.12);
      border: 1px solid rgba(255, 193, 7, 0.3);
    }
    &.dark-mode {
      background: rgba(255, 193, 7, 0.15);
      border: 1px solid rgba(255, 193, 7, 0.25);
    }
  }

  // Pending navigation confirmation styling (blue)
  &.pending-navigation {
    cursor: default;

    &.light-mode {
      background: rgba(25, 118, 210, 0.08);
      border: 1px solid rgba(25, 118, 210, 0.3);
    }
    &.dark-mode {
      background: rgba(66, 165, 245, 0.12);
      border: 1px solid rgba(66, 165, 245, 0.25);
    }
  }

  .tool-confirmation-inline {
    margin-top: 12px;

    .confirmation-content {
      padding: 16px;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;

      .light-mode & {
        background: #fffbeb;
        border: 1px solid #fde68a;
      }
      .dark-mode & {
        background: rgba(251, 191, 36, 0.15);
        border: 1px solid rgba(251, 191, 36, 0.3);
      }
    }
  }

  .navigation-icon {
    cursor: pointer;
    margin-left: 4px;
    transition: transform 0.2s;

    &:hover {
      transform: scale(1.15);
    }
  }

  .navigation-block {
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: 4px;
    display: inline-block;

    &.light-mode {
      background: rgba(25, 118, 210, 0.08);
    }

    &.dark-mode {
      background: rgba(66, 165, 245, 0.12);
    }

    .navigation-block-btn {
      font-size: 13px;
    }
  }

  .tool-call-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tool-call-name {
    font-weight: 500;
    flex: 1;

    code {
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 12px;
      padding: 1px 4px;
      border-radius: 3px;

      .light-mode & {
        background: rgba(0, 0, 0, 0.06);
      }
      .dark-mode & {
        background: rgba(255, 255, 255, 0.1);
      }
    }
  }

  .expand-icon {
    opacity: 0.6;
    transition: transform 0.2s;
  }

  .tool-call-details {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(128, 128, 128, 0.2);
    display: flex;
    flex-direction: column;
    gap: 8px;

    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .detail-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      opacity: 0.6;
    }

    .copy-btn {
      opacity: 0.6;
      &:hover {
        opacity: 1;
      }
    }

    .detail-value {
      font-size: 12px;
      user-select: text;

      &.query-value {
        font-family: 'Fira Code', 'Consolas', monospace;
        padding: 8px;
        border-radius: 4px;
        white-space: pre-wrap;
        word-break: break-all;
        user-select: text;
        cursor: text;

        .light-mode & {
          background: rgba(0, 0, 0, 0.04);
        }
        .dark-mode & {
          background: rgba(255, 255, 255, 0.06);
        }
      }
    }
  }
}

// Log entry item - expandable log content display
.log-entry-item {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  margin-bottom: 4px;
  cursor: pointer;

  &.light-mode {
    background: rgba(33, 150, 243, 0.08);
    color: #4a5568;
  }

  &.dark-mode {
    background: #252a31;
    border: 1px solid #3a4149;
    color: #e2e8f0;
  }

  &:hover {
    &.light-mode {
      background: rgba(33, 150, 243, 0.12);
    }
    &.dark-mode {
      background: #20242e;
      border-color: #4a5568;
    }
  }

  .log-entry-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .log-entry-info {
    flex: 1;
    font-weight: 500;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .expand-icon {
    opacity: 0.6;
    transition: transform 0.2s;
  }

  .log-entry-details {
    margin-top: 10px;
  }

  .log-entry-content {
    position: relative;
    border-radius: 6px;
    border: 1px solid;
    overflow: hidden;

    .light-mode & {
      background: #ffffff;
      border-color: #e4e7ec;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
    .dark-mode & {
      background: #1e293b;
      border-color: #475569;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      opacity: 0.6;
      z-index: 1;
      background: rgba(128, 128, 128, 0.1);
      border-radius: 4px;
      padding: 4px 8px;

      &:hover {
        opacity: 1;
        .light-mode & {
          background: rgba(0, 0, 0, 0.08);
        }
        .dark-mode & {
          background: rgba(255, 255, 255, 0.15);
        }
      }
    }

    .log-entry-code {
      display: block;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.5;
      padding: 12px;
      padding-right: 40px;
      white-space: pre-wrap;
      word-wrap: break-word;
      user-select: text;
      cursor: text;
      max-height: 300px;
      overflow-y: auto;

      .light-mode & {
        background: #f8fafc;
        color: #1a202c;
      }
      .dark-mode & {
        background: #0d1017;
        color: #e2e8f0;
      }

      // JSON syntax highlighting - use :deep() for v-html content
      :deep(.json-key) {
        color: #0066cc;
        font-weight: 600;
      }

      :deep(.json-string) {
        color: #22863a;
      }

      :deep(.json-number) {
        color: #005cc5;
      }

      :deep(.json-boolean) {
        color: #d73a49;
        font-weight: 600;
      }

      :deep(.json-null) {
        color: #6f42c1;
        font-weight: 600;
      }
    }
  }
}

// Dark mode JSON syntax highlighting for log entries
.dark-mode .log-entry-code {
  :deep(.json-key) {
    color: #60a5fa;
  }

  :deep(.json-string) {
    color: #86efac;
  }

  :deep(.json-number) {
    color: #7dd3fc;
  }

  :deep(.json-boolean) {
    color: #fca5a5;
  }

  :deep(.json-null) {
    color: #c4b5fd;
  }
}

.tool-call-item {
  .tool-response-hits {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    font-family: 'Fira Code', 'Consolas', monospace;
    padding: 6px 8px;
    border-radius: 4px;
    max-height: 200px;
    overflow-y: auto;

    .light-mode & {
      background: rgba(0, 0, 0, 0.04);
    }
    .dark-mode & {
      background: rgba(255, 255, 255, 0.06);
    }
  }

  .tool-response-hit {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding: 2px 0;

    &:not(:last-child) {
      border-bottom: 1px solid rgba(128, 128, 128, 0.15);
      padding-bottom: 4px;
    }
  }

  .hit-field {
    word-break: break-all;
    user-select: text;
    cursor: text;
  }

  .hit-key {
    opacity: 0.6;
    font-weight: 600;
  }

  .hit-error {
    color: #f44336;
  }

  .tool-response-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .tool-call-error {
    font-size: 11px;
    color: #f44336;
    font-style: italic;
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-call-error {
    font-size: 11px;
    color: #f44336;
    font-style: italic;
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-call-query {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    .light-mode & {
      background: rgba(0, 0, 0, 0.05);
      color: #666;
    }

    .dark-mode & {
      background: rgba(255, 255, 255, 0.08);
      color: #888;
    }
  }

  .tool-error-message {
    color: #f44336;
  }

  .tool-suggestion {
    font-style: italic;
    opacity: 0.85;
  }
}

// Stream-level error block - inline in chat flow
.stream-error-block {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border-radius: 6px;
  border-left: 3px solid #f44336;
  margin-bottom: 8px;
  font-size: 13px;

  &.light-mode {
    background: rgba(244, 67, 54, 0.06);
    color: #4a5568;
  }

  &.dark-mode {
    background: rgba(244, 67, 54, 0.10);
    color: #a0aec0;
  }

  .stream-error-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stream-error-message {
    font-weight: 500;
    color: #f44336;
  }

  .stream-error-suggestion {
    margin-top: 6px;
    padding-left: 24px;
    font-style: italic;
    font-size: 12px;
    opacity: 0.85;
  }

  .stream-error-recoverable {
    margin-top: 4px;
    padding-left: 24px;
    font-size: 11px;
    opacity: 0.7;
  }
}


// Theme-based syntax highlighting - both CSS files are loaded, we scope them by theme
// Hide dark theme in light mode
.light-mode {
  // Force light theme colors to take precedence
  :deep(.hljs) {
    display: block;
    overflow-x: auto;
    padding: 0.5em;
    color: #24292e;
    background: #ffffff;
  }
  :deep(.hljs-doctag),
  :deep(.hljs-keyword),
  :deep(.hljs-meta .hljs-keyword),
  :deep(.hljs-template-tag),
  :deep(.hljs-template-variable),
  :deep(.hljs-type),
  :deep(.hljs-variable.language_) {
    color: #d73a49;
  }
  :deep(.hljs-title),
  :deep(.hljs-title.class_),
  :deep(.hljs-title.class_.inherited__),
  :deep(.hljs-title.function_) {
    color: #6f42c1;
  }
  :deep(.hljs-attr),
  :deep(.hljs-attribute),
  :deep(.hljs-literal),
  :deep(.hljs-meta),
  :deep(.hljs-number),
  :deep(.hljs-operator),
  :deep(.hljs-variable),
  :deep(.hljs-selector-attr),
  :deep(.hljs-selector-class),
  :deep(.hljs-selector-id) {
    color: #005cc5;
  }
  :deep(.hljs-regexp),
  :deep(.hljs-string),
  :deep(.hljs-meta .hljs-string) {
    color: #032f62;
  }
  :deep(.hljs-built_in),
  :deep(.hljs-symbol) {
    color: #e36209;
  }
  :deep(.hljs-comment),
  :deep(.hljs-code),
  :deep(.hljs-formula) {
    color: #6a737d;
  }
  :deep(.hljs-name),
  :deep(.hljs-quote),
  :deep(.hljs-selector-tag),
  :deep(.hljs-selector-pseudo) {
    color: #22863a;
  }
  :deep(.hljs-subst) {
    color: #24292e;
  }
  :deep(.hljs-section) {
    color: #005cc5;
    font-weight: bold;
  }
  :deep(.hljs-bullet) {
    color: #735c0f;
  }
  :deep(.hljs-emphasis) {
    color: #24292e;
    font-style: italic;
  }
  :deep(.hljs-strong) {
    color: #24292e;
    font-weight: bold;
  }
  :deep(.hljs-addition) {
    color: #22863a;
    background-color: #f0fff4;
  }
  :deep(.hljs-deletion) {
    color: #b31d28;
    background-color: #ffeef0;
  }
}
// Force dark theme colors in dark mode
.dark-mode {
  :deep(.hljs) {
    display: block;
    overflow-x: auto;
    padding: 0.5em;
    color: #c9d1d9;
    background: #0d1117;
  }
  :deep(.hljs-doctag),
  :deep(.hljs-keyword),
  :deep(.hljs-meta .hljs-keyword),
  :deep(.hljs-template-tag),
  :deep(.hljs-template-variable),
  :deep(.hljs-type),
  :deep(.hljs-variable.language_) {
    color: #ff7b72;
  }
  :deep(.hljs-title),
  :deep(.hljs-title.class_),
  :deep(.hljs-title.class_.inherited__),
  :deep(.hljs-title.function_) {
    color: #d2a8ff;
  }
  :deep(.hljs-attr),
  :deep(.hljs-attribute),
  :deep(.hljs-literal),
  :deep(.hljs-meta),
  :deep(.hljs-number),
  :deep(.hljs-operator),
  :deep(.hljs-variable),
  :deep(.hljs-selector-attr),
  :deep(.hljs-selector-class),
  :deep(.hljs-selector-id) {
    color: #79c0ff;
  }
  :deep(.hljs-regexp),
  :deep(.hljs-string),
  :deep(.hljs-meta .hljs-string) {
    color: #a5d6ff;
  }
  :deep(.hljs-built_in),
  :deep(.hljs-symbol) {
    color: #ffa657;
  }
  :deep(.hljs-comment),
  :deep(.hljs-code),
  :deep(.hljs-formula) {
    color: #8b949e;
  }
  :deep(.hljs-name),
  :deep(.hljs-quote),
  :deep(.hljs-selector-tag),
  :deep(.hljs-selector-pseudo) {
    color: #7ee787;
  }
  :deep(.hljs-subst) {
    color: #c9d1d9;
  }
  :deep(.hljs-section) {
    color: #1f6feb;
    font-weight: bold;
  }
  :deep(.hljs-bullet) {
    color: #f2cc60;
  }
  :deep(.hljs-emphasis) {
    color: #c9d1d9;
    font-style: italic;
  }
  :deep(.hljs-strong) {
    color: #c9d1d9;
    font-weight: bold;
  }
  :deep(.hljs-addition) {
    color: #aff5b4;
    background-color: #033a16;
  }
  :deep(.hljs-deletion) {
    color: #ffdcd7;
    background-color: #67060c;
  }
}
</style> 
