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
  <section class="tw:flex tw:flex-col tw:gap-3 tw:w-full">
    <p class="tw:m-0 tw:self-center tw:text-xs tw:font-normal tw:text-(--color-typography-meta) tw:opacity-75">
      {{ t("aiAssistant.welcome.tryOneOfThese") }}
    </p>

    <div class="suggestions-grid tw:grid tw:w-full tw:gap-2 tw:grid-cols-3 tw:lg:grid-cols-2 tw:sm:grid-cols-1">
      <button
        v-for="s in PROMPT_SUGGESTIONS"
        :key="s.id"
        type="button"
        class="suggestion-chip tw:group tw:relative tw:inline-flex tw:items-center tw:gap-2 tw:py-2 tw:px-[0.625rem] tw:pl-3 tw:rounded-lg tw:border tw:border-(--color-border-default) tw:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-card-bg)_100%,transparent),color-mix(in_srgb,var(--color-card-bg)_92%,transparent))] tw:text-(--color-text-secondary) tw:text-xs tw:leading-tight tw:text-left tw:cursor-pointer tw:[transition:border-color_0.15s_ease,background_0.15s_ease,color_0.15s_ease,transform_0.15s_ease,box-shadow_0.15s_ease] tw:overflow-hidden tw:hover:border-[rgba(123,97,255,0.5)] tw:hover:text-(--color-text-primary) tw:hover:-translate-y-px tw:hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-8px_rgba(123,97,255,0.3)] tw:focus-visible:outline-none tw:focus-visible:border-[rgba(123,97,255,0.7)] tw:focus-visible:shadow-[0_0_0_2px_rgba(123,97,255,0.4)]"
        @click="selectPrompt(s.id)"
      >
        <span class="suggestion-chip__icon tw:inline-flex tw:items-center tw:justify-center tw:shrink-0 tw:w-[22px] tw:h-[22px] tw:rounded-md tw:bg-[color-mix(in_srgb,var(--color-border-default)_40%,transparent)] tw:text-(--color-typography-meta) tw:[transition:background_0.15s_ease,color_0.15s_ease] tw:group-hover:bg-[rgba(123,97,255,0.15)] tw:group-hover:text-[#7b61ff]">
          <OIcon :name="s.icon" size="sm" />
        </span>
        <span class="tw:flex-1 tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">
          {{ t(`aiAssistant.suggestions.${s.id}`) }}
        </span>
        <span class="suggestion-chip__arrow tw:inline-flex tw:items-center tw:justify-center tw:shrink-0 tw:text-(--color-typography-meta) tw:opacity-0 tw:-translate-x-1 tw:[transition:opacity_0.15s_ease,transform_0.15s_ease,color_0.15s_ease] tw:group-hover:opacity-100 tw:group-hover:translate-x-0 tw:group-hover:text-[#7b61ff]" aria-hidden="true">
          <OIcon name="arrow-forward" size="xs" />
        </span>
      </button>
    </div>
  </section>
</template>
