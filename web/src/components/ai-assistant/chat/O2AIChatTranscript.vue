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

<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { processChatMessage } from "@/components/O2AIChat.content";
import O2AIChatMessage from "./O2AIChatMessage.vue";

const props = defineProps<{
  messages: ChatMessage[];
}>();

const processed = computed(() => props.messages.map(processChatMessage));

const expandedToolCalls = ref<Set<string>>(new Set());
const expandedLogEntries = ref<Set<string>>(new Set());

// Keys are `${messageIndex}-${blockIndex}`, the shape O2AIChatMessage reads.
const toggle = (set: Set<string>, messageIndex: number, blockIndex: number) => {
  const key = `${messageIndex}-${blockIndex}`;
  if (set.has(key)) set.delete(key);
  else set.add(key);
};
</script>

<template>
  <div class="flex w-full flex-col gap-4" data-test="o2-ai-chat-transcript">
    <O2AIChatMessage
      v-for="(message, index) in processed"
      :key="index"
      :message="message"
      :index="index"
      :is-loading="false"
      current-analyzing-message=""
      :expanded-tool-calls="expandedToolCalls"
      :expanded-log-entries="expandedLogEntries"
      readonly
      @toggle-tool-call="(blockIndex: number) => toggle(expandedToolCalls, index, blockIndex)"
      @toggle-log-entry="(blockIndex: number) => toggle(expandedLogEntries, index, blockIndex)"
    />
  </div>
</template>
