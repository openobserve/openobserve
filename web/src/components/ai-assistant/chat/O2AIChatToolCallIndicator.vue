<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { getToolCallDisplayData, truncateQuery } from "@/components/O2AIChat.toolcall";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

defineProps<{
  message: I18nText;
  context: Record<string, any>;
}>();

const { t } = useI18nTyped();
</script>

<template>
  <div
    class="tool-call-indicator rounded-default border-border-default my-2 flex items-center border px-4 py-3 [background:var(--color-chat-bubble-user)]"
  >
    <div class="tool-call-content flex w-full items-center gap-3">
      <OSpinner variant="dots" size="xs" />
      <div class="tool-call-info flex min-w-0 flex-1 flex-col gap-1.5">
        <span class="tool-call-message text-text-secondary text-sm font-semibold">{{
          message
        }}</span>
        <div
          v-if="getToolCallDisplayData(context)"
          class="tool-call-context flex flex-wrap items-center gap-2"
        >
          <div v-if="getToolCallDisplayData(context)?.query" class="context-item w-full">
            <code
              class="context-query rounded-default bg-surface-base border-border-default text-text-body dark:text-text-secondary block max-w-full overflow-hidden border px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
              >{{ truncateQuery(getToolCallDisplayData(context)?.query) }}</code
            >
          </div>
          <div
            v-if="getToolCallDisplayData(context)?.vrl && !getToolCallDisplayData(context)?.query"
            class="context-item w-full"
          >
            <code
              class="context-query rounded-default bg-surface-base border-border-default text-text-body dark:text-text-secondary block max-w-full overflow-hidden border px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
              >{{ truncateQuery(getToolCallDisplayData(context)?.vrl) }}</code
            >
          </div>
          <span
            v-if="getToolCallDisplayData(context)?.stream"
            class="context-tag text-2xs rounded-default text-ai-accent dark:text-text-secondary inline-flex items-center px-2 py-1 font-medium [background:color-mix(in_srgb,var(--color-ai-accent)_10%,transparent)] dark:[background:color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)]"
          >
            {{ t("aiAssistant.streamPrefix") }}
            {{ getToolCallDisplayData(context)?.stream }}
          </span>
          <span
            v-if="getToolCallDisplayData(context)?.query_type"
            class="context-tag text-2xs rounded-default text-ai-accent dark:text-text-secondary inline-flex items-center px-2 py-1 font-medium [background:color-mix(in_srgb,var(--color-ai-accent)_10%,transparent)] dark:[background:color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)]"
          >
            {{ t("aiAssistant.typePrefix") }}
            {{ getToolCallDisplayData(context)?.query_type }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Deliberate copy of the shell's rule: the shell's standalone loading box shares this class. */
.tool-call-indicator {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-0.625rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
