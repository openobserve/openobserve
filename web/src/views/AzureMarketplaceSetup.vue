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
  <div class="azure-marketplace-setup">
    <div class="tw:flex relative-position tw-px-3 tw-pt-2">
      <img
        class="appLogo"
        loading="lazy"
        :src="
          store?.state?.theme === 'dark'
            ? getImageURL('images/common/openobserve_latest_dark_2.svg')
            : getImageURL('images/common/openobserve_latest_light_2.svg')
        "
      />
    </div>

    <div class="setup-container tw:p-6">
      <!-- No Token Error -->
      <div v-if="state === 'no_token'" class="tw:text-center">
        <OIcon name="warning" style="width: 80px; height: 80px;" />
        <h5 class="tw:mt-3">No Marketplace Token Found</h5>
        <p class="tw:text-gray-400">
          Please start the registration process from Azure Marketplace.
        </p>
        <OButton
          variant="primary"
          size="sm-action"
          class="tw:mt-4"
          @click="goToDashboard"
        >Go to Dashboard</OButton>
      </div>

      <!-- Error State -->
      <div v-else-if="state === 'error'" class="tw:text-center">
        <OIcon name="error" style="width: 80px; height: 80px;" />
        <h5 class="tw:mt-3">{{ errorMessage }}</h5>
        <OButton
          variant="primary"
          size="sm-action"
          class="tw:mt-4"
          @click="resetAndRetry"
        >Try Again</OButton>
      </div>

      <!-- Org Selection/Creation -->
      <div v-else-if="state === 'select_org'" class="tw:text-center">
        <OIcon name="cloud" style="width: 60px; height: 60px;" />
        <h4 class="tw:mt-3">Complete Azure Marketplace Setup</h4>
        <p class="tw:text-gray-400 tw:mb-4">
          Link your Azure Marketplace subscription to an organization
        </p>

        <div class="options-container">
          <!-- Create New Org -->
          <OCard class="option-card tw:mb-4">
            <OCardSection role="body">
              <div class="tw:text-xl tw:font-semibold">Create New Organization</div>
              <p class="tw:text-gray-400">
                Create a new organization with Azure Marketplace billing
              </p>
              <OInput
                v-model="newOrgName"
                data-test="azure-marketplace-org-name"
                label="Organization Name"
                class="tw:mb-3"
                :error="!!orgNameError"
                :error-message="orgNameError"
                @update:model-value="orgNameError = ''"
              />
              <OButton
                data-test="azure-marketplace-create-link-btn"
                variant="primary"
                size="sm-action"
                block
                @click="createNewOrgForAzure"
                :loading="isProcessing"
                :disabled="!newOrgName"
              >Create &amp; Link</OButton>
            </OCardSection>
          </OCard>

          <!-- Link to Existing Org (only show orgs without billing) -->
          <OCard
            v-if="eligibleOrganizations.length > 0"
            class="option-card"
          >
            <OCardSection role="body">
              <div class="tw:text-xl tw:font-semibold">Link to Existing Organization</div>
              <p class="tw:text-gray-400">
                Link Azure billing to an existing organization
              </p>
              <OSelect
                v-model="selectedOrg"
                :options="eligibleOrganizations"
                labelKey="name"
                valueKey="identifier"
                label="Select Organization"
                class="tw:mb-3"
              />
              <OButton
                variant="primary"
                size="sm-action"
                block
                @click="linkToExistingOrg"
                :loading="isProcessing"
                :disabled="!selectedOrg"
              >Link Azure Billing</OButton>
            </OCardSection>
          </OCard>
        </div>
      </div>

      <!-- Processing State -->
      <div v-else-if="state === 'processing'" class="tw:text-center">
        <OSpinner variant="dots" size="xl" />
        <h5 class="tw:mt-3">Setting up your subscription...</h5>
        <p class="tw:text-gray-400">Please wait while we configure your account.</p>
      </div>

      
      <!-- Success State -->
      <div v-else-if="state === 'success'" class="tw:text-center">
        <OIcon name="check-circle" style="width: 80px; height: 80px;" />
        <h4 class="tw:mt-3">Subscription Activated!</h4>
        <p class="tw:text-gray-400">
          Your Azure Marketplace subscription is now active.
        </p>
        <OButton
          variant="primary"
          size="sm-action"
          class="tw:mt-4"
          @click="goToDashboard"
        >Go to Dashboard</OButton>
      </div>

      <!-- Payment Failed State -->
      <div v-else-if="state === 'payment_failed'" class="tw:text-center">
        <OIcon name="error" style="width: 80px; height: 80px;" />
        <h5 class="tw:mt-3">Payment Failed</h5>
        <p class="tw:text-gray-400">
          There was an issue with activating Azure subscription. Please check
          your Azure account or contact support.
        </p>
        <OButton
          as="a"
          href="mailto:support@openobserve.ai"
          variant="primary"
          size="sm-action"
          class="tw:mt-4"
        >Contact Support</OButton>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted } from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getImageURL, useLocalOrganization } from "@/utils/zincutils";
import azureMarketplace from "@/services/azureMarketplace";
import organizationsService from "@/services/organizations";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

type SetupState =
  | "select_org"
  | "no_token"
  | "processing"
  | "success"
  | "payment_failed"
  | "error";

export default defineComponent({
  name: "AzureMarketplaceSetup",
  components: { OButton, OSpinner, OInput, OSelect,
    OIcon, OCard, OCardSection,
},
  setup() {
    const store = useStore();
    const router = useRouter();

    const state = ref<SetupState>("select_org");
    const errorMessage = ref("");
    const isProcessing = ref(false);
    const newOrgName = ref("");
    const orgNameError = ref("");
    const selectedOrg = ref<{ identifier: string; name: string } | null>(null);
    const eligibleOrganizations = ref<{ identifier: string; name: string }[]>(
      []
    );
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

    const createNewOrgForAzure = async () => {
      if (!newOrgName.value) {
        orgNameError.value = "Please enter an organization name";
        return;
      }

      isProcessing.value = true;
      state.value = "processing";

      try {
        // Create the organization
        const orgRes = await organizationsService.create({
          name: newOrgName.value,
        });

        const orgId = orgRes.data.identifier;

        // Link AWS Marketplace subscription
        await linkSubscription(orgId);
      } catch (error: any) {
        console.error("Failed to create organization:", error);
        state.value = "error";
        errorMessage.value =
          error.response?.data?.message || "Failed to create organization";
        isProcessing.value = false;
      }
    };

    const linkToExistingOrg = async () => {
      if (!selectedOrg.value) {
        toast({
          variant: "error",
          message: "Please select an organization",
        });
        return;
      }

      isProcessing.value = true;
      state.value = "processing";

      await linkSubscription(selectedOrg.value.identifier);
    };

    const linkSubscription = async (orgId: string) => {
      try {
        await azureMarketplace.linkSubscription(
          orgId,
          token.value
        );

        // Clear the token from sessionStorage
        sessionStorage.removeItem("azure_marketplace_token");
        state.value = "success";
        isProcessing.value = false;

        // Update selected org in store
        const orgData = {
            identifier: orgId,
            label: newOrgName.value || selectedOrg.value?.name || orgId,
            user_email: store.state.userInfo?.email,
        };
        useLocalOrganization(orgData);
        store.dispatch("setSelectedOrganization", orgData);
      } catch (error: any) {
        console.error("Failed to link subscription:", error);
        state.value = "error";
        errorMessage.value =
          error.response?.data?.message || "Failed to link Azure subscription";
        isProcessing.value = false;
      }
    };

    const goToDashboard = () => {
      sessionStorage.removeItem("azure_marketplace_token");
      router.push({
        path: "/",
        query: activatedOrgId.value
          ? { org_identifier: activatedOrgId.value }
          : undefined,
      });
    };

    const resetAndRetry = () => {
      state.value = "select_org";
      errorMessage.value = "";
      isProcessing.value = false;
    };

    return {
      store,
      state,
      errorMessage,
      isProcessing,
      newOrgName,
      orgNameError,
      selectedOrg,
      eligibleOrganizations,
      getImageURL,
      createNewOrgForAzure,
      linkToExistingOrg,
      goToDashboard,
      resetAndRetry,
    };
  },
});
</script>

<style lang="scss" scoped>
.azure-marketplace-setup {
  min-height: 100vh;
  background: var(--q-background);
}

.appLogo {
  height: 40px;
}

.setup-container {
  max-width: 500px;
  margin: 0 auto;
  padding-top: 60px;
}

.options-container {
  max-width: 400px;
  margin: 0 auto;
}

.option-card {
  border-radius: 8px;
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}
</style>