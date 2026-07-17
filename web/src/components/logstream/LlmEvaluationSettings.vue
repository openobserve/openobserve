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
  <div class="flex flex-col h-full">
    <!-- Loading skeleton -->
    <div
      v-if="loading"
      data-test="stream-llm-eval-loading"
      class="flex justify-center items-center p-8"
    >
      <OSpinner size="md" />
    </div>

    <template v-else>
      <div
        class="flex-1 overflow-y-auto rounded-lg border border-solid py-2 m-4"
        :class="
          store.state.theme === 'dark'
            ? 'border-[#374151] bg-(--o2-primary-background)'
            : 'border-[#e5e7eb] bg-white'
        "
      >
        <OForm
          id="llm-eval-settings-form"
          :form="llmEvalForm"
        >
          <!-- Enable toggle row -->
          <div
            class="flex items-center justify-between px-4 py-2 text-[0.8125rem] border-b border-b-solid"
            :class="
              store.state.theme === 'dark'
                ? 'border-b-[#4b5563]'
                : 'border-b-[#e5e7eb]'
            "
          >
            <div class="flex flex-col gap-0.5 flex-1 pr-4">
              <span
                class="text-[0.8125rem] font-semibold"
                :class="
                  store.state.theme === 'dark'
                    ? 'text-[#e5e7eb]'
                    : 'text-[#374151]'
                "
              >
                {{ t("pipeline.llmEvaluation") }}
              </span>
              <small
                class="block text-xs italic mt-1"
                :class="
                  store.state.theme === 'dark'
                    ? 'text-[#9ca3af]'
                    : 'text-[#6b7280]'
                "
              >
                {{ t("pipeline.llmEvaluationEnableHelp") }}
              </small>
            </div>
            <OFormSwitch
              name="enabled"
              data-test="stream-llm-eval-enable-toggle"
              @update:model-value="markDirty"
            />
          </div>

          <!-- Config fields — visible when enabled -->
          <template v-if="enabled">
            <!-- LLM Span Identifier -->
            <div class="pt-3 px-4 pb-1">
              <OFormSelect
                name="spanIdentifier"
                :label="t('pipeline.llmSpanIdentifier')"
                required
                :options="streamFields"
                searchable
                labelKey="label"
                valueKey="value"
                class="w-full"
                data-test="stream-llm-eval-span-identifier"
                @update:model-value="markDirty"
              />
              <small
                class="block text-xs italic mt-1"
                :class="
                  store.state.theme === 'dark'
                    ? 'text-[#9ca3af]'
                    : 'text-[#6b7280]'
                "
              >
                {{ t("pipeline.llmSpanIdentifierFieldHelp") }}
              </small>
            </div>

            <!-- Evaluation Template Selection -->
            <div class="pt-3 px-4 pb-1">
              <div class="flex items-end gap-2">
                <OFormSelect
                  name="selectedTemplate"
                  :label="t('pipeline.evaluationTemplate')"
                  required
                  :options="availableTemplates"
                  labelKey="name"
                  valueKey="id"
                  class="w-full flex-1"
                  data-test="stream-llm-eval-template-select"
                  @update:model-value="markDirty"
                />
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
                class="block text-xs italic mt-1"
                :class="
                  store.state.theme === 'dark'
                    ? 'text-[#9ca3af]'
                    : 'text-[#6b7280]'
                "
              >
                {{ t("pipeline.evaluationTemplateHelp") }}
              </small>
            </div>

            <!-- Sampling toggle row -->
            <div
              class="flex items-center justify-between px-4 py-2 text-[0.8125rem] border-b border-b-solid"
              :class="
                store.state.theme === 'dark'
                  ? 'border-b-[#4b5563]'
                  : 'border-b-[#e5e7eb]'
              "
            >
              <span
                class="text-[0.8125rem] font-semibold"
                :class="
                  store.state.theme === 'dark'
                    ? 'text-[#e5e7eb]'
                    : 'text-[#374151]'
                "
              >
                {{ t("pipeline.samplingLabel") }}
              </span>
              <OFormSwitch
                name="enableSampling"
                data-test="stream-llm-eval-sampling-toggle"
                @update:model-value="markDirty"
              />
            </div>

            <!-- Sampling rate slider -->
            <div
              v-if="enableSampling"
              class="pt-3 px-4 pb-1"
            >
              <div class="mb-1">
                <span
                  class="text-xs"
                  :class="
                    store.state.theme === 'dark'
                      ? 'text-[#e5e7eb]'
                      : 'text-[#374151]'
                  "
                >
                  {{
                    t("pipeline.llmEvaluationSamplingRateLabel", {
                      percentage: samplingRatePercent,
                    })
                  }}
                </span>
              </div>
              <OFormSlider
                name="samplingRate"
                :min="0"
                :max="1"
                :step="0.01"
                data-test="stream-llm-eval-sampling-rate"
                @update:model-value="markDirty"
              />
              <small
                class="block text-xs italic mt-1"
                :class="
                  store.state.theme === 'dark'
                    ? 'text-[#9ca3af]'
                    : 'text-[#6b7280]'
                "
              >
                {{ t("pipeline.llmEvaluationSamplingHelp") }}
              </small>
            </div>

            <!-- Output stream name -->
            <div class="pt-3 px-4 pb-1">
              <OFormInput
                name="outputStream"
                :label="t('pipeline.llmEvaluationOutputStreamName')"
                required
                class="w-full"
                data-test="stream-llm-eval-output-stream"
                @update:model-value="markDirty"
              />
              <small
                class="block text-xs italic mt-1"
                :class="
                  store.state.theme === 'dark'
                    ? 'text-[#9ca3af]'
                    : 'text-[#6b7280]'
                "
              >
                {{ t("pipeline.llmEvaluationOutputStreamHelp") }}
              </small>
            </div>
          </template>

          <!-- Info banner when disabled -->
          <div
            v-else
            data-test="stream-llm-eval-info-banner"
            class="mx-4 my-3 p-3 rounded border border-solid text-xs"
            :class="
              store.state.theme === 'dark'
                ? 'text-[#fcd34d] border-[#92400e] bg-[rgba(146,64,14,0.15)]'
                : 'text-[#92400e] border-[#fde68a] bg-[#fffbeb]'
            "
          >
            {{ t("pipeline.llmEvaluationRemoveWarning") }}
          </div>
        </OForm>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import pipelineService from "@/services/pipelines";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSlider from "@/lib/forms/Slider/OFormSlider.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeLlmEvaluationSettingsSchema,
  llmEvaluationSettingsDefaults,
  type LlmEvaluationSettingsForm,
} from "./LlmEvaluationSettings.schema";

export default defineComponent({
  name: "LlmEvaluationSettings",
  components: {
    OButton,
    OSpinner,
    OForm,
    OFormSwitch,
    OFormSelect,
    OFormInput,
    OFormSlider,
  },

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

    const loading = ref(true);
    const filteredFields = ref<{ label: string; value: string }[]>([]);
    const availableTemplates = ref<any[]>([]);
    const loadingTemplates = ref(false);

    // Rule ③ OWNER pattern: this Options-API component OWNS <OForm> and must read
    // form state (enabled / enableSampling / samplingRate) to drive parent-side
    // `v-if` conditionals + the sampling-rate percentage label. So create the ONE
    // form here with useOForm, hand it to <OForm :form="llmEvalForm">, and read it
    // reactively with form.useStore — single source of truth, NO mirror. The save
    // is wired through useOForm({ onSubmit }), not @submit.
    const llmEvalForm = useOForm<LlmEvaluationSettingsForm>({
      defaultValues: llmEvaluationSettingsDefaults(),
      schema: makeLlmEvaluationSettingsSchema(t),
      onSubmit: (value) => onSubmit(value),
    });

    // Existing pipeline found on mount — needed for update vs create
    let existingPipeline: any = null;

    // Reactive READS of the form-owned values that drive the v-if conditionals +
    // the sampling percentage label. form.useStore tracks changes (a
    // `form.state.values` read inside a computed would not); the form remains the
    // single source of truth — these are never written back.
    const enabled = llmEvalForm.useStore((s: any) => !!s.values.enabled);
    const enableSampling = llmEvalForm.useStore(
      (s: any) => !!s.values.enableSampling,
    );
    const samplingRate = llmEvalForm.useStore((s: any) =>
      Number(s.values.samplingRate ?? 0.01),
    );
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
      toast({
        variant: "success",
        message: t("pipeline.evalTemplatesRefreshed"),
        timeout: 1500,
      });
    };

    // On mount: detect if an LLM evaluation pipeline already exists for this
    // stream, build the prefill values, then seed them into the form. The form
    // only mounts once `loading` flips to false, so we reset() it after the
    // next tick (constraint: data arriving AFTER mount → form.reset(values)).
    onMounted(async () => {
      if (!props.streamName) {
        loading.value = false;
        return;
      }

      const orgId = store.state.selectedOrganization?.identifier;

      // Start from the create defaults; layer the loaded record on top.
      const loaded: LlmEvaluationSettingsForm = llmEvaluationSettingsDefaults();

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
          loaded.enabled = true;

          const evalNode = match.nodes.find(
            (n: any) => n.data?.node_type === "llm_evaluation"
          );
          if (evalNode) {
            loaded.spanIdentifier =
              evalNode.data.llm_span_identifier || "gen_ai_system";
            const rate = evalNode.data.sampling_rate ?? 0.01;
            loaded.enableSampling = rate > 0;
            loaded.samplingRate = rate > 0 ? rate : 0.01;

            // Restore saved template ID
            if (evalNode.data.eval_template) {
              loaded.selectedTemplate = evalNode.data.eval_template;
            } else if (availableTemplates.value.length > 0) {
              loaded.selectedTemplate = availableTemplates.value[0].id;
            }
          }

          // Read output stream from the eval output node
          const evalOutputNode = match.nodes.find(
            (n: any) =>
              n.io_type === "output" && n.data?.stream_type === "logs"
          );
          loaded.outputStream =
            evalOutputNode?.data?.stream_name ||
            `${props.streamName}_evaluations`;
        } else {
          // No existing pipeline — apply defaults
          loaded.outputStream = `${props.streamName}_evaluations`;
          if (availableTemplates.value.length > 0) {
            loaded.selectedTemplate = availableTemplates.value[0].id;
          }
        }
      } catch (e) {
        console.error("[LlmEvalSettings] Data fetch failed:", e);
        // Fallback for defaults
        loaded.outputStream = `${props.streamName}_evaluations`;
        if (availableTemplates.value.length > 0 && !loaded.selectedTemplate) {
          loaded.selectedTemplate = availableTemplates.value[0].id;
        }
      } finally {
        loading.value = false;
        // The form instance exists from setup() (independent of the OForm
        // component's v-if mount), so seed the loaded values directly. reset()
        // rebuilds pristine submit-state → flash-free.
        llmEvalForm.reset(loaded);
      }
    });

    // @submit handler — OForm awaits it and only calls it once the schema
    // passes. `value` is the validated payload (single source of truth).
    const onSubmit = async (value: LlmEvaluationSettingsForm) => {
      const orgId = store.state.selectedOrganization.identifier;
      const streamName = props.streamName;

      if (!value.enabled) {
        toast({
          variant: "warning",
          message: t("pipeline.llmEvaluationRemoveWarning"),
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
              llm_span_identifier: value.spanIdentifier || "gen_ai_system",
              sampling_rate: value.enableSampling ? value.samplingRate : 0.0,
              eval_template: value.selectedTemplate || null,
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
              stream_name: value.outputStream || `${streamName}_evaluations`,
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

      toast({
        variant: "success",
        message: t("pipeline.llmEvaluationCreatedSuccess", { streamName }),
      });
    };

    // Submit THROUGH the form so the Zod schema gates the save (handleSubmit
    // runs the schema then awaits onSubmit; an empty/invalid required field
    // blocks it and reveals errors). Returns the submit promise so a parent
    // footer can await it. Exposed so schema.vue can call it from its shared
    // footer; a consuming dialog/drawer should also wire `form-id` =
    // "llm-eval-settings-form" so Enter + the footer Save submit natively.
    const save = () => llmEvalForm.handleSubmit();

    expose({ save });

    return {
      t,
      store,
      // The owner-created form (Rule ③) — bound via <OForm :form="llmEvalForm">.
      // It carries the schema + defaults internally (passed to useOForm above),
      // so no separate :schema / :default-values binding is needed.
      llmEvalForm,
      loading,
      enabled,
      enableSampling,
      samplingRate,
      samplingRatePercent,
      filteredFields,
      filterFields,
      availableTemplates,
      loadingTemplates,
      refreshTemplates,
      markDirty,
    };
  },
});
</script>
