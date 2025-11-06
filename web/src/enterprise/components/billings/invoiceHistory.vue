<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page class="q-py-md" style="min-height: inherit;">
    <!-- Tax ID Section -->
    <div class="q-px-sm q-mb-lg">
      <div class="q-table__title tw-font-[600] q-mb-md">
        {{ t("billing.taxInformation") }}
      </div>
      <q-card flat bordered class="q-pa-md">
        <div v-if="taxIdLoading" class="text-center q-py-md">
          <q-spinner color="primary" size="3em" />
        </div>
        <div v-else>
          <div v-if="!isEditing && taxIdData.tax_id" class="row items-center q-gutter-md">
            <div class="col">
              <div class="text-subtitle2 text-grey-7">Tax ID</div>
              <div class="text-body1">{{ taxIdData.tax_id }}</div>
            </div>
            <div class="col">
              <div class="text-subtitle2 text-grey-7">Country</div>
              <div class="text-body1">{{ getCountryName(taxIdData.country) }}</div>
            </div>
            <div class="col">
              <div class="text-subtitle2 text-grey-7">Type</div>
              <div class="text-body1">{{ taxIdData.tax_id_type }}</div>
            </div>
            <div class="col-auto">
              <q-btn
                flat
                dense
                color="primary"
                label="Edit"
                @click="startEditing"
              />
            </div>
          </div>
          <div v-else-if="!isEditing && !taxIdData.tax_id" class="text-center q-py-md">
            <div class="text-grey-7 q-mb-md">No tax ID on file</div>
            <q-btn
              color="primary"
              label="Add Tax ID"
              @click="startEditing"
            />
          </div>
          <div v-else class="q-gutter-md">
            <div class="row q-col-gutter-md">
              <div class="col-12 col-md-6">
                <q-select
                  v-model="editForm.country"
                  :options="countryOptions"
                  label="Country"
                  outlined
                  dense
                  option-value="code"
                  option-label="name"
                  emit-value
                  map-options
                  :rules="[(val) => !!val || 'Country is required']"
                />
              </div>
              <div class="col-12 col-md-6">
                <q-input
                  v-model="editForm.tax_id"
                  label="Tax ID"
                  outlined
                  dense
                  :hint="getTaxIdHint(editForm.country)"
                  :rules="[(val) => !!val || 'Tax ID is required']"
                />
              </div>
            </div>
            <div class="row q-gutter-sm justify-end">
              <q-btn
                flat
                label="Cancel"
                @click="cancelEditing"
              />
              <q-btn
                color="primary"
                label="Save"
                :loading="saving"
                @click="saveTaxId"
              />
            </div>
            <div v-if="saveError" class="text-negative q-mt-sm">
              {{ saveError }}
            </div>
          </div>
        </div>
      </q-card>
    </div>

    <!-- Invoice History Section -->
    <div class="q-px-sm">
      <div class="row q-table__title tw-font-[600]">
        {{ t("billing.invoiceHistory") }}
      </div>
      <div>
        <invoice-table></invoice-table>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import InvoiceTable from "./invoiceTable.vue";
import billingsService from "@/services/billings";

export default defineComponent({
  name: "Payment Details",
  components: {
    InvoiceTable,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();

    const taxIdLoading = ref(false);
    const saving = ref(false);
    const isEditing = ref(false);
    const saveError = ref("");

    const taxIdData = ref<{
      tax_id: string | null;
      country: string | null;
      tax_id_type: string | null;
    }>({
      tax_id: null,
      country: null,
      tax_id_type: null,
    });

    const editForm = ref({
      country: "",
      tax_id: "",
    });

    const countryOptions = [
      // EU Countries
      { code: "AT", name: "Austria" },
      { code: "BE", name: "Belgium" },
      { code: "BG", name: "Bulgaria" },
      { code: "HR", name: "Croatia" },
      { code: "CY", name: "Cyprus" },
      { code: "CZ", name: "Czech Republic" },
      { code: "DK", name: "Denmark" },
      { code: "EE", name: "Estonia" },
      { code: "FI", name: "Finland" },
      { code: "FR", name: "France" },
      { code: "DE", name: "Germany" },
      { code: "GR", name: "Greece" },
      { code: "HU", name: "Hungary" },
      { code: "IE", name: "Ireland" },
      { code: "IT", name: "Italy" },
      { code: "LV", name: "Latvia" },
      { code: "LT", name: "Lithuania" },
      { code: "LU", name: "Luxembourg" },
      { code: "MT", name: "Malta" },
      { code: "NL", name: "Netherlands" },
      { code: "PL", name: "Poland" },
      { code: "PT", name: "Portugal" },
      { code: "RO", name: "Romania" },
      { code: "SK", name: "Slovakia" },
      { code: "SI", name: "Slovenia" },
      { code: "ES", name: "Spain" },
      { code: "SE", name: "Sweden" },
      // Non-EU European
      { code: "GB", name: "United Kingdom" },
      { code: "CH", name: "Switzerland" },
      { code: "NO", name: "Norway" },
      // Americas
      { code: "US", name: "United States" },
      { code: "CA", name: "Canada" },
      { code: "MX", name: "Mexico" },
      { code: "BR", name: "Brazil" },
      { code: "CL", name: "Chile" },
      // Asia Pacific
      { code: "AU", name: "Australia" },
      { code: "NZ", name: "New Zealand" },
      { code: "IN", name: "India" },
      { code: "SG", name: "Singapore" },
      { code: "HK", name: "Hong Kong" },
      { code: "MY", name: "Malaysia" },
      { code: "TH", name: "Thailand" },
      { code: "ID", name: "Indonesia" },
      { code: "TW", name: "Taiwan" },
      { code: "KR", name: "South Korea" },
      { code: "JP", name: "Japan" },
      // Middle East & Africa
      { code: "AE", name: "United Arab Emirates" },
      { code: "SA", name: "Saudi Arabia" },
      { code: "ZA", name: "South Africa" },
      { code: "IL", name: "Israel" },
      // Other
      { code: "IS", name: "Iceland" },
      { code: "LI", name: "Liechtenstein" },
      { code: "RU", name: "Russia" },
      { code: "TR", name: "Turkey" },
    ];

    const getCountryName = (code: string | null) => {
      if (!code) return "N/A";
      const country = countryOptions.find((c) => c.code === code);
      return country ? country.name : code;
    };

    const getTaxIdHint = (countryCode: string) => {
      const hints: Record<string, string> = {
        US: "e.g., 12-3456789 (EIN)",
        GB: "e.g., GB123456789 (VAT)",
        DE: "e.g., DE123456789 (VAT)",
        FR: "e.g., FR12345678901 (VAT)",
        AU: "e.g., 12345678901 (ABN)",
        IN: "e.g., 12ABCDE3456F1Z5 (GST)",
        CA: "e.g., 123456789 (BN)",
      };
      return hints[countryCode] || "Enter your tax identification number";
    };

    const loadTaxId = async () => {
      taxIdLoading.value = true;
      saveError.value = "";
      try {
        const orgIdentifier = store.state.selectedOrganization.identifier;
        const response = await billingsService.get_tax_id(orgIdentifier);
        if (response.data) {
          taxIdData.value = {
            tax_id: response.data.tax_id || null,
            country: response.data.country || null,
            tax_id_type: response.data.tax_id_type || null,
          };
        }
      } catch (error: any) {
        console.error("Failed to load tax ID:", error);
        // Don't show error for empty tax ID (404 is expected)
        if (error?.response?.status !== 404) {
          saveError.value = "Failed to load tax information";
        }
      } finally {
        taxIdLoading.value = false;
      }
    };

    const startEditing = () => {
      editForm.value = {
        country: taxIdData.value.country || "",
        tax_id: taxIdData.value.tax_id || "",
      };
      isEditing.value = true;
      saveError.value = "";
    };

    const cancelEditing = () => {
      isEditing.value = false;
      editForm.value = { country: "", tax_id: "" };
      saveError.value = "";
    };

    const saveTaxId = async () => {
      if (!editForm.value.country || !editForm.value.tax_id) {
        saveError.value = "Please fill in all required fields";
        return;
      }

      saving.value = true;
      saveError.value = "";
      try {
        const orgIdentifier = store.state.selectedOrganization.identifier;
        await billingsService.update_tax_id(orgIdentifier, {
          tax_id: editForm.value.tax_id,
          country: editForm.value.country,
        });

        $q.notify({
          type: "positive",
          message: "Tax ID updated successfully",
          timeout: 3000,
        });

        isEditing.value = false;
        await loadTaxId();
      } catch (error: any) {
        console.error("Failed to update tax ID:", error);
        saveError.value =
          error?.response?.data?.error ||
          "Failed to update tax ID. Please check your input and try again.";
      } finally {
        saving.value = false;
      }
    };

    onMounted(() => {
      loadTaxId();
    });

    return {
      t,
      taxIdLoading,
      saving,
      isEditing,
      saveError,
      taxIdData,
      editForm,
      countryOptions,
      getCountryName,
      getTaxIdHint,
      startEditing,
      cancelEditing,
      saveTaxId,
    };
  },
});
</script>
<style lang="scss" scoped></style>
