<!--
  ReviewContentBox — a single Input / Output / Retrieved-Context pane for the
  Queue Workbench. Mirrors the TraceDetailsSidebar LLM preview pattern: a bold
  label with copy + fullscreen controls, and a neutral code-bg box that bounds
  its own height and scrolls internally so large content never blows out the
  review layout.

  Fullscreen is the PARENT's: a box reviewed on its own is half the evidence, so
  the button reports up and the workbench takes its whole Input+Output pane
  fullscreen (same as the trace view).
-->
<template>
  <div class="flex min-w-0 flex-col gap-1.5" :class="fill ? 'min-h-0 flex-1' : ''">
    <div class="flex items-center justify-between">
      <span class="text-text-heading text-sm font-bold">{{ label }}</span>
      <div class="flex items-center gap-1">
        <OButton
          variant="outline"
          size="icon"
          :data-test="`ai-review-content-copy-${contentType}`"
          :title="t('aiObservability.queues.workbench.copyContent', { label })"
          @click="copy"
        >
          <OIcon name="content-copy" size="xs" />
        </OButton>
        <OButton
          variant="outline"
          size="icon"
          :data-test="`ai-review-content-expand-${contentType}`"
          :title="
            fullscreen
              ? t('aiObservability.queues.workbench.exitFullscreen')
              : t('aiObservability.queues.workbench.enterFullscreen')
          "
          @click="emit('toggle-fullscreen')"
        >
          <OIcon :name="fullscreen ? 'fullscreen-exit' : 'fullscreen'" size="xs" />
        </OButton>
      </div>
    </div>
    <div
      class="border-card-glass-border rounded-default bg-code-bg overflow-x-auto overflow-y-auto border p-3"
      :class="fill ? 'min-h-0 flex-1' : 'max-h-[24rem]'"
    >
      <LLMContentRenderer
        :content="content"
        :content-type="contentType"
        view-mode="formatted"
        :instance-id="instanceId"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import LLMContentRenderer from "@/plugins/traces/LLMContentRenderer.vue";
import { copyToClipboard } from "@/utils/clipboard";

const props = withDefaults(
  defineProps<{
    label: I18nText;
    content: string;
    contentType: "input" | "output";
    instanceId: string;
    // Stretch to fill the parent's height (internal scroll) instead of a fixed cap.
    fill?: boolean;
    /** Whether the container this box belongs to is currently fullscreen. */
    fullscreen?: boolean;
  }>(),
  { fill: false, fullscreen: false },
);

const emit = defineEmits<{ (_e: "toggle-fullscreen"): void }>();

const { t } = useI18nTyped();

const copy = () => {
  copyToClipboard(props.content ?? "", t, {
    successMessage: t("common.copiedToClipboard"),
  });
};
</script>
