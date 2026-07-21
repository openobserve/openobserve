<template>
  <ODrawer data-test="dashboard-json-editor-drawer"
    bleed
    :open="open"
    :width="70"
    persistent
    :title="t('dashboard.editJson')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('common.save')"
    :primary-button-loading="saveJsonLoading"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
    @click:primary="saveChanges()"
  >
  <div data-test="dashboard-json-editor-container" class="w-[70vw] flex flex-col h-[calc(100vh-116px)] bg-surface-base">
    <!-- Monaco editor fills remaining space; flex-1 + min-h-0 lets it expand without overflow -->
    <div class="flex-1 min-h-0">
      <query-editor
        data-test="dashboard-json-editor"
        ref="queryEditorRef"
        editor-id="dashboard-json-editor"
        class="h-full"
        :debounceTime="300"
        v-model:query="jsonContent"
        language="json"
        @update:query="handleEditorChange"
      />
    </div>

    <!-- Display validation errors -->
    <div
      v-if="validationErrors.length > 0"
      data-test="dashboard-json-editor-validation-errors"
      class="p-3 text-status-error-text max-h-50 overflow-y-auto"
    >
      <div class="font-bold mb-2">{{ t('dashboard.dashboardJsonEditor.pleaseFixIssues') }}</div>
      <ul class="ml-3">
        <li v-for="(error, index) in validationErrors" :key="index">
          {{ error }}
        </li>
      </ul>
    </div>
  </div>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { defineAsyncComponent } from "vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);
import { validateDashboardJson } from "@/utils/dashboard/panelValidation";

export default defineComponent({
  name: "DashboardJsonEditor",
  components: {
    QueryEditor,
    ODrawer,
  },
  props: {
    dashboardData: {
      type: Object,
      required: true,
    },
    saveJsonDashboard: {
      type: Object,
      required: true,
    },
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["close", "update:open"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const jsonContent = ref("");
    const isValidJson = ref(true);
    const validationErrors = ref<string[]>([]);
    const queryEditorRef = ref();

    // Use the loading state from the parent component
    const saveJsonLoading = computed(
      () => props.saveJsonDashboard.isLoading.value,
    );

    const handleEditorChange = (value: string) => {
      try {
        const parsedJson = JSON.parse(value);
        isValidJson.value = true;

        // Validate the dashboard JSON structure
        validationErrors.value = validateDashboardJson(parsedJson);

        // Check if dashboardId has been changed
        if (
          parsedJson.dashboardId &&
          parsedJson.dashboardId !== props.dashboardData.dashboardId
        ) {
          validationErrors.value.push(
            t("dashboard.dashboardJsonEditor.dashboardIdCannotBeModified"),
          );
        }

        // Check if owner has been changed
        if (
          parsedJson.owner &&
          parsedJson.owner !== props.dashboardData.owner
        ) {
          validationErrors.value.push(
            t("dashboard.dashboardJsonEditor.ownerCannotBeModified"),
          );
        }

        // Check if created has been changed
        if (
          parsedJson.created &&
          parsedJson.created !== props.dashboardData.created
        ) {
          validationErrors.value.push(
            t("dashboard.dashboardJsonEditor.createdCannotBeModified"),
          );
        }
      } catch (error) {
        isValidJson.value = false;
        validationErrors.value = [
          t("dashboard.dashboardJsonEditor.invalidJsonFormat"),
        ];
      }
    };

    const saveChanges = async () => {
      if (!isValidJson.value || saveJsonLoading.value) return;

      try {
        const updatedJson = JSON.parse(jsonContent.value);
        // Validate one more time before saving
        const errors = validateDashboardJson(updatedJson);

        if (errors.length > 0) {
          // Show validation errors
          validationErrors.value = errors;
          return;
        }

        await props.saveJsonDashboard.execute(updatedJson);
      } catch (error) {
        console.error("Failed during JSON save:", error);
        validationErrors.value = [
          t("dashboard.dashboardJsonEditor.failedDuringJsonSave", {
            error:
              error instanceof Error
                ? error.message
                : t("dashboard.dashboardJsonEditor.unknownError"),
          }),
        ];
      }
    };

    onMounted(() => {
      jsonContent.value = JSON.stringify(props.dashboardData, null, 2);
    });

    watch(
      () => props.dashboardData,
      (newVal) => {
        jsonContent.value = JSON.stringify(newVal, null, 2);
      },
    );

    return {
      t,
      store,
      jsonContent,
      isValidJson,
      validationErrors,
      saveJsonLoading,
      queryEditorRef,
      handleEditorChange,
      saveChanges,
    };
  },
});
</script>
