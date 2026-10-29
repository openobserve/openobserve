<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { requestErrorMessage } from "@/composables/usePrebuiltDestinations";
import destinationService, {
  type JiraConnectResponse,
  type JiraFieldsResponse,
  type JiraIssueTypesResponse,
  type JiraOption,
  type JiraRequiredField,
  type JiraSetupAction,
} from "@/services/alert_destination";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  jiraFieldInputValues,
  jiraFieldsPayload,
  jiraSetupRequest,
  parseJiraFields,
  type JiraCreateMeta,
} from "@/utils/prebuilt-templates/jira";

type Credentials = Record<string, unknown>;
type FormState = { values: { credentials?: Credentials } };

const { t } = useI18nTyped();
const store = useStore();
const form = inject(FORM_CONTEXT_KEY, null);

if (!form) {
  throw new Error("JiraDestinationFields must be rendered inside OForm");
}

const credentials = form.useStore((s: FormState) => s.values.credentials ?? {});
const field = (key: string) => form.useStore((s: FormState) => s.values.credentials?.[key]);
const deployment = field("deployment");
const url = field("url");
const email = field("email");
const token = field("token");
const projectKey = field("projectKey");
const issueTypeId = field("issueTypeId");
const connectedAs = field("connectedAs");
const savedDestination = field("savedDestination");
const changing = field("changing");
const createMeta = computed(() => credentials.value.createMeta as JiraCreateMeta | undefined);
const fieldValues = field("fieldValues");

const isCloud = computed(() => deployment.value !== "data_center");
const projects = ref<JiraConnectResponse["projects"]>([]);
const issueTypes = ref<JiraOption[]>([]);
const priorities = ref<JiraOption[]>([]);
const loading = ref<JiraSetupAction | null>(null);
const error = ref<I18nText | null>(null);

const projectOptions = computed<SelectOption[]>(() =>
  projects.value.map((p) => ({ label: raw(`${p.name} (${p.key})`), value: p.key })),
);
const toOptions = (list: JiraOption[] = []): SelectOption[] =>
  list.map((o) => ({ label: raw(o.name), value: o.id }));
const issueTypeOptions = computed(() => toOptions(issueTypes.value));
const priorityOptions = computed(() => toOptions(priorities.value));

const set = (key: string, value: unknown) => form.setFieldValue(`credentials.${key}`, value);

// Bumped whenever the login, project or issue type changes, so older responses are dropped.
let generation = 0;
const invalidateLookups = (): void => {
  generation++;
  loading.value = null;
};

// Credentials never reach a cache: every lookup is a fresh POST (destination payloads are memory-only).
async function callJira<T>(action: JiraSetupAction): Promise<T | null> {
  const mine = generation;
  loading.value = action;
  error.value = null;
  try {
    const res = await destinationService.jiraSetup<T>(
      store.state.selectedOrganization.identifier,
      jiraSetupRequest(credentials.value, action),
    );
    return mine === generation ? res.data : null;
  } catch (e) {
    if (mine === generation) {
      error.value = requestErrorMessage(e, t("alerts.prebuilt.testFailedUnknownError"));
    }
    return null;
  } finally {
    if (mine === generation) loading.value = null;
  }
}

const loadFields = async (): Promise<void> => {
  const requestedType = issueTypeId.value;
  const data = await callJira<JiraFieldsResponse>("fields");
  if (!data || issueTypeId.value !== requestedType) return;
  priorities.value = data.priorities;
  if (!data.priorities.some((p) => p.id === credentials.value.priorityId)) set("priorityId", "");
  // On edit the saved values fill the inputs again; on a new issue type `fields` is empty.
  set("fieldValues", jiraFieldInputValues(parseJiraFields(credentials.value.fields)));
  set("createMeta", {
    projectName: projects.value.find((p) => p.key === projectKey.value)?.name ?? projectKey.value,
    issueTypeName: issueTypes.value.find((i) => i.id === requestedType)?.name ?? requestedType,
    hasLabels: data.has_labels,
    requiredFields: data.required_fields,
  } satisfies JiraCreateMeta);
};

const loadIssueTypes = async (): Promise<void> => {
  const requestedProject = projectKey.value;
  const data = await callJira<JiraIssueTypesResponse>("issue_types");
  if (!data || projectKey.value !== requestedProject) return;
  issueTypes.value = data.issue_types;
  if (!issueTypeId.value) return;
  if (data.issue_types.some((i) => i.id === issueTypeId.value)) await loadFields();
  else set("issueTypeId", "");
};

const host = computed(() => {
  try {
    return new URL(String(url.value)).host;
  } catch {
    return String(url.value ?? "");
  }
});

// Change reopens the inputs; the project, issue type, priority, fields and token start over.
const change = (): void => {
  set("changing", true);
  set("token", "");
  set("connectedAs", "");
  set("projectKey", "");
  set("priorityId", "");
  set("fields", "");
  set("fieldValues", {});
  set("createMeta", undefined);
  projects.value = [];
};

const connect = async (): Promise<void> => {
  // A saved destination keeps its token on the server, so an empty token is fine until Change.
  const usesSavedToken = !token.value && !!savedDestination.value && !changing.value;
  const failed = (message?: I18nText) => {
    if (message) error.value = message;
    if (usesSavedToken) set("changing", true);
  };
  if (!url.value || (!token.value && !usesSavedToken) || (isCloud.value && !email.value)) {
    failed(t("alerts.prebuiltDestinations.jiraConnectMissing"));
    return;
  }
  const mine = generation;
  const data = await callJira<JiraConnectResponse>("connect");
  if (mine !== generation) return;
  if (!data) return failed();
  projects.value = data.projects;
  set("connectedAs", data.display_name);
  if (!projectKey.value) return;
  if (data.projects.some((p) => p.key === projectKey.value)) await loadIssueTypes();
  else set("projectKey", "");
};

// A changed login must be checked again before the destination can be saved.
watch([deployment, url, email, token], () => {
  invalidateLookups();
  error.value = null;
  if (connectedAs.value) set("connectedAs", "");
});

watch(projectKey, (next) => {
  invalidateLookups();
  issueTypes.value = [];
  set("issueTypeId", "");
  if (next && connectedAs.value) void loadIssueTypes();
});

watch(issueTypeId, (next) => {
  invalidateLookups();
  priorities.value = [];
  set("createMeta", undefined);
  set("fieldValues", {});
  set("fields", "");
  if (next && connectedAs.value) void loadFields();
});

// The saved `fields` JSON is what the server sends to Jira, so it follows every input.
watch(
  [createMeta, fieldValues],
  ([meta, values]) => {
    if (!meta) return;
    const next = JSON.stringify(
      jiraFieldsPayload(meta.requiredFields, (values ?? {}) as Credentials),
    );
    if (next !== credentials.value.fields) set("fields", next);
  },
  { deep: true },
);

const fieldOptions = (requiredField: JiraRequiredField) => toOptions(requiredField.options);

onBeforeUnmount(invalidateLookups);

onMounted(() => {
  if (!deployment.value) set("deployment", "cloud");
  // Editing a saved destination: load the lists so the dropdowns show its values.
  if (projectKey.value) void connect();
});
</script>

<template>
  <div class="flex w-full flex-col gap-2" data-test="jira-destination-fields">
    <OText variant="card-title" as="div">
      {{ t("alerts.prebuiltDestinations.jiraConnectSection") }}
    </OText>

    <template v-if="!connectedAs">
      <div class="flex flex-col gap-1 py-1">
        <OText variant="label">{{ t("alerts.prebuiltDestinations.jiraType") }}</OText>
        <OFormRadioGroup
          name="credentials.deployment"
          :label="t('alerts.prebuiltDestinations.jiraType')"
          orientation="horizontal"
          data-test="jira-deployment"
        >
          <ORadio
            value="cloud"
            :label="t('alerts.prebuiltDestinations.jiraCloud')"
            data-test="jira-deployment-cloud"
          />
          <ORadio
            value="data_center"
            :label="t('alerts.prebuiltDestinations.jiraDataCenter')"
            data-test="jira-deployment-data-center"
          />
        </OFormRadioGroup>
      </div>

      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.url"
          data-test="jira-url-input"
          :label="t('alerts.prebuiltDestinations.jiraUrl')"
          required
          :help-text="
            t('alerts.prebuiltDestinations.jiraUrlHelp', {
              example: raw('https://acme.atlassian.net'),
            })
          "
        />
      </div>
      <div v-if="isCloud" class="w-1/2 py-1">
        <OFormInput
          name="credentials.email"
          data-test="jira-email-input"
          :label="t('alerts.prebuiltDestinations.jiraEmail')"
          required
          autocomplete="username"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.token"
          data-test="jira-token-input"
          :label="
            isCloud
              ? t('alerts.prebuiltDestinations.jiraApiToken')
              : t('alerts.prebuiltDestinations.jiraPersonalAccessToken')
          "
          type="password"
          revealable
          required
          autocomplete="new-password"
          :help-text="t('alerts.prebuiltDestinations.jiraTokenTip')"
        />
      </div>

      <div class="flex flex-wrap items-center gap-3 py-1">
        <OButton
          data-test="jira-connect-button"
          variant="outline"
          size="sm"
          :loading="loading === 'connect'"
          @click="connect"
        >
          {{ t("alerts.prebuiltDestinations.jiraConnect") }}
        </OButton>
      </div>
    </template>
    <div v-else class="flex flex-wrap items-center gap-3 py-1" data-test="jira-connected-summary">
      <OText variant="meta" data-test="jira-connected-as">
        {{
          t("alerts.prebuiltDestinations.jiraConnectedSummary", {
            host,
            name: String(connectedAs),
          })
        }}
      </OText>
      <OButton data-test="jira-change-button" variant="outline" size="sm" @click="change">
        {{ t("alerts.prebuiltDestinations.jiraChange") }}
      </OButton>
    </div>
    <OBanner v-if="error" variant="error" dense data-test="jira-setup-error">{{ error }}</OBanner>

    <template v-if="connectedAs">
      <OText variant="card-title" as="div" class="mt-2">
        {{ t("alerts.prebuiltDestinations.jiraTicketsSection") }}
      </OText>
      <div class="w-1/2 py-1">
        <OFormSelect
          name="credentials.projectKey"
          data-test="jira-project-select"
          :label="t('alerts.prebuiltDestinations.jiraProject')"
          required
          :options="projectOptions"
          labelKey="label"
          valueKey="value"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormSelect
          name="credentials.issueTypeId"
          data-test="jira-issue-type-select"
          :label="t('alerts.prebuiltDestinations.jiraIssueType')"
          required
          :options="issueTypeOptions"
          labelKey="label"
          valueKey="value"
          :loading="loading === 'issue_types'"
          :help-text="t('alerts.prebuiltDestinations.jiraBehavior')"
        />
      </div>

      <!-- Holds the Priority slot while its options load, so the form does not jump. -->
      <div v-if="issueTypeId" class="w-1/2 py-1">
        <OFormSelect
          v-if="createMeta"
          name="credentials.priorityId"
          data-test="jira-priority-select"
          :label="t('alerts.prebuiltDestinations.jiraPriority')"
          :placeholder="t('alerts.prebuiltDestinations.jiraDefaultPriority')"
          clearable
          :options="priorityOptions"
          labelKey="label"
          valueKey="value"
        />
        <OSelect
          v-else
          data-test="jira-priority-loading"
          :label="t('alerts.prebuiltDestinations.jiraPriority')"
          :placeholder="t('common.loading')"
          :model-value="undefined"
          :options="[]"
          :loading="loading === 'fields'"
          disabled
        />
      </div>

      <template v-if="createMeta">
        <OBanner v-if="!createMeta.hasLabels" variant="error" dense data-test="jira-labels-missing">
          {{
            t("alerts.prebuiltDestinations.jiraLabelsMissing", {
              issueType: createMeta.issueTypeName,
              project: createMeta.projectName,
            })
          }}
        </OBanner>
        <template v-for="requiredField in createMeta.requiredFields" :key="requiredField.id">
          <OBanner
            v-if="requiredField.kind === 'unsupported'"
            variant="error"
            dense
            :data-test="`jira-unsupported-field-${requiredField.id}`"
          >
            {{
              t("alerts.prebuiltDestinations.jiraUnsupportedField", {
                field: requiredField.name,
                issueType: createMeta.issueTypeName,
              })
            }}
          </OBanner>
          <div v-else class="w-1/2 py-1">
            <OFormSelect
              v-if="requiredField.kind === 'option' || requiredField.kind === 'options'"
              :name="`credentials.fieldValues.${requiredField.id}`"
              :data-test="`jira-field-${requiredField.id}`"
              :label="raw(requiredField.name)"
              required
              :multiple="requiredField.kind === 'options'"
              :options="fieldOptions(requiredField)"
              labelKey="label"
              valueKey="value"
              :help-text="t('alerts.prebuiltDestinations.jiraRequiredFieldHelp')"
            />
            <OFormInput
              v-else
              :name="`credentials.fieldValues.${requiredField.id}`"
              :data-test="`jira-field-${requiredField.id}`"
              :label="raw(requiredField.name)"
              required
              :type="requiredField.kind === 'number' ? 'number' : 'text'"
              :help-text="t('alerts.prebuiltDestinations.jiraRequiredFieldHelp')"
            />
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
