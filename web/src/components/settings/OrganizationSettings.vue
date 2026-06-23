<template>
  <div>
    <!-- Section header is provided full-width by the Settings shell. The page
         gutter is owned by ConstrainedPage; this page adds none of its own. -->
    <div class="tw:pb-3">
      <div class="tw:text-base tw:font-bold">
        {{ t("settings.logDetails") }}
      </div>
    </div>

    <div class="tw:mb-3">
    <div
      data-test="add-role-rolename-input-btn"
      class="trace-id-field-name o2-input tw:mb-2"
    >
      <OInput
        data-test="settings-org-trace-id-input"
        v-model.trim="traceIdFieldName"
        :label="t('settings.traceIdFieldName') + ' *'"
        class="tw:py-3 showLabelOnTop"
        :error="!!traceIdFieldNameError"
        :error-message="traceIdFieldNameError"
        help-text="Use alphanumeric and '+=,.@-_' characters only, without spaces."
        @update:model-value="updateFieldName('trace'); traceIdFieldNameError = ''"
      />
    </div>

    <div
      data-test="add-role-rolename-input-btn"
      class="span-id-field-name o2-input"
    >
      <OInput
        data-test="settings-org-span-id-input"
        v-model.trim="spanIdFieldName"
        :label="t('settings.spanIdFieldName') + ' *'"
        class="tw:py-3 showLabelOnTop"
        :error="!!spanIdFieldNameError"
        :error-message="spanIdFieldNameError"
        help-text="Use alphanumeric and '+=,.@-_' characters only, without spaces."
        @update:model-value="updateFieldName('span'); spanIdFieldNameError = ''"
      />
    </div>

    <div v-if="config.isCloud !== 'true'" data-test="add-toggle-ingestion" class="span-id-field-name o2-input">
      <OSwitch
        data-test="add-toggle-ingestion-btn"
        v-model="toggleIngestionLogs"
        :label="t('settings.toggleIngestionLogsLabel')"
        class="tw:mt-2"
      />
    </div>

    <div data-test="add-toggle-usage-stream" class="o2-input">
      <OSwitch
        data-test="add-toggle-usage-stream-btn"
        v-model="usageStreamEnabled"
        :label="t('settings.usageStreamEnabledLabel')"
        class="tw:mt-2"
      />
    </div>

    <!-- Cross-Linking Configuration -->
    <template v-if="store.state.zoConfig?.enable_cross_linking">
      <OSeparator class="tw:mt-6 tw:mb-4" />
      <CrossLinkManager
        v-model="crossLinks"
        :title="t('crossLinks.orgConfigTitle')"
        :subtitle="t('crossLinks.orgConfigSubtitle')"
        @change="formDirty = true"
      />
    </template>

    <div class="tw:flex tw:gap-2 tw:mt-3">
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
        @click="saveOrgSettings"
      >{{ t('alerts.save') }}</OButton>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import organizations from "@/services/organizations";
import { useStore } from "vuex";
import CrossLinkManager from "@/components/cross-linking/CrossLinkManager.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import config from "@/aws-exports";
import { toast } from "@/lib/feedback/Toast/useToast";

const { t } = useI18n();

const store = useStore();

const traceIdFieldName = ref(
  store.state?.organizationData?.organizationSettings?.trace_id_field_name,
);

const spanIdFieldName = ref(
  store.state?.organizationData?.organizationSettings?.span_id_field_name,
);


const isValidSpanField = ref(true);
const isValidTraceField = ref(true);
const traceIdFieldNameError = ref('');
const spanIdFieldNameError = ref('');
const toggleIngestionLogs = ref(
  store.state?.organizationData?.organizationSettings?.toggle_ingestion_logs ||
    false,
);
const usageStreamEnabled = ref(
  store.state?.organizationData?.organizationSettings?.usage_stream_enabled ||
    false,
);
const crossLinks = ref(
  store.state?.organizationData?.organizationSettings?.cross_links || [],
);

watch(
  () => store.state?.organizationData?.organizationSettings?.cross_links,
  (newVal) => {
    if (!formDirty.value) {
      crossLinks.value = newVal || [];
    }
  },
);
const formDirty = ref(false);

const isValidRoleName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;
  // Check if the role name is valid
  return roleNameRegex.test(traceIdFieldName.value);
});

const validateFieldName = (value: string) => {
  const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;
  // Check if the role name is valid
  return roleNameRegex.test(value);
};

const updateFieldName = (fieldName: string) => {
  if (fieldName === "span")
    isValidSpanField.value = validateFieldName(spanIdFieldName.value);

  if (fieldName === "trace")
    isValidTraceField.value = validateFieldName(traceIdFieldName.value);
};

const validateOrgSettings = () => {
  let valid = true;
  if (!traceIdFieldName.value) {
    traceIdFieldNameError.value = t('common.nameRequired');
    valid = false;
  } else if (!isValidTraceField.value) {
    traceIdFieldNameError.value = `Use alphanumeric and '+=,.@-_' characters only, without spaces.`;
    valid = false;
  }
  if (!spanIdFieldName.value) {
    spanIdFieldNameError.value = t('common.nameRequired');
    valid = false;
  } else if (!isValidSpanField.value) {
    spanIdFieldNameError.value = `Use alphanumeric and '+=,.@-_' characters only, without spaces.`;
    valid = false;
  }
  return valid;
};

const saveOrgSettings = async () => {
  if (!validateOrgSettings()) return;
  try {
    const payload: any = {
      trace_id_field_name: traceIdFieldName.value,
      span_id_field_name: spanIdFieldName.value,
      toggle_ingestion_logs: toggleIngestionLogs.value,
      cross_links: crossLinks.value,
      usage_stream_enabled: usageStreamEnabled.value,
    };

    await organizations.post_organization_settings(
      store.state.selectedOrganization.identifier,
      payload,
    );

    const updatedSettings: any = {
      ...store.state?.organizationData?.organizationSettings,
      trace_id_field_name: traceIdFieldName.value,
      span_id_field_name: spanIdFieldName.value,
      toggle_ingestion_logs: toggleIngestionLogs.value,
      cross_links: crossLinks.value,
      usage_stream_enabled: usageStreamEnabled.value,
    };

    store.dispatch("setOrganizationSettings", updatedSettings);

    formDirty.value = false;

    toast({
      message: "Organization settings updated successfully",
      variant: "success",
    });
  } catch (e: any) {
    toast({
      message: e?.message || "Error saving organization settings",
      variant: "error",
    });
  }
};
</script>

<style scoped lang="scss">
.trace-id-field-name,
.span-id-field-name {
  width: 400px;
}
</style>
