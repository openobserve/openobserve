<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <!-- The rail's top padding is the main column's, so Chats sits on the greeting's top line -->
  <div class="flex h-full min-h-0 min-w-0 flex-col gap-2 pt-4" data-test="home-chats-rail">
    <div class="flex h-8 shrink-0 items-center gap-1 px-3" data-test="home-chats-rail-header">
      <!-- The list names itself with a hidden heading, so the visible title is not read twice -->
      <span aria-hidden="true" class="text-text-heading min-w-0 flex-1 text-sm font-medium">
        {{ t("assistant.history.title") }}
      </span>
      <AssistantIconButton
        :label="t('assistant.thread.newChat')"
        :icon="assistantGlyph.newChat"
        data-test="home-chats-rail-new"
        @click="newChat"
      />
    </div>
    <AssistantHistoryList
      mode="rail"
      bare
      container="full_view"
      :current-sid="thread ? store.state.shell.activeSid : null"
      class="min-h-0 flex-1"
      @close="onClose"
      @shared-links="sharesOpen = true"
    />
    <AssistantShareManager v-model:open="sharesOpen" initial-scope="mine" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantHistoryList from "@/components/ai-assistant/history/AssistantHistoryList.vue";
import AssistantShareManager from "@/components/ai-assistant/share/AssistantShareManager.vue";
import { useAssistantStore } from "@/composables/assistant";
import { homeAskLocation } from "@/composables/assistant/pure";
import { requestOverviewFocus } from "@/composables/goto/goToRequests";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  /** Beside a chat open on Home: that chat is marked, and New chat goes back to the Ask box. */
  thread?: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const route = useRoute();
const router = useRouter();
const sharesOpen = ref(false);

// Home's hero is the new-chat state, so New chat lands on its Ask box.
function newChat(): void {
  if (props.thread) void router.push(homeAskLocation(route.query)).catch(() => undefined);
  else requestOverviewFocus();
}

// Escape hands focus to the Ask box on the hero, and to the open chat beside one.
function onClose(): void {
  if (props.thread) emit("close");
  else requestOverviewFocus();
}
</script>
