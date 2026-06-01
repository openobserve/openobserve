<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version. -->

<template>
  <div class="online-evals" data-test="online-evals-page">
    <form v-if="formPage" class="eval-form-page" @submit.prevent="saveDialog">
      <div class="eval-form-page__top">
        <button class="eval-form-page__back" type="button" @click="closeFormPage">
          <OIcon name="chevron-left" size="xs" />
          Back to {{ currentTabLabel }}
        </button>
        <div class="eval-form-page__top-actions">
          <span v-if="formPage.entity === 'scorers'" class="eval-form-page__badge">
            {{ scorerForm.scorerType === "remote" ? "Remote" : "LLM Judge" }}
          </span>
          <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="closeFormPage" />
        </div>
      </div>

      <div class="eval-form-page__head">
        <h1>{{ formPageTitle }}</h1>
        <p>{{ formPageSubtitle }}</p>
      </div>

      <div class="eval-form-page__body" :class="{ 'eval-form-page__body--split': formPage.entity !== 'providers' }">
        <div class="eval-form-page__main">
          <template v-if="formPage.entity === 'jobs'">
            <div class="eval-stepper">
              <span class="is-active"><i>1</i> Target</span>
              <span><i>2</i> Scorers</span>
              <span><i>3</i> Mapping</span>
              <span><i>4</i> Sampling</span>
            </div>
            <section class="eval-form-section">
              <div class="eval-form-section__title"><span>01</span> Target</div>
              <label>Name <input v-model.trim="jobForm.name" required placeholder="Production Faithfulness Monitor" /></label>
              <label>Input stream <input v-model.trim="jobForm.stream" required placeholder="default" /></label>
              <label>Stream type <input v-model.trim="jobForm.streamType" required placeholder="traces" /></label>
              <label class="eval-form-section__wide">Description <textarea v-model.trim="jobForm.description" rows="3" /></label>
              <label>Sampling mode
                <select v-model="jobForm.samplingMode">
                  <option value="rate">Rate</option>
                  <option value="all">All</option>
                  <option value="count">Count</option>
                </select>
              </label>
              <label>Sampling value JSON <textarea v-model="jobForm.samplingValue" rows="4" required /></label>
            </section>

            <section class="eval-form-section">
              <div class="eval-form-section__title"><span>02</span> Scorers and mapping</div>
              <div class="eval-form-section__wide eval-scorer-picker">
                <div class="eval-form-field-head">
                  <span>Scorers</span>
                  <small>Select one or more scorers to run for every matched span.</small>
                </div>
                <div class="eval-scorer-picker__grid">
                  <label
                    v-for="scorer in scorers"
                    :key="entityId(scorer)"
                    class="eval-scorer-option"
                    :class="{ 'is-selected': jobForm.scorerIds.includes(entityId(scorer)) }"
                  >
                    <input
                      type="checkbox"
                      :checked="jobForm.scorerIds.includes(entityId(scorer))"
                      @change="toggleJobScorer(entityId(scorer))"
                    />
                    <span>
                      <strong>{{ scorer.name }}</strong>
                      <small>{{ scorerTypeOf(scorer).replace("_", " ") }} · v{{ scorer.version }}</small>
                    </span>
                  </label>
                </div>
              </div>

              <div class="eval-form-section__wide eval-condition-builder">
                <div class="eval-form-field-head">
                  <span>Filter condition</span>
                  <small>Only spans matching this condition enter sampling and scoring.</small>
                </div>
                <FilterGroup
                  :group="jobFilterGroup"
                  :depth="0"
                  :stream-fields="jobStreamFields"
                  :stream-fields-map="jobStreamFieldsMap"
                  :show-sql-preview="true"
                  condition-input-width="tw:w-[220px]"
                  :allow-custom-columns="true"
                  module="alerts"
                  @add-condition="handleJobFilterGroupUpdate"
                  @add-group="handleJobFilterGroupUpdate"
                  @remove-group="removeJobFilterGroup"
                  @input:update="handleJobFilterInputUpdate"
                />
              </div>

              <div class="eval-form-section__wide eval-input-mapping">
                <div class="eval-form-field-head">
                  <span>Input mapping</span>
                  <small>Map span fields into each scorer template variable.</small>
                </div>
                <div v-if="selectedJobScorers.length === 0" class="eval-input-mapping__empty">
                  Select scorers to configure their mappings.
                </div>
                <template v-else>
                  <article
                    v-for="scorer in selectedJobScorers"
                    :key="entityId(scorer)"
                    class="eval-mapping-card"
                  >
                    <div class="eval-mapping-card__head">
                      <div>
                        <strong>{{ scorer.name }}</strong>
                        <small>{{ scorerTypeOf(scorer).replace("_", " ") }} · v{{ scorer.version }}</small>
                      </div>
                      <i>{{ jobMappingVariablesForScorer(scorer).length }} variables</i>
                    </div>
                    <div v-if="jobMappingVariablesForScorer(scorer).length" class="eval-mapping-card__rows">
                      <label
                        v-for="variable in jobMappingVariablesForScorer(scorer)"
                        :key="`${entityId(scorer)}-${variable}`"
                        class="eval-mapping-row"
                      >
                        <code v-text="formatTemplateVariable(variable)" />
                        <input
                          :value="jobInputMappings[entityId(scorer)]?.[variable] || ''"
                          :placeholder="defaultJobMappingValue(variable)"
                          @input="updateJobInputMapping(entityId(scorer), variable, $event)"
                        />
                      </label>
                    </div>
                    <div v-else class="eval-input-mapping__empty">
                      This scorer has no template variables to map.
                    </div>
                  </article>
                </template>
              </div>
            </section>
          </template>

          <template v-else-if="formPage.entity === 'scorers'">
            <section class="eval-form-section">
              <div class="eval-form-section__title"><span>01</span> Identity</div>
              <label>Name <input v-model.trim="scorerForm.name" required placeholder="faithfulness_judge" /></label>
              <label>Produces score config
                <select v-model="scorerForm.producesScoreConfigId" @change="handleScoreConfigSelection">
                  <option value="">None</option>
                  <option v-for="config in scoreConfigs" :key="entityId(config)" :value="entityId(config)">
                    {{ config.name }}
                  </option>
                </select>
              </label>
              <label>Score config version
                <select
                  v-model="scorerForm.producesScoreConfigVersion"
                  :disabled="!scorerForm.producesScoreConfigId"
                  @change="scorerForm.pinScoreConfigVersion = true"
                >
                  <option
                    v-for="(configVersion, index) in selectedScoreConfigVersions"
                    :key="`${entityId(configVersion)}-${configVersion.version}`"
                    :value="String(configVersion.version)"
                  >
                    v{{ configVersion.version }}{{ index === 0 ? " (latest)" : "" }}
                  </option>
                </select>
              </label>
              <label class="eval-form-check">
                <input
                  v-model="scorerForm.pinScoreConfigVersion"
                  type="checkbox"
                  :disabled="!scorerForm.producesScoreConfigId || !scorerForm.producesScoreConfigVersion"
                />
                <span>Pin selected version</span>
              </label>
              <label class="eval-form-section__wide">Description <textarea v-model.trim="scorerForm.description" rows="3" /></label>
            </section>

            <section class="eval-form-section">
              <div class="eval-form-section__title"><span>02</span> {{ scorerForm.scorerType === "remote" ? "Endpoint" : "Judge configuration" }}</div>
              <template v-if="scorerForm.scorerType === 'llm_judge'">
                <label>Provider
                  <select v-model="scorerForm.providerId" required>
                    <option value="">Select provider</option>
                    <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                      {{ provider.name }}
                    </option>
                  </select>
                </label>
                <label>Model <input v-model.trim="scorerForm.model" placeholder="gpt-4o" /></label>
                <label class="eval-form-section__wide">Judge prompt <textarea v-model="scorerForm.template" rows="10" required /></label>
                <label class="eval-form-section__wide">Output schema JSON <textarea v-model="scorerForm.outputSchema" rows="7" /></label>
              </template>
              <template v-else>
                <label class="eval-form-section__wide">Remote endpoint <input v-model.trim="scorerForm.remoteEndpoint" required placeholder="https://eval.internal.corp/check" /></label>
                <label class="eval-form-section__wide">Request body template <textarea v-model="scorerForm.template" rows="10" required /></label>
              </template>
            </section>
          </template>

          <template v-else>
            <section class="eval-form-section">
              <div class="eval-form-section__title"><span>01</span> Provider</div>
              <label>Name <input v-model.trim="providerForm.name" required placeholder="Production OpenAI" /></label>
              <label>Provider type <input v-model.trim="providerForm.providerType" required placeholder="openai" /></label>
              <label class="eval-form-section__wide">Endpoint <input v-model.trim="providerForm.endpoint" placeholder="Optional custom endpoint" /></label>
              <label>Default model <input v-model.trim="providerForm.defaultModel" required placeholder="gpt-4o-mini" /></label>
              <label>Available models <input v-model.trim="providerForm.availableModels" placeholder="gpt-4o-mini, gpt-4.1" /></label>
              <label class="eval-form-check">
                <input v-model="providerForm.isDefault" type="checkbox" />
                <span>Use as default provider</span>
              </label>
              <label class="eval-form-section__wide">Auth config JSON
                <textarea v-model="providerForm.authConfig" rows="7" required />
              </label>
            </section>
          </template>
        </div>

        <aside v-if="formPage.entity === 'jobs'" class="eval-form-page__side">
          <section class="eval-preview-card">
            <h3>Preview</h3>
            <p>Use the fields on the left to define the production evaluation target.</p>
            <textarea
              rows="4"
              readonly
              value="6,854 matched spans
Match rate: 4.5%"
            />
          </section>
          <section class="eval-preview-card">
            <h3>Summary</h3>
            <dl>
              <dt>Name</dt><dd>{{ currentFormName || "—" }}</dd>
              <dt>Type</dt><dd>{{ formPage.entity === "scorers" ? scorerForm.scorerType.replace("_", " ") : jobForm.streamType }}</dd>
              <dt>Status</dt><dd>{{ dialog.mode === "edit" ? "Editing" : "Draft" }}</dd>
            </dl>
          </section>
        </aside>

        <aside v-else-if="formPage.entity === 'scorers'" class="eval-form-page__side eval-form-page__side--test">
          <section class="eval-test-panel">
            <h3>
              <OIcon name="play-arrow" size="xs" />
              Test this scorer
            </h3>
            <p>Try your scorer with sample data before saving. Test runs are not persisted.</p>

            <div v-if="scorerTestVariables.length" class="eval-test-panel__fields">
              <label v-for="variable in scorerTestVariables" :key="variable">
                <code v-text="formatTemplateVariable(variable)" />
                <textarea
                  v-model="scorerTestInputs[variable]"
                  :rows="variable === 'metadata' ? 2 : 3"
                  :placeholder="`Value for {{ ${variable} }}`"
                />
              </label>
            </div>

            <div v-else class="eval-test-panel__empty">
              Add variables like <code v-text="'{{ input }}'" /> to the scorer template to test with sample fields.
            </div>

            <div class="eval-test-panel__actions">
              <OButton
                type="button"
                icon-left="play-arrow"
                :loading="scorerTestState === 'running'"
                :disabled="scorerTestVariables.length === 0"
                @click="runScorerTest"
              >
                Run test
              </OButton>
              <select v-model="scorerTestScenario">
                <option value="success">Mock response</option>
                <option value="auth">Auth error</option>
                <option value="schema">Schema mismatch</option>
              </select>
            </div>

            <div class="eval-test-panel__result" :class="`is-${scorerTestState}`">
              <template v-if="scorerTestState === 'idle'">Run a test to see the result here.</template>
              <template v-else-if="scorerTestState === 'running'">Running scorer test...</template>
              <template v-else-if="scorerTestState === 'success'">
                <strong>Success</strong>
                <span>score: 0.92</span>
                <small>reasoning: The answer is supported by the supplied context.</small>
              </template>
              <template v-else>
                <strong>{{ scorerTestScenario === "auth" ? "Authentication failed" : "Schema mismatch" }}</strong>
                <small>{{ scorerTestScenario === "auth" ? "Check provider credentials before saving." : "The response did not match the configured output schema." }}</small>
              </template>
            </div>
          </section>
        </aside>
      </div>

      <div class="eval-form-page__foot">
        <OButton type="button" variant="outline" @click="closeFormPage">Cancel</OButton>
        <OButton type="submit" :loading="isSaving">{{ dialog.mode === "create" ? "Create" : "Save" }}</OButton>
      </div>
    </form>

    <template v-else>
    <div class="online-evals__header card-container">
      <div>
        <h1>Evaluations</h1>
        <p>Configure LLM providers, score definitions, scorers, and live evaluation jobs.</p>
      </div>
    </div>

    <section class="online-evals__content card-container">
      <div class="online-evals__tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="online-evals__tab"
          :class="{ 'is-active': activeTab === tab.value }"
          type="button"
          @click="activeTab = tab.value"
        >
          <OIcon :name="tab.icon" size="xs" />
          <span>{{ tab.label }}</span>
          <strong>{{ tab.count }}</strong>
        </button>
      </div>

      <div v-if="isLoading" class="online-evals__loading">
        <OSpinner size="lg" />
        <span>Loading online eval configuration...</span>
      </div>

      <div v-else class="online-evals__body">
        <section class="online-evals__list">
          <div class="online-evals__toolbar">
            <div class="online-evals__search">
              <OIcon name="search" size="xs" />
              <input v-model="filterQuery" :placeholder="`Search ${currentTabLabel.toLowerCase()}`" />
            </div>

            <div class="online-evals__toolbar-actions">
              <select v-if="activeTab === 'jobs'" v-model="jobStatusFilter" class="online-evals__select">
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="degraded">Degraded</option>
                <option value="archived">Archived</option>
              </select>

              <OButton
                icon-left="refresh"
                variant="outline"
                size="sm"
                :loading="isLoading"
                @click="loadAll"
              >
                Refresh
              </OButton>
              <OButton icon-left="add" size="sm" @click="openCreateDialog">
                {{ createButtonLabel }}
              </OButton>
            </div>
          </div>

          <div v-if="filteredRows.length === 0" class="online-evals__empty">
            <OIcon name="rule" size="md" />
            <strong>No {{ currentTabLabel.toLowerCase() }} found</strong>
            <span>Create one to start wiring online evaluation.</span>
          </div>

          <div v-else class="online-evals__table">
            <div class="online-evals__thead" :class="tableClass">
              <span>Name</span>
              <span>{{ secondaryColumnLabel }}</span>
              <span>Status</span>
              <span>Updated</span>
              <span></span>
            </div>

            <div
              v-for="row in filteredRows"
              :key="rowKey(row)"
              class="online-evals__row"
              :class="tableClass"
            >
              <span>
                <strong>{{ row.name }}</strong>
                <small>{{ rowDescription(row) }}</small>
              </span>
              <span>{{ rowSecondary(row) }}</span>
              <span>
                <i class="eval-pill" :class="statusClass(rowStatus(row))">{{ rowStatus(row) }}</i>
              </span>
              <span>{{ formatDate(rowUpdatedAt(row)) }}</span>
              <span class="online-evals__row-actions" @click.stop>
                <OButton
                  icon-left="edit"
                  variant="ghost"
                  size="icon-sm"
                  title="Edit"
                  @click="openEditDialog(row)"
                />
                <OButton
                  icon-left="delete"
                  variant="ghost-destructive"
                  size="icon-sm"
                  title="Delete"
                  @click="deleteRow(row)"
                />
              </span>
            </div>
          </div>
        </section>
      </div>
    </section>

    <div v-if="scorerTypeDialog" class="eval-type-dialog" role="dialog" aria-modal="true" @click.self="scorerTypeDialog = false">
      <div class="eval-type-dialog__panel">
        <div class="eval-type-dialog__head">
          <h2>Create a new Scorer</h2>
          <OButton icon-left="close" variant="ghost" size="icon-sm" @click="scorerTypeDialog = false" />
        </div>
        <p>Choose the scorer type. Pick whichever fits how you want to author and run it.</p>
        <div class="eval-type-dialog__cards">
          <button type="button" @click="selectScorerType('llm_judge')">
            <OIcon name="smart-toy" size="sm" />
            <strong>LLM Judge</strong>
            <span>Use a configured provider to evaluate semantically.</span>
          </button>
          <button type="button" @click="selectScorerType('remote')">
            <OIcon name="cloud" size="sm" />
            <strong>Remote</strong>
            <span>Call your own HTTP endpoint for scoring.</span>
          </button>
          <button type="button" disabled>
            <OIcon name="code" size="sm" />
            <strong>Code</strong>
            <span>Coming soon.</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="dialog.open && activeTab === 'scoreConfigs'" class="eval-dialog" role="dialog" aria-modal="true" @click.self="closeDialog">
      <form class="eval-dialog__panel" @submit.prevent="saveDialog">
        <div class="eval-dialog__head">
          <div>
            <h2>{{ dialog.mode === "create" ? createButtonLabel : `Edit ${currentSingularLabel}` }}</h2>
            <p>{{ dialogHelpText }}</p>
          </div>
          <OButton type="button" icon-left="close" variant="ghost" size="icon-sm" @click="closeDialog" />
        </div>

        <div class="eval-dialog__content">
          <template v-if="activeTab === 'scoreConfigs'">
            <label>Name <input v-model.trim="scoreConfigForm.name" required /></label>
            <label>Data type
              <select v-model="scoreConfigForm.dataType" :disabled="dialog.mode === 'edit'">
                <option value="numeric">Numeric</option>
                <option value="categorical">Categorical</option>
                <option value="boolean">Boolean</option>
              </select>
            </label>
            <label class="eval-dialog__wide">Description <input v-model.trim="scoreConfigForm.description" /></label>
            <label>Numeric range JSON <textarea v-model="scoreConfigForm.numericRange" rows="4" /></label>
            <label>Categories JSON <textarea v-model="scoreConfigForm.categories" rows="4" /></label>
            <label class="eval-dialog__wide">Healthy threshold JSON <textarea v-model="scoreConfigForm.healthyThreshold" rows="4" /></label>
          </template>
        </div>

        <div class="eval-dialog__foot">
          <OButton type="button" variant="outline" @click="closeDialog">Cancel</OButton>
          <OButton type="submit" :loading="isSaving">{{ dialog.mode === "create" ? "Create" : "Save" }}</OButton>
        </div>
      </form>
    </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import onlineEvalsService, {
  type EvalJob,
  type EvalJobStatus,
  type EvalJobScorerRef,
  type Provider,
  type ScoreConfig,
  type Scorer,
  type ScorerType,
} from "@/services/online-evals.service";
import {
  convertV0ToV2,
  convertV1BEToV2,
  convertV1ToV2,
  detectConditionsVersion,
  ensureIds,
  removeConditionGroup as removeAlertConditionGroup,
  updateGroup as updateAlertConditionGroup,
  type V2Group,
} from "@/utils/alerts/alertDataTransforms";

type ActiveTab = "jobs" | "scorers" | "scoreConfigs" | "providers";
type FullPageEntity = Exclude<ActiveTab, "scoreConfigs">;
type AnyRow = EvalJob | Scorer | ScoreConfig | Provider;

const store = useStore();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const activeTab = ref<ActiveTab>("jobs");
const filterQuery = ref("");
const jobStatusFilter = ref<EvalJobStatus | "">("");
const isLoading = ref(false);
const isSaving = ref(false);
const scorerTypeDialog = ref(false);
const formPage = ref<{ entity: FullPageEntity; mode: "create" | "edit" } | null>(null);
const scorerTestInputs = ref<Record<string, string>>({
  input: "The capital of France is Paris, located on the Seine river.",
  output: "Paris is the capital of France.",
  metadata: "{}",
});
const scorerTestScenario = ref<"success" | "auth" | "schema">("success");
const scorerTestState = ref<"idle" | "running" | "success" | "error">("idle");

const jobs = ref<EvalJob[]>([]);
const scorers = ref<Scorer[]>([]);
const scoreConfigs = ref<ScoreConfig[]>([]);
const scoreConfigVersions = ref<Record<string, ScoreConfig[]>>({});
const providers = ref<Provider[]>([]);

const dialog = ref<{ open: boolean; mode: "create" | "edit"; row: AnyRow | null }>({
  open: false,
  mode: "create",
  row: null,
});

const providerForm = ref({
  name: "",
  providerType: "openai",
  endpoint: "",
  defaultModel: "",
  availableModels: "",
  authConfig: "{\n  \"api_key\": \"\"\n}",
  isDefault: false,
});

const scoreConfigForm = ref({
  name: "",
  dataType: "numeric",
  description: "",
  numericRange: "{\n  \"min\": 0,\n  \"max\": 1\n}",
  categories: "",
  healthyThreshold: "{\n  \"direction\": \"gte\",\n  \"value\": 0.8\n}",
});

const scorerForm = ref({
  name: "",
  scorerType: "llm_judge" as ScorerType,
  description: "",
  producesScoreConfigId: "",
  producesScoreConfigVersion: "",
  pinScoreConfigVersion: false,
  providerId: "",
  model: "",
  remoteEndpoint: "",
  template: "Evaluate {{input}} and {{output}}.",
  outputSchema: "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"score\": { \"type\": \"number\" },\n    \"reasoning\": { \"type\": \"string\" }\n  }\n}",
});

const jobForm = ref({
  name: "",
  description: "",
  stream: "",
  streamType: "traces",
  scorerIds: [] as string[],
  samplingMode: "rate",
  samplingValue: "0.1",
  filterCondition: "{\n  \"op\": \"and\",\n  \"conditions\": []\n}",
  inputMapping: "",
});
const jobFilterGroup = ref<V2Group>(createEmptyJobFilterGroup());
const jobInputMappings = ref<Record<string, Record<string, string>>>({});
const jobScorerVersions = ref<Record<string, number | null>>({});

const defaultJobStreamFields = [
  { label: "service.name", value: "service.name", type: "String" },
  { label: "span_name", value: "span_name", type: "String" },
  { label: "operation_name", value: "operation_name", type: "String" },
  { label: "gen_ai_operation_name", value: "gen_ai_operation_name", type: "String" },
  { label: "gen_ai_model_name", value: "gen_ai_model_name", type: "String" },
  { label: "gen_ai_system_instructions", value: "gen_ai_system_instructions", type: "String" },
  { label: "gen_ai_input_messages", value: "gen_ai_input_messages", type: "String" },
  { label: "gen_ai_output_messages", value: "gen_ai_output_messages", type: "String" },
  { label: "trace_id", value: "trace_id", type: "String" },
  { label: "span_id", value: "span_id", type: "String" },
  { label: "session_id", value: "session_id", type: "String" },
  { label: "duration", value: "duration", type: "Int64" },
];

const rowsByTab = computed<Record<ActiveTab, AnyRow[]>>(() => ({
  jobs: jobs.value.filter((job) => !jobStatusFilter.value || statusOf(job) === jobStatusFilter.value),
  scorers: scorers.value,
  scoreConfigs: scoreConfigs.value,
  providers: providers.value,
}));

const filteredRows = computed(() => {
  const query = filterQuery.value.trim().toLowerCase();
  const rows = rowsByTab.value[activeTab.value];
  if (!query) return rows;

  return rows.filter((row) =>
    [row.name, rowDescription(row), rowSecondary(row), rowStatus(row)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
});

const tabs = computed(() => [
  { value: "jobs" as ActiveTab, label: "Eval Jobs", icon: "rule", count: jobs.value.length },
  { value: "scorers" as ActiveTab, label: "Scorers", icon: "grading", count: scorers.value.length },
  { value: "scoreConfigs" as ActiveTab, label: "Score Configs", icon: "fact-check", count: scoreConfigs.value.length },
  { value: "providers" as ActiveTab, label: "Providers", icon: "hub", count: providers.value.length },
]);

const currentTabLabel = computed(() => tabs.value.find((tab) => tab.value === activeTab.value)?.label || "Rows");
const currentSingularLabel = computed(() => ({
  jobs: "Eval Job",
  scorers: "Scorer",
  scoreConfigs: "Score Config",
  providers: "Provider",
})[activeTab.value]);
const createButtonLabel = computed(() => `New ${currentSingularLabel.value}`);
const dialogHelpText = computed(() => ({
  jobs: "Jobs connect trace streams to the scorers that should evaluate them.",
  scorers: "Scorers define how individual quality signals are calculated.",
  scoreConfigs: "Score configs define score type, health thresholds, and categories.",
  providers: "Providers store model endpoints and credentials for LLM judge scorers.",
})[activeTab.value]);
const secondaryColumnLabel = computed(() => ({
  jobs: "Stream",
  scorers: "Type",
  scoreConfigs: "Data type",
  providers: "Provider",
})[activeTab.value]);
const tableClass = computed(() => `online-evals__row--${activeTab.value}`);
const selectedScoreConfigVersions = computed(() => {
  const selectedId = scorerForm.value.producesScoreConfigId;
  if (!selectedId) return [];
  const cachedVersions = scoreConfigVersions.value[selectedId];
  const fallback = scoreConfigs.value.filter((config) => entityId(config) === selectedId);
  return [...(cachedVersions || fallback)].sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
});
const formPageTitle = computed(() => {
  if (!formPage.value) return "";
  const action = dialog.value.mode === "create" ? "Create" : "Edit";
  if (formPage.value.entity === "jobs") return `${action} Online Eval Job`;
  if (formPage.value.entity === "providers") return `${action} LLM Provider`;
  return `${action} ${scorerForm.value.scorerType === "remote" ? "Remote" : "LLM Judge"} Scorer`;
});
const formPageSubtitle = computed(() => {
  if (!formPage.value) return "";
  if (formPage.value.entity === "jobs") return "Pick the stream, scorers, mapping, and sampling behavior for this evaluation job.";
  if (formPage.value.entity === "providers") return "Configure the model endpoint used by LLM judge scorers.";
  return scorerForm.value.scorerType === "remote"
    ? "Call an HTTP endpoint you host. We render the request; you return a score."
    : "A language model judges each trace using the prompt you provide.";
});
const currentFormName = computed(() => {
  if (!formPage.value) return "";
  if (formPage.value.entity === "jobs") return jobForm.value.name;
  if (formPage.value.entity === "providers") return providerForm.value.name;
  return scorerForm.value.name;
});
const selectedJobScorers = computed(() =>
  jobForm.value.scorerIds
    .map((id) => scorers.value.find((scorer) => entityId(scorer) === id))
    .filter((scorer): scorer is Scorer => Boolean(scorer)),
);
const jobStreamFields = computed(() => defaultJobStreamFields);
const jobStreamFieldsMap = computed(() =>
  Object.fromEntries(jobStreamFields.value.map((field) => [field.value, { type: field.type }])),
);
const scorerTestVariables = computed(() => extractTemplateVariables(scorerForm.value.template));

watch(activeTab, () => {
  filterQuery.value = "";
});

watch(scorerTestVariables, (variables) => {
  const next = { ...scorerTestInputs.value };
  variables.forEach((variable) => {
    if (next[variable] === undefined) next[variable] = defaultTestValue(variable);
  });
  scorerTestInputs.value = next;
  scorerTestState.value = "idle";
}, { immediate: true });

watch(
  () => jobForm.value.scorerIds.slice(),
  syncJobInputMappings,
);

watch(scorers, syncJobInputMappings);

onBeforeMount(loadAll);

async function loadAll() {
  if (!orgId.value) return;
  isLoading.value = true;
  try {
    const [providerList, scoreConfigList, scorerList, jobList] = await Promise.all([
      onlineEvalsService.providers.list(orgId.value),
      onlineEvalsService.scoreConfigs.list(orgId.value),
      onlineEvalsService.scorers.list(orgId.value),
      onlineEvalsService.jobs.list(orgId.value),
    ]);

    providers.value = providerList;
    scoreConfigs.value = scoreConfigList;
    scoreConfigVersions.value = Object.fromEntries(
      scoreConfigList.map((config) => [entityId(config), [config]]),
    );
    scorers.value = scorerList;
    jobs.value = jobList;
  } catch (err: any) {
    showError(err, "Failed to load online evals");
  } finally {
    isLoading.value = false;
  }
}

function openCreateDialog() {
  resetForms();
  dialog.value = { open: activeTab.value === "scoreConfigs", mode: "create", row: null };
  if (activeTab.value === "scoreConfigs") return;
  if (activeTab.value === "scorers") {
    scorerTypeDialog.value = true;
    return;
  }
  openFormPage(activeTab.value as FullPageEntity, "create");
}

function openEditDialog(row: AnyRow) {
  resetForms(row);
  dialog.value = { open: activeTab.value === "scoreConfigs", mode: "edit", row };
  if (activeTab.value !== "scoreConfigs") openFormPage(activeTab.value as FullPageEntity, "edit");
}

function closeDialog() {
  dialog.value.open = false;
}

function openFormPage(entity: FullPageEntity, mode: "create" | "edit") {
  activeTab.value = entity;
  formPage.value = { entity, mode };
}

function closeFormPage() {
  formPage.value = null;
  dialog.value = { open: false, mode: "create", row: null };
}

function selectScorerType(type: ScorerType) {
  scorerTypeDialog.value = false;
  activeTab.value = "scorers";
  dialog.value = { open: false, mode: "create", row: null };
  resetForms();
  scorerForm.value.scorerType = type;
  openFormPage("scorers", "create");
}

function runScorerTest() {
  scorerTestState.value = "running";
  window.setTimeout(() => {
    scorerTestState.value = scorerTestScenario.value === "success" ? "success" : "error";
  }, 450);
}

async function handleScoreConfigSelection() {
  scorerForm.value.pinScoreConfigVersion = false;
  scorerForm.value.producesScoreConfigVersion = "";
  await prepareSelectedScoreConfigVersion(false);
}

async function prepareSelectedScoreConfigVersion(keepSelectedVersion: boolean) {
  const selectedId = scorerForm.value.producesScoreConfigId;
  if (!selectedId) return;

  await ensureScoreConfigVersions(selectedId);

  const latestVersion = selectedScoreConfigVersions.value[0]?.version;
  if (!latestVersion) return;

  const currentVersion = scorerForm.value.producesScoreConfigVersion;
  const selectedVersionExists = selectedScoreConfigVersions.value.some(
    (config) => String(config.version) === currentVersion,
  );

  if (!keepSelectedVersion || !currentVersion || !selectedVersionExists) {
    scorerForm.value.producesScoreConfigVersion = String(latestVersion);
  }
}

async function ensureScoreConfigVersions(entityIdValue: string) {
  if (!orgId.value || scoreConfigVersions.value[entityIdValue]?.length > 1) return;

  try {
    const versions = await onlineEvalsService.scoreConfigs.versions(orgId.value, entityIdValue);
    if (versions.length) {
      scoreConfigVersions.value = {
        ...scoreConfigVersions.value,
        [entityIdValue]: versions,
      };
    }
  } catch (err: any) {
    showError(err, "Failed to load score config versions");
  }
}

function resetForms(row?: AnyRow) {
  if (!row) {
    providerForm.value = {
      name: "",
      providerType: "openai",
      endpoint: "",
      defaultModel: "",
      availableModels: "",
      authConfig: "{\n  \"api_key\": \"\"\n}",
      isDefault: false,
    };
    scoreConfigForm.value = {
      name: "",
      dataType: "numeric",
      description: "",
      numericRange: "{\n  \"min\": 0,\n  \"max\": 1\n}",
      categories: "",
      healthyThreshold: "{\n  \"direction\": \"gte\",\n  \"value\": 0.8\n}",
    };
    scorerForm.value = {
      name: "",
      scorerType: "llm_judge",
      description: "",
      producesScoreConfigId: "",
      producesScoreConfigVersion: "",
      pinScoreConfigVersion: false,
      providerId: "",
      model: "",
      remoteEndpoint: "",
      template: "Evaluate {{input}} and {{output}}.",
      outputSchema: "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"score\": { \"type\": \"number\" },\n    \"reasoning\": { \"type\": \"string\" }\n  }\n}",
    };
    jobForm.value = {
      name: "",
      description: "",
      stream: "",
      streamType: "traces",
      scorerIds: [],
      samplingMode: "rate",
      samplingValue: "0.1",
      filterCondition: "{\n  \"op\": \"and\",\n  \"conditions\": []\n}",
      inputMapping: "",
    };
    jobFilterGroup.value = createEmptyJobFilterGroup();
    jobInputMappings.value = {};
    jobScorerVersions.value = {};
    return;
  }

  if (activeTab.value === "providers") {
    const provider = row as Provider;
    providerForm.value = {
      name: provider.name,
      providerType: providerTypeOf(provider),
      endpoint: provider.endpoint || "",
      defaultModel: defaultModelOf(provider),
      availableModels: availableModelsOf(provider).join(", "),
      authConfig: "{\n  \"api_key\": \"\"\n}",
      isDefault: booleanOf(provider, "isDefault", "is_default"),
    };
  } else if (activeTab.value === "scoreConfigs") {
    const config = row as ScoreConfig;
    scoreConfigForm.value = {
      name: config.name,
      dataType: dataTypeOf(config),
      description: config.description || "",
      numericRange: stringifyJson(valueOf(config, "numericRange", "numeric_range")),
      categories: stringifyJson(config.categories),
      healthyThreshold: stringifyJson(valueOf(config, "healthyThreshold", "healthy_threshold")),
    };
  } else if (activeTab.value === "scorers") {
    const scorer = row as Scorer;
    scorerForm.value = {
      name: scorer.name,
      scorerType: scorerTypeOf(scorer),
      description: scorer.description || "",
      producesScoreConfigId: String(valueOf(scorer, "producesScoreConfigId", "produces_score_config_id") || ""),
      producesScoreConfigVersion: String(valueOf(scorer, "producesScoreConfigVersion", "produces_score_config_version") || ""),
      pinScoreConfigVersion: Boolean(valueOf(scorer, "producesScoreConfigVersion", "produces_score_config_version")),
      providerId: String(scorer.params?.provider_id || ""),
      model: String(scorer.params?.model || ""),
      remoteEndpoint: String(scorer.params?.endpoint || ""),
      template: scorer.template || "",
      outputSchema: stringifyJson(valueOf(scorer, "outputSchema", "output_schema") || defaultOutputSchema()),
    };
    void prepareSelectedScoreConfigVersion(true);
  } else {
    const job = row as EvalJob;
    const selectedScorerIds = (job.scorers || []).map(scorerRefId);
    jobForm.value = {
      name: job.name,
      description: job.description || "",
      stream: job.stream,
      streamType: streamTypeOf(job),
      scorerIds: selectedScorerIds,
      samplingMode: samplingModeOf(job),
      samplingValue: stringifyJson(valueOf(job, "samplingValue", "sampling_value")),
      filterCondition: stringifyJson(valueOf(job, "filterCondition", "filter_condition") || { op: "and", conditions: [] }),
      inputMapping: stringifyJson(valueOf(job, "inputMapping", "input_mapping")),
    };
    jobFilterGroup.value = normalizeJobFilterCondition(valueOf(job, "filterCondition", "filter_condition"));
    jobScorerVersions.value = Object.fromEntries(
      (job.scorers || []).map((scorer) => [scorerRefId(scorer), scorerRefVersion(scorer)]),
    );
    jobInputMappings.value = normalizeJobInputMappings(
      valueOf(job, "inputMapping", "input_mapping"),
      selectedScorerIds,
    );
    syncJobInputMappings();
  }
}

async function saveDialog() {
  if (!orgId.value) return;

  isSaving.value = true;
  try {
    if (activeTab.value === "providers") await saveProvider();
    else if (activeTab.value === "scoreConfigs") await saveScoreConfig();
    else if (activeTab.value === "scorers") await saveScorer();
    else await saveJob();

    toast({ variant: "success", message: `${currentSingularLabel.value} saved` });
    if (dialog.value.open) closeDialog();
    if (formPage.value) closeFormPage();
    await loadAll();
  } catch (err: any) {
    showError(err, `Failed to save ${currentSingularLabel.value.toLowerCase()}`);
  } finally {
    isSaving.value = false;
  }
}

async function saveProvider() {
  const payload = {
    name: providerForm.value.name,
    providerType: providerForm.value.providerType,
    endpoint: providerForm.value.endpoint || null,
    defaultModel: providerForm.value.defaultModel,
    availableModels: splitCsv(providerForm.value.availableModels),
    authConfig: parseJson(providerForm.value.authConfig, "Auth config"),
    isDefault: providerForm.value.isDefault,
  };

  if (dialog.value.mode === "edit" && dialog.value.row) {
    await onlineEvalsService.providers.update(orgId.value, (dialog.value.row as Provider).id, payload);
  } else {
    await onlineEvalsService.providers.create(orgId.value, payload);
  }
}

async function saveScoreConfig() {
  const form = scoreConfigForm.value;
  const basePayload: Record<string, any> = {
    name: form.name,
    description: form.description || null,
    numericRange: parseOptionalJson(form.numericRange, "Numeric range"),
    categories: parseOptionalJson(form.categories, "Categories"),
    healthyThreshold: parseOptionalJson(form.healthyThreshold, "Healthy threshold"),
  };

  if (dialog.value.mode === "edit" && dialog.value.row) {
    await onlineEvalsService.scoreConfigs.update(orgId.value, entityId(dialog.value.row as ScoreConfig), basePayload);
  } else {
    await onlineEvalsService.scoreConfigs.create(orgId.value, {
      ...basePayload,
      dataType: form.dataType,
    });
  }
}

async function saveScorer() {
  const form = scorerForm.value;
  const isLlmJudge = form.scorerType === "llm_judge";
  const scoreConfigRef = {
    producesScoreConfigId: form.producesScoreConfigId || null,
    producesScoreConfigVersion:
      form.pinScoreConfigVersion && form.producesScoreConfigVersion
        ? Number(form.producesScoreConfigVersion)
        : null,
  };
  const scorerPayload: Record<string, any> = isLlmJudge
    ? {
        type: "llm_judge",
        ...scoreConfigRef,
        template: form.template,
        outputSchema: parseOptionalJson(form.outputSchema, "Output schema") || defaultOutputSchema(),
        params: {
          provider_id: form.providerId,
          ...(form.model ? { model: form.model } : {}),
          include_reasoning: true,
        },
      }
    : {
        type: "remote",
        ...scoreConfigRef,
        template: form.template,
        params: {
          endpoint: form.remoteEndpoint,
          http_method: "POST",
          timeout_ms: 30000,
        },
      };

  if (dialog.value.mode === "edit" && dialog.value.row) {
    await onlineEvalsService.scorers.update(orgId.value, entityId(dialog.value.row as Scorer), {
      name: form.name,
      description: form.description || null,
      scorer: scorerPayload,
    });
  } else {
    await onlineEvalsService.scorers.create(orgId.value, {
      name: form.name,
      description: form.description || null,
      scorer: {
        ...scorerPayload,
      },
    });
  }
}

async function saveJob() {
  const form = jobForm.value;
  if (!form.scorerIds.length) {
    throw new Error("Select at least one scorer");
  }

  const payload = {
    name: form.name,
    description: form.description || null,
    stream: form.stream,
    streamType: form.streamType,
    filterCondition: buildJobFilterConditionPayload(),
    scorers: form.scorerIds.map((id) => ({ id, version: jobScorerVersions.value[id] ?? null })),
    inputMapping: buildJobInputMappingPayload(),
    samplingMode: form.samplingMode as any,
    samplingValue: parseJson(form.samplingValue, "Sampling value"),
  };

  if (dialog.value.mode === "edit" && dialog.value.row) {
    await onlineEvalsService.jobs.update(orgId.value, (dialog.value.row as EvalJob).id, payload);
  } else {
    await onlineEvalsService.jobs.create(orgId.value, payload);
  }
}

function toggleJobScorer(scorerId: string) {
  const selected = new Set(jobForm.value.scorerIds);
  if (selected.has(scorerId)) selected.delete(scorerId);
  else selected.add(scorerId);

  jobForm.value.scorerIds = [...selected];
  if (!(scorerId in jobScorerVersions.value)) jobScorerVersions.value[scorerId] = null;
  syncJobInputMappings();
}

function syncJobInputMappings() {
  const selected = new Set(jobForm.value.scorerIds);
  const nextMappings: Record<string, Record<string, string>> = {};
  const nextVersions: Record<string, number | null> = {};

  selected.forEach((scorerId) => {
    const scorer = scorers.value.find((item) => entityId(item) === scorerId);
    const mapping = { ...(jobInputMappings.value[scorerId] || {}) };

    if (scorer) {
      scorerTemplateVariables(scorer).forEach((variable) => {
        if (mapping[variable] === undefined) mapping[variable] = defaultJobMappingValue(variable);
      });
    }

    nextMappings[scorerId] = mapping;
    nextVersions[scorerId] = jobScorerVersions.value[scorerId] ?? null;
  });

  jobInputMappings.value = nextMappings;
  jobScorerVersions.value = nextVersions;
}

function handleJobFilterGroupUpdate(updatedGroup: any) {
  const formData = { query_condition: { conditions: jobFilterGroup.value } };
  updateAlertConditionGroup(updatedGroup, { formData });
  jobFilterGroup.value = formData.query_condition.conditions;
}

function removeJobFilterGroup(groupId: string) {
  const formData = { query_condition: { conditions: jobFilterGroup.value } };
  removeAlertConditionGroup(groupId, jobFilterGroup.value, { formData });
  jobFilterGroup.value = formData.query_condition.conditions;
}

function handleJobFilterInputUpdate() {
  jobFilterGroup.value = { ...jobFilterGroup.value };
}

function updateJobInputMapping(scorerId: string, variable: string, event: Event) {
  const target = event.target as HTMLInputElement;
  jobInputMappings.value = {
    ...jobInputMappings.value,
    [scorerId]: {
      ...(jobInputMappings.value[scorerId] || {}),
      [variable]: target.value,
    },
  };
}

function jobMappingVariablesForScorer(scorer: Scorer) {
  const scorerId = entityId(scorer);
  return [
    ...new Set([
      ...scorerTemplateVariables(scorer),
      ...Object.keys(jobInputMappings.value[scorerId] || {}),
    ]),
  ];
}

function scorerTemplateVariables(scorer: Scorer) {
  return [
    ...new Set([
      ...((scorer.variables || []) as string[]),
      ...extractTemplateVariables(scorer.template || ""),
    ]),
  ];
}

function defaultJobMappingValue(variable: string) {
  const defaults: Record<string, string> = {
    input: "{{gen_ai_input_messages}}",
    output: "{{gen_ai_output_messages}}",
    context: "{{gen_ai_system_instructions}}",
    metadata: "{{attributes}}",
    "trace.id": "{{trace_id}}",
    "span.id": "{{span_id}}",
    trace_id: "{{trace_id}}",
    span_id: "{{span_id}}",
    session_id: "{{session_id}}",
  };

  return defaults[variable] || `{{${variable.replace(/\./g, "_")}}}`;
}

function buildJobInputMappingPayload() {
  const payload: Record<string, Record<string, string>> = {};

  jobForm.value.scorerIds.forEach((scorerId) => {
    const cleanMapping = Object.fromEntries(
      Object.entries(jobInputMappings.value[scorerId] || {})
        .map(([key, value]) => [key.trim(), value.trim()])
        .filter(([key, value]) => key && value),
    );

    if (Object.keys(cleanMapping).length) payload[scorerId] = cleanMapping;
  });

  return Object.keys(payload).length ? payload : null;
}

function buildJobFilterConditionPayload() {
  const conditions = cleanFilterGroup(jobFilterGroup.value);
  if (!conditions.conditions.length) return { type: "all" };

  return {
    version: 2,
    conditions,
  };
}

function createEmptyJobFilterGroup(): V2Group {
  return ensureIds(convertV0ToV2([])) as V2Group;
}

function normalizeJobFilterCondition(value: any): V2Group {
  const parsedValue = parseMaybeJson(value);
  if (
    !parsedValue ||
    parsedValue.type === "all" ||
    (typeof parsedValue === "object" && !Array.isArray(parsedValue) && Object.keys(parsedValue).length === 0)
  ) {
    return createEmptyJobFilterGroup();
  }

  const conditionValue = parsedValue.version !== undefined && parsedValue.conditions !== undefined
    ? parsedValue.conditions
    : parsedValue;

  if (conditionValue?.op && Array.isArray(conditionValue.conditions)) {
    return ensureIds({
      filterType: "group",
      logicalOperator: String(conditionValue.op).toUpperCase() === "OR" ? "OR" : "AND",
      conditions: conditionValue.conditions.map((condition: any) => ({
        filterType: "condition",
        column: condition.column || "",
        operator: condition.operator || "=",
        value: condition.value || "",
        values: condition.values || [],
        logicalOperator: String(conditionValue.op).toUpperCase() === "OR" ? "OR" : "AND",
      })),
    }) as V2Group;
  }

  const version = detectConditionsVersion(conditionValue);
  if (version === 2) return ensureIds(cloneJson(conditionValue)) as V2Group;
  if (Array.isArray(conditionValue)) return ensureIds(convertV0ToV2(conditionValue)) as V2Group;
  if (conditionValue?.label && conditionValue?.items) {
    return ensureIds(convertV1ToV2(conditionValue)) as V2Group;
  }

  return ensureIds(convertV1BEToV2(conditionValue)) as V2Group;
}

function normalizeJobInputMappings(value: any, selectedScorerIds: string[]) {
  const parsedValue = parseMaybeJson(value);
  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) return {};

  const entries = Object.entries(parsedValue);
  const hasPerScorerShape = entries.some(([, mapping]) => (
    mapping &&
    typeof mapping === "object" &&
    !Array.isArray(mapping) &&
    Object.values(mapping).every((fieldValue) => typeof fieldValue === "string")
  ));

  if (hasPerScorerShape) {
    return Object.fromEntries(
      entries
        .filter(([, mapping]) => mapping && typeof mapping === "object" && !Array.isArray(mapping))
        .map(([scorerId, mapping]) => [scorerId, { ...(mapping as Record<string, string>) }]),
    );
  }

  const flatMapping = Object.fromEntries(
    entries.filter(([, mappingValue]) => typeof mappingValue === "string"),
  ) as Record<string, string>;

  return Object.fromEntries(selectedScorerIds.map((scorerId) => [scorerId, { ...flatMapping }]));
}

function cleanFilterGroup(group: any): V2Group {
  const logicalOperator = group?.logicalOperator === "OR" ? "OR" : "AND";
  const conditions = (group?.conditions || [])
    .map((item: any) => {
      if (item?.filterType === "group") {
        const cleanGroup = cleanFilterGroup(item);
        return cleanGroup.conditions.length
          ? {
              ...cleanGroup,
              logicalOperator: item.logicalOperator === "OR" ? "OR" : "AND",
            }
          : null;
      }

      const hasValue = item?.value !== undefined && item?.value !== null && item?.value !== "";
      if (item?.filterType !== "condition" || !item.column || !item.operator || !hasValue) return null;

      return {
        filterType: "condition",
        column: item.column,
        operator: item.operator,
        value: item.value,
        values: item.values || [],
        logicalOperator: item.logicalOperator === "OR" ? "OR" : "AND",
      };
    })
    .filter(Boolean);

  return {
    filterType: "group",
    logicalOperator,
    conditions,
  } as V2Group;
}

function parseMaybeJson(value: any) {
  if (typeof value !== "string") return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function deleteRow(row: AnyRow) {
  if (!window.confirm(`Delete ${row.name}?`)) return;
  try {
    if (activeTab.value === "providers") await onlineEvalsService.providers.delete(orgId.value, (row as Provider).id);
    else if (activeTab.value === "scoreConfigs") await onlineEvalsService.scoreConfigs.delete(orgId.value, entityId(row as ScoreConfig));
    else if (activeTab.value === "scorers") await onlineEvalsService.scorers.delete(orgId.value, entityId(row as Scorer));
    else await onlineEvalsService.jobs.delete(orgId.value, (row as EvalJob).id);

    toast({ variant: "success", message: `${currentSingularLabel.value} deleted` });
    await loadAll();
  } catch (err: any) {
    showError(err, `Failed to delete ${currentSingularLabel.value.toLowerCase()}`);
  }
}

function rowKey(row: AnyRow) {
  return activeTab.value === "jobs" || activeTab.value === "providers" ? row.id : entityId(row as ScoreConfig | Scorer);
}

function rowDescription(row: AnyRow) {
  if (activeTab.value === "jobs") return (row as EvalJob).description || `Pipeline: ${valueOf(row, "pipelineId", "pipeline_id") || "pending"}`;
  if (activeTab.value === "scorers") return (row as Scorer).description || `${(row as Scorer).variables?.length || 0} variables`;
  if (activeTab.value === "scoreConfigs") return (row as ScoreConfig).description || `v${(row as ScoreConfig).version}`;
  return (row as Provider).endpoint || defaultModelOf(row as Provider);
}

function rowSecondary(row: AnyRow) {
  if (activeTab.value === "jobs") return `${(row as EvalJob).stream} (${streamTypeOf(row as EvalJob)})`;
  if (activeTab.value === "scorers") return scorerTypeOf(row as Scorer).replace("_", " ");
  if (activeTab.value === "scoreConfigs") return dataTypeOf(row as ScoreConfig);
  return providerTypeOf(row as Provider);
}

function rowStatus(row: AnyRow) {
  if (activeTab.value === "jobs") return statusOf(row as EvalJob);
  if (activeTab.value === "providers") return booleanOf(row, "isDefault", "is_default") ? "default" : "configured";
  return booleanOf(row, "isActive", "is_active") ? "active" : "inactive";
}

function rowUpdatedAt(row: AnyRow) {
  return Number(valueOf(row, "updatedAt", "updated_at") || valueOf(row, "createdAt", "created_at") || 0);
}

function statusOf(row: EvalJob) {
  return row.status || "draft";
}

function statusClass(status: string) {
  return {
    "is-good": ["active", "default", "configured"].includes(status),
    "is-warn": ["draft", "paused", "degraded"].includes(status),
    "is-muted": ["archived", "inactive"].includes(status),
  };
}

function entityId(row: ScoreConfig | Scorer) {
  return String(valueOf(row, "entityId", "entity_id") || row.id);
}

function providerTypeOf(row: Provider) {
  return String(valueOf(row, "providerType", "provider_type") || "");
}

function defaultModelOf(row: Provider) {
  return String(valueOf(row, "defaultModel", "default_model") || "");
}

function availableModelsOf(row: Provider) {
  return (valueOf(row, "availableModels", "available_models") || []) as string[];
}

function scorerTypeOf(row: Scorer) {
  return (valueOf(row, "scorerType", "scorer_type") || "llm_judge") as ScorerType;
}

function dataTypeOf(row: ScoreConfig) {
  return String(valueOf(row, "dataType", "data_type") || "numeric");
}

function streamTypeOf(row: EvalJob) {
  return String(valueOf(row, "streamType", "stream_type") || "traces");
}

function samplingModeOf(row: EvalJob) {
  return String(valueOf(row, "samplingMode", "sampling_mode") || "rate");
}

function scorerRefId(ref: EvalJobScorerRef) {
  return typeof ref === "string" ? ref : ref.id;
}

function scorerRefVersion(ref: EvalJobScorerRef) {
  return typeof ref === "string" ? null : ref.version ?? null;
}

function booleanOf(row: any, camelKey: string, snakeKey: string) {
  return Boolean(valueOf(row, camelKey, snakeKey));
}

function valueOf(row: any, camelKey: string, snakeKey: string) {
  return row?.[camelKey] ?? row?.[snakeKey];
}

function parseJson(value: string, label: string) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function parseOptionalJson(value: string, label: string) {
  if (!value.trim()) return null;
  return parseJson(value, label);
}

function stringifyJson(value: any) {
  if (value === undefined || value === null || value === "") return "";
  return JSON.stringify(value, null, 2);
}

function splitCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function extractTemplateVariables(template: string) {
  const variables = new Set<string>();
  const matcher = /\{\{\s*([\w.]+)\s*\}\}/g;
  let match = matcher.exec(template);
  while (match) {
    variables.add(match[1]);
    match = matcher.exec(template);
  }
  return [...variables];
}

function formatTemplateVariable(variable: string) {
  return `{{ ${variable} }}`;
}

function defaultTestValue(variable: string) {
  if (variable === "input") return "The capital of France is Paris, located on the Seine river.";
  if (variable === "output") return "Paris is the capital of France.";
  if (variable === "context") return "France country profile: Paris is the capital city.";
  if (variable === "metadata") return "{}";
  if (variable === "trace.id") return "test_trace_123";
  if (variable === "span.id") return "test_span_456";
  return "";
}

function defaultOutputSchema() {
  return {
    type: "object",
    properties: {
      score: { type: "number" },
      reasoning: { type: "string" },
    },
  };
}

function formatDate(value: number) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showError(err: any, fallback: string) {
  toast({
    variant: "error",
    message: err?.response?.data?.message || err?.message || fallback,
  });
}
</script>

<style scoped lang="scss">
.online-evals {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: calc(100vh - var(--navbar-height));
  min-height: 0;
  padding: 4px 10px 10px;
  color: var(--o2-text);
}

.online-evals__header,
.online-evals__content {
  background: var(--o2-card-bg);
}

.online-evals__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.online-evals__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 68px;
  padding: 10px 16px;
  flex-shrink: 0;
}

.online-evals__header h1,
.eval-dialog h2 {
  margin: 0;
  font-weight: 700;
  color: var(--o2-text);
  letter-spacing: 0;
}

.online-evals__header h1 {
  font-size: 18px;
}

.online-evals__header p,
.eval-dialog p {
  margin: 2px 0 0;
  color: var(--o2-text-muted);
  font-size: 12px;
}

.online-evals__tabs,
.online-evals__toolbar,
.online-evals__toolbar-actions,
.online-evals__row-actions,
.eval-dialog__foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.online-evals__tabs {
  flex-shrink: 0;
  padding: 0 14px;
  background: transparent;
  border-bottom: 1px solid var(--o2-border);
}

.online-evals__tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 14px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--o2-text-muted);
  cursor: pointer;
  font: 600 13px var(--o2-font);
}

.online-evals__tab.is-active {
  color: var(--o2-text);
  border-bottom-color: var(--o2-brand);
  margin-bottom: -1px;
}

.online-evals__tab strong {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--o2-bg-muted);
  color: var(--o2-text-secondary);
  font: 700 10px var(--o2-font-mono);
}

.online-evals__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 260px;
  color: var(--o2-text-muted);
}

.online-evals__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.online-evals__list {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.online-evals__toolbar {
  justify-content: space-between;
  min-height: 52px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--o2-border);
}

.online-evals__toolbar-actions {
  margin-left: auto;
}

.online-evals__search {
  display: flex;
  align-items: center;
  gap: 7px;
  width: min(320px, 100%);
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
}

.online-evals__search input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--o2-text);
  font-size: 12px;
}

.online-evals__select,
.eval-dialog input,
.eval-dialog select,
.eval-dialog textarea {
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font);
}

.online-evals__select {
  height: 30px;
  padding: 0 9px;
}

.online-evals__table {
  height: calc(100% - 52px);
  overflow: auto;
  background: var(--o2-card-bg-solid);
}

.online-evals__thead,
.online-evals__row {
  display: grid;
  grid-template-columns: minmax(210px, 1.5fr) minmax(120px, 1fr) 98px 118px 170px;
  align-items: center;
  gap: 12px;
}

.online-evals__thead {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 14px;
  background: var(--o2-table-header-bg, var(--o2-bg-secondary));
  color: var(--o2-text);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.online-evals__row {
  width: 100%;
  min-height: 54px;
  padding: 8px 14px;
  border: 0;
  border-bottom: 1px solid var(--o2-border);
  background: transparent;
  color: var(--o2-text);
  text-align: left;
}

.online-evals__row:hover {
  background: var(--o2-hover-gray);
}

.online-evals__row span {
  min-width: 0;
}

.online-evals__row strong,
.online-evals__row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.online-evals__row strong {
  color: var(--o2-text);
  font-size: 13px;
}

.online-evals__row small,
.online-evals__row > span {
  color: var(--o2-text-secondary);
  font-size: 12px;
}

.eval-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 2px 8px;
  border-radius: 999px;
  font: 700 10px var(--o2-font);
  text-transform: uppercase;
}

.eval-pill.is-good {
  background: var(--o2-status-success-bg);
  color: var(--o2-status-success-text);
}

.eval-pill.is-warn {
  background: var(--o2-status-warning-bg);
  color: var(--o2-status-warning-text);
}

.eval-pill.is-muted {
  background: var(--o2-status-neutral-bg);
  color: var(--o2-status-neutral-text);
}

.online-evals__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 260px;
  padding: 24px;
  color: var(--o2-text-muted);
  text-align: center;
}

.online-evals__empty strong {
  color: var(--o2-text);
  font-size: 14px;
}

.eval-form-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--o2-card-bg-solid);
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  box-shadow: var(--o2-shadow-sm);
}

.eval-form-page__top,
.eval-form-page__head,
.eval-form-page__foot {
  flex-shrink: 0;
  border-bottom: 1px solid var(--o2-border);
}

.eval-form-page__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 18px;
}

.eval-form-page__top-actions,
.eval-form-page__back,
.eval-stepper,
.eval-type-dialog__cards {
  display: flex;
  align-items: center;
  gap: 8px;
}

.eval-form-page__back {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--o2-text-secondary);
  cursor: pointer;
  font: 600 12px var(--o2-font);
}

.eval-form-page__back:hover {
  color: var(--o2-text);
}

.eval-form-page__badge {
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--o2-bg-muted);
  color: var(--o2-text);
  font: 700 11px var(--o2-font);
}

.eval-form-page__head {
  padding: 18px 24px;
}

.eval-form-page__head h1 {
  margin: 0;
  color: var(--o2-text);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0;
}

.eval-form-page__head p {
  margin: 3px 0 0;
  color: var(--o2-text-muted);
  font-size: 13px;
}

.eval-form-page__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.eval-form-page__body--split {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  overflow: hidden;
}

.eval-form-page__main {
  min-width: 0;
  overflow: auto;
}

.eval-form-page__side {
  min-width: 0;
  overflow: auto;
  padding: 18px;
  border-left: 1px solid var(--o2-border);
  background: var(--o2-bg-secondary);
}

.eval-form-page__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--o2-border);
  border-bottom: 0;
}

.eval-stepper {
  height: 48px;
  padding: 0 24px;
  border-bottom: 1px solid var(--o2-border);
  color: var(--o2-text-muted);
  font: 600 12px var(--o2-font);
}

.eval-stepper span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.eval-stepper i,
.eval-form-section__title span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--o2-bg-muted);
  color: var(--o2-text-muted);
  font: 700 11px var(--o2-font-mono);
  font-style: normal;
}

.eval-stepper .is-active {
  color: var(--o2-text);
}

.eval-stepper .is-active i {
  background: var(--o2-brand);
  color: white;
}

.eval-form-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  max-width: 1040px;
  padding: 24px;
  border-bottom: 1px solid var(--o2-border);
}

.eval-form-section__title,
.eval-form-section__wide {
  grid-column: 1 / -1;
}

.eval-form-section__title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--o2-text);
  font-size: 16px;
  font-weight: 700;
}

.eval-form-section label,
.eval-dialog label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--o2-text);
  font-size: 12px;
  font-weight: 700;
}

.eval-form-section input,
.eval-form-section select,
.eval-form-section textarea,
.eval-dialog input,
.eval-dialog select,
.eval-dialog textarea {
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font);
}

.eval-form-section input,
.eval-form-section select,
.eval-dialog input,
.eval-dialog select {
  height: 32px;
  padding: 0 9px;
}

.eval-form-section textarea,
.eval-dialog textarea {
  min-height: 90px;
  padding: 8px 9px;
  resize: vertical;
  font-family: var(--o2-font-mono);
}

.eval-form-check {
  flex-direction: row !important;
  align-items: center;
  align-self: end;
  min-height: 32px;
}

.eval-form-check input {
  width: auto;
  height: auto;
}

.eval-form-field-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
  color: var(--o2-text);
  font-size: 12px;
  font-weight: 700;
}

.eval-form-field-head small {
  color: var(--o2-text-muted);
  font-size: 12px;
  font-weight: 400;
}

.eval-scorer-picker__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.eval-scorer-option {
  flex-direction: row !important;
  align-items: center;
  gap: 10px !important;
  min-height: 54px;
  padding: 10px 12px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
  cursor: pointer;
}

.eval-scorer-option.is-selected {
  border-color: var(--o2-brand);
  background: color-mix(in srgb, var(--o2-brand) 8%, var(--o2-card-bg-solid));
}

.eval-scorer-option input {
  width: auto;
  height: auto;
}

.eval-scorer-option span,
.eval-mapping-card__head div {
  min-width: 0;
}

.eval-scorer-option strong,
.eval-scorer-option small,
.eval-mapping-card__head strong,
.eval-mapping-card__head small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eval-scorer-option small,
.eval-mapping-card__head small {
  color: var(--o2-text-secondary);
  font-size: 11px;
  font-weight: 400;
}

.eval-condition-builder {
  min-width: 0;
  padding: 10px 0 2px;
}

.eval-condition-builder :deep(.el-border) {
  width: 100%;
  max-width: 100%;
  margin-top: 0 !important;
  margin-left: 0 !important;
  border-color: var(--o2-border);
}

.eval-condition-builder :deep(.group-container) {
  width: 100%;
}

.eval-input-mapping {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.eval-input-mapping__empty {
  padding: 10px 12px;
  border: 1px dashed var(--o2-border);
  border-radius: 6px;
  color: var(--o2-text-muted);
  font-size: 12px;
  font-weight: 400;
}

.eval-mapping-card {
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-mapping-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--o2-border);
}

.eval-mapping-card__head i {
  flex-shrink: 0;
  color: var(--o2-text-muted);
  font: 700 11px var(--o2-font);
  font-style: normal;
}

.eval-mapping-card__rows {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.eval-mapping-row {
  display: grid !important;
  grid-template-columns: minmax(130px, 0.35fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px !important;
}

.eval-mapping-row code {
  overflow: hidden;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--o2-bg-muted);
  color: var(--o2-text);
  font: 700 11px var(--o2-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.eval-preview-card {
  padding: 16px;
  margin-bottom: 14px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-preview-card h3 {
  margin: 0 0 6px;
  color: var(--o2-text);
  font-size: 14px;
  font-weight: 700;
}

.eval-preview-card p {
  margin: 0 0 12px;
  color: var(--o2-text-muted);
  font-size: 12px;
}

.eval-preview-card textarea {
  width: 100%;
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font-mono);
  padding: 8px;
  resize: none;
}

.eval-preview-card dl {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px;
  margin: 0;
  font-size: 12px;
}

.eval-preview-card dt {
  color: var(--o2-text-muted);
}

.eval-preview-card dd {
  margin: 0;
  color: var(--o2-text);
}

.eval-form-page__side--test {
  padding: 0;
}

.eval-test-panel {
  min-height: 100%;
  padding: 20px;
  background: var(--o2-bg-secondary);
}

.eval-test-panel h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  color: var(--o2-text);
  font-size: 14px;
  font-weight: 700;
}

.eval-test-panel p,
.eval-test-panel__empty,
.eval-test-panel__result {
  color: var(--o2-text-muted);
  font-size: 12px;
}

.eval-test-panel p {
  margin: 0 0 16px;
}

.eval-test-panel__fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.eval-test-panel label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.eval-test-panel code {
  color: var(--o2-text);
  font: 700 12px var(--o2-font-mono);
}

.eval-test-panel textarea,
.eval-test-panel select {
  border: 1px solid var(--o2-border-input);
  border-radius: 4px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  font: 400 12px var(--o2-font);
}

.eval-test-panel textarea {
  padding: 8px 9px;
  resize: vertical;
}

.eval-test-panel select {
  height: 32px;
  padding: 0 9px;
}

.eval-test-panel__empty {
  padding: 10px 12px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-test-panel__actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 8px;
  margin-top: 14px;
}

.eval-test-panel__result {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 84px;
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
}

.eval-test-panel__result.is-success {
  border-color: color-mix(in srgb, var(--o2-status-success-text) 35%, var(--o2-border));
  color: var(--o2-status-success-text);
}

.eval-test-panel__result.is-error {
  border-color: color-mix(in srgb, var(--o2-status-error-text) 35%, var(--o2-border));
  color: var(--o2-status-error-text);
}

.eval-test-panel__result span,
.eval-test-panel__result small {
  color: var(--o2-text-secondary);
}

.eval-type-dialog,
.eval-dialog {
  position: fixed;
  inset: 0;
  z-index: 6000;
  padding: 0;
  background: rgba(0, 0, 0, 0.36);
  animation: eval-scrim-in 0.15s ease-out;
}

.eval-type-dialog {
  display: flex;
  align-items: center;
  justify-content: center;
}

.eval-type-dialog__panel {
  width: min(760px, calc(100vw - 48px));
  padding: 20px;
  border-radius: 8px;
  background: var(--o2-card-bg-solid);
  box-shadow: var(--o2-shadow-lg);
}

.eval-type-dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--o2-border);
}

.eval-type-dialog__head h2 {
  margin: 0;
  color: var(--o2-text);
  font-size: 18px;
  font-weight: 700;
}

.eval-type-dialog__panel > p {
  margin: 16px 0;
  color: var(--o2-text-muted);
  font-size: 13px;
}

.eval-type-dialog__cards {
  align-items: stretch;
}

.eval-type-dialog__cards button {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-height: 150px;
  padding: 18px;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-card-bg-solid);
  color: var(--o2-text);
  text-align: left;
  cursor: pointer;
}

.eval-type-dialog__cards button:hover:not(:disabled) {
  border-color: var(--o2-brand);
  box-shadow: inset 0 0 0 1px var(--o2-brand);
}

.eval-type-dialog__cards button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.eval-type-dialog__cards strong {
  font-size: 14px;
}

.eval-type-dialog__cards span {
  color: var(--o2-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.eval-dialog {
  display: block;
}

.eval-dialog__panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: 52vw;
  min-width: 600px;
  max-width: 920px;
  max-height: none;
  overflow: hidden;
  border: 1px solid var(--o2-border);
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  border-radius: 0;
  background: var(--o2-card-bg-solid);
  box-shadow: var(--o2-shadow-lg);
  animation: eval-drawer-in 0.2s ease-out;
}

.eval-dialog__panel--small {
  width: 50vw;
  min-width: 560px;
  max-width: 760px;
}

.eval-dialog__head,
.eval-dialog__foot {
  flex-shrink: 0;
  padding: 14px 20px;
  border-bottom: 1px solid var(--o2-border);
}

.eval-dialog__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.eval-dialog__head h2 {
  font-size: 16px;
}

.eval-dialog__content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  flex: 1;
  padding: 20px;
  overflow: auto;
}

.eval-dialog__content--single {
  grid-template-columns: 1fr;
}

.eval-dialog label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--o2-text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.eval-dialog input,
.eval-dialog select {
  height: 32px;
  padding: 0 9px;
}

.eval-dialog textarea {
  min-height: 90px;
  padding: 8px 9px;
  resize: vertical;
  font-family: var(--o2-font-mono);
}

.eval-dialog__wide {
  grid-column: 1 / -1;
}

.eval-dialog__check {
  flex-direction: row !important;
  align-items: center;
  align-self: end;
  height: 32px;
}

.eval-dialog__check input {
  width: auto;
  height: auto;
}

.eval-dialog__foot {
  justify-content: flex-end;
  border-top: 1px solid var(--o2-border);
  border-bottom: 0;
  background: var(--o2-card-bg-solid);
}

@keyframes eval-scrim-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes eval-drawer-in {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (max-width: 900px) {
  .eval-dialog__panel,
  .eval-dialog__panel--small {
    width: 100vw;
    min-width: 0;
    max-width: none;
  }

  .eval-dialog__content {
    grid-template-columns: 1fr;
  }

  .eval-form-page__body--split {
    display: block;
    overflow: auto;
  }

  .eval-form-page__side {
    border-left: 0;
    border-top: 1px solid var(--o2-border);
  }

  .eval-form-section {
    grid-template-columns: 1fr;
  }
}

</style>
