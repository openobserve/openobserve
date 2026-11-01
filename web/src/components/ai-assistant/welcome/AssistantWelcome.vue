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
  <section
    data-test="assistant-welcome"
    :data-variant="variant"
    :data-fresh="fresh ? '' : undefined"
    :aria-label="t('assistant.welcome.suggestions')"
    :class="[
      'flex min-h-full flex-col justify-end px-3 pb-1',
      variant === 'roomy' ? 'mx-auto w-full max-w-3xl' : '',
    ]"
  >
    <div v-if="loading" class="flex flex-col gap-2" data-test="assistant-welcome-loading">
      <OSkeleton v-for="row in 3" :key="row" type="text" class="h-5 w-3/5" />
    </div>
    <ul v-else class="flex flex-col items-start">
      <li v-for="(starter, index) in shownStarters" :key="starter.id" class="max-w-full">
        <AssistantStarterRow
          :label="starter.label"
          :data-test="starter.dataTest"
          @click="select(starter, index)"
        />
      </li>
    </ul>
  </section>
</template>

<script lang="ts">
import type { AssistantScope, Container, Sid, Starter } from "@/composables/assistant";

export interface AssistantWelcomeProps {
  variant: "compact" | "roomy";
  scope: AssistantScope;
  starters: Starter[];
  loading: boolean;
  /** The telemetry container this welcome renders in. */
  container?: Container;
  sid?: Sid | null;
}

export interface AssistantWelcomeEmits {
  (e: "select-starter", starter: Starter): void;
  (e: "open-chat", target: { sid: Sid } | { chatId: number }): void;
}

/** The empty chat never offers more than this. */
export const WELCOME_STARTERS = 3;

// Once per page session per container, however often the welcome re-renders.
const shown = new Set<string>();

/** Lets a spec start from a fresh session; never called by app code. */
export function resetWelcomeTelemetryForTests(): void {
  shown.clear();
}
</script>

<script setup lang="ts">
import { computed, watch } from "vue";

import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

import AssistantStarterRow from "./AssistantStarterRow.vue";

const props = withDefaults(defineProps<AssistantWelcomeProps>(), {
  container: "sidebar",
  sid: null,
});

const emit = defineEmits<AssistantWelcomeEmits>();

const { t } = useI18nTyped();

const fresh = computed(() => props.scope.streamCount === 0);
const shownStarters = computed(() => props.starters.slice(0, WELCOME_STARTERS));

function select(starter: Starter, index: number): void {
  trackAssistant("ai_welcome_starter", { starter_kind: starter.kind, index, via: "click" });
  if (starter.kind === "recent" && starter.sid) return emit("open-chat", { sid: starter.sid });
  if (starter.kind === "recent" && starter.chatId !== undefined)
    return emit("open-chat", { chatId: starter.chatId });
  emit("select-starter", starter);
}

watch(
  () => props.loading,
  (loading) => {
    if (loading || shown.has(props.container)) return;
    shown.add(props.container);
    trackAssistant("ai_welcome_shown", {
      fresh_org: fresh.value,
      starter_kinds: props.starters.map((s) => s.kind),
    });
  },
  { immediate: true },
);
</script>
