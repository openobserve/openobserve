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
  <div class="azure-marketplace-setup bg-surface-base min-h-screen">
    <div class="relative-position flex px-3 pt-2">
      <img
        data-test="azure-marketplace-setup-logo"
        class="h-10"
        loading="lazy"
        :src="
          isDark
            ? getImageURL('images/common/openobserve_latest_dark_2.svg')
            : getImageURL('images/common/openobserve_latest_light_2.svg')
        "
      />
    </div>

    <div class="mx-auto max-w-125 p-6 pt-15">
      <!-- No Token Error -->
      <div v-if="state === 'no_token'" class="text-center">
        <OIcon name="warning" style="width: 80px; height: 80px" />
        <h5 class="mt-3">No Marketplace Token Found</h5>
        <p class="text-text-secondary">
          Please start the registration process from Azure Marketplace.
        </p>
        <OButton variant="primary" size="sm-action" class="mt-4" @click="goToDashboard"
          >Go to Dashboard</OButton
        >
      </div>

      <!-- Error State -->
      <div v-else-if="state === 'error'" class="text-center">
        <OIcon name="error" style="width: 80px; height: 80px" />
        <h5 class="mt-3">{{ errorMessage }}</h5>
        <OButton variant="primary" size="sm-action" class="mt-4" @click="resetAndRetry"
          >Try Again</OButton
        >
      </div>

      <!-- Org Selection/Creation -->
      <div v-else-if="state === 'select_org'" class="text-center">
        <OIcon name="cloud" style="width: 60px; height: 60px" />
        <h4 class="mt-3">Complete Azure Marketplace Setup</h4>
        <p class="text-text-secondary mb-4">
          Link your Azure Marketplace subscription to an organization
        </p>

        <div class="mx-auto max-w-100">
          <!-- Create New Org -->
          <OCard
            class="rounded-default mb-4 transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
          >
            <OCardSection role="body">
              <div class="text-xl font-semibold">Create New Organization</div>
              <p class="text-text-secondary">
                Create a new organization with Azure Marketplace billing
              </p>
              <OForm
                id="azure-create-org-form"
                :schema="azureCreateOrgSchema"
                :default-values="azureCreateOrgDefaults()"
                @submit="createNewOrgForAzure"
                v-slot="{ isSubmitting }"
              >
                <OFormInput
                  name="newOrgName"
                  data-test="azure-marketplace-org-name"
                  label="Organization Name"
                  required
                  class="mb-3"
                />
                <OButton
                  data-test="azure-marketplace-create-link-btn"
                  type="submit"
                  variant="primary"
                  size="sm-action"
                  block
                  :loading="isSubmitting"
                  >Create &amp; Link</OButton
                >
              </OForm>
            </OCardSection>
          </OCard>

          <!-- Link to Existing Org (only show orgs without billing) -->
          <OCard
            v-if="eligibleOrganizations.length > 0"
            class="rounded-default transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
          >
            <OCardSection role="body">
              <div class="text-xl font-semibold">Link to Existing Organization</div>
              <p class="text-text-secondary">Link Azure billing to an existing organization</p>
              <OForm
                id="azure-link-org-form"
                :schema="azureLinkOrgSchema"
                :default-values="azureLinkOrgDefaults()"
                @submit="linkToExistingOrg"
                v-slot="{ isSubmitting }"
              >
                <!-- label-key/value-key map the fields; SelectOptionInput's required `label` doesn't apply -->
                <OFormSelect
                  name="selectedOrg"
                  :options="eligibleOrganizations as any[]"
                  label-key="name"
                  value-key="identifier"
                  label="Select Organization"
                  required
                  class="mb-3"
                />
                <OButton
                  type="submit"
                  variant="primary"
                  size="sm-action"
                  block
                  :loading="isSubmitting"
                  >Link Azure Billing</OButton
                >
              </OForm>
            </OCardSection>
          </OCard>
        </div>
      </div>

      <!-- Processing State -->
      <div v-else-if="state === 'processing'" class="text-center">
        <OSpinner variant="dots" size="xl" />
        <h5 class="mt-3">Setting up your subscription...</h5>
        <p class="text-text-secondary">Please wait while we configure your account.</p>
      </div>

      <!-- Success State -->
      <div v-else-if="state === 'success'" class="text-center">
        <OIcon name="check-circle" style="width: 80px; height: 80px" />
        <h4 class="mt-3">Subscription Activated!</h4>
        <p class="text-text-secondary">Your Azure Marketplace subscription is now active.</p>
        <OButton variant="primary" size="sm-action" class="mt-4" @click="goToDashboard"
          >Go to Dashboard</OButton
        >
      </div>

      <!-- Payment Failed State -->
      <div v-else-if="state === 'payment_failed'" class="text-center">
        <OIcon name="error" style="width: 80px; height: 80px" />
        <h5 class="mt-3">Payment Failed</h5>
        <p class="text-text-secondary">
          There was an issue with activating Azure subscription. Please check your Azure account or
          contact support.
        </p>
        <OButton
          as="a"
          href="mailto:support@openobserve.ai"
          variant="primary"
          size="sm-action"
          class="mt-4"
          >Contact Support</OButton
        >
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { useI18n } from "vue-i18n";
import { getImageURL, useLocalOrganization } from "@/utils/zincutils";
import azureMarketplace from "@/services/azureMarketplace";
import organizationsService from "@/services/organizations";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import {
  makeAzureCreateOrgSchema,
  azureCreateOrgDefaults,
  makeAzureLinkOrgSchema,
  azureLinkOrgDefaults,
  type AzureCreateOrgForm,
  type AzureLinkOrgForm,
} from "./AzureMarketplaceSetup.schema";
// NOTE: the old `toast` import was removed — the empty-selection guard is now
// schema-driven (z.string().min(1)), not an imperative toast.

type SetupState = "select_org" | "no_token" | "processing" | "success" | "payment_failed" | "error";

export default defineComponent({
  name: "AzureMarketplaceSetup",
  components: { OButton, OSpinner, OForm, OFormInput, OFormSelect, OIcon, OCard, OCardSection },
  setup() {
    const store = useStore();
    const { isDark } = useTheme();
    const router = useRouter();
    const { t } = useI18n();

    // Factory-built so the required messages resolve through i18n.
    const azureCreateOrgSchema = makeAzureCreateOrgSchema(t);
    const azureLinkOrgSchema = makeAzureLinkOrgSchema(t);

    const state = ref<SetupState>("select_org");
    const errorMessage = ref("");
    const eligibleOrganizations = ref<{ identifier: string; name: string }[]>([]);
    const token = ref("");
    const activatedOrgId = ref("");

    onMounted(async () => {
      // Get token from sessionStorage (saved by /marketplace/azure/register route)
      token.value = sessionStorage.getItem("azure_marketplace_token") || "";

      if (!token.value) {
        state.value = "no_token";
        return;
      }

      // Fetch user's organizations
      await fetchOrganizations();
    });

    const fetchOrganizations = async () => {
      try {
        const res = await organizationsService.list(0, 100000, "id", false, "");
        // Show all orgs for now - backend will validate eligibility
        eligibleOrganizations.value = res.data.data.map((org: any) => ({
          identifier: org.identifier,
          name: org.name,
        }));
      } catch (error) {
        console.error("Failed to fetch organizations:", error);
      }
    };

    // Plain async @submit handler — the schema already gated `value.newOrgName`
    // (required), so no imperative empty-check is needed. The Save spinner is
    // form-driven (OForm awaits this handler).
    const createNewOrgForAzure = async (value: AzureCreateOrgForm) => {
      state.value = "processing";

      try {
        // Create the organization
        const orgRes = await organizationsService.create({
          name: value.newOrgName,
        });

        const orgId = orgRes.data.identifier;

        // Link Azure Marketplace subscription
        await linkSubscription(orgId, value.newOrgName);
      } catch (error: any) {
        console.error("Failed to create organization:", error);
        state.value = "error";
        errorMessage.value = error.response?.data?.message || "Failed to create organization";
      }
    };

    // `value.selectedOrg` is the org identifier (OSelect value-key="identifier").
    const linkToExistingOrg = async (value: AzureLinkOrgForm) => {
      state.value = "processing";

      const org = eligibleOrganizations.value.find((o) => o.identifier === value.selectedOrg);
      await linkSubscription(value.selectedOrg, org?.name ?? value.selectedOrg);
    };

    const linkSubscription = async (orgId: string, orgLabel: string) => {
      try {
        await azureMarketplace.linkSubscription(orgId, token.value);

        // Clear the token from sessionStorage
        sessionStorage.removeItem("azure_marketplace_token");
        state.value = "success";

        // Update selected org in store
        const orgData = {
          identifier: orgId,
          label: orgLabel || orgId,
          user_email: store.state.userInfo?.email,
        };
        useLocalOrganization(orgData);
        store.dispatch("setSelectedOrganization", orgData);
      } catch (error: any) {
        console.error("Failed to link subscription:", error);
        state.value = "error";
        errorMessage.value = error.response?.data?.message || "Failed to link Azure subscription";
      }
    };

    const goToDashboard = () => {
      sessionStorage.removeItem("azure_marketplace_token");
      router.push({
        path: "/",
        query: activatedOrgId.value ? { org_identifier: activatedOrgId.value } : undefined,
      });
    };

    const resetAndRetry = () => {
      state.value = "select_org";
      errorMessage.value = "";
    };

    return {
      store,
      isDark,
      state,
      errorMessage,
      eligibleOrganizations,
      getImageURL,
      // Schemas + typed default factories must be returned from setup() so the
      // Options-API template can resolve `:schema` / `:default-values`
      // (a module-level import would be out of the template's scope).
      azureCreateOrgSchema,
      azureCreateOrgDefaults,
      azureLinkOrgSchema,
      azureLinkOrgDefaults,
      createNewOrgForAzure,
      linkToExistingOrg,
      goToDashboard,
      resetAndRetry,
    };
  },
});
</script>
