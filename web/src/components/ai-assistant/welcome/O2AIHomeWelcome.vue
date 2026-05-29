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
  <div class="o2-ai-home-welcome">
    <div class="o2-ai-home-welcome__ambient" aria-hidden="true"></div>
    <div class="o2-ai-home-welcome__inner">
      <WelcomeGreeting />
      <CapabilityCards @select="onSelect" />
      <PromptSuggestions @select="onSelect" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.o2-ai-home-welcome {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}

.o2-ai-home-welcome__ambient {
  position: absolute;
  top: 8%;
  left: 50%;
  transform: translateX(-50%);
  width: min(820px, 70%);
  height: 320px;
  background: radial-gradient(
    closest-side,
    rgba(123, 97, 255, 0.22),
    rgba(236, 72, 153, 0.1) 45%,
    rgba(245, 158, 11, 0.06) 65%,
    transparent 75%
  );
  filter: blur(56px);
  pointer-events: none;
  z-index: 0;
}

.o2-ai-home-welcome__inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 1.5rem 1.5rem 1rem;
}
</style>
