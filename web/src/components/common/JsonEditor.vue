<template>
  <div
    :ref="docked ? docked.dockSlot : undefined"
    class="dark:bg-surface-base flex h-[calc(100vh-3.75rem)] min-h-0"
  >
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref="editorArea" :class="['flex min-h-0 flex-1 flex-col', docked ? 'relative' : '']">
        <AssistantDiffBlock
          v-if="docked?.proposal.pending.value"
          :key="docked.proposal.pending.value.id"
          :proposal="docked.proposal.pending.value"
          class="absolute inset-0 z-1000"
        />
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
        <div class="mb-2 font-bold">{{ t("common.pleaseFixIssues") }}</div>
        <ul class="ms-3">
          <li v-for="(error, index) in localValidationErrors" :key="index">
            {{ error }}
          </li>
        </ul>
      </div>

      <div class="flex shrink-0 justify-end gap-2 p-3">
        <AiLabel
          v-if="docked?.proposal.label.value"
          :state="docked.proposal.label.value"
          class="me-auto"
          @revert="docked.proposal.revert"
          @ask-again="docked.dock.askAgain"
        />
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
    <AssistantDock v-if="docked" :host="docked.adapter" />
    <!-- o2aichat enabled -->
    <div v-else-if="store.state.isAiChatEnabled" class="ms-2 h-full w-[25vw]">
      <O2AIChat
        class="h-full"
        :is-open="store.state.isAiChatEnabled"
        @close="store.state.isAiChatEnabled = false"
      />
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  watch,
  computed,
  defineAsyncComponent,
  type PropType,
} from "vue";
import { type I18nText, raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { getImageURL } from "@/utils/zincutils";
import O2AIChat from "../O2AIChat.vue";
import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import useTheme from "@/composables/useTheme";
import { isAssistantV2, useDockedEditor, type DockedEditor } from "@/composables/assistant/pure";

export default defineComponent({
  name: "JsonEditor",
  components: {
    QueryEditor: defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue")),
    O2AIChat,
    OButton,
    // The assistant's parts load only where the revamp renders them, never in the flag-off chunk.
    AiLabel: defineAsyncComponent(() => import("@/components/ai-assistant/entry/AiLabel.vue")),
    AssistantDiffBlock: defineAsyncComponent(
      () => import("@/components/ai-assistant/evidence/AssistantDiffBlock.vue"),
    ),
    AssistantDock: defineAsyncComponent(
      () => import("@/components/ai-assistant/shell/AssistantDock.vue"),
    ),
  },
  props: {
    data: {
      type: Object,
      required: true,
    },
    title: {
      type: String as unknown as PropType<I18nText>,
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
    const { t } = useI18nTyped();
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

    // The protected-field errors are rebuilt on every edit, so the stale ones have
    // to be dropped first. Matching on the rendered message (not an English prefix)
    // keeps that working in every locale.
    const protectedFieldError = (field: string): I18nText =>
      t("common.cannotModifyProtectedField", { field });
    const isProtectedFieldError = (err: unknown) =>
      typeof err === "string" && protectedFields.value.some((f) => err === protectedFieldError(f));

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
            ...localValidationErrors.value.filter((err) => !isProtectedFieldError(err)),
            ...protectedFieldChanges.map((field) => protectedFieldError(field)),
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
          (err) => !isProtectedFieldError(err),
        );
      } catch (error) {
        localValidationErrors.value = [t("common.invalidJsonFormat")];
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
      openedWith = jsonContent.value;
    });
    //whenever user clicks on save button , we need to save the changes
    //we need to merge the stored fields with the parsed content
    //and then emit the saveJson event

    const editorArea = ref<HTMLElement | null>(null);
    let openedWith = "";
    const docked: DockedEditor | null = isAssistantV2() ? jsonHost() : null;

    function landWithProtectedFields(text: string): { text: string; kept: boolean } {
      try {
        const parsed = JSON.parse(text);
        const kept = protectedFields.value.some(
          (field) => storedFields.value[field] && parsed?.[field] !== storedFields.value[field],
        );
        if (!kept) return { text, kept };
        return { text: JSON.stringify({ ...parsed, ...storedFields.value }, null, 2), kept };
      } catch {
        return { text, kept: false };
      }
    }

    function jsonHost(): DockedEditor {
      const isAlert = props.type === "alerts";
      const name = () => String(props.data?.name ?? "");
      return useDockedEditor({
        id: "json_editor",
        objectKind: isAlert ? "alert" : "pipeline_node",
        objectTitle: () =>
          isAlert
            ? name()
              ? t("assistant.editor.title.alert", { name: raw(name()) })
              : t("assistant.editor.title.alertNew")
            : name()
              ? t("assistant.editor.title.pipeline", { name: raw(name()) })
              : t("assistant.editor.title.pipelineNew"),
        language: () => "json",
        getBuffer: () => jsonContent.value,
        getContext: () =>
          isAlert
            ? { ...(props.data?.id && { alertId: String(props.data.id) }) }
            : { ...(props.data?.pipeline_id && { pipelineId: String(props.data.pipeline_id) }) },
        isDirty: () => !!openedWith && jsonContent.value !== openedWith,
        focusEditor: () => editorArea.value?.querySelector<HTMLElement>("textarea")?.focus(),
        write(text) {
          const landed = landWithProtectedFields(text);
          jsonContent.value = landed.text;
          queryEditorRef.value?.replaceValue?.(landed.text);
          return {
            text: landed.text,
            ...(landed.kept && { note: "assistant.editor.protectedFields" as const }),
          };
        },
        area: () => editorArea.value,
      });
    }

    const saveChanges = () => {
      docked?.proposal.clear();
      try {
        const parsedContent = JSON.parse(jsonContent.value);
        // Merge back the stored fields
        const finalContent = {
          ...parsedContent,
          ...storedFields.value,
        };

        emit("saveJson", JSON.stringify(finalContent));
      } catch (error) {
        localValidationErrors.value = [t("common.invalidJsonFormat")];
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
      docked,
      editorArea,
    };
  },
});
</script>
