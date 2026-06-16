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
    class="tw:flex tw:flex-col tw:h-full tw:text-base tw:w-[15em] tw:shrink-0 tw:border-r tw:border-[0.0625em] tw:border-(--o2-border-color) tw:bg-(--o2-card-bg) tw:overflow-hidden"
    :class="store.state.theme === 'dark' ? 'hch-dark' : 'hch-light'"
  >
    <!-- Header -->
    <div class="tw:flex tw:items-center tw:justify-between tw:px-3 tw:pt-[0.625em] tw:pb-[0.375em] tw:shrink-0">
      <span class="tw:text-[0.8125em] tw:font-semibold tw:opacity-70">{{ t("chatHistory.title") }}</span>
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
    <div class="tw:px-2 tw:pb-[0.375em] tw:shrink-0">
      <div class="tw:flex tw:items-center tw:gap-[0.375em] tw:bg-(--o2-input-bg) tw:rounded-md tw:px-[0.375em]">
        <svg
          class="tw:opacity-50 tw:shrink-0"
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
          class="hch-search-input tw:flex-1 tw:min-w-0 tw:border-0 tw:bg-transparent tw:outline-none tw:text-[0.8125em] tw:text-(--o2-text-primary) tw:py-[0.375em]"
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
    <div class="hch-list tw:flex-1 tw:overflow-y-auto tw:py-1 tw:px-[0.375em]">
      <div
        v-for="chat in filtered"
        :key="chat.id"
        class="hch-item tw:flex tw:items-center tw:gap-1 tw:py-[0.4375em] tw:px-2 tw:rounded-md tw:cursor-pointer tw:transition-[background] tw:duration-[120ms] tw:hover:bg-[var(--o2-hover-color,rgba(128,128,128,0.1))]"
        :class="{
          'hch-item-active': activeChatId === chat.id,
          'tw:bg-[var(--o2-selected-color,rgba(57,126,246,0.12))]!': activeChatId === chat.id,
        }"
        @click="selectChat(chat.id)"
      >
        <div class="tw:flex-1 tw:min-w-0">
          <div class="hch-item-title tw:text-[0.8125em] tw:leading-[1.35] tw:truncate tw:text-(--o2-text-body)">{{ chat.title }}</div>
          <div class="tw:text-[0.6875em] tw:text-(--o2-text-caption) tw:mt-[0.0625em]">{{ formatTime(chat.timestamp) }}</div>
        </div>
        <span class="hch-delete-wrap tw:inline-flex tw:items-center tw:shrink-0 tw:opacity-0 tw:transition-opacity tw:duration-[120ms]">
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

      <div v-if="filtered.length === 0" class="tw:text-center tw:text-[0.8125em] tw:opacity-[0.45] tw:py-[1.5em]">
        {{
          searchTerm ? t("chatHistory.noMatches") : t("chatHistory.noHistory")
        }}
      </div>
    </div>

    <!-- Clear all -->
    <div v-if="history.length > 0" class="tw:shrink-0 tw:py-[0.375em] tw:px-2 tw:border-t tw:border-[0.0625em] tw:border-(--o2-border-color)">
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

<style>
/* placeholder pseudo-element — cannot be inlined */
.hch-search-input::placeholder {
  color: var(--o2-text-muted);
  opacity: 0.7;
}

/* descendant selector — cannot be inlined on parent */
.hch-item:hover .hch-delete-wrap {
  opacity: 1;
}

/* descendant selector — cannot be inlined on parent */
.hch-item-active .hch-item-title {
  color: var(--o2-text-body);
  font-weight: 500;
}
</style>
