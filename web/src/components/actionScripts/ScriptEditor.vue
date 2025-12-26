<template>
  <div class="tw:w-full tw:h-full">
    <FullViewContainer
      data-test="test-function-input-title-section"
      :name="file.name"
      v-model:is-expanded="isExpanded"
      :label="file.name"
    >
      <template #left>
        <div
          v-if="loading"
          class="text-weight-bold tw:flex tw:items-center tw:text-gray-500 tw:ml-2 tw:text-[13px]"
        >
          <q-spinner-hourglass size="18px" />
          <div class="tw:relative tw:top-[2px]">
            {{ t("confirmDialog.loading") }}
          </div>
        </div>
        <q-icon
          v-if="!!error"
          name="info"
          class="tw:text-red-600 tw:mx-1 tw:cursor-pointer"
          size="16px"
        >
          <q-tooltip
            anchor="center right"
            self="center left"
            :offset="[10, 10]"
            class="tw:text-[12px]"
          >
            {{ error }}
          </q-tooltip>
        </q-icon>
      </template>
    </FullViewContainer>
    <div
      v-show="isExpanded"
      class="tw:border-[1px] tw:border-gray-200 tw:h-[calc(100%-30px)] tw:relative tw:rounded-md tw:overflow-hidden"
      data-test="test-function-input-editor-section"
    >
      <query-editor
        data-test="vrl-function-test-events-editor"
        ref="eventsEditorRef"
        :editor-id="`test-function-events-input-editor-${file.name}`"
        class="monaco-editor test-function-input-editor tw:h-full"
        v-model:query="inputScript"
        :language="file.language"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import QueryEditor from "@/components/CodeQueryEditor.vue";
import axios from "axios";
import { useI18n } from "vue-i18n";

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

<style scoped>
/* Add your styles here */
.monaco-editor {
  width: 100%;
  min-height: 10rem;
  border-radius: 5px;
}
</style>
