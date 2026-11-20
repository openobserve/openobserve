<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div
    class="bg-surface-panel flex h-full w-full flex-col"
    :class="frameless ? '' : 'border-border-default border-e'"
    data-test="dashboard-field-panel"
  >
    <div v-if="!frameless" class="px-page-edge my-3 flex shrink-0 items-center justify-between">
      <span class="text-base font-bold">{{ t("panel.fields") }}</span>
      <OButton
        variant="outline"
        size="icon-xs-sq"
        class="rotate-90"
        icon-left="unfold-less"
        :title="t('panel.collapseFields')"
        data-test="panel-field-list-collapse-btn"
        @click="emit('collapse')"
      />
    </div>
    <StreamFieldPanel
      :capabilities="source.capabilities.value"
      :source="source"
      test-id-prefix="dashboard-panel"
      stream-test-id="index-dropdown-stream"
      stream-type-test-id="index-dropdown-stream_type"
      class="min-h-0 flex-1"
    />
  </div>
</template>

<script setup lang="ts">
import { inject } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import StreamFieldPanel from "@/components/common/fieldPanel/StreamFieldPanel.vue";
import useDashboardFieldSource from "@/components/common/fieldPanel/useDashboardFieldSource";

const props = defineProps<{
  editMode?: boolean;
  /** Drop the pane's own title row and border when a host (drawer) provides them. */
  frameless?: boolean;
}>();

const emit = defineEmits<{ collapse: [] }>();

const { t } = useI18nTyped();

const pageKey = inject<string>("dashboardPanelDataPageKey", "dashboard");

// Created per mount, so the stream list and schema loads run only while the field list is on screen.
const source = useDashboardFieldSource({ pageKey, editMode: props.editMode === true });
</script>
