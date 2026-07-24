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
  <OPageLayout
    :back="{
      label: t('storage_settings.title'),
      onClick: () => emit('cancel'),
      dataTest: 'storage-settings-editor-back-btn',
    }"
    :title="headerTitle"
  >
      <template #title>
        <span data-test="storage-settings-editor-title">{{ headerTitle }}</span>
      </template>

    <!-- Stepper -->
    <div class="bg-card-glass-bg h-[calc(100vh-7rem)] py-2 px-3 overflow-auto">
    <div style="max-width: 720px;">
      <OForm
        ref="storageForm"
        :schema="orgStorageEditorSchema"
        :default-values="orgStorageEditorDefaults"
        @submit="submitStorage"
      >
        <OStepper
          v-model="step"
          ref="stepper"
          animated
          :navigable="step > 1 && !isEditMode"
        >
          <!-- Step 1: Choose Provider -->
          <OStep
            :name="1"
            :title="t('settings.orgStorageEditor.chooseTypeTitle')"
            icon="cloud"
            :done="step > 1"
            :navigable="step > 1 && !isEditMode"
          >
            <div class="text-sm text-text-secondary mb-3">
              {{ t("storage_settings.selectProviderDesc") }}
              {{ t("settings.orgStorageEditor.selectProviderDescCont") }}
            </div>
            <div
              v-if="!isEditMode"
              class="flex items-start gap-2.5 px-3 py-2.5 mb-3 rounded-default border bg-banner-warning-bg border-banner-warning-border"
            >
              <OIcon name="warning" size="sm" class="flex-shrink-0 mt-px" />
              <div class="text-compact leading-[1.55] text-text-body">
                {{ t("settings.orgStorageEditor.irreversibleWarnPre") }}<strong>{{ t("settings.orgStorageEditor.irreversibleWarnEmphasis") }}</strong>{{ t("settings.orgStorageEditor.irreversibleWarnPost") }}
              </div>
            </div>
            <div
              v-if="!isEditMode"
              class="flex items-start gap-2.5 px-3 py-2.5 mb-3 rounded-default border bg-banner-info-bg border-banner-info-border"
            >
              <OIcon name="info" size="sm" class="flex-shrink-0 mt-px" />
              <div class="text-compact leading-[1.55] text-text-body">
                {{ t("settings.orgStorageEditor.credentialsOnlyInfo") }}
              </div>
            </div>
            <div class="text-sm font-medium mb-2">
              {{ t("settings.orgStorageEditor.selectStorageProviderLabel") }}<span class="text-status-negative">*</span>
            </div>
            <div class="destination-type-grid grid gap-3 grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))]">
              <div
                v-for="provider in availableProviders"
                :key="provider.value"
                :data-test="`storage-settings-provider-card-${provider.value}`"
                class="group/card relative flex flex-col items-center justify-center py-5 px-3 border-2 rounded-default cursor-pointer transition-all duration-300 min-h-30 hover:-translate-y-0.5 hover:shadow-md"
                :class="
                  selectedProvider === provider.value
                    ? 'selected bg-table-row-selected-bg border-accent shadow-md'
                    : 'bg-surface-base border-border-default hover:border-card-glass-border'
                "
                @click="selectedProvider = provider.value"
              >
                <img
                  v-if="provider.image"
                  :src="provider.image"
                  :alt="provider.label"
                  class="card-image w-12 h-12 mb-2 object-contain"
                />
                <OIcon
                  v-else
                  :name="provider.icon"
                  size="lg"
                  class="mb-2 text-text-secondary [transition:color_0.3s_ease] group-[.selected]/card:text-card-glass-border"
                />
                <div class="text-compact font-medium text-center [line-height:1.3] mt-1 text-text-body">{{ provider.label }}</div>
                <div
                  v-if="selectedProvider === provider.value"
                  class="check-icon absolute top-1.5 right-1.5 w-5 h-5 rounded-full overflow-hidden bg-status-positive text-white flex items-center justify-center z-1"
                >
                  <OIcon name="check" size="xs" />
                </div>
              </div>
            </div>
          </OStep>

          <!-- Step 2: Connection Details -->
          <OStep
            :name="2"
            :title="t('settings.orgStorageEditor.connectionTitle')"
            icon="lan"
            :done="step > 2"
            :navigable="step > 2"
          >
            <div class="gap-2">
              <!-- AwsCredentials Fields -->
              <template v-if="selectedProvider === 'AwsCredentials'">
                <div class="flex flex-col gap-y-3">
                  <OFormInput
                    v-if="!isCloud"
                    data-test="storage-settings-server-url-input"
                    name="server_url"
                    :label="t('settings.orgStorageEditor.serverUrlLabel')"
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode"
                  />
                  <OFormInput
                    data-test="storage-settings-region-input"
                    name="region"
                    :label="t('settings.orgStorageEditor.regionLabel')"
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode || !!cloudRegion"
                  />
                  <OFormInput
                    data-test="storage-settings-bucket-name-input"
                    name="bucket_name"
                    :label="t('settings.orgStorageEditor.bucketNameLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode"
                  />
                  <OFormInput
                    data-test="storage-settings-access-key-input"
                    name="access_key"
                    :label="t('settings.orgStorageEditor.accessKeyLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                  />
                  <OFormInput
                    data-test="storage-settings-secret-key-input"
                    name="secret_key"
                    :label="t('settings.orgStorageEditor.secretKeyLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                    type="password"
                  />
                </div>
              </template>

              <!-- AzureCredentials Fields -->
              <template v-if="selectedProvider === 'AzureCredentials'">
                <div class="flex flex-col gap-y-3">
                  <OFormInput
                    data-test="storage-settings-access-key-input"
                    name="storage_account"
                    :label="t('settings.orgStorageEditor.storageAccountNameLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode"
                  />
                  <OFormInput
                    data-test="storage-settings-bucket-name-input"
                    name="bucket_name"
                    :label="t('settings.orgStorageEditor.bucketNameLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode"
                  />
                  <OFormInput
                    data-test="storage-settings-secret-key-input"
                    name="secret_key"
                    :label="t('settings.orgStorageEditor.secretKeyLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                    type="password"
                  />
                  <OFormInput
                    v-if="!isCloud"
                    data-test="storage-settings-server-url-input"
                    name="server_url"
                    :label="t('settings.orgStorageEditor.serverUrlLabel')"
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode"
                  />
                </div>
              </template>

              <!-- GcpCredentials Fields -->
              <template v-if="selectedProvider === 'GcpCredentials'">
                 <div class="flex flex-col gap-y-3">
                  <OFormInput
                    data-test="storage-settings-bucket-name-input"
                    name="bucket_name"
                    :label="t('settings.orgStorageEditor.bucketNameLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode"
                  />
                  <OFormInput
                    data-test="storage-settings-access-key-input"
                    name="access_key"
                    :label="t('settings.orgStorageEditor.accessKeyLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                  />
                  <OFormInput
                    v-if="!isCloud"
                    data-test="storage-settings-server-url-input"
                    name="server_url"
                    :label="t('settings.orgStorageEditor.serverUrlLabel')"
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode"
                  />
                </div>
              </template>

              <!-- AwsRoleArn Fields -->
              <template v-if="selectedProvider === 'AwsRoleArn'">
                <div
                  class="flex items-start gap-2.5 px-3 py-2.5 mb-3 rounded-default border bg-banner-info-bg border-banner-info-border"
                >
                  <OIcon name="info" size="sm" class="flex-shrink-0 mt-px" />
                  <div class="text-compact leading-[1.55] text-text-body">
                    <template v-if="isCloud">
                      {{ t("storage_settings.awsStsCloudInfo") }}
                    </template>
                    <template v-else>
                      {{ t("storage_settings.awsStsSelfHostedInfo") }}
                    </template>
                  </div>
                </div>
                 <div class="flex flex-col gap-y-3">
                  <OFormInput
                    data-test="storage-settings-bucket-name-input"
                    name="bucket_name"
                    :label="t('settings.orgStorageEditor.bucketNameLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode"
                  />
                  <OFormInput
                    data-test="storage-settings-region-input"
                    name="region"
                    :label="t('settings.orgStorageEditor.regionLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                    :disabled="isEditMode || !!cloudRegion"
                  />
                  <OFormInput
                    data-test="storage-settings-role-arn-input"
                    name="role_arn"
                    :label="t('settings.orgStorageEditor.roleArnLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                  />
                  <OFormInput
                    data-test="storage-settings-role-external-id-input"
                    name="external_id"
                    :label="t('settings.orgStorageEditor.externalIdLabel')"
                    required
                    class="no-border showLabelOnTop"
                    flat
                  />
                </div>
              </template>
            </div>
          </OStep>
        </OStepper>

        <!-- Form buttons -->
        <div class="flex justify-start mt-3">
          <div v-if="step === 1">
            <OButton
              data-test="step1-cancel-btn"
              variant="outline"
              class="o2-secondary-button h-9 mr-2"
              :class="
                isDark
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
              class="no-border o2-primary-button h-9"
              :class="
                isDark
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
              class="o2-secondary-button h-9 mr-2"
              :class="
                isDark
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
              class="o2-secondary-button h-9"
              :class="
                isDark
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
              class="no-border ml-2 o2-primary-button h-9"
              :class="
                isDark
                  ? 'o2-primary-button-dark'
                  : 'o2-primary-button-light'
              "
              type="submit"
            >
              {{ isEditMode ? t("storage_settings.update") : t("storage_settings.save") }}
            </OButton>
          </div>
        </div>
      </OForm>
    </div>
    </div>
  </OPageLayout>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, watch } from "vue";

defineOptions({ name: "OrgStorageEditor" });
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import config from "@/aws-exports";
import orgStorageService from "@/services/org_storage";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeOrgStorageEditorSchema,
  type OrgStorageEditorForm,
} from "./OrgStorageEditor.schema";

const props = defineProps<{
  action: "add" | "edit";
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "saved"): void;
}>();

const store = useStore();
    const { isDark } = useTheme();
const { t } = useI18n();

const step = ref(1);
const selectedProvider = ref("");

// OForm instance ref — used for the selectedProvider bridge (setFieldValue),
// provider-change reset, and async edit-prefill (form.reset).
const storageForm = ref<any>(null);

// Provider-discriminated validation via superRefine on the bridged
// `selectedProvider` field.
const orgStorageEditorSchema = makeOrgStorageEditorSchema(t);

const existingConfig = ref<any>(null);

const isEditMode = computed(() => props.action === "edit");
const headerTitle = computed(() =>
  isEditMode.value
    ? t("storage_settings.updateStorage")
    : t("storage_settings.newStorageConfiguration"),
);
const isCloud = computed(() => config.isCloud === "true");

// Blank form values for a given provider (region seeded from cloud/store).
function blankFormValues(provider: string): OrgStorageEditorForm {
  return {
    selectedProvider: provider,
    bucket_name: "",
    server_url: "",
    region: cloudRegion.value || (store.state as any).zoConfig?.org_storage_region || "",
    access_key: "",
    storage_account: "",
    secret_key: "",
    role_arn: "",
    external_id: "",
  };
}

// Dynamic defaults (region from cloud/store, provider projected from the card
// grid) → a typed computed.
const orgStorageEditorDefaults = computed((): OrgStorageEditorForm =>
  blankFormValues(selectedProvider.value),
);

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

const providerDefinitions: Array<{
  label: string;
  value: string;
  image?: string;
  icon?: string;
}> = [
  {
    label: "AWS Credentials",
    value: "AwsCredentials",
    image: getImageURL("images/org_storage/aws_plain_without_bg.png"),
  },
  {
    label: "Azure Credentials",
    value: "AzureCredentials",
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

function buildDataPayload(value: OrgStorageEditorForm) {
  const data: Record<string, string> = {};
  switch (selectedProvider.value) {
    case "AwsCredentials":
      data.bucket_name = value.bucket_name;
      data.server_url = isCloud.value ? "" : value.server_url;
      data.region = value.region;
      data.access_key = value.access_key;
      data.secret_key = value.secret_key;
      break;
    case "AzureCredentials":
      data.bucket_name = value.bucket_name;
      data.server_url = isCloud.value ? "" : value.server_url;
      data.storage_account = value.storage_account;
      data.secret_key = value.secret_key;
      break;
    case "GcpCredentials":
      data.bucket_name = value.bucket_name;
      data.server_url = isCloud.value ? "" : value.server_url;
      data.access_key = value.access_key;
      break;
    case "AwsRoleArn":
      data.bucket_name = value.bucket_name;
      data.region = value.region;
      data.role_arn = value.role_arn;
      data.external_id = value.external_id;
      break;
  }
  return data;
}

// @submit handler — fires only once the provider-discriminated schema passes.
// The Save button is inline (type=submit inside <OForm>) so Enter works
// natively; OForm awaits this so the spinner spans the POST.
async function submitStorage(value: OrgStorageEditorForm) {
  const dismiss = toast({
    variant: "loading",
    message: t("settings.orgStorageEditor.pleaseWaitMessage"),
      timeout: 0,
});

  const orgId = store.state.selectedOrganization.identifier;
  const payload = {
    provider: selectedProvider.value,
    data: buildDataPayload(value),
  };

  try {
    if (isEditMode.value) {
      await orgStorageService.update(orgId, payload);
      dismiss();
      toast({
        variant: "success",
        message: t("settings.orgStorageEditor.credentialsUpdatedSuccess"),
      });
    } else {
      await orgStorageService.create(orgId, payload);
      dismiss();
      toast({
        variant: "success",
        message: t("settings.orgStorageEditor.storageConfigCreatedSuccess"),
      });
    }
    emit("saved");
  } catch (err: any) {
    if (err.response?.status === 403) return;
    dismiss();
    toast({
      variant: "error",
      message:
        err.response?.data?.error ||
        err.response?.data?.message ||
        t("settings.orgStorageEditor.saveStorageConfigError"),
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
        // Prefill the form once the (async) config arrives. Non-credential
        // fields are disabled in the form; credentials must be entered fresh —
        // never prefill with masked values. external_id is a credential but not
        // masked, so it IS prefilled.
        storageForm.value?.form?.reset({
          selectedProvider: res.data.provider,
          bucket_name: parsed.bucket_name || "",
          server_url: parsed.server_url || "",
          region: parsed.region || "",
          access_key: "",
          secret_key: "",
          role_arn: "",
          external_id: parsed.external_id || "",
          storage_account: parsed.storage_account || "",
        });
      }
    } catch {
      toast({
        variant: "error",
        message: t("settings.orgStorageEditor.loadStorageConfigError"),
      });
    }
  }
});

// Bridge the provider card grid into the form so superRefine can branch on it.
// On a create-mode provider change, reset the credential fields fresh for the
// new provider.
watch(selectedProvider, (newProvider) => {
  storageForm.value?.form?.setFieldValue("selectedProvider", newProvider);
  if (newProvider && !isEditMode.value) {
    storageForm.value?.form?.reset(blankFormValues(newProvider));
  }
});
</script>

