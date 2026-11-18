<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import { useStore } from "vuex";

import { queryClient } from "@/composables/query/queryClient";
import { streamNameListQuery } from "@/services/stream.queries";
import { useI18nTyped } from "@/types/i18n";
import { isUserDataStream, type StreamOwnership } from "@/utils/internalStreams";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { PROMPT_SUGGESTIONS, type PromptSuggestion } from "./welcomeContent";

const { t } = useI18nTyped();
const vuex = useStore();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const logLists = useQuery(
  computed(() => ({ ...streamNameListQuery(org.value, "logs"), enabled: !!org.value })),
  queryClient,
);
// A suggestion names this org's own stream, never another org's or an internal one.
const logStream = computed<string | null>(() => {
  const rows: StreamOwnership[] = Array.isArray(logLists.data.value) ? logLists.data.value : [];
  const own = rows.find((row) => isUserDataStream(row, "logs") && row.is_internal !== true);
  return own?.name ?? null;
});
const suggestions = computed(() =>
  PROMPT_SUGGESTIONS.filter((s) => !s.logStream || logStream.value !== null),
);

const keyOf = (s: PromptSuggestion) => s.key ?? `aiAssistant.suggestions.${s.id}`;

function textOf(s: PromptSuggestion) {
  return s.logStream ? t(keyOf(s), { stream: logStream.value ?? "" }) : t(keyOf(s));
}

function selectPrompt(s: PromptSuggestion) {
  emit("select", textOf(s));
}
</script>

<template>
  <section class="flex w-full flex-col gap-3">
    <div class="text-typography-meta m-0 self-center text-xs font-normal opacity-75">
      {{ t("aiAssistant.welcome.tryOneOfThese") }}
    </div>

    <!-- Phones show the first three so the whole welcome fits above the composer. -->
    <div
      class="suggestions-grid grid w-full gap-2 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-md:[&>button:nth-child(n+4)]:hidden"
    >
      <button
        v-for="s in suggestions"
        :key="s.id"
        type="button"
        :data-test="`assistant-prompt-suggestion-${s.id}`"
        class="suggestion-chip group rounded-default border-border-default bg-surface-base text-text-secondary hover:text-text-body hover:border-accent hover:bg-tabs-hover-bg focus-visible:border-accent focus-visible:ring-accent/40 relative inline-flex cursor-pointer items-center gap-2 overflow-hidden border px-2.5 py-2 ps-3 text-left text-xs leading-tight transition-[color,background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:outline-none"
        @click="selectPrompt(s)"
      >
        <span
          class="suggestion-chip__icon rounded-default text-typography-meta group-hover:text-accent bg-border-default/40 group-hover:bg-tabs-active-bg inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center transition-colors duration-150"
        >
          <OIcon :name="s.icon" size="sm" />
        </span>
        <OTruncatedText class="flex-1">
          {{ textOf(s) }}
        </OTruncatedText>
        <span
          class="suggestion-chip__arrow text-typography-meta group-hover:text-accent inline-flex shrink-0 -translate-x-1 items-center justify-center opacity-0 transition-[opacity,transform,color] duration-150 group-hover:translate-x-0 group-hover:opacity-100"
          aria-hidden="true"
        >
          <OIcon name="arrow-forward" size="xs" />
        </span>
      </button>
    </div>
  </section>
</template>
