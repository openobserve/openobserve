<template>
  <q-card
    class="dashboard-json-editor column full-height"
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'bg-white'"
  >
    <div class="row items-center no-wrap">
      <div class="col">
        <div class="q-mx-md q-my-md text-h6">
          {{ t("dashboard.editJson") }}
        </div>
      </div>
      <div class="col-auto">
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

    <q-card-section class="col q-pa-none">
      <query-editor
        data-test="dashboard-json-editor"
        ref="queryEditorRef"
        editor-id="dashboard-json-editor"
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
        color="primary"
        class="q-ml-sm o2-secondary-button tw:h-[36px]"
        v-close-popup
        data-test="json-editor-cancel"
      />
      <q-btn
        class="q-ml-sm o2-primary-button tw:h-[36px]"
        no-caps
        :label="t('common.save')"
        :loading="saveJsonLoading"
        :disable="
          !isValidJson || validationErrors.length > 0 || saveJsonLoading
        "
        @click="saveChanges"
        data-test="json-editor-save"
      />
    </q-card-actions>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import QueryEditor from "@/components/CodeQueryEditor.vue";
import { getImageURL } from "@/utils/zincutils";
import { validateDashboardJson } from "@/utils/dashboard/convertDataIntoUnitValue";

export default defineComponent({
  name: "DashboardJsonEditor",
  components: {
    QueryEditor,
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
  },
  emits: ["close"],
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
          validationErrors.value.push("Dashboard ID cannot be modified");
        }

        // Check if owner has been changed
        if (
          parsedJson.owner &&
          parsedJson.owner !== props.dashboardData.owner
        ) {
          validationErrors.value.push("Owner cannot be modified");
        }

        // Check if created has been changed
        if (
          parsedJson.created &&
          parsedJson.created !== props.dashboardData.created
        ) {
          validationErrors.value.push("Created cannot be modified");
        }
      } catch (error) {
        isValidJson.value = false;
        validationErrors.value = ["Invalid JSON format"];
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
          `Failed during JSON save: ${error instanceof Error ? error.message : "Unknown error"}`,
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
      getImageURL,
    };
  },
});
</script>

<style lang="scss" scoped>
.dashboard-json-editor {
  width: 70vw;
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
