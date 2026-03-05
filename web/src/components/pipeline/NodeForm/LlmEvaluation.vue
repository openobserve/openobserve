<!-- Copyright 2025 OpenObserve Inc.

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
  <div
    data-test="llm-evaluation-node-section"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
    style="width: 100%; height: 100%"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md tw:flex tw:items-center tw:justify-between">
      {{ t("pipeline.llmEvaluation") }}
      <div>
        <q-btn v-close-popup="true" round flat icon="cancel"></q-btn>
      </div>
    </div>
    <q-separator />

    <div class="stream-routing-container full-width q-pt-xs q-pb-md q-px-md">
      <q-form @submit="saveLlmEvaluationNode">
        <!-- Node Name -->
        <div class="o2-input full-width q-py-sm">
          <q-input
            v-model="nodeName"
            :label="t('pipeline.nodeName') + ' *'"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop"
            stack-label
            outlined
            filled
            dense
            :rules="[(val) => !!val || t('common.nameRequired')]"
            data-test="llm-evaluation-node-name-input"
          />
        </div>

        <!-- LLM Span Identifier -->
        <div class="o2-input full-width q-py-sm">
          <q-select
            v-model="llmSpanIdentifier"
            :options="filteredStreamFields"
            :label="t('pipeline.llmSpanIdentifierLabel')"
            color="input-border"
            bg-color="input-bg"
            class="q-py-sm showLabelOnTop no-case"
            stack-label
            outlined
            filled
            dense
            use-input
            input-debounce="300"
            emit-value
            map-options
            :loading="loadingFields"
            @filter="filterStreamFields"
            data-test="llm-evaluation-span-identifier-select"
          >
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  {{ t("pipeline.noFieldsFound") }}
                </q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>

        <!-- Enable Sampling Toggle -->
        <q-toggle
          v-model="enableSampling"
          :label="t('pipeline.enableSampling')"
          class="q-mb-sm tw:h-[36px] o2-toggle-button-lg -tw:ml-4"
          size="lg"
          :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
          data-test="llm-evaluation-enable-sampling-toggle"
        />

        <!-- Sampling Rate -->
        <div v-if="enableSampling" class="q-px-xs q-mb-sm">
          <div class="text-body2 q-mb-sm">
            {{ t("pipeline.samplingRate") }}: {{ (samplingRate * 100).toFixed(0) }}%
          </div>
          <q-slider
            v-model="samplingRate"
            :min="0"
            :max="1"
            :step="0.01"
            color="primary"
            label
            :label-value="(samplingRate * 100).toFixed(0) + '%'"
            data-test="llm-evaluation-sampling-rate-slider"
          />
        </div>

        <!-- Action Buttons -->
        <div
          class="flex justify-start full-width q-mt-sm"
          :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
        >
          <q-btn
            v-if="pipelineObj.isEditNode"
            data-test="llm-evaluation-delete-btn"
            class="o2-secondary-button tw:h-[36px] q-mr-md"
            color="negative"
            flat
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            no-caps
            @click="openDeleteDialog"
          >
            <q-icon name="delete" class="q-mr-xs" />
            {{ t('pipeline.deleteNode') }}
          </q-btn>
          <q-btn
            data-test="llm-evaluation-cancel-btn"
            class="o2-secondary-button tw:h-[36px]"
            :label="t('alerts.cancel')"
            no-caps
            flat
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            @click="openCancelDialog"
          />
          <q-btn
            data-test="llm-evaluation-save-btn"
            :label="t('alerts.save')"
            class="no-border q-ml-md o2-primary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            flat
            no-caps
            type="submit"
          />
        </div>
      </q-form>
    </div>
  </div>
  <confirm-dialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

export default defineComponent({
  name: "LlmEvaluation",
  components: { ConfirmDialog },
  emits: ["cancel:hideform"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const q = useQuasar();
    const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();
    const { getStream } = useStreams();

    const nodeName = ref("");
    const enableSampling = ref(true);
    const samplingRate = ref(0.01);
    const llmSpanIdentifier = ref("gen_ai_system");
    const streamFields = ref<{ label: string; value: string }[]>([]);
    const filteredStreamFields = ref<{ label: string; value: string }[]>([]);
    const loadingFields = ref(false);

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
          (node: any) => node.io_type === "input" && node.data.node_type === "stream",
        );

        if (inputStreamNode) {
          const streamName =
            inputStreamNode.data?.stream_name?.value || inputStreamNode.data?.stream_name;
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

    const filterStreamFields = (val: string, update: Function) => {
      update(() => {
        if (!val) {
          filteredStreamFields.value = [...streamFields.value];
        } else {
          const needle = val.toLowerCase();
          filteredStreamFields.value = streamFields.value.filter(
            (field) => field.label.toLowerCase().includes(needle),
          );
        }
      });
    };

    onMounted(async () => {
      if (pipelineObj.userSelectedNode) {
        pipelineObj.userSelectedNode = {};
      }
      if (pipelineObj.isEditNode && pipelineObj.currentSelectedNodeData) {
        const data = pipelineObj.currentSelectedNodeData.data;
        nodeName.value = data.name || "";
        llmSpanIdentifier.value = data.llm_span_identifier || "gen_ai_system";

        if (data.sampling_rate !== undefined && data.sampling_rate !== null && data.sampling_rate > 0) {
          enableSampling.value = true;
          samplingRate.value = data.sampling_rate;
        } else {
          enableSampling.value = false;
        }
      } else {
        nodeName.value = "evaluate";
      }

      await fetchSourceStreamFields();
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
        q.notify({
          type: "negative",
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

      addNode(nodeData);

      q.notify({
        type: "positive",
        message: t("pipeline.llmEvaluationNodeSaved"),
        timeout: 1500,
      });

      emit("cancel:hideform");
    };

    return {
      t,
      store,
      nodeName,
      enableSampling,
      samplingRate,
      llmSpanIdentifier,
      filteredStreamFields,
      loadingFields,
      filterStreamFields,
      saveLlmEvaluationNode,
      openCancelDialog,
      openDeleteDialog,
      deleteNode,
      dialog,
      pipelineObj,
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
