<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import StarterPackCatalogGate from "@/components/starterPacks/StarterPackCatalogGate.vue";
import WelcomeGreeting from "./WelcomeGreeting.vue";
import CapabilityCards from "./CapabilityCards.vue";
import PromptSuggestions from "./PromptSuggestions.vue";
import WelcomeStarter from "./WelcomeStarter.vue";
import type { StarterWelcomeMode, WelcomeContext } from "./starterWelcome";

const emit = defineEmits<{
  (e: "select-prompt", prompt: string): void;
  (e: "select-context", prompt: string, context: WelcomeContext): void;
  (e: "welcome-context", context: WelcomeContext | null): void;
}>();

const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const starterMode = ref<StarterWelcomeMode>("none");

function onSelect(prompt: string) {
  emit("select-prompt", prompt);
}
</script>

<template>
  <div
    class="o2-ai-home-welcome relative flex h-full w-full items-center justify-center overflow-hidden"
  >
    <!-- eslint-disable local/no-hardcoded-px -- optical effect, not layout — the glow's blur radius must not scale with text -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute top-[8%] left-1/2 z-0 h-80 w-[min(51.25rem,70%)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(123,97,255,0.22),rgba(236,72,153,0.1)_45%,rgba(245,158,11,0.06)_65%,transparent_75%)] blur-[56px]"
    ></div>
    <!-- eslint-enable local/no-hardcoded-px -->
    <div
      class="o2-ai-home-welcome__inner relative z-1 flex w-full max-w-240 flex-col items-center gap-6 px-6 pt-6 pb-4 max-md:gap-3 max-md:px-2 max-md:pt-1"
    >
      <WelcomeGreeting />
      <StarterPackCatalogGate v-if="STARTER_PACKS_ENABLED && org" :key="org" :org="org">
        <WelcomeStarter
          :org="org"
          @mode="starterMode = $event"
          @context="emit('welcome-context', $event)"
          @select="(prompt, context) => emit('select-context', prompt, context)"
        />
      </StarterPackCatalogGate>
      <template v-if="starterMode === 'none'">
        <CapabilityCards @select="onSelect" />
        <PromptSuggestions @select="onSelect" />
      </template>
    </div>
  </div>
</template>
