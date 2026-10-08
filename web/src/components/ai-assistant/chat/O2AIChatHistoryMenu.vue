<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

defineProps<{
  chats: Array<{ id: number; title: string; timestamp: string }>;
}>();

const searchTerm = defineModel<string>("searchTerm", { required: true });

const emit = defineEmits<{
  (e: "select", chatId: number): void;
  (e: "delete", chatId: number): void;
  (e: "clear-all"): void;
}>();

const { t } = useI18nTyped();

const formatTime = (timestamp: string) => new Date(timestamp).toLocaleString();
</script>

<template>
  <div class="history-menu-container relative flex max-h-112.5 w-75 flex-col">
    <OSearchInput
      v-model="searchTerm"
      :placeholder="t('aiAssistant.searchChatHistory')"
      class="sticky top-0 z-2 shrink-0 p-2"
    />
    <div class="history-list-container max-h-87.5 flex-1 overflow-x-hidden overflow-y-auto">
      <ODropdownItem
        v-for="chat in chats"
        :key="chat.id"
        class="history-item group relative"
        @select="emit('select', chat.id)"
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
            @click.stop="emit('delete', chat.id)"
          >
            <OIcon name="delete" size="sm" />
            <OTooltip :content="t('aiAssistant.deleteChatTooltip')" />
          </OButton>
        </div>
      </ODropdownItem>
      <div v-if="chats.length === 0" class="text-text-muted p-2 text-center">
        {{ t("aiAssistant.noMatchingChatsFound") }}
      </div>
    </div>

    <!-- Clear all conversations button -->
    <div v-if="chats.length > 0" class="clear-all-container bg-surface-base shrink-0">
      <ODropdownSeparator />
      <OButton
        variant="ghost-destructive"
        class="clear-all-btn text-compact w-full justify-start px-3 py-1.5"
        @click.stop="emit('clear-all')"
      >
        <template #icon-left>
          <OIcon name="delete-sweep" size="sm" />
        </template>
        {{ t("aiAssistant.clearAllConversations") }}
      </OButton>
    </div>
  </div>
</template>
