<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import { useChatHistory } from "@/composables/useChatHistory";
import type { ChatHistoryEntry } from "@/ts/interfaces/chat";
import OButton from "@/lib/core/Button/OButton.vue";

const emit = defineEmits<{
  (e: "load-chat", id: number): void;
  (e: "new-chat"): void;
}>();

const store = useStore();
const { t } = useI18n();
const $q = useQuasar();

const { loadHistory, deleteChatById, clearAllHistory } = useChatHistory(
  () => store.state.userInfo.email ?? "",
  () => store.state.selectedOrganization.identifier ?? "",
);

const history = ref<ChatHistoryEntry[]>([]);
const searchTerm = ref("");

async function refresh() {
  history.value = await loadHistory();
}

onMounted(refresh);

// Re-fetch whenever a chat is saved (chatUpdated flips true)
watch(
  () => store.state.chatUpdated,
  (val) => {
    if (val) refresh();
  },
);

const filtered = computed(() => {
  const q = searchTerm.value.trim().toLowerCase();
  if (!q) return history.value;
  return history.value.filter((c) => c.title.toLowerCase().includes(q));
});

const activeChatId = computed(() => store.state.currentChatTimestamp);

function selectChat(id: number) {
  store.dispatch("setCurrentChatTimestamp", id);
  emit("load-chat", id);
}

function newChat() {
  store.dispatch("setCurrentChatTimestamp", null);
  emit("new-chat");
}

async function deleteChat(e: MouseEvent, id: number) {
  e.stopPropagation();
  await deleteChatById(id);
  if (activeChatId.value === id) newChat();
  await refresh();
}

function clearAll() {
  $q.dialog({
    title: t("chatHistory.clearAllTitle"),
    message: t("chatHistory.clearAllMessage"),
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    await clearAllHistory();
    newChat();
    await refresh();
  });
}

function formatTime(ts: string): string {
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
</script>

<template>
  <div
    class="hch-root"
    :class="store.state.theme === 'dark' ? 'hch-dark' : 'hch-light'"
  >
    <!-- Header -->
    <div class="hch-header">
      <span class="hch-title">{{ t("chatHistory.title") }}</span>
      <OButton
        variant="ghost-muted"
        size="icon"
        :title="t('chatHistory.newChat')"
        @click="newChat"
      >
        <svg
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </OButton>
    </div>

    <!-- Search -->
    <div class="hch-search">
      <div class="hch-search-wrap">
        <svg
          class="hch-search-icon"
          width="0.875em"
          height="0.875em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="searchTerm"
          class="hch-search-input"
          :placeholder="t('chatHistory.search')"
          type="text"
        />
        <OButton
          v-if="searchTerm"
          variant="ghost-subtle"
          size="icon"
          @click="searchTerm = ''"
        >
          <svg
            width="0.75em"
            height="0.75em"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </OButton>
      </div>
    </div>

    <!-- List -->
    <div class="hch-list">
      <div
        v-for="chat in filtered"
        :key="chat.id"
        class="hch-item"
        :class="{ 'hch-item-active': activeChatId === chat.id }"
        @click="selectChat(chat.id)"
      >
        <div class="hch-item-content">
          <div class="hch-item-title">{{ chat.title }}</div>
          <div class="hch-item-time">{{ formatTime(chat.timestamp) }}</div>
        </div>
        <span class="hch-delete-wrap">
          <OButton
            variant="ghost-destructive"
            size="icon"
            :title="t('chatHistory.delete')"
            @click="deleteChat($event, chat.id)"
          >
            <svg
              width="0.875em"
              height="0.875em"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </OButton>
        </span>
      </div>

      <div v-if="filtered.length === 0" class="hch-empty">
        {{
          searchTerm ? t("chatHistory.noMatches") : t("chatHistory.noHistory")
        }}
      </div>
    </div>

    <!-- Clear all -->
    <div v-if="history.length > 0" class="hch-footer">
      <OButton variant="ghost-subtle" :block="true" @click="clearAll">
        <svg
          width="0.875em"
          height="0.875em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
        </svg>
        {{ t("chatHistory.clearAll") }}
      </OButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.hch-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 1rem;
  width: 15em;
  flex-shrink: 0;
  border-right: 0.0625em solid var(--o2-border-color);
  background: var(--o2-card-bg);
  overflow: hidden;
}

.hch-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.625em 0.75em 0.375em;
  flex-shrink: 0;
}

.hch-title {
  font-size: 0.8125em;
  font-weight: 600;
  opacity: 0.7;
}

.hch-search {
  padding: 0 0.5em 0.375em;
  flex-shrink: 0;
}

.hch-search-wrap {
  display: flex;
  align-items: center;
  gap: 0.375em;
  background: var(--o2-input-bg, rgba(128, 128, 128, 0.08));
  border-radius: 0.375em;
  padding: 0 0.375em;
}

.hch-search-icon {
  opacity: 0.5;
  flex-shrink: 0;
}

.hch-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.8125em;
  color: var(--o2-text-primary);
  padding: 0.375em 0;

  &::placeholder {
    color: var(--o2-text-muted);
    opacity: 0.7;
  }
}

.hch-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.25em 0.375em;
}

.hch-item {
  display: flex;
  align-items: center;
  gap: 0.25em;
  padding: 0.4375em 0.5em;
  border-radius: 0.375em;
  cursor: pointer;
  transition: background 0.12s;

  &:hover {
    background: var(--o2-hover-color, rgba(128, 128, 128, 0.1));

    .hch-delete-wrap {
      opacity: 1;
    }
  }
}

.hch-item-active {
  background: var(--o2-selected-color, rgba(57, 126, 246, 0.12)) !important;

  .hch-item-title {
    color: var(--o2-primary-color, #397ef6);
    font-weight: 500;
  }
}

.hch-item-content {
  flex: 1;
  min-width: 0;
}

.hch-delete-wrap {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}

.hch-item-title {
  font-size: 0.8125em;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hch-item-time {
  font-size: 0.6875em;
  opacity: 0.45;
  margin-top: 0.0625em;
}

.hch-empty {
  text-align: center;
  font-size: 0.8125em;
  opacity: 0.45;
  padding: 1.5em 0;
}

.hch-footer {
  flex-shrink: 0;
  padding: 0.375em 0.5em;
  border-top: 0.0625em solid var(--o2-border-color);
}
</style>
