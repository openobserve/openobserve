<template>
  <div class="w-full h-full">
    <FullViewContainer
      data-test="test-function-input-title-section"
      :name="file.name"
      v-model:is-expanded="isExpanded"
      :label="file.name"
    >
      <template #left>
        <div
          v-if="loading"
          class="text-weight-bold flex items-center text-gray-500 ml-2 text-[13px]"
        >
          <OSpinner size="xs" data-test="script-editor-loading-indicator" />
          <div class="relative top-[2px]">
            {{ t("confirmDialog.loading") }}
          </div>
        </div>
        <OIcon
          v-if="!!error"
          name="info"
          class="text-red-600 mx-1 cursor-pointer"
          size="sm"
         />
          <OTooltip side="right" align="center" :sideOffset="10" :content="error" />
      </template>
    </FullViewContainer>
    <div
      v-show="isExpanded"
      class="border-[1px] border-gray-200 h-[calc(100%-30px)] relative rounded-md overflow-hidden"
      data-test="test-function-input-editor-section"
    >
      <query-editor
        data-test="vrl-function-test-events-editor"
        ref="eventsEditorRef"
        :editor-id="`test-function-events-input-editor-${file.name}`"
        class="test-function-input-editor w-full min-h-40 rounded h-full"
        v-model:query="inputScript"
        :language="file.language"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, defineAsyncComponent } from "vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));
import axios from "axios";
import { useI18n } from "vue-i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: "",
  },
  file: {
    type: Object,
    default: null,
  },
  script: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["update:script", "cancel"]);

const { t } = useI18n();

const isExpanded = ref(true);

const inputScript = computed({
  get: () => props.script,
  set: (value) => emit("update:script", value),
});
</script>

