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
    form-id="llm-evaluation-form"
    :primaryButtonLabel="t('alerts.save')"
    :secondaryButtonLabel="t('alerts.cancel')"
    :neutralButtonLabel="pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
  >
    <div
      data-test="llm-evaluation-node-section"
      :class="store.state.theme === 'dark' ? 'bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'bg-white'"
    >
      <OForm id="llm-evaluation-form" :form="form">
        <div class="stream-routing-container w-full pt-3 pb-3 px-3 flex flex-col gap-4">
          <!-- Node Name -->
          <OFormInput
            name="nodeName"
            :label="t('pipeline.nodeName')"
            required
            data-test="llm-evaluation-node-name-input"
          />

          <!-- LLM Span Identifier -->
          <OFormSelect
            name="spanIdentifier"
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
          </OFormSelect>

          <!-- Evaluation Template Selection -->
          <div class="flex items-end gap-2">
            <OFormSelect
              name="template"
              :options="availableTemplates"
              labelKey="name"
              valueKey="id"
              :label="t('pipeline.evaluationTemplate')"
              :loading="loadingTemplates"
              class="flex-1"
              data-test="llm-evaluation-template-select"
            >
              <template #empty>
                <span>{{ t("pipeline.noTemplatesFound") }}</span>
              </template>
            </OFormSelect>
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
          <OFormSwitch
            name="enableSampling"
            :label="t('pipeline.enableSampling')"
            data-test="llm-evaluation-enable-sampling-toggle"
          />

          <!-- Sampling Rate -->
          <div v-if="enableSampling" class="flex flex-col gap-2">
            <div class="text-sm">
              {{ t("pipeline.samplingRate") }}:
              {{ (samplingRate * 100).toFixed(0) }}%
            </div>
            <OFormSlider
              name="samplingRate"
              :min="0"
              :max="1"
              :step="0.01"
              data-test="llm-evaluation-sampling-rate-slider"
            />
          </div>
        </div>
      </OForm>
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
import {
  defineComponent,
  ref,
  computed,
  onMounted,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormSlider from "@/lib/forms/Slider/OFormSlider.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeLlmEvaluationSchema,
  type LlmEvaluationForm,
} from "./LlmEvaluation.schema";

export default defineComponent({
  name: "LlmEvaluation",
  components: {
    ConfirmDialog,
    OButton,
    ODrawer,
    OForm,
    OFormInput,
    OFormSelect,
    OFormSwitch,
    OFormSlider,
  },
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

    // Options-API form: the schema (and the defaults computed below) MUST be
    // returned from setup() or the template binds `:schema="undefined"` and the
    // form silently never validates (foundation checklist §5.6).
    const llmEvaluationSchema = makeLlmEvaluationSchema(t);

    const internalOpen = ref(!!props.open);
    watch(() => props.open, (v: boolean) => { internalOpen.value = !!v; });
    function handleDrawerClose(v: boolean) {
      internalOpen.value = v;
      if (!v) {
        setTimeout(() => emit("cancel:hideform"), 300);
      }
    }
    const { getStream } = useStreams();

    // ── Seed values for the form's `:default-values` ──────────────────────────
    // Computed synchronously in setup() so they are ready before OForm mounts
    // (edit-node data is available synchronously from `pipelineObj`). The
    // form owns the live values after mount; these only seed it.
    const editData =
      pipelineObj.isEditNode && pipelineObj.currentSelectedNodeData
        ? pipelineObj.currentSelectedNodeData.data
        : null;

    const nodeNameSeed = ref(editData ? editData.name || "" : "evaluate");
    const spanIdentifierSeed = ref(
      editData ? editData.llm_span_identifier || "gen_ai_system" : "gen_ai_system",
    );
    const templateSeed = ref<string | null>(
      editData ? editData.eval_template || null : null,
    );
    const enableSamplingSeed = ref(
      editData
        ? editData.sampling_rate !== undefined &&
            editData.sampling_rate !== null &&
            editData.sampling_rate > 0
        : true,
    );
    const samplingRateSeed = ref(
      editData &&
        editData.sampling_rate !== undefined &&
        editData.sampling_rate !== null &&
        editData.sampling_rate > 0
        ? editData.sampling_rate
        : 0.01,
    );

    // Typed dynamic defaults (edit-prefill) — read once at OForm mount.
    const llmEvaluationDefaults = computed((): LlmEvaluationForm => ({
      nodeName: nodeNameSeed.value,
      spanIdentifier: spanIdentifierSeed.value,
      template: templateSeed.value,
      enableSampling: enableSamplingSeed.value,
      samplingRate: samplingRateSeed.value,
    }));

    // Rule ③ OWNER pattern: this component OWNS <OForm> and needs the live
    // `enableSampling` / `samplingRate` for the slider's `v-if` + percentage
    // display, so it creates the form here with useOForm and reads it reactively
    // via form.useStore — a SINGLE source of truth (no mirror ref, no
    // store.subscribe). The form is handed to <OForm :form="form">.
    const form = useOForm<LlmEvaluationForm>({
      defaultValues: llmEvaluationDefaults.value,
      schema: llmEvaluationSchema,
      onSubmit: (value) => saveLlmEvaluationNode(value),
    });

    const enableSampling = form.useStore((s: any) => s.values.enableSampling);
    const samplingRate = form.useStore((s: any) => s.values.samplingRate);

    const streamFields = ref<{ label: string; value: string }[]>([]);
    const filteredStreamFields = ref<{ label: string; value: string }[]>([]);
    const loadingFields = ref(false);
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

      await fetchSourceStreamFields();
      await fetchAvailableTemplates();

      // New node: default the (form-owned) template to the first available one
      // once the templates have loaded. This is async-arriving data, so bridge it
      // into the form rather than mutating a local mirror.
      if (
        !pipelineObj.isEditNode &&
        !templateSeed.value &&
        availableTemplates.value.length > 0
      ) {
        const firstTemplateId = availableTemplates.value[0]?.id || null;
        templateSeed.value = firstTemplateId;
        form.setFieldValue("template", firstTemplateId, {
          dontUpdateMeta: true,
        });
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

    // @submit handler. OForm only calls this once the schema passes (nodeName
    // required), so the schema — not a manual guard — gates the save. `value` is
    // the validated, trimmed payload and the single source of truth.
    const saveLlmEvaluationNode = (value: LlmEvaluationForm) => {
      const nodeData: any = {
        name: value.nodeName.trim(),
        node_type: "llm_evaluation",
        enable_llm_judge: true,
        llm_span_identifier: value.spanIdentifier || "gen_ai_system",
        sampling_rate: value.enableSampling ? value.samplingRate ?? 0 : 0.0,
      };

      nodeData.eval_template = value.template || null;

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
      form,
      enableSampling,
      samplingRate,
      streamFields,
      filteredStreamFields,
      loadingFields,
      filterStreamFields,
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
