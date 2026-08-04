<!--
  ReviewContentBox — a single Input / Output / Retrieved-Context pane for the
  Queue Workbench. Mirrors the TraceDetailsSidebar LLM preview pattern: a bold
  label with copy + expand controls, and a neutral code-bg box that bounds its
  own height and scrolls internally so large content never blows out the review
  layout. Expand opens the same content in a full-size ODialog.
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
          :title="t('aiObservability.queues.workbench.enterFullscreen')"
          @click="expandOpen = true"
        >
          <OIcon name="fullscreen" size="xs" />
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

    <ODialog
      :open="expandOpen"
      size="full"
      :title="label"
      :data-test="`ai-review-content-dialog-${contentType}`"
      @update:open="expandOpen = $event"
    >
      <div class="bg-code-bg rounded-surface overflow-auto p-4">
        <LLMContentRenderer
          :content="content"
          :content-type="contentType"
          view-mode="formatted"
          :instance-id="`${instanceId}-expanded`"
        />
      </div>
    </ODialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import LLMContentRenderer from "@/plugins/traces/LLMContentRenderer.vue";
import { copyToClipboard } from "@/utils/clipboard";

const props = withDefaults(
  defineProps<{
    label: string;
    content: string;
    contentType: "input" | "output";
    instanceId: string;
    // Stretch to fill the parent's height (internal scroll) instead of a fixed cap.
    fill?: boolean;
  }>(),
  { fill: false },
);

const { t } = useI18n();

const expandOpen = ref(false);

const copy = () => {
  copyToClipboard(props.content ?? "", {
    successMessage: t("common.copiedToClipboard"),
  });
};
</script>
