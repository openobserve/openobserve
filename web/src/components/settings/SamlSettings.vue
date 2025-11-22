<template>
  <div class="q-pa-md">
    <div class="q-gutter-md">
      <div class="text-h6 q-mb-md">SAML Authentication Configuration</div>

      <q-toggle
        v-model="config.enabled"
        label="Enable SAML Authentication"
        color="primary"
      />

      <q-input
        v-model="config.sp_entity_id"
        label="Service Provider Entity ID *"
        outlined
        dense
        :disable="!config.enabled"
        hint="Unique identifier for OpenObserve as Service Provider"
      />

      <q-input
        v-model="config.acs_url"
        label="Assertion Consumer Service (ACS) URL *"
        outlined
        dense
        :disable="!config.enabled"
        hint="Callback URL where SAML responses are sent"
      />

      <q-input
        v-model="config.idp_metadata_xml"
        label="Identity Provider Metadata XML *"
        type="textarea"
        outlined
        rows="10"
        :disable="!config.enabled"
        hint="Paste the complete IdP metadata XML from AWS SSO or your SAML provider"
      />

      <q-input
        v-model="config.default_org"
        label="Default Organization"
        outlined
        dense
        :disable="!config.enabled"
        hint="Default organization for new SAML users"
      />

      <q-select
        v-model="config.default_role"
        :options="roleOptions"
        label="Default Role"
        outlined
        dense
        :disable="!config.enabled"
        hint="Default role assigned to new SAML users"
      />

      <q-input
        v-model="config.email_attribute"
        label="Email Attribute Name"
        outlined
        dense
        :disable="!config.enabled"
        hint="SAML attribute name containing user's email"
      />

      <q-input
        v-model="config.name_attribute"
        label="Name Attribute"
        outlined
        dense
        :disable="!config.enabled"
        hint="SAML attribute name containing user's display name"
      />

      <q-toggle
        v-model="config.allow_idp_initiated"
        label="Allow IdP-Initiated Login"
        color="primary"
        :disable="!config.enabled"
      />

      <div class="q-mt-md">
        <q-btn
          label="Save Configuration"
          color="primary"
          @click="saveConfig"
          :loading="saving"
          :disable="!config.enabled || !isValid"
        />
        <q-btn
          label="Test Connection"
          color="secondary"
          class="q-ml-sm"
          @click="testConnection"
          :disable="!config.enabled || !isValid"
        />
        <q-btn
          label="Delete Configuration"
          color="negative"
          flat
          class="q-ml-sm"
          @click="deleteConfig"
          :disable="!hasConfig"
        />
      </div>

      <div v-if="config.enabled && isValid" class="q-mt-md bg-grey-2 q-pa-md">
        <div class="text-subtitle2 q-mb-sm">Integration Instructions:</div>
        <ol class="text-body2">
          <li>Copy your SP Metadata URL: <code>{{ metadataUrl }}</code></li>
          <li>Configure this in your AWS SSO / SAML IdP</li>
          <li>Paste the IdP metadata XML above</li>
          <li>Save and test the connection</li>
        </ol>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from "vue";
import { useQuasar } from "quasar";
import settingsService from "@/services/settings";

export default defineComponent({
  name: "SamlSettings",
  setup() {
    const $q = useQuasar();
    const saving = ref(false);
    const hasConfig = ref(false);

    const config = ref({
      enabled: false,
      sp_entity_id: "",
      acs_url: "",
      idp_metadata_xml: "",
      default_org: "default",
      default_role: "admin",
      email_attribute: "email",
      name_attribute: "name",
      allow_idp_initiated: true,
    });

    const roleOptions = ["admin", "editor", "viewer"];

    const isValid = computed(() => {
      return (
        config.value.sp_entity_id.trim() !== "" &&
        config.value.acs_url.trim() !== "" &&
        config.value.idp_metadata_xml.trim() !== ""
      );
    });

    const metadataUrl = computed(() => {
      const baseUrl = window.location.origin;
      return `${baseUrl}/auth/saml/metadata`;
    });

    const loadConfig = async () => {
      try {
        const response = await settingsService.get_saml_config();
        if (response.data) {
          config.value = { ...config.value, ...response.data };
          hasConfig.value = true;
        }
      } catch (error: any) {
        if (error.response?.status !== 404) {
          console.error("Error loading SAML config:", error);
        }
        // 404 is expected if config doesn't exist yet
      }
    };

    const saveConfig = async () => {
      if (!isValid.value) {
        $q.notify({
          type: "warning",
          message: "Please fill all required fields",
        });
        return;
      }

      saving.value = true;
      try {
        await settingsService.update_saml_config(config.value);
        hasConfig.value = true;
        $q.notify({
          type: "positive",
          message: "SAML configuration saved successfully",
        });
      } catch (error: any) {
        $q.notify({
          type: "negative",
          message: `Error saving configuration: ${error.response?.data?.message || error.message}`,
        });
      } finally {
        saving.value = false;
      }
    };

    const testConnection = () => {
      const loginUrl = `${window.location.origin}/auth/saml/login`;
      window.open(loginUrl, "_blank");
    };

    const deleteConfig = async () => {
      $q.dialog({
        title: "Confirm Deletion",
        message: "Are you sure you want to delete the SAML configuration? This will disable SAML authentication.",
        cancel: true,
        persistent: true,
      }).onOk(async () => {
        try {
          await settingsService.delete_saml_config();
          config.value = {
            enabled: false,
            sp_entity_id: "",
            acs_url: "",
            idp_metadata_xml: "",
            default_org: "default",
            default_role: "admin",
            email_attribute: "email",
            name_attribute: "name",
            allow_idp_initiated: true,
          };
          hasConfig.value = false;
          $q.notify({
            type: "positive",
            message: "SAML configuration deleted successfully",
          });
        } catch (error: any) {
          $q.notify({
            type: "negative",
            message: `Error deleting configuration: ${error.response?.data?.message || error.message}`,
          });
        }
      });
    };

    onMounted(() => {
      loadConfig();
    });

    return {
      config,
      roleOptions,
      saving,
      hasConfig,
      isValid,
      metadataUrl,
      saveConfig,
      testConnection,
      deleteConfig,
    };
  },
});
</script>
