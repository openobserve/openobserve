<template>
  <div>
    <div class="q-px-md q-pt-md q-pb-md">
      <div class="text-body1 text-bold">
        {{ t("settings.logDetails") }}
      </div>
    </div>

    <div class="q-mx-md q-mb-md">
    <div
      data-test="add-role-rolename-input-btn"
      class="trace-id-field-name o2-input q-mb-sm"
    >
      <OInput
        v-model.trim="traceIdFieldName"
        :label="t('settings.traceIdFieldName') + ' *'"
        class="q-py-md showLabelOnTop"
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
        v-model.trim="spanIdFieldName"
        :label="t('settings.spanIdFieldName') + ' *'"
        class="q-py-md showLabelOnTop"
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
        class="q-mt-sm"
      />
    </div>

    <div data-test="add-toggle-usage-stream" class="o2-input">
      <OSwitch
        data-test="add-toggle-usage-stream-btn"
        v-model="usageStreamEnabled"
        :label="t('settings.usageStreamEnabledLabel')"
        class="q-mt-sm"
      />
    </div>

    <!-- Cross-Linking Configuration -->
    <template v-if="store.state.zoConfig?.enable_cross_linking">
      <q-separator class="q-mt-lg q-mb-md" />
      <CrossLinkManager
        v-model="crossLinks"
        :title="t('crossLinks.orgConfigTitle')"
        :subtitle="t('crossLinks.orgConfigSubtitle')"
        @change="formDirty = true"
      />
    </template>

    <div class="tw:flex tw:gap-2 q-mt-md">
      <OButton
        data-test="add-alert-cancel-btn"
        variant="outline"
        size="sm-action"
        @click="$emit('cancel:hideform')"
      >{{ t('alerts.cancel') }}</OButton>
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
import { useQuasar } from "quasar";
import CrossLinkManager from "@/components/cross-linking/CrossLinkManager.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import config from "@/aws-exports";

const { t } = useI18n();

const store = useStore();

const traceIdFieldName = ref(
  store.state?.organizationData?.organizationSettings?.trace_id_field_name,
);

const spanIdFieldName = ref(
  store.state?.organizationData?.organizationSettings?.span_id_field_name,
);

const q = useQuasar();

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
    crossLinks.value = newVal || [];
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

    q.notify({
      message: "Organization settings updated successfully",
      color: "positive",
      position: "bottom",
      timeout: 3000,
    });
  } catch (e: any) {
    q.notify({
      message: e?.message || "Error saving organization settings",
      color: "negative",
      position: "bottom",
      timeout: 3000,
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
