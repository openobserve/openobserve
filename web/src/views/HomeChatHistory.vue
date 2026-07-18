<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useChatHistory } from "@/composables/useChatHistory";
import type { ChatHistoryEntry } from "@/ts/interfaces/chat";
import OButton from "@/lib/core/Button/OButton.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

const emit = defineEmits<{
  (e: "load-chat", id: number): void;
  (e: "new-chat"): void;
}>();

const store = useStore();
const { t } = useI18n();

const { loadHistory, deleteChatById, clearAllHistory } = useChatHistory(
  () => store.state.userInfo.email ?? "",
  () => store.state.selectedOrganization.identifier ?? "",
);

const { confirm } = useConfirmDialog();

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

async function clearAll() {
  const ok = await confirm({
    title: t("chatHistory.clearAllTitle"),
    message: t("chatHistory.clearAllMessage"),
  });
  if (ok) {
    await clearAllHistory();
    newChat();
    await refresh();
  }
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
    class="flex flex-col h-full text-base w-[15em] shrink-0 border-r border-r-[0.0625em] border-card-glass-border bg-card-glass-bg overflow-hidden"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-3 pt-[0.625em] pb-[0.375em] shrink-0">
      <span class="text-[0.8125em] font-semibold opacity-70">{{ t("chatHistory.title") }}</span>
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
    <div class="px-2 pb-[0.375em] shrink-0">
      <div class="flex items-center gap-[0.375em] bg-input-bg rounded-default px-[0.375em]">
        <svg
          class="opacity-50 shrink-0"
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
          class="hch-search-input flex-1 min-w-0 border-0 bg-transparent outline-none text-[0.8125em] text-text-body py-[0.375em] placeholder:text-text-muted placeholder:opacity-70"
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
    <div class="hch-list flex-1 overflow-y-auto py-1 px-[0.375em]">
      <div
        v-for="chat in filtered"
        :key="chat.id"
        class="group flex items-center gap-1 py-[0.4375em] px-2 rounded-default cursor-pointer transition-[background] duration-[120ms] hover:bg-interactive-hover-bg"
        :class="{
          'bg-primary-100!': activeChatId === chat.id,
        }"
        @click="selectChat(chat.id)"
      >
        <div class="flex-1 min-w-0">
          <div class="text-[0.8125em] leading-[1.35] truncate text-text-body" :class="{ 'font-medium': activeChatId === chat.id }">{{ chat.title }}</div>
          <div class="text-[0.6875em] text-text-secondary mt-[0.0625em]">{{ formatTime(chat.timestamp) }}</div>
        </div>
        <span class="inline-flex items-center shrink-0 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100">
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

      <div v-if="filtered.length === 0" class="text-center text-[0.8125em] opacity-[0.45] py-[1.5em]">
        {{
          searchTerm ? t("chatHistory.noMatches") : t("chatHistory.noHistory")
        }}
      </div>
    </div>

    <!-- Clear all -->
    <div v-if="history.length > 0" class="shrink-0 py-[0.375em] px-2 border-t border-t-[0.0625em] border-t-card-glass-border">
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
