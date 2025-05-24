<template>
  <div class="chat-container" :class="[{ 'chat-open': isOpen }, store.state.theme == 'dark' ? 'dark-mode' : 'light-mode']" 
  >
    <div v-if="isOpen" class="chat-content-wrapper" :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
      <div class="chat-header" :style="{ height:  headerHeight ? headerHeight + 'px' : '' }">
        <div class="chat-title tw-flex tw-justify-between tw-items-center tw-w-full">

          <div >
            <q-avatar size="24px" class="q-mr-sm">
              <img :src="o2AiTitleLogo" />
            </q-avatar>
            <span>O2 AI</span>
          </div>

          <div>
            <q-btn flat round dense icon="add" @click="addNewChat" />
            <q-btn flat round dense icon="history" @click="loadHistory">
              <q-menu>
                <q-list style="min-width: 200px; max-width: 300px; border: 1px solid var(--q-separator-color);" padding>
                  <q-item
                    v-for="chat in chatHistory"
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
                </q-list>
              </q-menu>
            </q-btn>
            <q-btn flat round dense icon="close" @click="$emit('close')" />
          </div>
        </div>
      </div>
      <q-separator class="tw-bg-[#DBDBDB]" />
      
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
        <div class="messages-container " ref="messagesContainer">
          <div v-if="chatMessages.length === 0" class="welcome-section ">
            <div class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-h-full ">
              <img :src="o2AiTitleLogo" />
              <span class="tw-text-[14px] tw-font-[600] tw-text-center">AI native  observability</span>
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
              <q-avatar v-if="message.role === 'user'" size="24px" class="q-mr-sm">
                <q-icon size="16px" color="primary" name="person" />
              </q-avatar>
              <div class="message-blocks" style="background-color: transparent;" :class="store.state.theme == 'dark' ? 'dark-mode' : 'light-mode'">
                <template v-for="(block, blockIndex) in message.blocks" :key="blockIndex">
                  <div v-if="block.type === 'code'" class="code-block" >
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
                      <div class="tw-flex tw-items-center">
                        <q-icon size="16px" name="content_copy" />
                        <span class="tw-ml-1" >Copy</span>
                      </div>
                      </q-btn>
                    </div>
                    <span class="generated-code-block">
                      <code :class="['hljs', block.language]" v-html="block.highlightedContent"></code>
                    </span>
                    <div class="code-block-footer code-block-theme tw-flex tw-items-center tw-justify-between tw-w-full">
                      <q-btn
                        flat
                        dense
                        class="retry-button"
                        no-caps
                        color="primary"
                        @click="retryGeneration(message)"
                      >
                      <div class="tw-flex tw-items-center">
                        <q-icon size="16px" name="refresh" />
                        <span class="tw-ml-1" >Retry</span>
                      </div>
                      </q-btn>
                      <div class="tw-flex tw-items-center tw-gap-2">
                        <q-btn flat dense :icon="outlinedThumbUpOffAlt" color="primary" @click="likeCodeBlock(message)"  />
                        <q-btn flat dense :icon="outlinedThumbDownOffAlt" color="primary" @click="dislikeCodeBlock(message)"  />
                      </div>
                    </div>
                  </div>
                  <div v-else class="text-block" v-html="processHtmlBlock(block.content)"></div>

                </template>
              </div>
            </div>
          </div>
          <div v-if="isLoading" class="">
            <q-spinner-dots color="primary" size="2em" />
            <span>Generating response...</span>
          </div>
        </div>
      </div>
      <div class="chat-input-wrapper tw-flex tw-flex-col q-ma-md" >
        <q-input
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
        >
        </q-input>
        <div class="tw-flex tw-items-center tw-justify-end tw-mt-2 tw-gap-2" :class="store.state.theme == 'dark' ? 'dark-mode-bottom-bar' : 'light-mode-bottom-bar'">
          <q-select
              v-model="selectedModel"
              :options="availableModels"
              dense
              :borderless="true"
              class="tw-w-24 model-selector"
              style="max-width: 100px; height: 36px;"
            >
              <template v-slot:selected-item="scope">
                <div
                  class="ellipsis"
                  style="max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;"
                >
                  {{ scope.opt.label || scope.opt }}
                </div>
              </template>
            </q-select>

          <q-btn
            color="primary"
            :disable="isLoading || !inputMessage.trim()"
            @click="sendMessage"
            class="tw-px-2 tw-rounded-md no-border"
            no-caps

          >
            <div class="tw-flex tw-items-center tw-gap-2">
              <img :src="getGenerateAiIcon" class="tw-w-4 tw-h-4" />
              <span class="tw-text-[12px]">Generate</span>
            </div>
          </q-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, nextTick, watch, computed, onUnmounted } from 'vue';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { marked } from 'marked';
import { MarkedOptions } from 'marked';
import { useQuasar } from 'quasar';
import { useStore } from 'vuex';
import useAiChat from '@/composables/useAiChat';

import { outlinedThumbUpOffAlt, outlinedThumbDownOffAlt } from '@quasar/extras/material-icons-outlined';
import { getImageURL } from '@/utils/zincutils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatHistoryEntry {
  id: number;
  timestamp: string;
  title: string;
  messages: ChatMessage[];
  provider: string;
  model: string;
}

// Add IndexedDB setup
const DB_NAME = 'o2ChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'chatHistory';

const { fetchAiChat } = useAiChat();

const initDB = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    //this opens / creates(if not exists) the database with the name o2ChatDB and version 1
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    console.log('request', request);

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
  name: 'O2AIChat',
  props: {
    isOpen: {
      type: Boolean,
      default: false
    },
    headerHeight: {
      type: Number,
      default: 0,
    }
  },
  setup(props) {
    const $q = useQuasar();
    const inputMessage = ref('');
    const chatMessages = ref<ChatMessage[]>([]);
    const isLoading = ref(false);
    const messagesContainer = ref<HTMLElement | null>(null);
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
    
    const modelConfig: any = {
      openai: [
        'o4-mini-2025-04-16',
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

    const scrollToBottom = async () => {
      await nextTick();
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
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
                  if (data && typeof data.content === 'string') {
                    // Format code blocks with proper line breaks
                    let content = data.content;
                    
                    // Add line break after opening backticks if not present
                    content = content.replace(/```(\w*)\s*([^`])/g, '```$1\n$2');
                    
                    // Add line break before closing backticks if not present
                    content = content.replace(/([^`])\s*```/g, '$1\n```');
                    
                    currentStreamingMessage.value += content;
                    if (chatMessages.value.length > 0) {
                      const lastMessage = chatMessages.value[chatMessages.value.length - 1];
                      lastMessage.content = currentStreamingMessage.value;
                      messageComplete = true;
                    }
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
                if (data && typeof data.content === 'string') {
                  // Format code blocks with proper line breaks
                  let content = data.content;
                  
                  // Add line break after opening backticks if not present
                  content = content.replace(/```(\w*)\s*([^`])/g, '```$1\n$2');
                  
                  // Add line break before closing backticks if not present
                  content = content.replace(/([^`])\s*```/g, '$1\n```');
                  
                  currentStreamingMessage.value += content;
                  if (chatMessages.value.length > 0) {
                    const lastMessage = chatMessages.value[chatMessages.value.length - 1];
                    lastMessage.content = currentStreamingMessage.value;
                    messageComplete = true;
                  }
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
        console.error('Error reading stream:', error);
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

    const loadHistory = async () => {
      try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.index('timestamp').openCursor(null, 'prev');
        
        const history: any[] = [];
        
        return new Promise((resolve, reject) => {
          request.onsuccess = (event: Event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
              history.push(cursor.value);
              cursor.continue();
            } else {
              chatHistory.value = history;
              resolve(history);
            }
          };
          request.onerror = () => reject(request.error);
        });
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

    const sendMessage = async () => {
      if (!inputMessage.value.trim() || isLoading.value) return;

      const userMessage = inputMessage.value;
      chatMessages.value.push({
        role: 'user',
        content: userMessage
      });
      inputMessage.value = '';
      await scrollToBottom();
      await saveToHistory(); // Save after user message

      isLoading.value = true;
      currentStreamingMessage.value = '';
      
      try {
        chatMessages.value.push({
          role: 'assistant',
          content: ''
        });
        let response: any;
        try { 
          response = await fetchAiChat(chatMessages.value.slice(0, -1),"",store.state.org_id);
        } catch (error) {
          console.error('Error fetching AI chat:', error);
          return;
        }

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }


        const reader = response.body.getReader();
        await processStream(reader);

        store.dispatch('setCurrentChatTimestamp', currentChatId.value);
        store.dispatch('setChatUpdated', true);
        
        // Save is now handled after stream processing completes

      } catch (error) {
        console.error('Error sending message:', error);
        if (chatMessages.value.length > 0 && chatMessages.value[chatMessages.value.length - 1].role === 'assistant') {
          chatMessages.value[chatMessages.value.length - 1].content = 'Error: Unable to get response from the server';
        } else {
          chatMessages.value.push({
            role: 'assistant',
            content: 'Error: Unable to get response from the server'
          });
        }
        await saveToHistory(); // Save after error
      }

      isLoading.value = false;
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
      }
    };

    // Watch for isOpen changes to fetch initial message when opened
    watch(() => props.isOpen, (newValue) => {
      if (newValue) {
        if (chatMessages.value.length === 0) {
          fetchInitialMessage();
        }
        loadHistory(); // Load history when chat is opened
      }
    });

    // Only fetch initial message if component starts as open
    onMounted(() => {
      if (props.isOpen) {
        fetchInitialMessage();
        loadHistory(); // Load history on mount if chat is open
        loadChat(store.state.currentChatTimestamp);
      }
    });

    onUnmounted(()=>{
      store.dispatch('setCurrentChatTimestamp', currentChatId.value);
      store.dispatch('setChatUpdated', true);      if ( store.state.currentChatTimestamp) {
        loadChat(store.state.currentChatTimestamp);
      }
      if(!store.state.currentChatTimestamp) {
        addNewChat();
      }
    })

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
            ? hljs.highlight(codeText, { language: token.lang }).value
            : hljs.highlightAuto(codeText).value;

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
      return chatMessages.value.map(message => ({
        ...message,
        blocks: processMessageContent(message.content)
      }));
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
      // Replace pre tags with span and add our custom class
      return content.replace(/<pre([^>]*)>/g, '<span class="generated-code-block"$1>')
                   .replace(/<\/pre>/g, '</span>');
    };

    const formatTime = (timestamp: string) => {
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    const likeCodeBlock = (message: any) => {
      console.log('likeCodeBlock', message);
    };

    const dislikeCodeBlock = (message: any) => {
      console.log('dislikeCodeBlock', message);
    };
    const o2AiTitleLogo = computed(() => {
      return store.state.theme == 'dark' ? getImageURL('images/common/o2_ai_logo_dark.svg') : getImageURL('images/common/o2_ai_logo.svg')
    });
    const getGenerateAiIcon = computed(()=> {
      return getImageURL('images/common/ai_icon.svg')
    })
    return {
      inputMessage,
      chatMessages,
      isLoading,
      sendMessage,
      handleKeyDown,
      messagesContainer,
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
      saveHistoryLoading
    }
  }
});
</script>

<style lang="scss" scoped>
.chat-container {
  width: 100%;
  height: 100vh;
  background: var(--q-page-background);
  color: var(--q-primary-text);
  display: flex;
  flex-direction: column;
  
  overflow: hidden;

  .chat-content-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
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
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 16px;
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

    :deep(.q-field) {
      max-width: 900px;
      width: 100%;
    }
  }
  .light-mode .chat-input-wrapper{
    background:#ffffff;
    border: 1px solid #e4e7ec;
  }
  .dark-mode .chat-input-wrapper{
    background:#191919;
    border: 1px solid #323232;
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
      gap: 12px;
      width: 100%;
    }

    .message-blocks {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0;
      min-width: 0;
    }

    .text-block {
      width: 100%;
      overflow-wrap: break-word;
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
        
        code {
          padding: 8px;
          margin: 0;
          display: block;
        }
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
      background: white;
      color: black;
    }

    &.assistant {
      background: #fafafa;
      color: var(--q-primary-text);
    }
  }
  .dark-mode .message{
    &.user {
      background: #181a1b;
      color: #e2e2e2;
    }

    &.assistant {
      background: #181a1b;
      color: #e2e2e2;
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
    padding: 0px 6px;
  }

}

.light-mode-bottom-bar{
  .model-selector{
    background-color: #ffffff;
    border: 1px solid #f3f3f3;
    padding: 0px 4px;
  }
}
</style> 