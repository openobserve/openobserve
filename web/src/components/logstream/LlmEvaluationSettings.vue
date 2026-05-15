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
along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<template>
  <div class="llm-eval-settings">
    <!-- Loading skeleton -->
    <div v-if="loading" class="llm-eval-settings__loading">
      <OSpinner size="md" />
    </div>

    <template v-else>
      <div
        class="llm-eval-settings__card"
        :class="
          store.state.theme === 'dark'
            ? 'llm-eval-settings__card--dark'
            : 'llm-eval-settings__card--light'
        "
      >
        <!-- Enable toggle row -->
        <div
          class="llm-eval-settings__row llm-eval-settings__row--bordered"
          :class="
            store.state.theme === 'dark'
              ? 'llm-eval-settings__row--bordered-dark'
              : 'llm-eval-settings__row--bordered-light'
          "
        >
          <div class="llm-eval-settings__row-content">
            <span
              class="llm-eval-settings__label"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__label--dark'
                  : 'llm-eval-settings__label--light'
              "
            >
              {{ t("pipeline.llmEvaluation") }}
            </span>
            <small
              class="llm-eval-settings__hint"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__hint--dark'
                  : 'llm-eval-settings__hint--light'
              "
            >
              {{ t("pipeline.llmEvaluationEnableHelp") }}
            </small>
          </div>
          <q-toggle
            v-model="enabled"
            size="lg"
            class="o2-toggle-button-lg"
            :class="
              store.state.theme === 'dark'
                ? 'o2-toggle-button-lg-dark'
                : 'o2-toggle-button-lg-light'
            "
            data-test="stream-llm-eval-enable-toggle"
            @update:model-value="markDirty"
          />
        </div>

        <!-- Config fields — visible when enabled -->
        <template v-if="enabled">
          <!-- LLM Span Identifier -->
          <div class="setting-group llm-eval-settings__field">
            <label
              class="llm-eval-settings__field-label"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__label--dark'
                  : 'llm-eval-settings__label--light'
              "
            >
              {{ t("pipeline.llmSpanIdentifier") }}
            </label>
            <q-select
              v-model="spanIdentifier"
              :options="filteredFields"
              dense
              borderless
              use-input
              input-debounce="300"
              emit-value
              map-options
              :class="
                store.state.theme === 'dark'
                  ? 'o2-search-input-dark'
                  : 'o2-search-input-light'
              "
              class="o2-search-input no-border llm-eval-settings__input"
              data-test="stream-llm-eval-span-identifier"
              @filter="filterFields"
              @update:model-value="markDirty"
            >
              <template #no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    {{ t("pipeline.noFieldsFound") }}
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
            <small
              class="llm-eval-settings__hint"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__hint--dark'
                  : 'llm-eval-settings__hint--light'
              "
            >
              {{ t("pipeline.llmSpanIdentifierFieldHelp") }}
            </small>
          </div>

          <!-- Evaluation Template Selection -->
          <div class="setting-group llm-eval-settings__field">
            <label
              class="llm-eval-settings__field-label"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__label--dark'
                  : 'llm-eval-settings__label--light'
              "
            >
              {{ t("pipeline.evaluationTemplate") }}
            </label>
            <div class="tw:flex tw:items-center tw:gap-2">
              <q-select
                v-model="selectedTemplate"
                :options="availableTemplates"
                option-value="id"
                option-label="name"
                dense
                borderless
                emit-value
                map-options
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-search-input-dark'
                    : 'o2-search-input-light'
                "
                class="o2-search-input no-border llm-eval-settings__input tw:flex-1"
                data-test="stream-llm-eval-template-select"
                :loading="loadingTemplates"
                @update:model-value="markDirty"
              >
                <template #no-option>
                  <q-item>
                    <q-item-section class="text-grey">
                      {{ t("pipeline.noTemplatesFound") }}
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
              <OButton
                variant="ghost"
                size="icon-sm"
                @click="refreshTemplates"
                :loading="loadingTemplates"
                :title="t('common.refresh')"
                data-test="stream-llm-eval-template-refresh-btn"
                icon-left="refresh"
              />
            </div>
            <small
              class="llm-eval-settings__hint"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__hint--dark'
                  : 'llm-eval-settings__hint--light'
              "
            >
              {{ t("pipeline.evaluationTemplateHelp") }}
            </small>
          </div>

          <!-- Sampling toggle row -->
          <div
            class="llm-eval-settings__row llm-eval-settings__row--bordered"
            :class="
              store.state.theme === 'dark'
                ? 'llm-eval-settings__row--bordered-dark'
                : 'llm-eval-settings__row--bordered-light'
            "
          >
            <span
              class="llm-eval-settings__label"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__label--dark'
                  : 'llm-eval-settings__label--light'
              "
            >
              {{ t("pipeline.samplingLabel") }}
            </span>
            <q-toggle
              v-model="enableSampling"
              size="lg"
              class="o2-toggle-button-lg"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-toggle-button-lg-dark'
                  : 'o2-toggle-button-lg-light'
              "
              data-test="stream-llm-eval-sampling-toggle"
              @update:model-value="markDirty"
            />
          </div>

          <!-- Sampling rate slider -->
          <div
            v-if="enableSampling"
            class="setting-group llm-eval-settings__field"
          >
            <div class="llm-eval-settings__sampling-header">
              <span
                class="llm-eval-settings__sampling-label"
                :class="
                  store.state.theme === 'dark'
                    ? 'llm-eval-settings__label--dark'
                    : 'llm-eval-settings__label--light'
                "
              >
                {{
                  t("pipeline.llmEvaluationSamplingRateLabel", {
                    percentage: samplingRatePercent,
                  })
                }}
              </span>
            </div>
            <q-slider
              v-model="samplingRate"
              :min="0"
              :max="1"
              :step="0.01"
              color="primary"
              label
              :label-value="samplingRatePercent + '%'"
              data-test="stream-llm-eval-sampling-rate"
              @update:model-value="markDirty"
            />
            <small
              class="llm-eval-settings__hint"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__hint--dark'
                  : 'llm-eval-settings__hint--light'
              "
            >
              {{ t("pipeline.llmEvaluationSamplingHelp") }}
            </small>
          </div>

          <!-- Output stream name -->
          <div class="setting-group llm-eval-settings__field">
            <label
              class="llm-eval-settings__field-label"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__label--dark'
                  : 'llm-eval-settings__label--light'
              "
            >
              {{ t("pipeline.llmEvaluationOutputStreamName") }}
            </label>
            <q-input
              v-model="outputStream"
              dense
              borderless
              :class="
                store.state.theme === 'dark'
                  ? 'o2-search-input-dark'
                  : 'o2-search-input-light'
              "
              class="o2-search-input no-border llm-eval-settings__input"
              data-test="stream-llm-eval-output-stream"
              @update:model-value="markDirty"
            />
            <small
              class="llm-eval-settings__hint"
              :class="
                store.state.theme === 'dark'
                  ? 'llm-eval-settings__hint--dark'
                  : 'llm-eval-settings__hint--light'
              "
            >
              {{ t("pipeline.llmEvaluationOutputStreamHelp") }}
            </small>
          </div>
        </template>

        <!-- Info banner when disabled -->
        <div
          v-else
          class="llm-eval-settings__info-banner"
          :class="
            store.state.theme === 'dark'
              ? 'llm-eval-settings__info-banner--dark'
              : 'llm-eval-settings__info-banner--light'
          "
        >
          {{ t("pipeline.llmEvaluationRemoveWarning") }}
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import pipelineService from "@/services/pipelines";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "LlmEvaluationSettings",
  components: { OButton, OSpinner },

  props: {
    streamName: {
      type: String,
      required: true,
    },
    streamFields: {
      type: Array as () => { label: string; value: string }[],
      default: () => [],
    },
  },

  emits: ["dirty"],

  setup(props, { emit, expose }) {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();

    const loading = ref(true);
    const enabled = ref(false);
    const spanIdentifier = ref("gen_ai_system");
    const enableSampling = ref(true);
    const samplingRate = ref(0.01);
    const outputStream = ref("");
    const filteredFields = ref<{ label: string; value: string }[]>([]);
    const selectedTemplate = ref<{ id: string; name: string } | null>(null);
    const availableTemplates = ref<any[]>([]);
    const loadingTemplates = ref(false);

    // Existing pipeline found on mount — needed for update vs create
    let existingPipeline: any = null;

    const samplingRatePercent = computed(() =>
      (samplingRate.value * 100).toFixed(0),
    );

    const markDirty = () => emit("dirty");

    // Keep filteredFields in sync with the prop
    watch(
      () => props.streamFields,
      (fields) => {
        filteredFields.value = [...fields];
      },
      { immediate: true },
    );

    const filterFields = (val: string, update: (fn: () => void) => void) => {
      update(() => {
        if (!val) {
          filteredFields.value = [...props.streamFields];
        } else {
          const needle = val.toLowerCase();
          filteredFields.value = props.streamFields.filter((f) =>
            f.label.toLowerCase().includes(needle),
          );
        }
      });
    };

    const fetchAvailableTemplates = async (forceRefresh: boolean = false) => {
      loadingTemplates.value = true;
      try {
        const orgId = store.state.selectedOrganization?.identifier;
        if (!orgId) return;

        // Use store cache unless force refresh requested
        if (!forceRefresh) {
          const cached = store.state.streams.evalTemplatesByOrg[orgId];
          if (cached && cached.length > 0) {
            availableTemplates.value = cached;
            return;
          }
        }

        const { evalTemplateService } = await import(
          "@/services/eval-template.service"
        );
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
      await fetchAvailableTemplates(true);
      q.notify({
        type: "positive",
        message: t("pipeline.evalTemplatesRefreshed"),
        timeout: 1500,
      });
    };

    // On mount: detect if an LLM evaluation pipeline already exists for this stream
    onMounted(async () => {
      if (!props.streamName) {
        loading.value = false;
        return;
      }

      const orgId = store.state.selectedOrganization?.identifier;

      try {
        // Fetch templates first so they are available for restoration
        await fetchAvailableTemplates();

        const res = await pipelineService.getPipelines(orgId);
        const pipelines: any[] = res.data?.list || [];

        const match = pipelines.find(
          (p: any) =>
            p.source?.stream_name === props.streamName &&
            p.source?.stream_type === "traces" &&
            p.nodes?.some((n: any) => n.data?.node_type === "llm_evaluation")
        );

        if (match) {
          existingPipeline = match;
          enabled.value = true;

          const evalNode = match.nodes.find(
            (n: any) => n.data?.node_type === "llm_evaluation"
          );
          if (evalNode) {
            spanIdentifier.value =
              evalNode.data.llm_span_identifier || "gen_ai_system";
            const rate = evalNode.data.sampling_rate ?? 0.01;
            enableSampling.value = rate > 0;
            samplingRate.value = rate > 0 ? rate : 0.01;

            // Restore saved template ID
            if (evalNode.data.eval_template) {
              selectedTemplate.value = evalNode.data.eval_template;
            } else if (availableTemplates.value.length > 0) {
              selectedTemplate.value = availableTemplates.value[0].id;
            }
          }

          // Read output stream from the eval output node
          const evalOutputNode = match.nodes.find(
            (n: any) =>
              n.io_type === "output" && n.data?.stream_type === "logs"
          );
          outputStream.value =
            evalOutputNode?.data?.stream_name ||
            `${props.streamName}_evaluations`;
        } else {
          // No existing pipeline — apply defaults
          outputStream.value = `${props.streamName}_evaluations`;
          if (availableTemplates.value.length > 0) {
            selectedTemplate.value = availableTemplates.value[0].id;
          }
        }
      } catch (e) {
        console.error("[LlmEvalSettings] Data fetch failed:", e);
        // Fallback for defaults
        outputStream.value = `${props.streamName}_evaluations`;
        if (availableTemplates.value.length > 0 && !selectedTemplate.value) {
          selectedTemplate.value = availableTemplates.value[0].id;
        }
      } finally {
        loading.value = false;
      }
    });

    // Modified save() to handle template ID
    const save = async () => {
      const orgId = store.state.selectedOrganization.identifier;
      const streamName = props.streamName;

      if (!enabled.value) {
        q.notify({
          type: "warning",
          message: t("pipeline.llmEvaluationRemoveWarning"),
          timeout: 4000,
        });
        return;
      }

      const ts = Date.now();
      const inputNodeId = `input-${ts}`;
      const evalNodeId = `llm-eval-${ts}`;
      const passthroughOutputId = `output-passthrough-${ts}`;
      const evalOutputId = `output-eval-${ts}`;

      const payload = {
        name: streamName,
        description: t("pipeline.llmEvaluationPipelineDescription", {
          streamName,
        }),
        source: {
          source_type: "realtime",
          org_id: orgId,
          stream_name: streamName,
          stream_type: "traces",
        },
        nodes: [
          {
            id: inputNodeId,
            io_type: "input",
            position: { x: 300, y: 50 },
            data: {
              node_type: "stream",
              org_id: orgId,
              stream_name: streamName,
              stream_type: "traces",
            },
          },
          {
            id: evalNodeId,
            io_type: "default",
            position: { x: 500, y: 250 },
            data: {
              node_type: "llm_evaluation",
              name: "evaluate",
              enable_llm_judge: true,
              llm_span_identifier: spanIdentifier.value || "gen_ai_system",
              sampling_rate: enableSampling.value ? samplingRate.value : 0.0,
              eval_template: selectedTemplate.value || null,
            },
          },
          {
            id: passthroughOutputId,
            io_type: "output",
            position: { x: 100, y: 450 },
            data: {
              node_type: "stream",
              org_id: orgId,
              stream_name: streamName,
              stream_type: "traces",
            },
          },
          {
            id: evalOutputId,
            io_type: "output",
            position: { x: 500, y: 450 },
            data: {
              node_type: "stream",
              org_id: orgId,
              stream_name: outputStream.value || `${streamName}_evaluations`,
              stream_type: "logs",
            },
          },
        ],
        edges: [
          {
            id: `e${inputNodeId}-${passthroughOutputId}`,
            source: inputNodeId,
            target: passthroughOutputId,
          },
          {
            id: `e${inputNodeId}-${evalNodeId}`,
            source: inputNodeId,
            target: evalNodeId,
          },
          {
            id: `e${evalNodeId}-${evalOutputId}`,
            source: evalNodeId,
            target: evalOutputId,
          },
        ],
      };

      if (existingPipeline) {
        // Preserve the existing pipeline id/version for update
        await pipelineService.updatePipeline({
          org_identifier: orgId,
          data: {
            ...payload,
            pipeline_id: existingPipeline.pipeline_id,
            version: existingPipeline.version,
          },
        });
      } else {
        await pipelineService.createPipeline({
          data: payload,
          org_identifier: orgId,
        });
        // Reload to pick up the newly created pipeline
        const res = await pipelineService.getPipelines(orgId);
        const pipelines: any[] = res.data?.list || [];
        existingPipeline = pipelines.find(
          (p: any) =>
            p.source?.stream_name === streamName &&
            p.source?.stream_type === "traces" &&
            p.nodes?.some((n: any) => n.data?.node_type === "llm_evaluation"),
        );
      }

      q.notify({
        type: "positive",
        message: t("pipeline.llmEvaluationCreatedSuccess", { streamName }),
        timeout: 3000,
      });
    };

    // Expose save() so schema.vue can call it from its shared footer
    expose({ save });

    return {
      t,
      store,
      loading,
      enabled,
      spanIdentifier,
      enableSampling,
      samplingRate,
      samplingRatePercent,
      outputStream,
      filteredFields,
      filterFields,
      selectedTemplate,
      availableTemplates,
      loadingTemplates,
      refreshTemplates,
      markDirty,
    };
  },
});
</script>

<style lang="scss" scoped>
.llm-eval-settings {
  display: flex;
  flex-direction: column;
  height: 100%;

  &__loading {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2rem;
  }

  &__card {
    flex: 1;
    overflow-y: auto;
    border-radius: 0.5rem;
    border-width: 0.0625rem;
    border-style: solid;
    padding: 0.5rem 0;
    margin: 1rem;

    &--light {
      border-color: #e5e7eb;
      background-color: #ffffff;
    }

    &--dark {
      border-color: #374151;
      background-color: #181a1b;
    }
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;

    &--bordered {
      border-bottom-width: 0.0625rem;
      border-bottom-style: solid;

      &-light {
        border-bottom-color: #e5e7eb;
      }
      &-dark {
        border-bottom-color: #4b5563;
      }
    }
  }

  &__row-content {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    flex: 1;
    padding-right: 1rem;
  }

  &__label {
    font-size: 0.8125rem;
    font-weight: 600;

    &--light {
      color: #374151;
    }
    &--dark {
      color: #e5e7eb;
    }
  }

  &__field {
    padding: 0.75rem 1rem 0.25rem;
  }

  &__field-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  &__input {
    width: 100%;
  }

  &__hint {
    display: block;
    font-size: 0.75rem;
    font-style: italic;
    margin-top: 0.25rem;

    &--light {
      color: #6b7280;
    }
    &--dark {
      color: #9ca3af;
    }
  }

  &__sampling-header {
    margin-bottom: 0.25rem;
  }

  &__sampling-label {
    font-size: 0.75rem;
  }

  &__info-banner {
    margin: 0.75rem 1rem;
    padding: 0.75rem;
    border-radius: 0.25rem;
    border-width: 0.0625rem;
    border-style: solid;
    font-size: 0.75rem;

    &--light {
      color: #92400e;
      border-color: #fde68a;
      background-color: #fffbeb;
    }

    &--dark {
      color: #fcd34d;
      border-color: #92400e;
      background-color: rgba(146, 64, 14, 0.15);
    }
  }
}
</style>
