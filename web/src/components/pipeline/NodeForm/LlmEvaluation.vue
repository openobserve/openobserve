<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <ODrawer
    :open="internalOpen"
    @update:open="handleDrawerClose"
    :title="t('pipeline.llmEvaluation')"
    :width="30"
    :show-close="true"
    @keydown.stop
    :primaryButtonLabel="t('alerts.save')"
    :secondaryButtonLabel="t('alerts.cancel')"
    :neutralButtonLabel="pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    @click:primary="saveLlmEvaluationNode"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
  >
    <div
      data-test="llm-evaluation-node-section"
      :class="store.state.theme === 'dark' ? 'tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'tw:bg-white'"
    >


    <div class="stream-routing-container tw:w-full tw:pt-3 tw:pb-3 tw:px-3 tw:flex tw:flex-col tw:gap-4">
        <!-- Node Name -->
        <OInput
          v-model="nodeName"
          :label="t('pipeline.nodeName') + ' *'"
          :error="!!nodeNameError"
          :error-message="nodeNameError"
          @update:model-value="nodeNameError = ''"
          data-test="llm-evaluation-node-name-input"
        />

        <!-- LLM Span Identifier -->
        <OSelect
          v-model="llmSpanIdentifier"
          :options="streamFields"
          labelKey="label"
          valueKey="value"
          searchable
          :label="t('pipeline.llmSpanIdentifierLabel')"
          :loading="loadingFields"
          data-test="llm-evaluation-span-identifier-select"
        >
          <template #empty>
            <span>{{ t("pipeline.noFieldsFound") }}</span>
          </template>
        </OSelect>

        <!-- Evaluation Template Selection -->
        <div class="tw:flex tw:items-end tw:gap-2">
          <OSelect
            v-model="selectedTemplate"
            :options="availableTemplates"
            labelKey="name"
            valueKey="id"
            :label="t('pipeline.evaluationTemplate')"
            :loading="loadingTemplates"
            class="tw:flex-1"
            data-test="llm-evaluation-template-select"
          >
            <template #empty>
              <span>{{ t("pipeline.noTemplatesFound") }}</span>
            </template>
          </OSelect>
          <OButton
            variant="ghost-muted"
            size="icon-xs-sq"
            @click="refreshTemplates"
            :loading="loadingTemplates"
            :title="t('common.refresh')"
            data-test="llm-evaluation-template-refresh-btn"
            icon-left="refresh"
          />
        </div>

        <!-- Enable Sampling Toggle -->
        <OSwitch
          v-model="enableSampling"
          :label="t('pipeline.enableSampling')"
          data-test="llm-evaluation-enable-sampling-toggle"
        />

        <!-- Sampling Rate -->
        <div v-if="enableSampling" class="tw:flex tw:flex-col tw:gap-2">
          <div class="tw:text-sm">
            {{ t("pipeline.samplingRate") }}:
            {{ (samplingRate * 100).toFixed(0) }}%
          </div>
          <OSlider
            v-model="samplingRate"
            :min="0"
            :max="1"
            :step="0.01"
            data-test="llm-evaluation-sampling-rate-slider"
          />
        </div>


    </div>
    </div>
  </ODrawer>
  <confirm-dialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSlider from "@/lib/forms/Slider/OSlider.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "LlmEvaluation",
  components: { ConfirmDialog, OButton, ODrawer, OInput, OSelect, OSwitch, OSlider },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["cancel:hideform"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

    const nodeNameError = ref("");
    const internalOpen = ref(!!props.open);
    watch(() => props.open, (v: boolean) => { internalOpen.value = !!v; });
    function handleDrawerClose(v: boolean) {
      internalOpen.value = v;
      if (!v) {
        setTimeout(() => emit("cancel:hideform"), 300);
      }
    }
    const { getStream } = useStreams();

    const nodeName = ref("");
    const enableSampling = ref(true);
    const samplingRate = ref(0.01);
    const llmSpanIdentifier = ref("gen_ai_system");
    const streamFields = ref<{ label: string; value: string }[]>([]);
    const filteredStreamFields = ref<{ label: string; value: string }[]>([]);
    const loadingFields = ref(false);
    const selectedTemplate = ref<string | undefined>(undefined);
    const availableTemplates = ref<any[]>([]);
    const loadingTemplates = ref(false);

    const dialog = ref({
      show: false,
      title: "",
      message: "",
      okCallback: () => {},
    });

    const fetchSourceStreamFields = async () => {
      loadingFields.value = true;
      try {
        const allNodes = pipelineObj.currentSelectedPipeline?.nodes || [];
        const inputStreamNode: any = allNodes.find(
          (node: any) =>
            node.io_type === "input" && node.data.node_type === "stream",
        );

        if (inputStreamNode) {
          const streamName =
            inputStreamNode.data?.stream_name?.value ||
            inputStreamNode.data?.stream_name;
          const streamType = inputStreamNode.data?.stream_type;
          const streams: any = await getStream(streamName, streamType, true);

          if (streams && Array.isArray(streams.schema)) {
            streamFields.value = streams.schema.map((column: any) => ({
              label: column.name,
              value: column.name,
            }));
          }
        }
      } catch (e) {
        console.error("Failed to fetch stream fields:", e);
      } finally {
        filteredStreamFields.value = [...streamFields.value];
        loadingFields.value = false;
      }
    };

    const fetchAvailableTemplates = async (forceRefresh: boolean = false) => {
      loadingTemplates.value = true;
      try {
        const orgId = store.state.selectedOrganization?.identifier;
        if (!orgId) {
          console.warn("No organization selected");
          return;
        }

        // Use store cache unless force refresh requested
        if (!forceRefresh) {
          const cached = store.state.streams.evalTemplatesByOrg[orgId];
          if (cached && cached.length > 0) {
            availableTemplates.value = cached;
            return;
          }
        }

        const { evalTemplateService } =
          await import("@/services/eval-template.service");
        const templates = await evalTemplateService.listTemplates(orgId);
        availableTemplates.value = templates || [];

        store.dispatch("streams/setEvalTemplates", {
          orgId,
          templates: templates || [],
        });
      } catch (e) {
        console.error("Failed to fetch evaluation templates:", e);
        availableTemplates.value = [];
      } finally {
        loadingTemplates.value = false;
      }
    };

    const refreshTemplates = async () => {
      await fetchAvailableTemplates(true); // Force refresh by ignoring cache
      toast({
        variant: "success",
        message: t("pipeline.evalTemplatesRefreshed"),
        timeout: 1500,
      });
    };

    const filterStreamFields = (val: string, update: Function) => {
      update(() => {
        if (!val) {
          filteredStreamFields.value = [...streamFields.value];
        } else {
          const needle = val.toLowerCase();
          filteredStreamFields.value = streamFields.value.filter((field) =>
            field.label.toLowerCase().includes(needle),
          );
        }
      });
    };

    onMounted(async () => {
      if (pipelineObj.userSelectedNode) {
        pipelineObj.userSelectedNode = {};
      }

      let savedTemplate: string | null = null;
      if (pipelineObj.isEditNode && pipelineObj.currentSelectedNodeData) {
        const data = pipelineObj.currentSelectedNodeData.data;
        nodeName.value = data.name || "";
        llmSpanIdentifier.value = data.llm_span_identifier || "gen_ai_system";
        savedTemplate = data.eval_template || null;

        if (
          data.sampling_rate !== undefined &&
          data.sampling_rate !== null &&
          data.sampling_rate > 0
        ) {
          enableSampling.value = true;
          samplingRate.value = data.sampling_rate;
        } else {
          enableSampling.value = false;
        }
      } else {
        nodeName.value = "evaluate";
      }

      await fetchSourceStreamFields();
      await fetchAvailableTemplates();

      if (savedTemplate) {
        selectedTemplate.value = savedTemplate;
      } else if (
        !pipelineObj.isEditNode &&
        availableTemplates.value.length > 0
      ) {
        // New node: default to first template (only after templates have loaded)
        selectedTemplate.value = availableTemplates.value[0]?.id || undefined;
      }
    });

    const openCancelDialog = () => {
      dialog.value.show = true;
      dialog.value.title = t("pipeline.discardChangesTitle");
      dialog.value.message = t("pipeline.cancelChangesConfirm");
      dialog.value.okCallback = () => emit("cancel:hideform");
      pipelineObj.userClickedNode = {};
      pipelineObj.userSelectedNode = {};
    };

    const openDeleteDialog = () => {
      dialog.value.show = true;
      dialog.value.title = t("pipeline.deleteNodeTitle");
      dialog.value.message = t("pipeline.deleteNodeLlmEvalConfirm");
      dialog.value.okCallback = deleteNode;
    };

    const deleteNode = () => {
      deletePipelineNode(pipelineObj.currentSelectedNodeID);
      emit("cancel:hideform");
    };

    const saveLlmEvaluationNode = () => {
      if (!nodeName.value || nodeName.value.trim() === "") {
        nodeNameError.value = t("common.nameRequired");
        toast({
          variant: "error",
          message: t("common.nameRequired"),
          timeout: 1500,
        });
        return;
      }

      const nodeData: any = {
        name: nodeName.value.trim(),
        node_type: "llm_evaluation",
        enable_llm_judge: true,
        llm_span_identifier: llmSpanIdentifier.value || "gen_ai_system",
        sampling_rate: enableSampling.value ? samplingRate.value : 0.0,
      };

      nodeData.eval_template = selectedTemplate.value || null;

      addNode(nodeData);

      toast({
        variant: "success",
        message: t("pipeline.llmEvaluationNodeSaved"),
        timeout: 1500,
      });

      emit("cancel:hideform");
    };

    return {
      t,
      store,
      nodeName,
      nodeNameError,
      enableSampling,
      samplingRate,
      llmSpanIdentifier,
      filteredStreamFields,
      loadingFields,
      filterStreamFields,
      selectedTemplate,
      availableTemplates,
      loadingTemplates,
      refreshTemplates,
      saveLlmEvaluationNode,
      openCancelDialog,
      openDeleteDialog,
      deleteNode,
      dialog,
      pipelineObj,
      internalOpen,
      handleDrawerClose,
    };
  },
});
</script>

<style lang="scss">
.stream-routing-title {
  font-size: 18px;
  padding-top: 16px;
}
</style>
