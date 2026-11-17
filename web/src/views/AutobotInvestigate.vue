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
  <div class="relative isolate flex h-full min-h-0 min-w-0 overflow-hidden">
    <!-- overflow-hidden clips the thread's entrance slide, which would flash MainLayout's page scrollbar, as Home's root does -->
    <aside
      v-if="railShown"
      :aria-label="t('assistant.history.filter.investigations')"
      :class="HOME_RAIL_CLASS"
      data-test="autobot-investigate-chats"
    >
      <HomeChatsRail
        investigations
        :thread="threadShown"
        @close="threadShown && threadView?.focusEntry()"
      />
    </aside>
    <AssistantView
      v-if="threadShown"
      ref="threadView"
      :chat-id="threadId"
      bare
      class="h-full min-h-0 min-w-0 flex-1"
      data-test="autobot-investigate-thread"
    />
    <div
      v-else
      class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4"
      data-test="autobot-investigate"
      :data-state="state"
    >
      <div
        class="relative mx-auto flex min-h-0 w-full max-w-5xl min-w-0 flex-1 flex-col gap-4 pt-[12vh] max-md:pt-0"
        data-test="autobot-investigate-main"
      >
        <AgentHomeGreeting investigate :class="RISE.greeting" />
        <AgentHomeAskNote
          v-if="offReason"
          :reason="offReason"
          :org="org"
          class="mx-auto max-w-3xl"
        />
        <!-- mt-3 leaves room for the chip row that floats above the box, clear of the greeting -->
        <AssistantLauncher
          v-else
          ref="launcher"
          layout="overview"
          fixed-agent="sre"
          :ask-placeholder="t('autobotInvestigate.placeholder')"
          class="mx-auto mt-3 max-w-3xl"
        />
        <AssistantHomeExamples
          v-if="state === 'ai'"
          :cards="INVESTIGATE_CARDS"
          :prompts="false"
          class="mx-auto max-w-3xl"
          @select="launcher?.fill($event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import AssistantHomeExamples from "@/components/ai-assistant/welcome/AssistantHomeExamples.vue";
import AssistantLauncher from "@/components/ai-assistant/welcome/AssistantLauncher.vue";
import { INVESTIGATE_CARDS } from "@/components/ai-assistant/welcome/welcomeContent";
import { threadHost, threadParam } from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import { useI18nTyped } from "@/types/i18n";

import AgentHomeAskNote from "./home/AgentHomeAskNote.vue";
import AgentHomeGreeting from "./home/AgentHomeGreeting.vue";
import { HOME_RAIL_CLASS } from "./home/homeState";
import { useAgentHomeState } from "./home/useAgentHomeState";
import { useThreadUrlSync } from "./home/useThreadUrl";

const ROUTE_NAME = "autobotInvestigate";

const HomeChatsRail = defineAsyncComponent(() => import("./home/HomeChatsRail.vue"));
const AssistantView = defineAsyncComponent(() => import("./AssistantView.vue"));

// A 0.5s fade-up, none under reduced motion; a literal string so Tailwind emits it.
const RISE = {
  greeting: "motion-safe:animate-[assistant-fade-up_0.5s_ease-out_both]",
} as const;

const { t } = useI18nTyped();
const store = useStore();
const { lgUp } = useBreakpoint();
const { state, offReason } = useAgentHomeState();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

// Past chats stay readable with the credits used up; no agent, Open Source or a loading gate draws no rail.
const chatsOn = computed(() => state.value === "ai" || state.value === "budget");
const railShown = computed(() => lgUp.value && chatsOn.value);

// A chat sent or picked here opens on this page, as `?thread=` does on Home, so the Investigations rail stays beside it.
const route = useRoute();
const threadId = computed(() => (route.name === ROUTE_NAME ? threadParam(route.query) : null));
const threadShown = computed(() => threadId.value !== null && chatsOn.value);
const threadView = ref<{ focusEntry(): void } | null>(null);
threadHost.value = ROUTE_NAME;
onBeforeUnmount(() => (threadHost.value = "home"));
useThreadUrlSync(import("@/composables/assistant"), ROUTE_NAME);
const launcher = ref<InstanceType<typeof AssistantLauncher> | null>(null);
onMounted(() => void nextTick(() => launcher.value?.focusAsk?.()));
</script>
