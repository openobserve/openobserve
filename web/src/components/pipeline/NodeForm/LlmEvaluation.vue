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
    class="llm-evaluation-section"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md tw:flex tw:items-center tw:justify-between">
      {{ t("pipeline.llmEvaluation") }}
      <div>
        <q-btn v-close-popup="true" round flat icon="cancel"></q-btn>
      </div>
    </div>
    <q-separator />

    <div class="stream-routing-container full-width q-pt-md q-pb-md q-px-md">
      <q-form @submit="saveLlmEvaluationNode">
        <!-- Node Name -->
        <div class="o2-input full-width q-mb-md">
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
        <div class="q-mb-md">
          <div class="text-subtitle1 q-mb-sm">{{ t("pipeline.llmSpanIdentifier") }}</div>
          <div class="o2-input full-width">
            <q-select
              v-model="llmSpanIdentifier"
              :options="filteredStreamFields"
              :label="t('pipeline.llmSpanIdentifierLabel')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
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
          <div class="text-caption text-grey-7 q-mt-xs">
            {{ t("pipeline.llmSpanIdentifierHelp") }}
          </div>
        </div>

        <!-- Sampling Section -->
        <div class="q-mb-md">
          <div class="text-subtitle1 q-mb-sm">{{ t("pipeline.samplingConfig") }}</div>

          <!-- Enable Sampling Toggle -->
          <q-toggle
            v-model="enableSampling"
            :label="t('pipeline.enableSampling')"
            class="q-mb-md tw:h-[36px] o2-toggle-button-lg -tw:ml-4"
            size="lg"
            :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
            data-test="llm-evaluation-enable-sampling-toggle"
          />

          <!-- Sampling Rate -->
          <div v-if="enableSampling" class="q-mb-md">
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
            <div class="text-caption text-grey-7">
              {{ t("pipeline.samplingRateHelp") }}
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex justify-center q-mt-lg">
          <q-btn
            v-close-popup="true"
            class="text-bold"
            :label="t('pipeline.cancel')"
            text-color="light-text"
            padding="sm md"
            no-caps
            @click="$emit('cancel:hideform')"
            data-test="llm-evaluation-cancel-btn"
          />
          <q-btn
            data-test="llm-evaluation-save-btn"
            :label="t('pipeline.save')"
            class="text-bold no-border q-ml-md"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
          />
        </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import useStreams from "@/composables/useStreams";

export default defineComponent({
  name: "LlmEvaluation",
  emits: ["cancel:hideform"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const q = useQuasar();
    const { addNode, pipelineObj } = useDragAndDrop();
    const { getStream } = useStreams();

    const nodeName = ref("");
    const enableSampling = ref(true);
    const samplingRate = ref(0.01);
    const llmSpanIdentifier = ref("gen_ai_system");
    const streamFields = ref<{ label: string; value: string }[]>([]);
    const filteredStreamFields = ref<{ label: string; value: string }[]>([]);
    const loadingFields = ref(false);

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
      // If editing existing node, populate form
      if (pipelineObj.isEditNode && pipelineObj.currentSelectedNodeData) {
        const data = pipelineObj.currentSelectedNodeData.data;
        nodeName.value = data.name || "";
        llmSpanIdentifier.value = data.llm_span_identifier || "gen_ai_system";

        if (data.sampling_rate !== undefined && data.sampling_rate !== null && data.sampling_rate > 0) {
          enableSampling.value = true;
          samplingRate.value = data.sampling_rate;
        }
      } else {
        // Default name for new node
        nodeName.value = "evaluate";
      }

      // Fetch source stream fields for the dropdown
      await fetchSourceStreamFields();
    });

    const saveLlmEvaluationNode = () => {
      // Validate node name
      if (!nodeName.value || nodeName.value.trim() === "") {
        q.notify({
          type: "negative",
          message: t("common.nameRequired"),
          timeout: 1500,
        });
        return;
      }

      // Prepare node data
      const nodeData: any = {
        name: nodeName.value.trim(),
        node_type: "llm_evaluation",
        enable_llm_judge: true,
        llm_span_identifier: llmSpanIdentifier.value || "gen_ai_system",
        sampling_rate: enableSampling.value ? samplingRate.value : 0.0,
      };

      // Add node to canvas (works for both new and edit)
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
      pipelineObj,
    };
  },
});
</script>

<style lang="scss" scoped>
.llm-evaluation-section {
  width: 31.25rem;
  max-height: 90vh;
  overflow: auto;
}

.stream-routing-title {
  font-size: 1rem;
  font-weight: 600;
  padding: 1rem 0;
}

.stream-routing-container {
  max-height: calc(90vh - 6.25rem);
  overflow-y: auto;
}
</style>
