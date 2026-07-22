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
  <div
    class="o2-ai-home-welcome relative w-full h-full flex justify-center items-center overflow-hidden"
  >
    <div
      aria-hidden="true"
      class="absolute top-[8%] left-1/2 -translate-x-1/2 w-[min(820px,70%)] h-80 bg-[radial-gradient(closest-side,rgba(123,97,255,0.22),rgba(236,72,153,0.1)_45%,rgba(245,158,11,0.06)_65%,transparent_75%)] blur-[56px] pointer-events-none z-0"
    ></div>
    <div
      class="o2-ai-home-welcome__inner relative z-1 w-full max-w-240 flex flex-col items-center gap-6 px-6 pt-6 pb-4"
    >
      <WelcomeGreeting />
      <CapabilityCards @select="onSelect" />
      <PromptSuggestions @select="onSelect" />
    </div>
  </div>
</template>
