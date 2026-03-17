<template>
  <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem] tw:bg-white">
    <!-- LIST VIEW -->
    <template v-if="!showCreateForm">
      <!-- Header Toolbar -->
      <div class="tw:bg-white tw:mb-[0.8rem] tw:border-b tw:border-gray-200">
        <div
          class="tw:flex tw:items-center tw:justify-between tw:py-3 tw:pl-4 tw:pr-2 tw:h-[68px]"
        >
          <h6 class="q-my-none q-ma-none tw:text-lg tw:font-semibold">
            Evaluation Templates
          </h6>
          <div class="tw:flex tw:gap-2 tw:items-center">
            <q-btn
              flat
              round
              dense
              icon="refresh"
              :loading="loading"
              title="Refresh"
              @click="loadTemplates"
            />
            <q-btn
              color="primary"
              label="New Template"
              icon="add"
              @click="startCreateForm"
            />
          </div>
        </div>
      </div>

      <!-- Main Content Table -->
      <div
        class="q-px-md q-pt-sm q-pb-md tw:bg-white"
        style="height: calc(100vh - 128px)"
      >
        <q-table
          :rows="templates"
          :columns="columns"
          row-key="id"
          :loading="loading"
          :pagination="pagination"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          style="width: 100%; height: 100%"
        >
          <template v-slot:body-cell-version="props">
            <q-td :props="props">
              <q-badge :label="'v' + props.row.version" color="blue" />
            </q-td>
          </template>

          <template v-slot:body-cell-actions="props">
            <q-td :props="props" class="tw:text-center">
              <q-btn
                flat
                round
                dense
                icon="edit"
                size="sm"
                @click="startEditForm(props.row)"
                title="Edit"
              />
              <q-btn
                flat
                round
                dense
                icon="delete"
                size="sm"
                color="negative"
                @click="deleteTemplate(props.row)"
                title="Delete"
              />
              <q-btn
                flat
                round
                dense
                icon="bar_chart"
                size="sm"
                @click="showStats(props.row)"
                title="View Statistics"
              />
            </q-td>
          </template>

          <template #no-data>
            <div class="tw:w-full tw:text-center tw:py-12 text-grey-6">
              No evaluation templates found
            </div>
          </template>
        </q-table>
      </div>
    </template>

    <!-- CREATE/EDIT FORM VIEW -->
    <template v-else>
      <!-- Header Toolbar -->
      <div class="tw:bg-white tw:mb-[0.8rem] tw:border-b tw:border-gray-200">
        <div
          class="tw:flex tw:items-center tw:justify-between tw:py-3 tw:pl-4 tw:pr-2 tw:h-[68px]"
        >
          <h6 class="q-my-none q-ma-none tw:text-lg tw:font-semibold">
            {{
              editingTemplate
                ? "Edit Evaluation Template"
                : "Create New Evaluation Template"
            }}
          </h6>
          <div class="tw:flex tw:gap-2 tw:items-center">
            <q-btn flat
label="Cancel" @click="cancelForm" />
            <q-btn
              color="primary"
              :label="editingTemplate ? 'Update' : 'Create'"
              @click="saveTemplate"
              :loading="saving"
            />
          </div>
        </div>
      </div>

      <!-- Form Content -->
      <div class="card-container" style="height: calc(100vh - 128px); display: flex; flex-direction: column; margin: 0 0.625rem 0.625rem 0; padding: 1rem;">
        <!-- Row 1: Name & Description -->
        <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
          <div style="flex: 1; display: flex; flex-direction: column;">
            <label class="textarea-label">Template Name *</label>
            <div class="o2-input">
              <q-input
                v-model="form.name"
                borderless
                dense
                :rules="[(val) => !!val || 'Name is required']"
              />
            </div>
          </div>
          <div style="flex: 1; display: flex; flex-direction: column;">
            <label class="textarea-label">Description</label>
            <div class="o2-input">
              <q-input
                v-model="form.description"
                borderless
                dense
              />
            </div>
          </div>
        </div>

        <!-- Row 2: Agent Type & Dimensions -->
        <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
          <div style="flex: 0 0 200px; display: flex; flex-direction: column;">
            <label class="textarea-label">Agent Type *</label>
            <div class="o2-input">
              <q-select
                v-model="form.agent_type"
                :options="agentTypes"
                borderless
                dense
                :rules="[(val) => !!val || 'Agent type is required']"
              />
            </div>
          </div>
          <div style="flex: 1; display: flex; flex-direction: column;">
            <label class="textarea-label">Evaluation Dimensions *</label>
            <div class="o2-input">
              <q-select
                v-model="dimensionsInput"
                :options="filteredDimensionOptions"
                borderless
                dense
                multiple
                use-chips
                use-input
                hide-dropdown-icon
                input-debounce="0"
                new-value-mode="add-unique"
                @filter="filterDimensions"
                :rules="[(val) => (val && val.length > 0) || 'At least one dimension is required']"
              />
            </div>
          </div>
        </div>

        <!-- Row 3: Prompt Template (takes majority of space) -->
        <div style="display: flex; flex-direction: column; flex: 1; min-height: 0; margin-bottom: 1rem;">
          <label class="textarea-label">Prompt Template *</label>
          <div class="textarea-border" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
            <q-input
              v-model="form.content"
              borderless
              dense
              type="textarea"
              class="prompt-input"
              :rules="[(val) => !!val || 'Content is required']"
              style="flex: 1; min-height: 0;"
              input-style="resize: none;"
            />
          </div>
        </div>

        <!-- Row 4: Fail & Pass Patterns -->
        <div style="display: flex; gap: 1rem; overflow-y: auto; max-height: 150px;">
          <div style="flex: 1; display: flex; flex-direction: column;">
            <label class="textarea-label">Fail Patterns (optional)</label>
            <div class="textarea-border">
              <q-input
                v-model="failPatternsInput"
                borderless
                dense
                type="textarea"
                rows="2"
              />
            </div>
          </div>
          <div style="flex: 1; display: flex; flex-direction: column;">
            <label class="textarea-label">Pass Patterns (optional)</label>
            <div class="textarea-border">
              <q-input
                v-model="passPatternsInput"
                borderless
                dense
                type="textarea"
                rows="2"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Stats Dialog -->
    <q-dialog v-model="showStatsDialog">
      <q-card style="width: 500px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Template Statistics</div>
          <q-space />
          <q-btn icon="close"
flat round
dense v-close-popup />
        </q-card-section>

        <q-separator />

        <q-card-section v-if="selectedStats" class="scroll q-px-lg q-py-md">
          <div class="q-mb-lg">
            <div class="text-h6">{{ selectedStats.name }}</div>
            <div class="text-caption text-grey-6">
              v{{ selectedStats.version }}
            </div>
          </div>

          <div class="q-mb-lg">
            <div class="text-subtitle2 q-mb-sm">Average Quality Score</div>
            <q-linear-progress
              :value="selectedStats.avg_quality_score"
              color="primary"
              class="q-mb-md"
            />
            <div class="text-body2">
              {{ (selectedStats.avg_quality_score * 100).toFixed(1) }}%
            </div>
          </div>

          <q-separator class="q-my-lg" />

          <div>
            <div class="text-subtitle2 q-mb-md">Usage Statistics</div>
            <q-list bordered separator>
              <q-item>
                <q-item-section>
                  <div class="text-subtitle2">Total Evaluations</div>
                </q-item-section>
                <q-item-section side>
                  <div class="text-weight-bold">
                    {{ selectedStats.total_evaluations }}
                  </div>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section>
                  <div class="text-subtitle2">Last Used</div>
                </q-item-section>
                <q-item-section side>
                  <div class="text-caption">
                    {{ formatDate(selectedStats.last_used) }}
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-card-section>

        <q-separator />

        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat label="Close"
color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed } from "vue";
import { useQuasar } from "quasar";
import { useRoute } from "vue-router";
import { evalTemplateService } from "@/services/eval-template.service";

interface Template {
  id: string;
  org_id: string;
  agent_type: string;
  name: string;
  description?: string;
  content: string;
  dimensions: string[];
  version: number;
  created_at: number;
  updated_at: number;
}

interface Stats {
  template_id: string;
  name: string;
  version: number;
  total_evaluations: number;
  avg_quality_score: number;
  last_used: number;
}

const $q = useQuasar();
const route = useRoute();

const templates = ref<Template[]>([]);
const loading = ref(false);
const saving = ref(false);
const showCreateForm = ref(false);
const showStatsDialog = ref(false);
const editingTemplate = ref<Template | null>(null);
const selectedStats = ref<Stats | null>(null);

const form = ref({
  name: "",
  agent_type: "",
  description: "",
  content: "",
});

const dimensionsInput = ref<string[]>([]);
const failPatternsInput = ref("");
const passPatternsInput = ref("");

const defaultDimensionOptions = [
  "accuracy",
  "clarity",
  "completeness",
  "coherence",
  "conciseness",
  "correctness",
  "faithfulness",
  "helpfulness",
  "relevance",
  "safety",
  "toxicity",
];

const filteredDimensionOptions = ref<string[]>(defaultDimensionOptions);

const filterDimensions = (val: string, update: (fn: () => void) => void) => {
  update(() => {
    if (!val) {
      filteredDimensionOptions.value = defaultDimensionOptions;
    } else {
      const needle = val.toLowerCase();
      filteredDimensionOptions.value = defaultDimensionOptions.filter((d) =>
        d.includes(needle)
      );
    }
  });
};

const agentTypes = ["sre", "security", "custom", "unknown"];

const pagination = ref({
  sortBy: "updated_at",
  descending: true,
  page: 1,
  rowsPerPage: 10,
});

const formatDate = (timestamp: number) => {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const columns = [
  { name: "name", label: "Name", field: "name", align: "left" },
  {
    name: "agent_type",
    label: "Agent Type",
    field: "agent_type",
    align: "left",
  },
  { name: "version", label: "Version", field: "version", align: "center" },
  {
    name: "updated_at",
    label: "Updated",
    field: "updated_at",
    align: "left",
    format: formatDate,
  },
  { name: "stats", label: "Statistics", align: "center" },
  { name: "actions", label: "Actions", align: "center" },
];

onMounted(() => {
  loadTemplates();
});

const loadTemplates = async () => {
  loading.value = true;
  try {
    const orgId =
      (route.query.org_identifier as string) ||
      localStorage.getItem("org_id") ||
      "default";
    templates.value = await evalTemplateService.listTemplates(orgId);
  } catch (error) {
    $q.notify({
      type: "negative",
      message: "Failed to load templates",
      caption: String(error),
    });
  } finally {
    loading.value = false;
  }
};

const startCreateForm = () => {
  resetForm();
  editingTemplate.value = null;
  showCreateForm.value = true;
};

const startEditForm = (template: Template) => {
  editingTemplate.value = template;
  form.value = {
    name: template.name,
    agent_type: template.agent_type,
    description: template.description || "",
    content: template.content,
  };
  dimensionsInput.value = [...template.dimensions];
  failPatternsInput.value = "";
  passPatternsInput.value = "";
  showCreateForm.value = true;
};

const cancelForm = () => {
  showCreateForm.value = false;
  resetForm();
};

const saveTemplate = async () => {
  // Validation
  if (
    !form.value.name ||
    !form.value.agent_type ||
    !form.value.content ||
    !dimensionsInput.value.length
  ) {
    $q.notify({
      type: "warning",
      message: "Please fill in all required fields",
    });
    return;
  }

  saving.value = true;
  try {
    const orgId =
      (route.query.org_identifier as string) ||
      localStorage.getItem("org_id") ||
      "default";
    const payload = {
      ...form.value,
      dimensions: dimensionsInput.value,
      fail_patterns: failPatternsInput.value
        ? failPatternsInput.value.split(",").map((p) => p.trim())
        : undefined,
      pass_patterns: passPatternsInput.value
        ? passPatternsInput.value.split(",").map((p) => p.trim())
        : undefined,
    };

    if (editingTemplate.value) {
      await evalTemplateService.updateTemplate(
        orgId,
        editingTemplate.value.id,
        payload,
      );
      $q.notify({
        type: "positive",
        message: "Template updated successfully",
      });
    } else {
      await evalTemplateService.createTemplate(orgId, payload);
      $q.notify({
        type: "positive",
        message: "Template created successfully",
      });
    }

    showCreateForm.value = false;
    resetForm();
    await loadTemplates();
  } catch (error) {
    $q.notify({
      type: "negative",
      message: editingTemplate.value
        ? "Failed to update template"
        : "Failed to create template",
      caption: String(error),
    });
  } finally {
    saving.value = false;
  }
};

const deleteTemplate = async (template: Template) => {
  $q.dialog({
    title: "Delete Template",
    message: `Are you sure you want to delete "${template.name}"?`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    try {
      const orgId =
        (route.query.org_identifier as string) ||
        localStorage.getItem("org_id") ||
        "default";
      await evalTemplateService.deleteTemplate(orgId, template.id);
      $q.notify({
        type: "positive",
        message: "Template deleted successfully",
      });
      await loadTemplates();
    } catch (error: any) {
      // Extract error message from axios error response
      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to delete template";
      $q.notify({
        type: "negative",
        message: errorMessage,
      });
    }
  });
};

const showStats = async (template: Template) => {
  try {
    const orgId =
      (route.query.org_identifier as string) ||
      localStorage.getItem("org_id") ||
      "default";
    selectedStats.value = await evalTemplateService.getTemplateStats(
      orgId,
      template.id,
    );
    showStatsDialog.value = true;
  } catch (error) {
    $q.notify({
      type: "negative",
      message: "Failed to load template statistics",
      caption: String(error),
    });
  }
};

const resetForm = () => {
  form.value = {
    name: "",
    agent_type: "",
    description: "",
    content: "",
  };
  dimensionsInput.value = [];
  failPatternsInput.value = "";
  passPatternsInput.value = "";
  editingTemplate.value = null;
};
</script>

<style scoped lang="scss">
.card-container {
  background: var(--q-color-page);
  border-radius: 4px;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.1);
}

.textarea-border {
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;

  :deep(.q-field__control) {
    border: none !important;
    box-shadow: none !important;
  }
}

.textarea-label {
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: var(--q-color-text);
}

/* Make the Prompt Template textarea fill all available vertical space */
.prompt-input {
  display: flex;
  flex-direction: column;
  min-height: 0;

  :deep(.q-field__inner) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  :deep(.q-field__control) {
    flex: 1;
    min-height: 0;
    height: auto !important;
    align-items: stretch;
  }

  :deep(.q-field__control-container) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  :deep(textarea) {
    flex: 1;
    min-height: 0;
    height: 100% !important;
    resize: none !important;
  }
}
</style>
