<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import {
  buildPackDigest,
  DIGEST_MAX_PACKS,
  PACK_DIGEST_NAME,
} from "@/composables/starterPacks/packDigest";
import { useHomePacks } from "@/composables/starterPacks/useHomePacks";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import { useI18nTyped } from "@/types/i18n";
import CapabilityCards from "./CapabilityCards.vue";
import PromptSuggestions from "./PromptSuggestions.vue";
import { STARTER_CARDS } from "./welcomeContent";
import {
  joinTitles,
  starterSuggestions,
  starterWelcomeMode,
  type StarterWelcomeMode,
  type WelcomeContext,
} from "./starterWelcome";

const props = defineProps<{ org: string }>();
const emit = defineEmits<{
  mode: [mode: StarterWelcomeMode];
  context: [context: WelcomeContext | null];
  select: [prompt: string, context: WelcomeContext];
}>();

const { t } = useI18nTyped();
const gate = usePackGate(props.org);
const home = useHomePacks(props.org, undefined, () => gate.visible.value);

// Live from the org's answers, so a set up that gives the org resources ends starter mode.
const mode = computed(() =>
  starterWelcomeMode({
    visible: gate.visible.value,
    showSection: home.showSection.value,
    loading: home.loading.value,
  }),
);
const matched = computed(() => home.offered.value.slice(0, DIGEST_MAX_PACKS));
const titles = computed(() => matched.value.map(({ title }) => String(title)));
const packs = computed(() => joinTitles(t, titles.value));
const suggestions = computed(() => starterSuggestions(t, titles.value));
const digest = computed(() => (mode.value === "starter" ? buildPackDigest(matched.value) : null));

watch(mode, (now) => emit("mode", now), { immediate: true });
// Re-sent as previews add counts, so the composer chip always carries the latest digest.
watch(digest, (text) => emit("context", text === null ? null : { name: PACK_DIGEST_NAME, text }), {
  immediate: true,
});
onBeforeUnmount(() => {
  emit("mode", "none");
  emit("context", null);
});

const select = (prompt: string) =>
  emit("select", prompt, { name: PACK_DIGEST_NAME, text: buildPackDigest(matched.value) });
</script>

<template>
  <template v-if="mode === 'loading'">
    <div class="flex w-full flex-col items-center gap-3" data-test="o2-ai-welcome-starter-loading">
      <OText variant="meta">{{ t("aiAssistant.starter.checking") }}</OText>
      <div
        class="grid w-full [grid-template-columns:repeat(4,minmax(0,1fr))] gap-3.5 max-[64rem]:[grid-template-columns:repeat(2,minmax(0,1fr))] max-md:gap-2.5"
      >
        <OSkeleton v-for="n in 4" :key="n" class="rounded-default h-33 w-full max-md:h-16" />
      </div>
    </div>
  </template>
  <template v-else-if="mode === 'starter'">
    <CapabilityCards :cards="STARTER_CARDS" :packs="packs" @select="select" />
    <PromptSuggestions :items="suggestions" @select="select" />
  </template>
</template>
