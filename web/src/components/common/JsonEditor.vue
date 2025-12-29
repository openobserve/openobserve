<template>
  <q-card
    class=" "
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'bg-white'"
  >
    <div class="row items-center no-wrap">
      <div class="col">
        <div class="q-mx-md q-my-md text-h6">
          {{ title }}
        </div>
      </div>
      <div class="tw:flex tw:items-center">
        <div>
          <q-btn
          v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
          :ripple="false"
          @click="toggleAIChat"
          data-test="menu-link-ai-item"
          no-caps
          :borderless="true"
          flat
          dense
          class="o2-button ai-hover-btn q-py-sm"
          :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
          style="border-radius: 100%;"
          @mouseenter="isHovered = true"
          @mouseleave="isHovered = false"

        >
          <div class="row items-center no-wrap tw:gap-2  ">
            <img  :src="getBtnLogo" class="header-icon ai-icon" />
          </div>
        </q-btn>
        </div>
        <q-icon
          v-close-popup
          name="cancel"
          class="cursor-pointer tw:mr-3"
          size="20px"
          data-test="json-editor-close"
        />
      </div>
    </div>
    <q-separator></q-separator>
    <div class="tw:h-[calc(100vh-65px)] tw:flex">
      <div class="row common-json-editor column tw:h-[calc(100vh-65px)]"
      :class="store.state.isAiChatEnabled ? 'tw:w-[64.5vw]' : 'tw:w-[90vw]'"
      >
      <q-card-section class="col q-pa-none">
      <query-editor
        data-test="common-json-editor"
        ref="queryEditorRef"
        editor-id="common-json-editor"
        class="monaco-editor"
        :debounceTime="300"
        v-model:query="jsonContent"
        language="json"
        @update:query="handleEditorChange"
      />
    </q-card-section>

    <!-- Display validation errors -->
    <q-card-section
      v-if="validationErrors.length > 0"
      class="q-pa-md text-negative validation-errors"
    >
      <div class="text-bold q-mb-sm">Please fix the following issues:</div>
      <ul class="q-ml-md">
        <li v-for="(error, index) in validationErrors" :key="index">
          {{ error }}
        </li>
      </ul>
    </q-card-section>

    <q-space></q-space>

    <q-card-actions align="right" class="q-pa-md">
      <q-btn
        flat
        :label="t('common.cancel')"
        class="q-ml-sm o2-secondary-button tw:h-[36px]"
        v-close-popup
        data-test="json-editor-cancel"
      />
      <q-btn
        class="q-ml-sm o2-primary-button tw:h-[36px]"
        padding="sm lg"
        no-caps
        :label="t('common.save')"
        @click="saveChanges"
        data-test="json-editor-save"
      />
    </q-card-actions>
    </div>
    <!-- o2aichat enableddd -->

    <div  class="q-ml-sm tw:w-[25vw] tw:h-[calc(100vh - 65px)]" v-if="store.state.isAiChatEnabled " :class="store.state.theme == 'dark' ? 'dark-mode-chat-container' : 'light-mode-chat-container'" >
            <O2AIChat style="height: calc(100vh - 70px) !important;" :is-open="store.state.isAiChatEnabled" @close="store.state.isAiChatEnabled = false" />
          </div>
    </div>

  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, computed, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "@/utils/zincutils";
import O2AIChat from "../O2AIChat.vue";
import config from "@/aws-exports";
import { ChatMessage, ChatHistoryEntry } from "@/types/chat";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

export default defineComponent({
  name: "JsonEditor",
  components: {
    QueryEditor: defineAsyncComponent(() => import('@/components/CodeQueryEditor.vue')),
    O2AIChat,
  },
  props: {
    data: {
      type: Object,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    validationErrors: {
      type: Array,
      required: false,
      default: () => [],
    },
    isEditing: {
      type: Boolean,
      required: false,
      default: false,
    }
  },
  emits: ["close", "saveJson"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const jsonContent = ref("");
    const isValidJson = ref(true);
    const queryEditorRef = ref();
    const { pipelineObj } = useDragAndDrop();
    const validationErrors = ref<any[]>(props.validationErrors || []);
    const storedFields = ref<any>({});

    // Define protected fields based on type
    const getProtectedFields = (type: string) => {
      switch (type) {
        case 'pipelines':
          return ['pipeline_id', 'org', 'name'];
        case 'alerts':
          const baseFields = ['id', 'name', 'org_id', 'last_triggered_at', 'last_satisfied_at', 'owner', 'last_edited_by', 'createdAt', 'updatedAt'];
          // If editing an existing alert, also protect stream-related fields
          if (props.isEditing) {
            return [...baseFields, 'stream_name', 'stream_type', 'is_real_time'];
          }
          return baseFields;
        // Add more cases for other types
        default:
          return [];
      }
    };

    const protectedFields = computed(() => getProtectedFields(props.type));

    const handleEditorChange = (value: string) => {
      try {
        const newContent = JSON.parse(value);
        const protectedFieldChanges: string[] = [];

        // Check for changes in protected fields
        protectedFields.value.forEach(field => {
          if (storedFields.value[field] && newContent[field] !== storedFields.value[field]) {
            protectedFieldChanges.push(field);
          }
        });

        if (protectedFieldChanges.length > 0) {
          // Add validation errors for changed protected fields
          validationErrors.value = [
            ...validationErrors.value.filter(err => !err.startsWith('Cannot modify')),
            ...protectedFieldChanges.map(field => `Cannot modify ${field} field directly , will be reverted to the original value`)
          ];

          // Revert the changes by restoring protected fields
          const revertedContent = {
            ...newContent,
            ...storedFields.value
          };
          
          // Update the editor content with reverted changes
          jsonContent.value = JSON.stringify(revertedContent, null, 2);
          return;
        }

        // If no protected fields were changed, update content normally
        jsonContent.value = value;
        
        // Clear any previous protected field validation errors
        validationErrors.value = validationErrors.value.filter(err => !err.startsWith('Cannot modify'));
      } catch (error) {
        validationErrors.value = ['Invalid JSON format'];
      }
    };

    onMounted(() => {
      // Store initial values of protected fields based on type
      protectedFields.value.forEach(field => {
        if (props.data[field]) {
          storedFields.value[field] = props.data[field];
        }
      });

      jsonContent.value = JSON.stringify(props.data, null, 2);
    });
    //whenever user clicks on save button , we need to save the changes
    //we need to merge the stored fields with the parsed content
    //and then emit the saveJson event

      const saveChanges = () => {
        try {
          const parsedContent = JSON.parse(jsonContent.value);
          // Merge back the stored fields
          const finalContent = {
            ...parsedContent,
            ...storedFields.value
          };
          
          emit("saveJson", JSON.stringify(finalContent));
        } catch (error) {
          console.log(error, 'error')
          validationErrors.value = ['Invalid JSON format'];
        }
      };

      watch(
        () => props.data,
        (newVal) => {
          // Update stored fields based on type
          protectedFields.value.forEach(field => {
            storedFields.value[field] = newVal[field] || storedFields.value[field];
          });

          // Show complete data in editor
          jsonContent.value = JSON.stringify(newVal, null, 2);
        },
      );
      //whenever any errors happens at the time of validating the pipeline , 
      //we need to show the errors in the json editor
      //so we need to watch the validationErrors array
      watch(
        () => props.validationErrors,
        (newErrors) => {
          validationErrors.value = newErrors;
        },
        { immediate: true, deep: true }
      );
      const toggleAIChat = () => {
      const isEnabled = !store.state.isAiChatEnabled;
      store.dispatch("setIsAiChatEnabled", isEnabled);
    }
      const isHovered = ref(false);
      const getBtnLogo = computed(() => {
      if (isHovered.value || store.state.isAiChatEnabled) {
        return getImageURL('images/common/ai_icon_dark.svg')
      }

      return store.state.theme === 'dark'
        ? getImageURL('images/common/ai_icon_dark.svg')
        : getImageURL('images/common/ai_icon.svg')
    })

    return {
      t,
      store,
      jsonContent,
      isValidJson,
      validationErrors,
      queryEditorRef,
      handleEditorChange,
      getImageURL,
      saveChanges,
      config,
      toggleAIChat,
      isHovered,
      getBtnLogo,
    };
  },
});
</script>

<style lang="scss" scoped>
.common-json-editor {
  display: flex;
  flex-direction: column;

  .dark-mode {
    background-color: $dark-page;
  }

  :deep(.monaco-editor) {
    height: 100%;
  }

  :deep(.q-card__section) {
    padding-left: 8px;
    padding-right: 0;
  }

  .validation-errors {
    max-height: 200px;
    overflow-y: auto;
  }

  .no-border {
    border: none !important;
  }
}
</style>
