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
  <div class="relative isolate flex h-full min-h-0 min-w-0">
    <aside
      v-if="railShown"
      :aria-label="t('assistant.history.title')"
      :class="HOME_RAIL_CLASS"
      data-test="assistant-home-chats"
    >
      <HomeChatsRail />
    </aside>
    <div
      class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4"
      data-test="assistant-home-tab"
      :data-state="state"
    >
      <div
        class="relative mx-auto flex min-h-0 w-full max-w-5xl min-w-0 flex-1 flex-col gap-4 pt-[12vh] max-md:pt-0"
        data-test="assistant-home-main"
      >
        <AgentHomeGreeting :class="entering && RISE.greeting" />
        <AgentHomeAskNote
          v-if="offReason"
          :reason="offReason"
          :org="org"
          class="mx-auto max-w-3xl"
        />
        <AssistantLauncher
          v-else
          ref="launcher"
          layout="overview"
          :page-range="pageRange"
          class="mx-auto max-w-3xl"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  ref,
} from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import AssistantLauncher from "@/components/ai-assistant/welcome/AssistantLauncher.vue";
import type { ComposerState } from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import { useI18nTyped } from "@/types/i18n";

import AgentHomeAskNote from "./AgentHomeAskNote.vue";
import AgentHomeGreeting from "./AgentHomeGreeting.vue";
import { HOME_RAIL_CLASS } from "./homeState";
import { DEFAULT_HOME_RANGE, periodToMs, readHomeUrl } from "./homeUrl";
import { useAgentHomeState } from "./useAgentHomeState";
import { useHomeRefresh } from "./useHomeRefresh";

const HomeChatsRail = defineAsyncComponent(() => import("./HomeChatsRail.vue"));

// A 0.5s fade-up, none under reduced motion; a literal string so Tailwind emits it.
const RISE = {
  greeting: "motion-safe:animate-[assistant-fade-up_0.5s_ease-out_both]",
} as const;

const { t } = useI18nTyped();
const route = useRoute();
const store = useStore();
const { lgUp } = useBreakpoint();
const { state, offReason } = useAgentHomeState();

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const range = readHomeUrl(route.query).range ?? DEFAULT_HOME_RANGE;
// A relative range ends now, so its bounds move with the clock while Home is on screen.
const now = ref(Date.now());
useHomeRefresh(
  () => range.type === "relative",
  () => (now.value = Date.now()),
);

// Past chats stay readable with the credits used up; no agent, Open Source or a loading gate draws no rail.
const railShown = computed(() => lgUp.value && (state.value === "ai" || state.value === "budget"));
onMounted(() => focusAsk());
// A kept-alive return to Home is an arrival too; the first activation follows the mount, which already asked.
let activatedOnce = false;
onActivated(() => {
  if (activatedOnce) focusAsk();
  activatedOnce = true;
});

const pageRange = computed<NonNullable<ComposerState["timeOverride"]>>(() =>
  range.type === "relative"
    ? { from: now.value - periodToMs(range.period), to: now.value, period: range.period }
    : { from: Math.floor(range.from / 1000), to: Math.ceil(range.to / 1000) },
);

// The entrance plays once per mount; a kept-alive return re-inserts the nodes, which would replay it.
const entering = ref(true);
onDeactivated(() => (entering.value = false));

const launcher = ref<InstanceType<typeof AssistantLauncher> | null>(null);

function focusAsk(): void {
  void nextTick(() => launcher.value?.focusAsk?.());
}
</script>
