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
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="q-pa-none storage-settings-editor">
    <!-- Header -->
    <div class="row items-center no-wrap card-container  q-px-md tw:mb-[0.675rem]">
      <div class="flex items-center tw:h-[60px]">
        <div
          data-test="storage-settings-editor-back-btn"
          class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius q-mr-sm"
          :title="t('storage_settings.goBack')"
          @click="emit('cancel')"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
        <div class="text-h6" data-test="storage-settings-editor-title">
          {{ isEditMode ? t("storage_settings.updateStorage") : t("storage_settings.newStorageConfiguration") }}
        </div>
      </div>
    </div>

    <!-- Stepper -->
    <div class="card-container tw:h-[calc(100vh-7rem)] tw:py-2 q-px-md tw:overflow-auto">
    <div style="max-width: 720px;">
      <q-form ref="storageForm" @submit="submitStorage">
        <q-stepper
          v-model="step"
          ref="stepper"
          color="primary"
          animated
          flat
          class="modern-stepper"
        >
          <!-- Step 1: Choose Provider -->
          <q-step
            :name="1"
            title="Choose Type"
            icon="cloud"
            :done="step > 1"
            :header-nav="step > 1 && !isEditMode"
          >
            <div class="text-body2 text-grey q-mb-md">
              {{ t("storage_settings.selectProviderDesc") }}
              once configured, all new data for this org will be written to your
              own storage infrastructure.
            </div>
            <div
              v-if="!isEditMode"
              class="tw:flex tw:items-start tw:gap-[10px] tw:px-3 tw:py-[10px] q-mb-md tw:rounded-[10px] tw:border"
              :class="store.state.theme === 'dark'
                ? 'tw:bg-amber-950/20 tw:border-amber-400/30'
                : 'tw:bg-amber-50 tw:border-amber-300'"
            >
              <OIcon name="warning" size="sm" class="tw:flex-shrink-0 tw:mt-px" />
              <div class="tw:text-[0.82rem] tw:leading-[1.55] tw:text-[var(--o2-text-primary)]">
                This action is <strong>irreversible</strong>. Once set, you cannot switch to a different storage provider or delete this configuration. To use a different provider, you must create a new organization.
              </div>
            </div>
            <div
              v-if="!isEditMode"
              class="tw:flex tw:items-start tw:gap-[10px] tw:px-3 tw:py-[10px] q-mb-md tw:rounded-[10px] tw:border"
              :class="store.state.theme === 'dark'
                ? 'tw:bg-blue-950/20 tw:border-blue-400/20'
                : 'tw:bg-blue-50 tw:border-blue-200'"
            >
              <OIcon name="info" size="sm" class="tw:flex-shrink-0 tw:mt-px" />
              <div class="tw:text-[0.82rem] tw:leading-[1.55] tw:text-[var(--o2-text-primary)]">
                Once configured, only credential fields can be updated. All other fields will be locked.
              </div>
            </div>
            <div class="text-subtitle2 q-mb-sm" style="font-weight: 500">
              Select Storage Provider <span class="text-red">*</span>
            </div>
            <div class="destination-type-grid">
              <div
                v-for="provider in availableProviders"
                :key="provider.value"
                :data-test="`storage-settings-provider-card-${provider.value}`"
                class="destination-type-card"
                :class="{
                  selected: selectedProvider === provider.value,
                  'dark-mode': store.state.theme === 'dark',
                }"
                @click="selectedProvider = provider.value"
              >
                <img
                  v-if="provider.image"
                  :src="provider.image"
                  :alt="provider.label"
                  class="card-image"
                />
                <OIcon
                  v-else
                  :name="provider.icon"
                  size="28px"
                  class="card-icon"
                />
                <div class="card-label">{{ provider.label }}</div>
                <div
                  v-if="selectedProvider === provider.value"
                  class="check-icon"
                >
                  <OIcon name="check-circle" size="md" />
                </div>
              </div>
            </div>
          </q-step>

          <!-- Step 2: Connection Details -->
          <q-step
            :name="2"
            title="Connection"
            icon="settings_ethernet"
            :done="step > 2"
            :header-nav="step > 2"
          >
            <div class="q-gutter-sm">
              <!-- AwsCredentials Fields -->
              <template v-if="selectedProvider === 'AwsCredentials'">
                <q-input
                  v-if="!isCloud"
                  data-test="storage-settings-server-url-input"
                  v-model="formData.server_url"
                  label="Server URL"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode"
                />
                <q-input
                  data-test="storage-settings-region-input"
                  v-model="formData.region"
                  label="Region"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode || !!cloudRegion"
                />
                <q-input
                  data-test="storage-settings-bucket-name-input"
                  v-model="formData.bucket_name"
                  label="Bucket Name *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode"
                  :rules="[
                    (val: any) =>
                      !!val?.trim() || t('storage_settings.bucketNameRequired'),
                  ]"
                />
                <q-input
                  data-test="storage-settings-access-key-input"
                  v-model="formData.access_key"
                  label="Access Key *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :rules="[
                    (val: any) =>
                      !!val?.trim() || t('storage_settings.accessKeyRequired'),
                  ]"
                />
                <q-input
                  data-test="storage-settings-secret-key-input"
                  v-model="formData.secret_key"
                  label="Secret Key *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  type="password"
                  :rules="[
                    (val: any) =>
                      !!val?.trim() || t('storage_settings.secretKeyRequired'),
                  ]"
                />
              </template>

              <!-- AzureCredentials Fields -->
              <template v-if="selectedProvider === 'AzureCredentials'">
                <q-input
                  data-test="storage-settings-access-key-input"
                  v-model="formData.storage_account"
                  label="Storage Account Name *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode"
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.storageAccountRequired')]"
                />
                <q-input
                  data-test="storage-settings-bucket-name-input"
                  v-model="formData.bucket_name"
                  label="Bucket Name *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode"
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.bucketNameRequired')]"
                />
                <q-input
                  data-test="storage-settings-secret-key-input"
                  v-model="formData.secret_key"
                  label="Secret Key *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  type="password"
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.secretKeyRequired')]"
                />
                <q-input
                  v-if="!isCloud"
                  data-test="storage-settings-server-url-input"
                  v-model="formData.server_url"
                  label="Server URL"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode"
                />
              </template>

              <!-- GcpCredentials Fields -->
              <template v-if="selectedProvider === 'GcpCredentials'">
                <q-input
                  data-test="storage-settings-bucket-name-input"
                  v-model="formData.bucket_name"
                  label="Bucket Name *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode"
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.bucketNameRequired')]"
                />
                <q-input
                  data-test="storage-settings-access-key-input"
                  v-model="formData.access_key"
                  label="Access Key *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.accessKeyRequired')]"
                />
                <q-input
                  v-if="!isCloud"
                  data-test="storage-settings-server-url-input"
                  v-model="formData.server_url"
                  label="Server URL"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode"
                />
              </template>

              <!-- AwsRoleArn Fields -->
              <template v-if="selectedProvider === 'AwsRoleArn'">
                <div
                  class="tw:flex tw:items-start tw:gap-[10px] tw:px-3 tw:py-[10px] q-mb-md tw:rounded-[10px] tw:border"
                  :class="store.state.theme === 'dark'
                    ? 'tw:bg-blue-950/20 tw:border-blue-400/20'
                    : 'tw:bg-blue-50 tw:border-blue-200'"
                >
                  <OIcon name="info" size="sm" class="tw:flex-shrink-0 tw:mt-px" />
                  <div class="tw:text-[0.82rem] tw:leading-[1.55] tw:text-[var(--o2-text-primary)]">
                    <template v-if="isCloud">
                      {{ t("storage_settings.awsStsCloudInfo") }}
                    </template>
                    <template v-else>
                      {{ t("storage_settings.awsStsSelfHostedInfo") }}
                    </template>
                  </div>
                </div>
                <q-input
                  data-test="storage-settings-bucket-name-input"
                  v-model="formData.bucket_name"
                  label="Bucket Name *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode"
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.bucketNameRequired')]"
                />
                <q-input
                  data-test="storage-settings-region-input"
                  v-model="formData.region"
                  label="Region *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :disable="isEditMode || !!cloudRegion"
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.regionRequired')]"
                />
                <q-input
                  data-test="storage-settings-role-arn-input"
                  v-model="formData.role_arn"
                  label="Role ARN *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.roleARNRequired')]"
                />
                <q-input
                  data-test="storage-settings-role-external-id-input"
                  v-model="formData.external_id"
                  label="External Id *"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  :rules="[(val: any) => !!val?.trim() || t('storage_settings.externalIdRequired')]"
                />
              </template>
            </div>
          </q-step>
        </q-stepper>

        <!-- Form buttons -->
        <div class="flex justify-start q-mb-md">
          <div v-if="step === 1">
            <OButton
              data-test="step1-cancel-btn"
              variant="outline"
              class="o2-secondary-button tw:h-[36px] q-mr-sm"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-secondary-button-dark'
                  : 'o2-secondary-button-light'
              "
              @click="emit('cancel')"
            >
              {{ t("alerts.cancel") }}
            </OButton>
            <OButton
              data-test="step1-continue-btn"
              variant="primary"
              class="no-border o2-primary-button tw:h-[36px]"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-primary-button-dark'
                  : 'o2-primary-button-light'
              "
              :disabled="!canProceedStep1"
              @click="nextStep"
            >
              {{ t("storage_settings.continue") }}
            </OButton>
          </div>
          <div v-if="step > 1">
            <OButton
              v-if="!isEditMode"
              data-test="step2-back-btn"
              variant="outline"
              class="o2-secondary-button tw:h-[36px] q-mr-sm"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-secondary-button-dark'
                  : 'o2-secondary-button-light'
              "
              @click="prevStep"
            >
              {{ t("storage_settings.back") }}
            </OButton>
            <OButton
              data-test="step2-cancel-btn"
              variant="outline"
              class="o2-secondary-button tw:h-[36px]"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-secondary-button-dark'
                  : 'o2-secondary-button-light'
              "
              @click="emit('cancel')"
            >
              {{ t("alerts.cancel") }}
            </OButton>
            <OButton
              data-test="storage-settings-submit-btn"
              variant="primary"
              class="no-border q-ml-sm o2-primary-button tw:h-[36px]"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-primary-button-dark'
                  : 'o2-primary-button-light'
              "
              type="submit"
            >
              {{ isEditMode ? t("storage_settings.update") : t("storage_settings.save") }}
            </OButton>
          </div>
        </div>
      </q-form>
    </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, reactive, watch } from "vue";

defineOptions({ name: "OrgStorageEditor" });
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import config from "@/aws-exports";
import orgStorageService from "@/services/org_storage";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps<{
  action: "add" | "edit";
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "saved"): void;
}>();

const store = useStore();
const { t } = useI18n();
const $q = useQuasar();

const step = ref(1);
const storageForm = ref(null);
const selectedProvider = ref("");
const existingConfig = ref<any>(null);

const isEditMode = computed(() => props.action === "edit");
const isCloud = computed(() => config.isCloud === "true");

const formData = reactive({
  bucket_name: "",
  server_url: "",
  region: (store.state as any).zoConfig?.org_storage_region || "",
  access_key: "",
  storage_account: "",
  secret_key: "",
  role_arn: "",
  external_id: "",
});

const cloudProviders = computed(() => {
  const raw = (store.state as any).zoConfig?.org_storage_providers;
  if (!raw || !isCloud.value) return null;
  return raw.split(",").map((s: string) => s.trim());
});

const cloudRegion = computed(() =>
  isCloud.value ? ((store.state as any).zoConfig?.org_storage_region || "") : ""
);

const availableProviders = computed(() => {
  let providers = [...providerDefinitions];
  if (isCloud.value && cloudProviders.value) {
    providers = providers.filter((p) =>
      cloudProviders.value!.includes(p.value)
    );
  }
  return providers;
});

const providerDefinitions = [
  {
    label: "AWS Credentials",
    value: "AwsCredentials",
    icon: "cloud",
    image: getImageURL("images/org_storage/aws_plain_without_bg.png"),
  },
  {
    label: "Azure Credentials",
    value: "AzureCredentials",
    icon: "cloud",
    image: getImageURL("images/org_storage/azure.png"),
  },
  // for now we do not support gcp specifically, use the  aws route to use gcp
  // keeping this for future use or remove later
  // {
  //   label: "GCP Credentials",
  //   value: "GcpCredentials",
  //   icon: "cloud",
  //   image: getImageURL("images/org_storage/gcp.png"),
  // },
  {
    label: "AWS Role ARN",
    value: "AwsRoleArn",
    icon: "shield",
    image: getImageURL("images/org_storage/aws_iam.png"),
  },
];

const canProceedStep1 = computed(() => !!selectedProvider.value);

function nextStep() {
  if (step.value === 1 && canProceedStep1.value) step.value = 2;
}

function prevStep() {
  if (step.value > 1) step.value--;
}

function resetFormData() {
  formData.bucket_name = "";
  formData.server_url = "";
  formData.region = cloudRegion.value;
  formData.access_key = "";
  formData.storage_account = "";
  formData.secret_key = "";
  formData.role_arn = "";
  formData.external_id = "";
}

function buildDataPayload() {
  const data: Record<string, string> = {};
  switch (selectedProvider.value) {
    case "AwsCredentials":
      data.bucket_name = formData.bucket_name;
      data.server_url = isCloud.value ? "" : formData.server_url;
      data.region = formData.region;
      data.access_key = formData.access_key;
      data.secret_key = formData.secret_key;
      break;
    case "AzureCredentials":
      data.bucket_name = formData.bucket_name;
      data.server_url = isCloud.value ? "" : formData.server_url;
      data.storage_account = formData.storage_account;
      data.secret_key = formData.secret_key;
      break;
    case "GcpCredentials":
      data.bucket_name = formData.bucket_name;
      data.server_url = isCloud.value ? "" : formData.server_url;
      data.access_key = formData.access_key;
      break;
    case "AwsRoleArn":
      data.bucket_name = formData.bucket_name;
      data.region = formData.region;
      data.role_arn = formData.role_arn;
      data.external_id = formData.external_id;
      break;
  }
  return data;
}

async function submitStorage() {
  const dismiss = $q.notify({
    spinner: true,
    message: "Please wait...",
    timeout: 2000,
  });

  const orgId = store.state.selectedOrganization.identifier;
  const payload = {
    provider: selectedProvider.value,
    data: buildDataPayload(),
  };

  try {
    if (isEditMode.value) {
      await orgStorageService.update(orgId, payload);
      dismiss();
      $q.notify({
        type: "positive",
        message: "Credentials updated successfully",
      });
    } else {
      await orgStorageService.create(orgId, payload);
      dismiss();
      $q.notify({
        type: "positive",
        message: "Storage config created successfully",
      });
    }
    emit("saved");
  } catch (err: any) {
    if (err.response?.status === 403) return;
    dismiss();
    $q.notify({
      type: "negative",
      message:
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Failed to save storage config",
    });
  }
}

// In edit mode, load existing config and skip to step 2
onMounted(async () => {
  if (isEditMode.value) {
    try {
      const orgId = store.state.selectedOrganization.identifier;
      const res = await orgStorageService.get(orgId);
      existingConfig.value = res.data;

      if (res.data.provider) {
        selectedProvider.value = res.data.provider;
        step.value = 2;
        // data is already a parsed object from the API
        const parsed = res.data.data || {};
        // prefill non-credential fields (they will be disabled in the form)
        formData.bucket_name = parsed.bucket_name || "";
        formData.server_url = parsed.server_url || "";
        formData.region = parsed.region || "";
        // credentials must be entered fresh — never prefill with masked values
        formData.access_key = "";
        formData.secret_key = "";
        formData.role_arn = "";
        // external id is something that is technically a credential, but not masked
        formData.external_id = parsed.external_id || "";
        formData.storage_account = parsed.storage_account || "";
      }
    } catch {
      $q.notify({
        type: "negative",
        message: "Failed to load existing storage config",
      });
    }
  }
});

// Watch for provider change to reset form data (skip in edit mode since provider is locked)
watch(selectedProvider, (newProvider) => {
  if (newProvider && !isEditMode.value) {
    resetFormData();
  }
});
</script>

<style lang="scss" scoped>
.destination-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.destination-type-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 12px;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.3s ease;
  min-height: 120px;

  &:hover {
    border-color: var(--o2-border-color);
    box-shadow: 0 4px 12px rgba(25, 118, 210, 0.15);
    transform: translateY(-2px);
  }

  &.selected {
    border-color: var(--o2-border-color);
    background: linear-gradient(135deg, #e3f2fd 0%, #ffffff 100%);
    box-shadow: 0 4px 16px rgba(25, 118, 210, 0.2);

    .card-icon { color: var(--o2-border-color); }
    .card-label { color: #333333; }
  }

  &.dark-mode {
    background: #1e1e1e;
    border-color: #424242;

    &:hover {
      border-color: #5d9cec;
      box-shadow: 0 4px 12px rgba(93, 156, 236, 0.2);
    }

    &.selected {
      border-color: #5d9cec;
      background: linear-gradient(135deg, #1a3a52 0%, #1e1e1e 100%);
      box-shadow: 0 4px 16px rgba(93, 156, 236, 0.25);

      .card-icon { color: #5d9cec; }
      .card-label { color: #ffffff; }
    }
  }

  .card-icon {
    margin-bottom: 8px;
    color: #666;
    transition: color 0.3s ease;
  }

  .card-image {
    width: 48px;
    height: 48px;
    margin-bottom: 8px;
    object-fit: contain;
  }

  .card-label {
    font-size: 13px;
    font-weight: 500;
    text-align: center;
    line-height: 1.3;
    margin-top: 4px;
    color: var(--o2-text-primary);
  }

  .check-icon {
    position: absolute;
    top: 8px;
    right: 8px;
  }
}
</style>

<style lang="scss">
.storage-settings-editor {
  .q-stepper {
    background: transparent !important;
  }

  .modern-stepper {
    box-shadow: none;

    :deep(.q-stepper__header) {
      border-bottom: 1px solid #e0e0e0;
    }

    :deep(.q-stepper__tab) {
      padding: 16px 24px;
    }

    :deep(.q-stepper__tab--active) {
      color: #1976d2;
      font-weight: 600;
    }

    :deep(.q-stepper__tab--done) {
      color: #4caf50;
    }

    :deep(.q-stepper__dot) {
      width: 32px;
      height: 32px;
      font-size: 14px;
      background: var(--o2-primary-btn-bg);
    }

    :deep(.q-stepper__step-inner) {
      padding: 4px 0;
    }
  }

  .q-field--labeled.showLabelOnTop .q-field__bottom {
    padding: 0.275rem 0 0 !important;
  }

  .q-field--labeled.showLabelOnTop {
    padding-top: 20px;
  }
}
</style>
