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
  <section class="flex flex-col gap-3 w-full">
    <div class="m-0 self-center text-xs font-normal text-(--color-typography-meta) opacity-75">
      {{ t("aiAssistant.welcome.tryOneOfThese") }}
    </div>

    <div class="suggestions-grid grid w-full gap-2 md:grid-cols-2 lg:grid-cols-3 sm:grid-cols-1">
      <button
        v-for="s in PROMPT_SUGGESTIONS"
        :key="s.id"
        type="button"
        class="suggestion-chip group relative inline-flex items-center gap-2 py-2 px-[0.625rem] pl-3 rounded-lg border border-(--color-border-default) bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-card-bg)_100%,transparent),color-mix(in_srgb,var(--color-card-bg)_92%,transparent))] text-(--color-text-secondary) text-xs leading-tight text-left cursor-pointer [transition:border-color_0.15s_ease,background_0.15s_ease,color_0.15s_ease,transform_0.15s_ease,box-shadow_0.15s_ease] overflow-hidden hover:border-[rgba(123,97,255,0.5)] hover:text-(--color-text-primary) hover:-translate-y-px hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-8px_rgba(123,97,255,0.3)] focus-visible:outline-none focus-visible:border-[rgba(123,97,255,0.7)] focus-visible:shadow-[0_0_0_2px_rgba(123,97,255,0.4)]"
        @click="selectPrompt(s.id)"
      >
        <span class="suggestion-chip__icon inline-flex items-center justify-center shrink-0 w-[22px] h-[22px] rounded-md bg-[color-mix(in_srgb,var(--color-border-default)_40%,transparent)] text-(--color-typography-meta) [transition:background_0.15s_ease,color_0.15s_ease] group-hover:bg-[rgba(123,97,255,0.15)] group-hover:text-[#7b61ff]">
          <OIcon :name="s.icon" size="sm" />
        </span>
        <span class="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
          {{ t(`aiAssistant.suggestions.${s.id}`) }}
        </span>
        <span class="suggestion-chip__arrow inline-flex items-center justify-center shrink-0 text-(--color-typography-meta) opacity-0 -translate-x-1 [transition:opacity_0.15s_ease,transform_0.15s_ease,color_0.15s_ease] group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-[#7b61ff]" aria-hidden="true">
          <OIcon name="arrow-forward" size="xs" />
        </span>
      </button>
    </div>
  </section>
</template>
