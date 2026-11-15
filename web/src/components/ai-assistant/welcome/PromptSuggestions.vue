<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { PROMPT_SUGGESTIONS, type PromptSuggestion } from "./welcomeContent";

const { t } = useI18nTyped();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();

const keyOf = (s: PromptSuggestion) => s.key ?? `aiAssistant.suggestions.${s.id}`;

function selectPrompt(s: PromptSuggestion) {
  emit("select", t(keyOf(s)));
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
        v-for="s in PROMPT_SUGGESTIONS"
        :key="s.id"
        type="button"
        class="suggestion-chip group rounded-default border-border-default bg-surface-base text-text-secondary hover:text-text-body hover:border-accent hover:bg-tabs-hover-bg focus-visible:border-accent focus-visible:ring-accent/40 relative inline-flex cursor-pointer items-center gap-2 overflow-hidden border px-2.5 py-2 ps-3 text-left text-xs leading-tight transition-[color,background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:outline-none"
        @click="selectPrompt(s)"
      >
        <span
          class="suggestion-chip__icon rounded-default text-typography-meta group-hover:text-accent bg-border-default/40 group-hover:bg-tabs-active-bg inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center transition-colors duration-150"
        >
          <OIcon :name="s.icon" size="sm" />
        </span>
        <OTruncatedText class="flex-1">
          {{ t(keyOf(s)) }}
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
