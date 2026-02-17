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
    style="width: 500px; max-height: 90vh; overflow: auto"
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

          <!-- Sampling Strategy -->
          <div v-if="enableSampling" class="q-mb-md">
            <div class="text-body2 q-mb-sm">{{ t("pipeline.samplingStrategy") }}</div>
            <q-option-group
              v-model="samplingStrategy"
              :options="samplingStrategyOptions"
              color="primary"
              data-test="llm-evaluation-sampling-strategy-group"
            />
          </div>
        </div>

        <!-- Info Box -->
        <q-card class="note-container q-mb-md">
          <q-card-section class="q-pa-sm">
            <div class="note-heading">{{ t("pipeline.llmEvaluationInfo") }}</div>
            <q-banner inline dense class="note-info">
              <div>
                <q-icon name="info" color="blue" class="q-mr-sm" />
                <span>{{ t("pipeline.llmEvaluationInfoText") }}</span>
              </div>
            </q-banner>
          </q-card-section>
        </q-card>

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
import { defineComponent, ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

export default defineComponent({
  name: "LlmEvaluation",
  emits: ["cancel:hideform"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const q = useQuasar();
    const { addNode, pipelineObj } = useDragAndDrop();

    const nodeName = ref("");
    const enableSampling = ref(false);
    const samplingRate = ref(0.1);
    const samplingStrategy = ref("hash");

    const samplingStrategyOptions = computed(() => [
      {
        label: t("pipeline.randomSampling"),
        value: "random",
        description: t("pipeline.randomSamplingDesc"),
      },
      {
        label: t("pipeline.hashSampling"),
        value: "hash",
        description: t("pipeline.hashSamplingDesc"),
      },
    ]);

    onMounted(() => {
      // If editing existing node, populate form
      if (pipelineObj.isEditNode && pipelineObj.currentSelectedNodeData) {
        const data = pipelineObj.currentSelectedNodeData.data;
        nodeName.value = data.name || "";

        if (data.sampling_rate !== undefined && data.sampling_rate !== null) {
          enableSampling.value = true;
          samplingRate.value = data.sampling_rate;
        }

        if (data.sampling_strategy) {
          samplingStrategy.value = data.sampling_strategy;
        }
      } else {
        // Default name for new node
        nodeName.value = "evaluate";
      }
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
      };

      // Only add sampling config if enabled
      if (enableSampling.value) {
        nodeData.sampling_rate = samplingRate.value;
        nodeData.sampling_strategy = samplingStrategy.value;
      }

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
      samplingStrategy,
      samplingStrategyOptions,
      saveLlmEvaluationNode,
      pipelineObj,
    };
  },
});
</script>

<style lang="scss" scoped>
.stream-routing-title {
  font-size: 16px;
  font-weight: 600;
  padding: 16px 0;
}

.stream-routing-container {
  max-height: calc(90vh - 100px);
  overflow-y: auto;
}

.note-container {
  background-color: rgba(0, 123, 255, 0.05);
  border: 1px solid rgba(0, 123, 255, 0.2);
  border-radius: 4px;
}

.note-heading {
  font-weight: 600;
  margin-bottom: 8px;
  color: #1976d2;
}

.note-info {
  background: transparent;
  padding: 8px 0;

  span {
    font-size: 13px;
    line-height: 1.5;
  }
}
</style>
