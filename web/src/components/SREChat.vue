<template>
  <div class="chat-container" :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="chat-content-wrapper" :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
      <div class="chat-header" :style="{ height: headerHeight ? headerHeight + 'px' : '' }">
        <div class="chat-title tw:flex tw:justify-between tw:items-center tw:w-full">

          <div class="tw:flex tw:items-center tw:gap-2">
            <q-avatar size="24px">
              <img :src="o2AiTitleLogo" />
            </q-avatar>
            <div class="tw:flex tw:items-center">
              <span class="tw:mr-[5.5px]">SRE Assistant</span>
            </div>

          </div>

          <div>
            <q-btn flat round dense icon="add" @click="addNewChat" />
            <q-btn flat round dense icon="history" @click="loadHistory">
              <q-menu>
                <!-- here we will show the history menu -->
                 <!-- and also the search functionality to search the history  -->
                <div class="history-menu-container">
                  <div class="search-history-bar-sticky">
                    <q-input
                      v-model="historySearchTerm"
                      placeholder="Search chat history"
                      dense
                    filled
                    borderless
                      class="tw:mb-2"
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
                      >
                        <q-item-section>
                          <div class="row items-center justify-between">
                            <div class="col-8 ellipsis">{{ chat.title }}</div>
                            <div class="col-4 text-right text-grey-7 text-caption">{{ formatTime(chat.timestamp) }}</div>
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
                </div>
              </q-menu>
            </q-btn>
            <q-btn flat round dense icon="close" @click="emit('close')" />
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

      <div class="chat-content " :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
        <div class="messages-container " ref="messagesContainer" @scroll="checkIfShouldAutoScroll">
          <!-- Context annotation -->
          <div v-if="contextData" class="context-annotation" :class="store.state.theme == 'dark' ? 'context-annotation-dark' : 'context-annotation-light'">
            <q-icon name="info" size="14px" class="tw:mr-1" />
            <span class="tw:text-xs">
              <template v-if="contextType === 'alert'">
                Alert: <strong>{{ contextData.name }}</strong>
              </template>
              <template v-else-if="contextType === 'incident'">
                Incident: <strong>{{ contextData.title || 'Untitled' }}</strong>
                <span v-if="contextData.severity" class="tw:ml-2 tw:opacity-75">{{ contextData.severity }}</span>
              </template>
            </span>
          </div>

          <div v-if="chatMessages.length === 0" class="welcome-section ">
            <div class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full ">
              <img :src="o2AiTitleLogo" />
              <span class="tw:text-[14px] tw:font-[600] tw:text-center">AI native  observability</span>
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
                <template v-for="(block, blockIndex) in message.blocks" :key="blockIndex">
                  <!-- Tool call block -->
                  <div
                    v-if="block.type === 'tool_call'"
                    class="tool-call-item"
                    :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'"
                  >
                    <q-icon name="check_circle" size="14px" color="positive" />
                    <span class="tool-call-name">{{ block.message }}</span>
                    <span v-if="block.context && block.context.query" class="tool-call-query">
                      {{ truncateQuery(block.context.query) }}
                    </span>
                  </div>
                  <!-- Code block -->
                  <div v-else-if="block.type === 'code'" class="code-block" >
                    <div  class="code-block-header code-block-theme">
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
                        <span class="tw:ml-1" >Copy</span>
                      </div>
                      </q-btn>
                    </div>
                    <span class="generated-code-block">
                      <code :class="['hljs', block.language]" v-html="block.highlightedContent"></code>
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
                        <span class="tw:ml-1" >Retry</span>
                      </div>
                      </q-btn>
                      <div v-if="false" class="tw:flex tw:items-center tw:gap-2">
                        <q-btn flat dense :icon="outlinedThumbUpOffAlt" color="primary" @click="likeCodeBlock(message)"  />
                        <q-btn flat dense :icon="outlinedThumbDownOffAlt" color="primary" @click="dislikeCodeBlock(message)"  />
                      </div>
                    </div>
                  </div>
                  <!-- Text block -->
                  <div v-else class="text-block" v-html="processHtmlBlock(block.content)"></div>

                </template>
              </div>
            </div>
          </div>
          <div v-if="isLoading" id="loading-indicator" class="tw:flex tw:items-center tw:gap-2 tw:p-4">
            <q-spinner-dots color="primary" size="2em" />
            <span style="font-size: 14px; opacity: 0.7;">{{ currentObservingMessage }}</span>
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
      <div class="chat-input-wrapper tw:flex tw:flex-col q-ma-md" @click="focusInput">
        <q-input
          ref="chatInput"
          v-model="inputMessage"
          placeholder="Write your prompt"
          dense
          :disable="isLoading"
          rows="10"
          @keydown="handleKeyDown"
          type="textarea"
          autogrow
          :borderless="true"
          style="max-height: 250px; overflow-y: auto; font-size: 16px;"
          class="chat-input"
          flat
        >
        </q-input>
        <div class="tw:flex tw:items-center tw:justify-end tw:mt-2 tw:gap-2" :class="store.state.theme == 'dark' ? 'dark-mode-bottom-bar' : 'light-mode-bottom-bar'">
          <!-- Send button - shown when not loading -->
          <q-btn
            v-if="!isLoading"
            :disable="!inputMessage.trim()"
            @click="sendMessage"
            round
            dense
            flat
            class="tw:ml-1 send-button"
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
            class="tw:ml-1 stop-button"
          >
            <q-icon name="stop" size="16px" color="white" />
          </q-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, nextTick, watch, computed, onUnmounted, toRefs } from 'vue';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { marked } from 'marked';
import { MarkedOptions } from 'marked';
import DOMPurify from 'dompurify';
import { useQuasar } from 'quasar';
import { useStore } from 'vuex';
import { outlinedThumbUpOffAlt, outlinedThumbDownOffAlt } from '@quasar/extras/material-icons-outlined';
import { getImageURL } from '@/utils/zincutils';
import { ChatMessage, ChatHistoryEntry } from '@/types/chat';

// Add IndexedDB setup
const DB_NAME = 'sreChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'sreChatHistory';

const initDB = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    //this opens / creates(if not exists) the database with the name o2ChatDB and version 1
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    //this is called when the database is successfully opened and returns the database object
    request.onsuccess = () => resolve(request.result);
    //this is called when the database is created for the first time / when the version is changed
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        //this creates the object store with the name chatHistory and the key is id , autoIncrement is true
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        //this creates the index with the name timestamp
        store.createIndex('timestamp', 'timestamp', { unique: false });
        //this creates the index with the name title
        store.createIndex('title', 'title', { unique: false });
      }
    };
  });
};

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
  name: 'SREChat',
  props: {
    headerHeight: {
      type: Number,
      default: 0,
    },
    contextType: {
      type: [String, null] as any,
      default: "general",
    },
    contextData: {
      type: [Object, null] as any,
      default: () => null,
    },
  },
  emits: ["close"],
  setup(props, { emit }) {
    const $q = useQuasar();
    const { contextType, contextData } = toRefs(props);
    const inputMessage = ref('');
    const chatMessages = ref<ChatMessage[]>([]);
    const isLoading = ref(false);
    const messagesContainer = ref<HTMLElement | null>(null);
    const chatInput = ref<HTMLElement | null>(null);
    const currentStreamingMessage = ref('');
    const selectedProvider = ref<string>('openai');
    const selectedModel = ref<any>('gpt-4.1');
    const showHistory = ref(false);
    const chatHistory = ref<ChatHistoryEntry[]>([]);
    const currentChatId = ref<number | null>(null);
    const store = useStore ();
    const chatUpdated = computed(() => store.state.chatUpdated);

    const currentChatTimestamp = ref<string | null>(null);
    const saveHistoryLoading = ref(false);
    const historySearchTerm = ref('');
    const shouldAutoScroll = ref(true);
    const showScrollToBottom = ref(false);
    
    // AbortController for managing request cancellation - allows users to stop ongoing AI requests
    const currentAbortController = ref<AbortController | null>(null);

    // Observing messages for loading indicator (OpenObserve branding)
    const OBSERVING_MESSAGES = [
      "Observing...",
      "Keenly observing...",
      "Carefully observing...",
      "Deeply observing...",
      "Patiently observing...",
      "Thoroughly observing...",
      "Meticulously observing...",
      "Intently observing...",
      "Actively observing...",
      "Closely observing...",
      "Observing some more...",
      "Still observing...",
      "Observing and thinking...",
      "Observing and analyzing...",
      "Observing carefully...",
      "Observing thoughtfully...",
      "Observing diligently...",
      "Observing attentively...",
      "Observing systematically...",
      "Continuing to observe...",
      "Observing further...",
      "Observing in detail...",
      "Perpetually observing..."
    ];
    const currentObservingMessage = ref(OBSERVING_MESSAGES[0]);
    const observingRotationInterval = ref<NodeJS.Timeout | null>(null);

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

    const availableModels = computed(() => modelConfig[selectedProvider.value] || []);

    watch(selectedProvider, (newProvider: string) => {
      selectedModel.value = modelConfig[newProvider][0];
    });

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
        stopObservingRotation();

        // Handle partial message cleanup
        if (chatMessages.value.length > 0) {
          const lastMessage = chatMessages.value[chatMessages.value.length - 1];
          if (lastMessage.role === 'assistant') {
            if (!lastMessage.content) {
              // Remove empty assistant message that was added for streaming
              chatMessages.value.pop();
            } else if (currentStreamingMessage.value) {
              // Keep partial content but indicate it was cancelled
              lastMessage.content += '\n\n_[Response stopped by user]_';
            }
          }
        }
        
        // Reset streaming state
        currentStreamingMessage.value = '';

        // Save the current state including cancellation
        await saveToHistory();
        
        // Scroll to show the final state
        await scrollToBottom();
      }
    };

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
      stopObservingRotation();
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
                // Extract everything after 'data: '
                const jsonStr = line.substring(line.indexOf('{'));

                // Skip empty or invalid JSON strings
                if (!jsonStr || !jsonStr.trim()) continue;

                // Try to parse the JSON
                try {
                  const data = JSON.parse(jsonStr);

                  // Handle different event types
                  if (data.type === 'status' || data.status) {
                    // Status/thinking events - just continue, already showing "Observing..."
                    continue;
                  } else if (data.type === 'tool_call' && data.message) {
                    // Tool call event - add as contentBlock for consistent display
                    const toolCallBlock = {
                      type: 'tool_call',
                      tool: data.tool,
                      message: data.message,
                      context: data.context || {}
                    };

                    // Add to current assistant message's contentBlocks
                    let lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                      if (!lastMessage.contentBlocks) {
                        lastMessage.contentBlocks = [];
                      }
                      lastMessage.contentBlocks.push(toolCallBlock);
                    }
                    await scrollToBottom();
                    continue;
                  } else if (data.type === 'tool_response' && data.message) {
                    // Tool response event - skip, don't show completion messages
                    continue;
                  } else if (data.type === 'message' && typeof data.content === 'string') {
                    // Message content - add spacing before content paragraphs
                    const content = data.content + '\n';
                    currentStreamingMessage.value += content;
                    updateAssistantMessage();
                    messageComplete = true;
                    await scrollToBottom();
                  } else if (data.type === 'complete') {
                    // Complete event - stream finished
                    messageComplete = true;
                  } else if (data.type === 'error') {
                    // Error event with spacing
                    const errorMsg = `\n\nError: ${data.error}\n\n`;
                    currentStreamingMessage.value += errorMsg;
                    updateAssistantMessage();
                    await scrollToBottom();
                  } else if (typeof data.content === 'string') {
                    // Legacy format - just content field
                    currentStreamingMessage.value += data.content;
                    updateAssistantMessage();
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
                if (data.type === 'message' && typeof data.content === 'string') {
                  currentStreamingMessage.value += data.content;
                  updateAssistantMessage();
                  messageComplete = true;
                  await scrollToBottom();
                } else if (typeof data.content === 'string') {
                  currentStreamingMessage.value += data.content;
                  updateAssistantMessage();
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

    // Helper function to update assistant message
    const updateAssistantMessage = () => {
      const lastMessage = chatMessages.value[chatMessages.value.length - 1];
      if (!lastMessage || lastMessage.role !== 'assistant') {
        // First content chunk - create assistant message
        chatMessages.value.push({
          role: 'assistant',
          content: currentStreamingMessage.value
        });
      } else {
        // Update existing assistant message
        lastMessage.content = currentStreamingMessage.value;
      }
    };

    const saveToHistory = async () => {
      saveHistoryLoading.value = true;
      if (chatMessages.value.length === 0) return;
      
      try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const DbIndexStore = transaction.objectStore(STORE_NAME);

        // Generate a title from the first user message
        const firstUserMessage = chatMessages.value.find(msg => msg.role === 'user');
        const title = firstUserMessage ? 
          (firstUserMessage.content.length > 40 ? 
            firstUserMessage.content.substring(0, 40) + '...' : 
            firstUserMessage.content) : 
          'New Chat';

        // Create a serializable version of the messages
        const serializableMessages = chatMessages.value.map(msg => ({
          role: msg.role,
          content: msg.content
        }));

        const chatData = {
          timestamp: new Date().toISOString(),
          title,
          messages: serializableMessages,
          provider: selectedProvider.value,
          model: selectedModel.value
        };

        // Always use put with the current chat ID to update existing chat
        // instead of creating a new one
        let chatId = currentChatId.value || Date.now();
        const request = DbIndexStore.put({ 
          ...chatData, 
          id: chatId // Use timestamp as ID if no current ID
        });




        request.onsuccess = (event: Event) => {
          if (!currentChatId.value) {
            currentChatId.value = (event.target as IDBRequest).result as number;
          }
        };
      } catch (error) {
        console.error('Error saving chat history:', error);
      }
      finally {
        saveHistoryLoading.value = false;
      }
    };

    const MAX_HISTORY_ITEMS = 100;

    const loadHistory = async () => {
      try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.index('timestamp').openCursor(null, 'prev');
        //one the promise is resolved we get the history here 
        //this history length might be more than 100 so after resolving / finishing the indexDB call
        // we do the filtering
        const history: any[] = [];
        
        const loadResult = await new Promise((resolve, reject) => {
          request.onsuccess = (event: Event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
              history.push(cursor.value);
              cursor.continue();
            } else {
              resolve(history);
            }
          };
          request.onerror = () => reject(request.error);
        });

        // If we have more than MAX_HISTORY_ITEMS, delete the oldest ones
        //this will allows the user to see only top 100 chat histories and also delete the non required ones
        //as we are not giving option to delete history manually we are doing this
        //some times it takes time to delete the history from the indexDB so we only delete the history if user access the history menu
        if (history.length > MAX_HISTORY_ITEMS) {
          const itemsToDelete = history.slice(MAX_HISTORY_ITEMS);
          const deleteTransaction = db.transaction(STORE_NAME, 'readwrite');
          const deleteStore = deleteTransaction.objectStore(STORE_NAME);
          
          for (const item of itemsToDelete) {
            deleteStore.delete(item.id);
          }

          // Wait for deletion transaction to complete
          await new Promise((resolve, reject) => {
            deleteTransaction.oncomplete = () => resolve(true);
            deleteTransaction.onerror = () => reject(deleteTransaction.error);
          });
        }

        //here we do assign the history to the actual chat history 
        // Keep only the latest MAX_HISTORY_ITEMS
        chatHistory.value = history.slice(0, MAX_HISTORY_ITEMS);
        return chatHistory.value;

      } catch (error) {
        console.error('Error loading chat history:', error);
        return [];
      }
    };

    const addNewChat = () => {
      chatMessages.value = [];
      currentChatId.value = null;
      selectedProvider.value = 'openai';
      selectedModel.value = modelConfig.openai[0];
      showHistory.value = false;
      currentChatTimestamp.value = null;
      shouldAutoScroll.value = true; // Reset auto-scroll for new chat
      store.dispatch('setCurrentChatTimestamp', null);
      store.dispatch('setChatUpdated', true);
    };

    const openHistory = async () => {
      showHistory.value = true;
      await loadHistory();
    };

    const loadChat = async (chatId: number) => {
      try {

        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const indexDbStore = transaction.objectStore(STORE_NAME);
        if(chatId == null) {
          addNewChat();
          return;
        }
        const request = indexDbStore.get(chatId);

        request.onsuccess = async () => {
          const chat = request.result;
          if (chat) {
            // Ensure messages are properly formatted
            const formattedMessages = chat.messages.map((msg: any) => ({
              role: msg.role,
              content: msg.content
            }));
            
            // Check if the last message is a user message without an assistant response
            const lastMessage = formattedMessages[formattedMessages.length - 1];
            
            chatMessages.value = formattedMessages;
            selectedProvider.value = chat.provider || 'openai';
            selectedModel.value = chat.model || modelConfig.openai[0];
            currentChatId.value = chatId;
            showHistory.value = false;
            shouldAutoScroll.value = true; // Reset auto-scroll when loading chat
            
            if(chatId !== store.state.currentChatTimestamp) {
              store.dispatch('setCurrentChatTimestamp', chatId);
              store.dispatch('setChatUpdated', true);
            }
            
            
            // Scroll to bottom after loading chat
            await nextTick(() => {
              scrollToBottom();
            });
          }
        };
      } catch (error) {
        console.error('Error loading chat:', error);
      }
    };

    /**
     * Start rotating the observing message every 7 seconds
     */
    const startObservingRotation = () => {
      // Pick initial random message
      currentObservingMessage.value = OBSERVING_MESSAGES[Math.floor(Math.random() * OBSERVING_MESSAGES.length)];

      // Rotate every 7 seconds
      observingRotationInterval.value = setInterval(() => {
        currentObservingMessage.value = OBSERVING_MESSAGES[Math.floor(Math.random() * OBSERVING_MESSAGES.length)];
      }, 7000);
    };

    /**
     * Stop rotating the observing message
     */
    const stopObservingRotation = () => {
      if (observingRotationInterval.value) {
        clearInterval(observingRotationInterval.value);
        observingRotationInterval.value = null;
      }
    };

    /**
     * Sends a message to the AI chat service with streaming response handling
     * Creates a new AbortController for each request to enable cancellation
     * Manages the complete request lifecycle from user input to streaming response
     */
    const sendMessage = async () => {
      if (!inputMessage.value.trim() || isLoading.value) return;

      const userMessage = inputMessage.value;
      
      // Add to query history before clearing input
      addToHistory(userMessage);
      
      chatMessages.value.push({
        role: 'user',
        content: userMessage
      });
      inputMessage.value = '';
      shouldAutoScroll.value = true; // Reset auto-scroll for new message
      await scrollToBottom(); // Scroll after user message
      await saveToHistory(); // Save after user message

      isLoading.value = true;
      currentStreamingMessage.value = '';
      startObservingRotation(); // Start rotating "Observing..." messages

      // Create new AbortController for this request - enables cancellation via Stop button
      currentAbortController.value = new AbortController();
      
      try {
        // Don't add empty assistant message here - wait for actual content
        await scrollToLoadingIndicator(); // Scroll directly to loading indicator
        
        let response: any;
        try {
          // Build context from props
          const context: any = {
            org_id: store.state.selectedOrganization.identifier,
          };
          if (props.contextType === 'alert' && props.contextData) {
            context.alert_id = props.contextData.alert_id || props.contextData.name;
            context.alert_name = props.contextData.name;
          } else if (props.contextType === 'incident' && props.contextData) {
            context.incident_id = props.contextData.id;
            context.incident_title = props.contextData.title;
            context.incident_status = props.contextData.status;
            context.incident_severity = props.contextData.severity;
            context.alert_count = props.contextData.alert_count;
            context.first_alert_at = props.contextData.first_alert_at;
            context.last_alert_at = props.contextData.last_alert_at;
            if (props.contextData.stable_dimensions) {
              context.stable_dimensions = props.contextData.stable_dimensions;
            }
            if (props.contextData.topology_context) {
              context.topology_context = props.contextData.topology_context;
            }
            if (props.contextData.triggers) {
              context.triggers = props.contextData.triggers;
            }
            if (props.contextData.rca_analysis) {
              context.rca_analysis = props.contextData.rca_analysis;
            }
          }

          // Prepare history (exclude current user message)
          const history = chatMessages.value.slice(0, -1).map((msg) => ({
            role: msg.role,
            content: msg.content,
          }));

          // Call AI chat API - backend will select sre agent based on incident_id in context
          response = await fetch(
            `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/ai/chat_stream`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messages: [...history, { role: "user", content: userMessage }],
                context: context,
              }),
              signal: currentAbortController.value.signal,
              credentials: "include",
            }
          );
        } catch (error) {
          console.error('Error fetching SRE chat:', error);
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
      stopObservingRotation();

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
      } else if (e.key === 'ArrowUp' && isOnFirstLine(e.target as HTMLTextAreaElement)) {
        e.preventDefault();
        navigateHistory('up');
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
        // For Quasar components, we need to call the focus method on the component
        chatInput.value.focus();
        // Alternative: directly focus the native textarea element
        const textarea = chatInput.value.$el?.querySelector('textarea');
        if (textarea) {
          textarea.focus();
        }
      }
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

    // Watch for context changes to start fresh chat
    watch(() => props.contextData, (newContext, oldContext) => {
      if (newContext && oldContext && newContext !== oldContext) {
        // New alert/incident clicked - start fresh chat
        chatMessages.value = [];
        currentChatId.value = null;
      }
    });

    // Load initial data when mounted
    onMounted(() => {
      loadHistory();
      loadQueryHistory();
    });

    onUnmounted(()=>{
      // Cancel any ongoing requests when component is unmounted to prevent memory leaks
      if (currentAbortController.value) {
        currentAbortController.value.abort();
        currentAbortController.value = null;
      }

      // Stop observing message rotation
      stopObservingRotation();

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

    const processMessageContent = (content: string) => {
      const tokens = marked.lexer(content);
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

    const processedMessages = computed(() => {
      return chatMessages.value.map(message => {
        // Process text content into code/text blocks
        const textBlocks = processMessageContent(message.content);

        // Merge contentBlocks (tool calls) with text blocks
        // contentBlocks come first (tool calls), then text content
        const allBlocks = [
          ...(message.contentBlocks || []),
          ...textBlocks
        ];

        return {
          ...message,
          blocks: allBlocks
        };
      });
    });

    // Truncate query for display in tool call items
    const truncateQuery = (query: string, maxLength: number = 50) => {
      if (!query) return '';
      return query.length > maxLength ? query.substring(0, maxLength) + '...' : query;
    };

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

    const likeCodeBlock = (message: any) => {
      // console.log('likeCodeBlock', message);
    };

    const dislikeCodeBlock = (message: any) => {
      // console.log('dislikeCodeBlock', message);
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
      sendMessage,
      handleKeyDown,
      focusInput,
      messagesContainer,
      chatInput,
      formatMessage,
      capabilities,
      selectCapability,
      selectedProvider,
      selectedModel,
      availableModels,
      showHistory,
      chatHistory,
      addNewChat,
      openHistory,
      loadChat,
      processedMessages,
      truncateQuery,
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
      currentObservingMessage,
      emit,
    }
  }
});
</script>

<style lang="scss" scoped>
.chat-container {
  width: 100%;
  height: 100vh;
  color: var(--q-primary-text);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  
  // Light mode gradient - more sophisticated
  &.light-mode {
    background: rgba(255,255,255,0.7);
    background-size: 400% 400%;
    animation: subtleShift 20s ease-in-out infinite;
  }
  
  // Dark mode gradient - more sophisticated
  &.dark-mode {
    background: rgba(0,0,0,0.7);
    background-size: 400% 400%;
    animation: subtleShift 25s ease-in-out infinite;
  }

  .chat-content-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    
    // Light mode gradient - more sophisticated
    &.light-mode {
      background: transparent;
      background-size: 400% 400%;
      animation: subtleShift 20s ease-in-out infinite;
    }
    
    // Dark mode gradient - more sophisticated
    &.dark-mode {
      background: transparent;
      background-size: 400% 400%;
      animation: subtleShift 25s ease-in-out infinite;
    }
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

  .chat-input-wrapper {
    padding: 4px 8px 8px 8px;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    transition: all 0.2s ease;

    :deep(.q-field) {
      max-width: 900px;
      width: 100%;
    }
  
  }
  .light-mode .chat-input-wrapper{
    background:#ffffff;
    border: 1px solid #e4e7ec;
    border-radius: 12px;
    &:focus-within {
      border: 1px solid transparent;
      box-shadow: 0 0 0 2px #667eea
    }
  }
  .dark-mode .chat-input-wrapper{
    background:#191919;
    border: 1px solid #323232;
    border-radius: 12px;
     &:focus-within {
      border: 1px solid transparent;
      box-shadow: 0 0 0 2px #5a6ec3
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
  max-height: 400px;
  display: flex;
  flex-direction: column;
}

.search-history-bar-sticky {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--q-page-background);
  padding: 8px;
  border-bottom: 1px solid var(--q-separator-color);
}

.history-list-container {
  flex: 1;
  overflow-y: auto;
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

// Subtle gradient animation
@keyframes subtleShift {
  0% {
    background-position: 0% 50%;
  }
  25% {
    background-position: 100% 50%;
  }
  50% {
    background-position: 100% 100%;
  }
  75% {
    background-position: 0% 100%;
  }
  100% {
    background-position: 0% 50%;
  }
}

// Context annotation styling
.context-annotation {
  padding: 8px 12px;
  margin: 8px 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  font-size: 12px;
  position: sticky;
  top: 0;
  z-index: 10;
}

.context-annotation-light {
  background: linear-gradient(135deg, #e8edff 0%, #f8f9ff 100%);
  border: 1px solid #d0d8ff;
  color: #2c3e50;
}

.context-annotation-dark {
  background: linear-gradient(135deg, #1e213a 0%, #2a2d47 100%);
  border: 1px solid #3a3d5c;
  color: #e2e8f0;
}

// Tool call item - inline in chat flow (interleaved with text)
.tool-call-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 8px;

  &.light-mode {
    background: rgba(76, 175, 80, 0.08);
    color: #4a5568;
  }

  &.dark-mode {
    background: rgba(76, 175, 80, 0.12);
    color: #a0aec0;
  }

  .tool-call-name {
    font-weight: 500;
    flex: 1;
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
}
</style> 