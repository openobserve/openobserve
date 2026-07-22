<template>
  <div>
    <!-- Section header is provided full-width by the Settings shell. The page
         gutter is owned by ConstrainedPage; this page adds none of its own. -->
    <div class="pb-3">
      <div class="text-base font-bold">
        {{ t("settings.logDetails") }}
      </div>
    </div>

    <OForm
      id="organization-settings-form"
      class="mb-3"
      :schema="organizationSettingsSchema"
      :default-values="organizationSettingsDefaults"
      @submit="saveOrgSettings"
      v-slot="{ isSubmitting }"
    >
      <div data-test="add-role-rolename-input-btn" class="trace-id-field-name o2-input mb-2 w-100">
        <OFormInput
          data-test="settings-org-trace-id-input"
          name="traceIdFieldName"
          :label="t('settings.traceIdFieldName')"
          required
          class="py-3 showLabelOnTop"
          :help-text="t('settings.organizationSettings.fieldNameHelp')"
        />
      </div>

      <div data-test="add-role-rolename-input-btn" class="span-id-field-name o2-input w-100">
        <OFormInput
          data-test="settings-org-span-id-input"
          name="spanIdFieldName"
          :label="t('settings.spanIdFieldName')"
          required
          class="py-3 showLabelOnTop"
          :help-text="t('settings.organizationSettings.fieldNameHelp')"
        />
      </div>

      <div
        v-if="config.isCloud !== 'true'"
        data-test="add-toggle-ingestion"
        class="span-id-field-name o2-input w-100"
      >
        <OFormSwitch
          data-test="add-toggle-ingestion-btn"
          name="toggleIngestionLogs"
          :label="t('settings.toggleIngestionLogsLabel')"
          class="mt-2"
        />
      </div>

      <div data-test="add-toggle-usage-stream" class="o2-input">
        <OFormSwitch
          data-test="add-toggle-usage-stream-btn"
          name="usageStreamEnabled"
          :label="t('settings.usageStreamEnabledLabel')"
          class="mt-2"
        />
      </div>

      <!-- Cross-Linking Configuration -->
      <template v-if="store.state.zoConfig?.enable_cross_linking">
        <OSeparator class="mt-6 mb-4" />
        <CrossLinkManager
          v-model="crossLinks"
          :title="t('crossLinks.orgConfigTitle')"
          :subtitle="t('crossLinks.orgConfigSubtitle')"
          @change="formDirty = true"
        />
      </template>

      <div class="flex gap-2 mt-3">
        <!-- <OButton
        data-test="add-alert-cancel-btn"
        variant="outline"
        size="sm-action"
        @click="$emit('cancel:hideform')"
      >{{ t('alerts.cancel') }}</OButton> -->
        <OButton
          data-test="add-alert-submit-btn"
          variant="primary"
          size="sm-action"
          type="submit"
          :loading="isSubmitting"
          >{{ t("alerts.save") }}</OButton
        >
      </div>
    </OForm>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import organizations from "@/services/organizations";
import { useStore } from "vuex";
import CrossLinkManager from "@/components/cross-linking/CrossLinkManager.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import config from "@/aws-exports";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeOrganizationSettingsSchema,
  type OrganizationSettingsForm,
} from "./OrganizationSettings.schema";

const { t } = useI18n();

const store = useStore();

// Schema-driven validation replaces the hand-rolled validate()/error refs.
const organizationSettingsSchema = makeOrganizationSettingsSchema(t);

// CrossLinkManager has no OForm* equivalent (composite) — kept as local state
// and merged at submit (the documented exception).
const crossLinks = ref(store.state?.organizationData?.organizationSettings?.cross_links || []);
const formDirty = ref(false);

// Dynamic defaults (edit-prefill from the store) → a typed computed. The trace/
// span/toggle values are form-owned (OFormInput / OFormSwitch).
const organizationSettingsDefaults = computed((): OrganizationSettingsForm => {
  const s = store.state?.organizationData?.organizationSettings;
  return {
    traceIdFieldName: s?.trace_id_field_name ?? "",
    spanIdFieldName: s?.span_id_field_name ?? "",
    toggleIngestionLogs: s?.toggle_ingestion_logs ?? false,
    usageStreamEnabled: s?.usage_stream_enabled ?? false,
  };
});

watch(
  () => store.state?.organizationData?.organizationSettings?.cross_links,
  (newVal) => {
    if (!formDirty.value) {
      crossLinks.value = newVal || [];
    }
  },
);

// @submit fires only once the schema passes (both field names required + regex),
// so the old validateOrgSettings()/error refs are gone. Awaited by OForm so the
// inline Save button's spinner spans the POST.
const saveOrgSettings = async (value: OrganizationSettingsForm) => {
  try {
    const payload: any = {
      trace_id_field_name: value.traceIdFieldName,
      span_id_field_name: value.spanIdFieldName,
      toggle_ingestion_logs: value.toggleIngestionLogs,
      cross_links: crossLinks.value,
      usage_stream_enabled: value.usageStreamEnabled,
    };

    await organizations.post_organization_settings(
      store.state.selectedOrganization.identifier,
      payload,
    );

    const updatedSettings: any = {
      ...store.state?.organizationData?.organizationSettings,
      trace_id_field_name: value.traceIdFieldName,
      span_id_field_name: value.spanIdFieldName,
      toggle_ingestion_logs: value.toggleIngestionLogs,
      cross_links: crossLinks.value,
      usage_stream_enabled: value.usageStreamEnabled,
    };

    store.dispatch("setOrganizationSettings", updatedSettings);

    formDirty.value = false;

    toast({
      message: t("settings.organizationSettings.settingsUpdated"),
      variant: "success",
    });
  } catch (e: any) {
    toast({
      message: e?.message || t("settings.organizationSettings.settingsSaveError"),
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
