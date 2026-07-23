<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { PROMPT_SUGGESTIONS } from "./welcomeContent";

const { t } = useI18n();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();

function selectPrompt(id: string) {
  emit("select", t(`aiAssistant.suggestions.${id}`));
}
</script>

<template>
  <section class="flex w-full flex-col gap-3">
    <div class="text-typography-meta m-0 self-center text-xs font-normal opacity-75">
      {{ t("aiAssistant.welcome.tryOneOfThese") }}
    </div>

    <div class="suggestions-grid grid w-full gap-2 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="s in PROMPT_SUGGESTIONS"
        :key="s.id"
        type="button"
        class="suggestion-chip group rounded-default border-border-default text-text-secondary hover:text-text-body relative inline-flex cursor-pointer items-center gap-2 overflow-hidden border bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-card-bg)_100%,transparent),color-mix(in_srgb,var(--color-card-bg)_92%,transparent))] px-2.5 py-2 pl-3 text-left text-xs leading-tight [transition:border-color_0.15s_ease,background_0.15s_ease,color_0.15s_ease,transform_0.15s_ease,box-shadow_0.15s_ease] hover:-translate-y-px hover:border-[rgba(123,97,255,0.5)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-8px_rgba(123,97,255,0.3)] focus-visible:border-[rgba(123,97,255,0.7)] focus-visible:shadow-[0_0_0_2px_rgba(123,97,255,0.4)] focus-visible:outline-none"
        @click="selectPrompt(s.id)"
      >
        <span
          class="suggestion-chip__icon rounded-default text-typography-meta group-hover:text-ai-accent inline-flex h-5.5 w-5.5 shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--color-border-default)_40%,transparent)] [transition:background_0.15s_ease,color_0.15s_ease] group-hover:bg-[rgba(123,97,255,0.15)]"
        >
          <OIcon :name="s.icon" size="sm" />
        </span>
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {{ t(`aiAssistant.suggestions.${s.id}`) }}
        </span>
        <span
          class="suggestion-chip__arrow text-typography-meta group-hover:text-ai-accent inline-flex shrink-0 -translate-x-1 items-center justify-center opacity-0 [transition:opacity_0.15s_ease,transform_0.15s_ease,color_0.15s_ease] group-hover:translate-x-0 group-hover:opacity-100"
          aria-hidden="true"
        >
          <OIcon name="arrow-forward" size="xs" />
        </span>
      </button>
    </div>
  </section>
</template>
