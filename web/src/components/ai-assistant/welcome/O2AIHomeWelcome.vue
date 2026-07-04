<script setup lang="ts">
import WelcomeGreeting from "./WelcomeGreeting.vue";
import CapabilityCards from "./CapabilityCards.vue";
import PromptSuggestions from "./PromptSuggestions.vue";

const emit = defineEmits<{ (e: "select-prompt", prompt: string): void }>();

function onSelect(prompt: string) {
  emit("select-prompt", prompt);
}
</script>

<template>
  <div class="o2-ai-home-welcome tw:relative tw:w-full tw:h-full tw:flex tw:justify-center tw:items-center tw:overflow-hidden">
    <div
      aria-hidden="true"
      class="tw:absolute tw:top-[8%] tw:left-1/2 tw:-translate-x-1/2 tw:w-[min(820px,70%)] tw:h-80 tw:bg-[radial-gradient(closest-side,rgba(123,97,255,0.22),rgba(236,72,153,0.1)_45%,rgba(245,158,11,0.06)_65%,transparent_75%)] tw:blur-[56px] tw:pointer-events-none tw:z-0"
    ></div>
    <div class="o2-ai-home-welcome__inner tw:relative tw:z-1 tw:w-full tw:max-w-[960px] tw:flex tw:flex-col tw:items-center tw:gap-6 tw:px-6 tw:pt-6 tw:pb-4">
      <WelcomeGreeting />
      <CapabilityCards @select="onSelect" />
      <PromptSuggestions @select="onSelect" />
    </div>
  </div>
</template>
