<template>
  <div class="q-pa-md">
    <div class="full-width license-expiry-container q-pa-md gradient-banner q-mb-md" v-if="showLicenseExpiryWarning">
      <div class="row">
        <div class="col">
          <span class="o2-license-message">{{ getLicenseExpiryMessage() }}</span>
          <br />
          <span class="o2-license-subtitle">Please update your license by contacting your administrator.</span>
        </div>
        <div class="col-2 q-mt-sm">
          <q-btn 
            @click="showUpdateFormAndFocus" 
            class="cursor-pointer text-capitalize bg-primary text-white q-px-md q-py-sm rounded-md float-right"
            dense
            no-caps
          >Update License Key</q-btn>
        </div>
      </div>
    </div>
    
    <div class="text-h6 q-mb-md">License Management</div>
    
    <div v-if="loading" class="q-pa-md text-center">
      <q-spinner size="40px" />
      <div class="q-mt-md">Loading license information...</div>
    </div>

    <div v-else>
      <div v-if="licenseData.license === null || !licenseData.license" class="q-mb-lg">
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="text-h6">No License Found</div>
            <div class="q-mt-sm text-body2">
              Installation ID: <strong>{{ licenseData.installation_id || 'N/A' }}</strong>
            </div>
            <div class="q-mt-md text-body2">
              Contact your administrator for getting a license and paste the key here:
            </div>
          </q-card-section>
        </q-card>

        <q-card>
          <q-card-section>
            <div class="text-subtitle1 q-mb-md">Enter License Key</div>
            <q-input
              v-model="licenseKey"
              outlined
              type="textarea"
              rows="8"
              placeholder="Paste your license key here..."
              class="q-mb-md"
              style="min-height: 200px;"
            />
            <q-btn
              color="primary"
              label="Update License"
              @click="updateLicense"
              :loading="updating"
              :disable="!licenseKey.trim()"
            />
          </q-card-section>
        </q-card>
      </div>

      <div v-else>
        <div class="row q-gutter-md">
          <div class="col" style="flex: 2">
            <q-card style="height: 100%">
              <q-card-section class="full-height">
                <div class="text-h6 q-mb-md">License Information</div>
                <q-markup-table flat bordered dense class="compact-table">
                  <tbody>
                    <tr>
                      <td class="text-weight-bold">Installation ID</td>
                      <td>{{ licenseData.installation_id }}</td>
                    </tr>
                    <tr>
                      <td class="text-weight-bold">License ID</td>
                      <td>{{ licenseData.license.license_id }}</td>
                    </tr>
                    <tr>
                      <td class="text-weight-bold">Active</td>
                      <td>
                        <q-badge :color="licenseData.license.active ? 'green' : 'red'">
                          {{ licenseData.license.active ? 'Yes' : 'No' }}
                        </q-badge>
                      </td>
                    </tr>
                    <tr>
                      <td class="text-weight-bold">Created At</td>
                      <td>{{ formatDate(licenseData.license.created_at) }}</td>
                    </tr>
                    <tr>
                      <td class="text-weight-bold">Expires At</td>
                      <td>{{ formatDate(licenseData.license.expires_at) }}</td>
                    </tr>
                    <tr>
                      <td class="text-weight-bold">Company</td>
                      <td>{{ licenseData.license.company }}</td>
                    </tr>
                    <tr v-if="licenseData.key">
                      <td class="text-weight-bold">License Key</td>
                      <td>
                        <div class="row items-center q-gutter-sm">
                          <span>{{ getMaskedLicenseKey() }}</span>
                          <q-btn
                            flat
                            round
                            dense
                            icon="visibility"
                            size="sm"
                            @click="showLicenseKeyModal = true"
                            class="q-ml-sm"
                          />
                        </div>
                      </td>
                    </tr>
                    <tr v-if="licenseData.license.contact_name">
                      <td class="text-weight-bold">Contact Name</td>
                      <td>{{ licenseData.license.contact_name }}</td>
                    </tr>
                    <tr v-if="licenseData.license.contact_email">
                      <td class="text-weight-bold">Contact Email</td>
                      <td>{{ licenseData.license.contact_email }}</td>
                    </tr>
                  </tbody>
                </q-markup-table>
                <div class="q-mt-md">
                  <q-btn
                    no-caps
                    color="primary"
                    label="Add New License Key"
                    @click="showUpdateFormAndFocus"
                  />
                </div>
              </q-card-section>
            </q-card>
          </div>

          <div class="col" style="flex: 1">
            <q-card style="height: 100%">
              <q-card-section class="full-height column">
                <div class="text-h6 q-mb-md tw-mx-auto">Usage Information</div>
                <div v-if="licenseData.license && licenseData.license.limits" class="text-center q-mb-md tw-mt-[10px]">
                  <div class="text-subtitle2 q-mb-sm">Ingestion Usage</div>
                  <q-circular-progress
                    :value="ingestionUsagePercent"
                    size="120px"
                    :thickness="0.15"
                    :color="getIngestionUsageColor()"
                    track-color="grey-3"
                    show-value
                    class="q-ma-md"
                  >
                    <span class="text-h6">{{ ingestionUsagePercent }}%</span>
                  </q-circular-progress>
                  <div class="text-caption text-weight-bold">
                    {{ isIngestionUnlimited ? 'Limit: Unlimited' : `Limit: ${licenseData.license.limits.Ingestion.value}GB / day` }}
                  </div>
                  <div v-if="isIngestionUnlimited" class="text-caption text-grey-6 q-mt-xs" style="font-size: 10px;">
                    * Usage shows 0% for unlimited plans
                  </div>
                </div>
                <div v-else class="text-center q-mb-md tw-mt-[70px] column items-center">
                  <q-icon name="info" size="60px" color="grey-5" class="q-mb-md" />
                  <div class="text-body2 text-grey-7">
                    Add license key to enable usage information
                  </div>
                </div>
                <q-markup-table v-if="licenseData.license && licenseData.license.limits" flat bordered dense class="q-mt-auto compact-table">
                  <thead>
                    <tr>
                      <th colspan="2" class="text-center text-weight-bold">Ingestion</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td class="text-weight-bold">Type</td>
                      <td>{{ licenseData.license.limits.Ingestion.typ }}</td>
                    </tr>
                    <tr>
                      <td class="text-weight-bold">Value</td>
                      <td>{{ licenseData.license.limits.Ingestion.value }}</td>
                    </tr>
                  </tbody>
                </q-markup-table>
              </q-card-section>
            </q-card>
          </div>
        </div>

        <q-card v-if="showUpdateForm" class="q-mt-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">Update License Key</div>
            <q-input
              v-model="licenseKey"
              outlined
              type="textarea"
              rows="8"
              placeholder="Paste new license key here..."
              class="q-mb-md"
              style="min-height: 200px;"
            />
            <div class="row q-gutter-sm">
              <q-btn
                outline
                color="grey-7"
                no-caps
                label="Cancel"
                @click="showUpdateForm = false; licenseKey = ''"
              />
              <q-btn
                color="primary"
                no-caps
                label="Update License"
                @click="updateLicense"
                :loading="updating"
                :disable="!licenseKey.trim()"
              />
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- License Key Modal -->
    <q-dialog v-model="showLicenseKeyModal" persistent>
      <q-card style="min-width: 500px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">License Key</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div class="text-body2 q-mb-md">Your complete license key:</div>
          <q-input
            v-model="licenseData.key"
            outlined
            readonly
            type="textarea"
            rows="8"
            class="q-mb-md"
            style="font-family: monospace; font-size: 12px;"
          />
        </q-card-section>

        <q-card-actions align="right" class="q-pt-none">
          <q-btn
            outline
            color="grey-7"
            no-caps
            label="Cancel"
            v-close-popup
              />
          <q-btn
            color="primary"
            label="Copy Key"
            no-caps
            @click="copyLicenseKey"
            :disable="!licenseData.key"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, computed } from "vue";
import { useQuasar } from "quasar";
import licenseServer from "@/services/license_server";

export default defineComponent({
  name: "License",
  setup() {
    const $q = useQuasar();
    const loading = ref(false);
    const updating = ref(false);
    const licenseData = ref<any>({});
    const licenseKey = ref("");
    const showUpdateForm = ref(false);
    const showLicenseKeyModal = ref(false);

    const loadLicenseData = async () => {
      try {
        loading.value = true;
        const response = await licenseServer.get_license();
        licenseData.value = response.data;
      } catch (error) {
        console.error("Error loading license data:", error);
        $q.notify({
          type: "negative",
          message: "Failed to load license information",
        });
      } finally {
        loading.value = false;
      }
    };

    const updateLicense = async () => {
      try {
        updating.value = true;
        await licenseServer.update_license(licenseKey.value.trim());
        $q.notify({
          type: "positive",
          message: "License updated successfully",
        });
        licenseKey.value = "";
        showUpdateForm.value = false;
        await loadLicenseData();
      } catch (error) {
        console.error("Error updating license:", error);
        $q.notify({
          type: "negative",
          message: "Failed to update license",
        });
      } finally {
        updating.value = false;
      }
    };

    const showUpdateFormAndFocus = () => {
      showUpdateForm.value = true;
      setTimeout(() => {
        const textarea = document.querySelector('textarea[placeholder="Paste new license key here..."]') as HTMLTextAreaElement;
        if (textarea) {
          textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
          textarea.focus();
        }
      }, 100);
    };

    const maskKey = (key: string) => {
      if (!key) return '';
      if (key.length <= 10) return key; // If key is too short, show as is
      const start = key.substring(0, 5);
      const end = key.substring(key.length - 5);
      const masked = '*'.repeat(18);
      return `${start}${masked}${end}`;
    };

    const getMaskedLicenseKey = () => {
      if (!licenseData.value.key) return '';
      return maskKey(licenseData.value.key);
    };

    const copyLicenseKey = async () => {
      try {
        if (!licenseData.value.key) return;
        await navigator.clipboard.writeText(licenseData.value.key);
        $q.notify({
          type: "positive",
          message: "License key copied to clipboard",
        });
        showLicenseKeyModal.value = false;
      } catch (error) {
        console.error("Error copying license key:", error);
        $q.notify({
          type: "negative",
          message: "Failed to copy license key",
        });
      }
    };

    const formatDate = (timestamp: number) => {
      return new Date(timestamp).toLocaleString();
    };

    const isIngestionUnlimited = computed(() => {
      return licenseData.value.license?.limits?.Ingestion?.typ === "Unlimited";
    });

    const ingestionUsagePercent = computed(() => {
      if (isIngestionUnlimited.value) {
        return 0;
      }
      return licenseData.value.ingestion_used || 0;
    });

    const getIngestionUsageColor = () => {
      const percent = ingestionUsagePercent.value;
      if (percent < 60) return "green";
      if (percent < 90) return "orange";
      return "red";
    };

    const showLicenseExpiryWarning = computed(() => {
      if (!licenseData.value.license?.expires_at) return false;
      const now = Date.now();
      const expiryDate = licenseData.value.license.expires_at;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry < 7;
    });

    const getLicenseExpiryMessage = () => {
      if (!licenseData.value.license?.expires_at) return '';
      const now = Date.now();
      const expiryDate = licenseData.value.license.expires_at;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiry > 1) {
        return `${daysUntilExpiry} days remaining until your license expires`;
      } else if (daysUntilExpiry === 1) {
        return `1 day remaining until your license expires`;
      } else {
        return 'Your license has expired';
      }
    };

    onMounted(() => {
      loadLicenseData();
    });

    return {
      loading,
      updating,
      licenseData,
      licenseKey,
      showUpdateForm,
      showLicenseKeyModal,
      updateLicense,
      formatDate,
      isIngestionUnlimited,
      ingestionUsagePercent,
      getIngestionUsageColor,
      showLicenseExpiryWarning,
      getLicenseExpiryMessage,
      showUpdateFormAndFocus,
      maskKey,
      getMaskedLicenseKey,
      copyLicenseKey,
    };
  },
});
</script>

<style>
.gradient-banner {
  background: linear-gradient(
    to right,
    transparent 60%,
    #f7f7ff 70%,
    #cdf7e4 100%  );
}

.license-expiry-container {
  border: 1px solid #D7D7D7;
  border-radius: 6px;
}

.o2-license-message {
  font-size: 18px;
  font-weight: 600;
  line-height: 32px;
}

.o2-license-subtitle {
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
}

.compact-table {
  td, th {
    padding: 8px 12px !important;
    line-height: 1.2;
  }
}

.body--dark {
  .gradient-banner {
    background: linear-gradient(
      to right,
      transparent 60%,
      #24262F 70%,
      #2C3934 100%  );
  }

  .license-expiry-container {
    border: 1px solid #454F5B;
  }
}
</style>