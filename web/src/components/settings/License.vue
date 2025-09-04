<template>
  <div class="q-pa-md">
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
        <q-card>
          <q-card-section>
            <div class="text-h6 q-mb-md">License Information</div>
            <q-markup-table flat bordered>
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
              </tbody>
            </q-markup-table>
          </q-card-section>
        </q-card>

        <q-card v-if="!licenseData.license.active" class="q-mt-md">
          <q-card-section>
            <div class="text-subtitle1 q-mb-md">Update License Key</div>
            <q-input
              v-model="licenseKey"
              outlined
              type="textarea"
              rows="8"
              placeholder="Paste new license key here..."
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
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
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

    const formatDate = (timestamp: number) => {
      return new Date(timestamp).toLocaleString();
    };

    onMounted(() => {
      loadLicenseData();
    });

    return {
      loading,
      updating,
      licenseData,
      licenseKey,
      updateLicense,
      formatDate,
    };
  },
});
</script>