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
  <!-- Own scroller out of flow: in flow it grows the chat's messages list, which scrolls to the bottom and cuts the greeting. -->
  <div class="o2-ai-home-welcome relative h-full w-full self-stretch overflow-hidden">
    <div class="absolute inset-0 flex justify-center overflow-x-hidden overflow-y-auto">
      <!-- eslint-disable local/no-hardcoded-px -- optical effect, not layout — the glow's blur radius must not scale with text -->
      <div
        aria-hidden="true"
        class="pointer-events-none absolute top-[8%] left-1/2 z-0 h-80 w-[min(51.25rem,70%)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(123,97,255,0.22),rgba(236,72,153,0.1)_45%,rgba(245,158,11,0.06)_65%,transparent_75%)] blur-[56px]"
      ></div>
      <!-- eslint-enable local/no-hardcoded-px -->
      <div
        class="o2-ai-home-welcome__inner relative z-1 m-auto flex w-full max-w-240 flex-col items-center gap-6 px-6 pt-12 pb-4 max-md:gap-3 max-md:px-2 max-md:pt-6"
      >
        <WelcomeGreeting />
        <CapabilityCards @select="onSelect" />
        <PromptSuggestions @select="onSelect" />
      </div>
    </div>
  </div>
</template>
