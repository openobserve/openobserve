<template>
  <div>
    <OForm id="organization-settings-form" :form="form">
      <OFormSection
        variant="plain"
        :title="t('settings.organizationSettings.sectionTitle')"
        :description="t('settings.organizationSettings.sectionDescription')"
        data-test="organization-settings-section"
      >
        <OSettingRow
          control-at="end"
          name="traceIdFieldName"
          error-data-test="settings-org-trace-id-input-error"
          :label="t('settings.traceIdFieldName')"
          :description="t('settings.organizationSettings.traceIdHelp')"
          :loading="!settingsLoaded"
          data-test="add-role-rolename-input-btn"
        >
          <OFormInput
            data-test="settings-org-trace-id-input"
            name="traceIdFieldName"
            required
            :aria-label="t('settings.traceIdFieldName')"
          />
        </OSettingRow>

        <OSettingRow
          control-at="end"
          name="spanIdFieldName"
          error-data-test="settings-org-span-id-input-error"
          :label="t('settings.spanIdFieldName')"
          :description="t('settings.organizationSettings.spanIdHelp')"
          :loading="!settingsLoaded"
          data-test="add-role-rolename-input-btn"
        >
          <OFormInput
            data-test="settings-org-span-id-input"
            name="spanIdFieldName"
            required
            :aria-label="t('settings.spanIdFieldName')"
          />
        </OSettingRow>

        <OSettingRow
          v-if="config.isCloud !== 'true'"
          control-at="end"
          name="toggleIngestionLogs"
          :label="t('settings.toggleIngestionLogsLabel')"
          :description="t('settings.organizationSettings.ingestionLogsHelp')"
          :loading="!settingsLoaded"
          data-test="add-toggle-ingestion"
        >
          <OFormSwitch
            data-test="add-toggle-ingestion-btn"
            name="toggleIngestionLogs"
            off-tone="neutral"
            state-text
            :aria-label="t('settings.toggleIngestionLogsLabel')"
          />
        </OSettingRow>

        <OSettingRow
          control-at="end"
          name="usageStreamEnabled"
          :label="t('settings.usageStreamEnabledLabel')"
          :description="t('settings.organizationSettings.usageStreamHelp', { org: orgName })"
          :loading="!settingsLoaded"
          data-test="add-toggle-usage-stream"
        >
          <OFormSwitch
            data-test="add-toggle-usage-stream-btn"
            name="usageStreamEnabled"
            off-tone="neutral"
            state-text
            :aria-label="t('settings.usageStreamEnabledLabel')"
          />
        </OSettingRow>

        <OSettingRow
          v-if="showRedInsights"
          control-at="end"
          name="redInsightsEnabled"
          :label="t('settings.redInsightsEnabledLabel')"
          :description="t('settings.redInsightsEnabledHelp')"
          :loading="!settingsLoaded"
          data-test="settings-red-insights"
        >
          <OFormSwitch
            data-test="settings-red-insights-btn"
            name="redInsightsEnabled"
            off-tone="neutral"
            state-text
            :aria-label="t('settings.redInsightsEnabledLabel')"
          />
        </OSettingRow>

        <OSettingRow
          v-if="showRedInsights"
          control-at="end"
          name="aiRcaThreadToolOutput"
          :label="t('settings.aiRcaThreadToolOutputLabel')"
          :description="t('settings.aiRcaThreadToolOutputHelp')"
          :loading="!settingsLoaded"
          data-test="settings-ai-rca-thread-tool-output"
        >
          <OFormSwitch
            data-test="settings-ai-rca-thread-tool-output-btn"
            name="aiRcaThreadToolOutput"
            off-tone="neutral"
            state-text
            :aria-label="t('settings.aiRcaThreadToolOutputLabel')"
          />
        </OSettingRow>
      </OFormSection>

      <DataRetentionDefaults
        v-if="showDataRetentionDefaults"
        class="mt-4"
        :form="form"
        :loading="!settingsLoaded"
      />

      <template v-if="store.state.zoConfig?.enable_cross_linking">
        <OSeparator class="mt-6 mb-4" />
        <CrossLinkManager
          v-model="crossLinks"
          :title="t('crossLinks.orgConfigTitle')"
          :subtitle="t('crossLinks.orgConfigSubtitle')"
        />
      </template>

      <Teleport defer :to="SAVE_BAR_SLOT">
        <OSaveBar
          class="px-page-edge"
          form-id="organization-settings-form"
          :change-count="changes"
          :loaded="settingsLoaded"
          data-test="organization-settings-save-bar"
          save-data-test="add-alert-submit-btn"
          @discard="discardCrossLinks"
        />
      </Teleport>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { orgSettingsQuery, updateOrgSettingsMutation } from "@/services/organizations.queries";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query";
import { useStore } from "vuex";
import CrossLinkManager from "@/components/cross-linking/CrossLinkManager.vue";
import DataRetentionDefaults from "@/components/settings/DataRetentionDefaults.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSaveBar from "@/lib/forms/SaveBar/OSaveBar.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import {
  discardFormChanges,
  rebaseSavedValues,
  useFormCounts,
} from "@/lib/forms/SaveBar/formCounts";
import { useLeaveGuard } from "@/lib/forms/SaveBar/useLeaveGuard";
import config from "@/aws-exports";
import { toast } from "@/lib/feedback/Toast/useToast";
import analytics from "@/services/product_analytics";
import {
  makeOrganizationSettingsSchema,
  type OrganizationSettingsForm,
} from "./OrganizationSettings.schema";
import {
  retentionRowChanges,
  toRetentionFormValues,
  toRetentionPayload,
} from "./DataRetentionDefaults.schema";
import { SAVE_BAR_SLOT } from "./saveBarSlot";

const { t } = useI18nTyped();

const store = useStore();
const orgId = useOrgId();
const queryClient = useQueryClient();
const updateOrgSettings = useMutation(() => updateOrgSettingsMutation(orgId.value));

const organizationSettingsSchema = makeOrganizationSettingsSchema(t);

const showRedInsights = config.isEnterprise == "true";
const showDataRetentionDefaults = config.isEnterprise == "true";

const savedSettings = computed(() => store.state?.organizationData?.organizationSettings);
const settingsLoaded = computed(() => !!savedSettings.value);
const orgName = computed(() => store.state?.selectedOrganization?.label ?? "");

// The fallbacks only fill the form's shape; rows stay `loading` until the saved values exist.
const organizationSettingsDefaults = computed((): OrganizationSettingsForm => {
  const s = savedSettings.value;
  return {
    traceIdFieldName: s?.trace_id_field_name ?? "",
    spanIdFieldName: s?.span_id_field_name ?? "",
    toggleIngestionLogs: s?.toggle_ingestion_logs ?? false,
    usageStreamEnabled: s?.usage_stream_enabled ?? false,
    redInsightsEnabled: s?.red_insights_enabled ?? false,
    aiRcaThreadToolOutput: s?.ai_rca_thread_tool_output ?? false,
    ...toRetentionFormValues(s?.data_retention),
  };
});

const form = useOForm<OrganizationSettingsForm>({
  defaultValues: organizationSettingsDefaults.value,
  schema: organizationSettingsSchema,
  validateOn: "leave",
  onSubmit: (value) => saveOrgSettings(value),
});

// CrossLinkManager is a composite with no OForm* wrapper, so it is held here and merged at submit.
const savedCrossLinks = computed(() => savedSettings.value?.cross_links || []);
const crossLinks = ref(savedCrossLinks.value);
const formDirty = computed(
  () => JSON.stringify(crossLinks.value) !== JSON.stringify(savedCrossLinks.value),
);

// A stream-type row registers several fields; the bar counts one change per stream type instead.
const isRetentionRowField = (name: string) => name === "types" || name.startsWith("types[");
const fieldsWithoutRetentionRows = {
  get options() {
    return form.options;
  },
  useStore: <R,>(selector: (_state: any) => R) =>
    form.useStore((s: any) =>
      selector({
        ...s,
        fieldMeta: Object.fromEntries(
          Object.entries(s.fieldMeta).filter(([name]) => !isRetentionRowField(name)),
        ),
      }),
    ),
};
const { changes: changedScalars } = useFormCounts(fieldsWithoutRetentionRows);
const changedRetentionRows = form.useStore((s: any) =>
  retentionRowChanges(s.values.types, form.options.defaultValues?.types),
);
const changedFields = computed(() => changedScalars.value + changedRetentionRows.value);
const changes = computed(() => changedFields.value + (formDirty.value ? 1 : 0));

function discardCrossLinks() {
  crossLinks.value = savedCrossLinks.value;
}

useLeaveGuard(() => changes.value > 0, {
  count: () => changes.value,
  onDiscard: () => {
    discardFormChanges(form);
    discardCrossLinks();
  },
});

// Saved values that arrive or change under the page replace only what the user has not edited.
watch(organizationSettingsDefaults, (saved) => {
  if (changedFields.value === 0) form.reset(saved);
});

watch(savedCrossLinks, (saved, previous) => {
  if (JSON.stringify(crossLinks.value) === JSON.stringify(previous)) crossLinks.value = saved;
});

const saveOrgSettings = async (value: OrganizationSettingsForm) => {
  const savedOrg = store.state?.selectedOrganization?.identifier;
  // Held as sent: links edited while the request is pending are not saved yet.
  const sentCrossLinks = crossLinks.value;
  try {
    const payload: any = {
      trace_id_field_name: value.traceIdFieldName,
      span_id_field_name: value.spanIdFieldName,
      toggle_ingestion_logs: value.toggleIngestionLogs,
      cross_links: sentCrossLinks,
      usage_stream_enabled: value.usageStreamEnabled,
    };

    // A hidden enterprise-only field must not overwrite the stored one.
    if (showRedInsights) {
      payload.red_insights_enabled = value.redInsightsEnabled;
      payload.ai_rca_thread_tool_output = value.aiRcaThreadToolOutput;
    }
    if (showDataRetentionDefaults) payload.data_retention = toRetentionPayload(value);

    const crossLinksChanged = formDirty.value;

    await updateOrgSettings.mutateAsync(payload);
    if (crossLinksChanged) analytics.track("cross_link_saved", { scope: "org" });
    // Only the server knows the resolved days; a failed re-read must not report the save as failed.
    const fresh: any =
      showDataRetentionDefaults && savedOrg
        ? await queryClient.fetchQuery(orgSettingsQuery(savedOrg)).catch(() => null)
        : null;
    // The store holds only the selected organization: a save that outlives a switch has nowhere to land.
    if (store.state?.selectedOrganization?.identifier !== savedOrg) return;

    const updatedSettings: any = {
      ...store.state?.organizationData?.organizationSettings,
      trace_id_field_name: value.traceIdFieldName,
      span_id_field_name: value.spanIdFieldName,
      toggle_ingestion_logs: value.toggleIngestionLogs,
      cross_links: sentCrossLinks,
      usage_stream_enabled: value.usageStreamEnabled,
      ...(showRedInsights
        ? {
            red_insights_enabled: value.redInsightsEnabled,
            ai_rca_thread_tool_output: value.aiRcaThreadToolOutput,
          }
        : {}),
    };
    if (showDataRetentionDefaults) {
      updatedSettings.data_retention = fresh?.data?.data_retention ?? payload.data_retention;
      if (fresh) updatedSettings.resolved_data_retention = fresh.resolved_data_retention;
    }

    store.dispatch("setOrganizationSettings", updatedSettings);
    rebaseSavedValues(form, value, value);

    toast({
      message: t("settings.organizationSettings.settingsUpdated"),
      variant: "success",
    });
  } catch (e: any) {
    toast({
      message:
        raw(e?.response?.data?.message) ||
        raw(e?.message) ||
        t("settings.organizationSettings.settingsSaveError"),
      variant: "error",
    });
  }
};

// Exposed for unit tests that exercise the submit handler directly.
defineExpose({
  crossLinks,
  formDirty,
  saveOrgSettings,
  organizationSettingsSchema,
  organizationSettingsDefaults,
});
</script>
