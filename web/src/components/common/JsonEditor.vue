<template>
  <div class="dark:bg-surface-base flex h-[calc(100vh-3.75rem)] min-h-0">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col">
        <QueryEditor
          data-test="common-json-editor"
          ref="queryEditorRef"
          editor-id="common-json-editor"
          class="h-full min-h-0 flex-1"
          :debounceTime="300"
          v-model:query="jsonContent"
          language="json"
          @update:query="handleEditorChange"
        />
      </div>

      <!-- Display validation errors -->
      <div
        v-if="localValidationErrors.length > 0"
        data-test="common-json-editor-validation-errors"
        class="text-status-error-text max-h-50 shrink-0 overflow-y-auto p-3"
      >
        <div class="mb-2 font-bold">Please fix the following issues:</div>
        <ul class="ml-3">
          <li v-for="(error, index) in localValidationErrors" :key="index">
            {{ error }}
          </li>
        </ul>
      </div>

      <div class="flex shrink-0 justify-end gap-2 p-3">
        <OButton
          variant="outline"
          size="sm-action"
          @click="$emit('close')"
          data-test="json-editor-cancel"
          >{{ t("common.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          @click="saveChanges"
          data-test="json-editor-save"
          >{{ t("common.save") }}</OButton
        >
      </div>
    </div>
    <!-- o2aichat enabled -->
    <div v-if="store.state.isAiChatEnabled" class="ml-2 h-full w-[25vw]">
      <O2AIChat
        class="h-full"
        :is-open="store.state.isAiChatEnabled"
        @close="store.state.isAiChatEnabled = false"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, computed, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getImageURL } from "@/utils/zincutils";
import O2AIChat from "../O2AIChat.vue";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import useTheme from "@/composables/useTheme";

export default defineComponent({
  name: "JsonEditor",
  components: {
    QueryEditor: defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue")),
    O2AIChat,
    OButton,
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
    },
  },
  emits: ["close", "saveJson"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const { isDark } = useTheme();
    const jsonContent = ref("");
    const isValidJson = ref(true);
    const queryEditorRef = ref();
    const localValidationErrors = ref<any[]>(props.validationErrors || []);
    const storedFields = ref<any>({});

    // Define protected fields based on type
    const getProtectedFields = (type: string) => {
      switch (type) {
        case "pipelines":
          return ["pipeline_id", "org", "name"];
        case "alerts": {
          const baseFields = [
            "id",
            "name",
            "org_id",
            "last_triggered_at",
            "last_satisfied_at",
            "owner",
            "last_edited_by",
            "createdAt",
            "updatedAt",
          ];
          // If editing an existing alert, also protect stream-related fields
          if (props.isEditing) {
            return [...baseFields, "stream_name", "stream_type", "is_real_time"];
          }
          return baseFields;
        }
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
        protectedFields.value.forEach((field) => {
          if (storedFields.value[field] && newContent[field] !== storedFields.value[field]) {
            protectedFieldChanges.push(field);
          }
        });

        if (protectedFieldChanges.length > 0) {
          // Add validation errors for changed protected fields
          localValidationErrors.value = [
            ...localValidationErrors.value.filter((err) => !err.startsWith("Cannot modify")),
            ...protectedFieldChanges.map(
              (field) =>
                `Cannot modify ${field} field directly , will be reverted to the original value`,
            ),
          ];

          // Revert the changes by restoring protected fields
          const revertedContent = {
            ...newContent,
            ...storedFields.value,
          };

          // Update the editor content with reverted changes
          jsonContent.value = JSON.stringify(revertedContent, null, 2);
          return;
        }

        // If no protected fields were changed, update content normally
        jsonContent.value = value;

        // Clear any previous protected field validation errors
        localValidationErrors.value = localValidationErrors.value.filter(
          (err) => !err.startsWith("Cannot modify"),
        );
      } catch (error) {
        localValidationErrors.value = ["Invalid JSON format"];
      }
    };

    onMounted(() => {
      // Store initial values of protected fields based on type
      protectedFields.value.forEach((field) => {
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
          ...storedFields.value,
        };

        emit("saveJson", JSON.stringify(finalContent));
      } catch (error) {
        localValidationErrors.value = ["Invalid JSON format"];
      }
    };

    watch(
      () => props.data,
      (newVal) => {
        // Update stored fields based on type
        protectedFields.value.forEach((field) => {
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
        localValidationErrors.value = newErrors;
      },
      { immediate: true, deep: true },
    );
    const toggleAIChat = () => {
      const isEnabled = !store.state.isAiChatEnabled;
      store.dispatch("setIsAiChatEnabled", isEnabled);
    };
    const isHovered = ref(false);
    const getBtnLogo = computed(() => {
      if (isHovered.value || store.state.isAiChatEnabled) {
        return getImageURL("images/common/ai_icon_dark.svg");
      }

      return isDark.value
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg");
    });

    return {
      t,
      store,
      jsonContent,
      isValidJson,
      localValidationErrors,
      queryEditorRef,
      handleEditorChange,
      getImageURL,
      saveChanges,
      config,
      toggleAIChat,
      isHovered,
      getBtnLogo,
      protectedFields,
      storedFields,
    };
  },
});
</script>
