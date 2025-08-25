<template>
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
      <q-input
        v-model.trim="traceIdFieldName"
        :label="t('settings.traceIdFieldName') + ' *'"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
        outlined
        stack-label
        filled
        dense
        :rules="[
          (val: string) =>
            !!val
              ? isValidTraceField ||
                `Use alphanumeric and '+=,.@-_' characters only, without spaces.`
              : t('common.nameRequired'),
        ]"
      >
        <template v-slot:hint>
          Use alphanumeric and '+=,.@-_' characters only, without spaces.
        </template>
      </q-input>
    </div>

    <div
      data-test="add-role-rolename-input-btn"
      class="span-id-field-name o2-input"
    >
      <q-input
        v-model.trim="spanIdFieldName"
        :label="t('settings.spanIdFieldName') + ' *'"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
        stack-label
        outlined
        filled
        dense
        :rules="[
          (val: string) =>
            !!val
              ? isValidSpanField ||
                `Use alphanumeric and '+=,.@-_' characters only, without spaces.`
              : t('common.nameRequired'),
        ]"
        @update:model-value="updateFieldName('span')"
      >
        <template v-slot:hint>
          Use alphanumeric and '+=,.@-_' characters only, without spaces.
        </template>
      </q-input>
    </div>

    <div data-test="add-toggle-ingestion" class="span-id-field-name o2-input">
      <q-toggle
        data-test="add-toggle-ingestion-btn"
        v-model="toggleIngestionLogs"
        :label="t('settings.toggleIngestionLogsLabel')"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
        stack-label
        outlined
        filled
        dense
      >
      </q-toggle>
    </div>

    <div class="flex justify-start q-mt-lg">
      <q-btn
        data-test="add-alert-cancel-btn"
        v-close-popup="true"
        class="q-mr-md o2-secondary-button tw-h-[36px]"
        :label="t('alerts.cancel')"
        no-caps
        flat
        :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
        @click="$emit('cancel:hideform')"
      />
      <q-btn
        data-test="add-alert-submit-btn"
        :label="t('alerts.save')"
        class="o2-primary-button no-border tw-h-[36px]"
        type="submit"
        no-caps
        flat
        :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
        @click="saveOrgSettings"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import organizations from "@/services/organizations";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

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
const toggleIngestionLogs = ref(
  store.state?.organizationData?.organizationSettings?.toggle_ingestion_logs ||
    false,
);

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

const saveOrgSettings = async () => {
  try {
    await organizations.post_organization_settings(
      store.state.selectedOrganization.identifier,
      {
        trace_id_field_name: traceIdFieldName.value,
        span_id_field_name: spanIdFieldName.value,
        toggle_ingestion_logs: toggleIngestionLogs.value,
      },
    );

    store.dispatch("setOrganizationSettings", {
      ...store.state?.organizationData?.organizationSettings,
      trace_id_field_name: traceIdFieldName.value,
      span_id_field_name: spanIdFieldName.value,
      toggle_ingestion_logs: toggleIngestionLogs.value,
    });

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
