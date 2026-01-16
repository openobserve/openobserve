<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="aws-marketplace-setup">
    <div class="flex relative-position tw-px-3 tw-pt-2">
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

    <div class="setup-container q-pa-xl">
      <!-- No Token Error -->
      <div v-if="state === 'no_token'" class="text-center">
        <q-icon name="warning" size="80px" color="warning" />
        <h5 class="q-mt-md">No Marketplace Token Found</h5>
        <p class="text-grey-7">
          Please start the registration process from AWS Marketplace.
        </p>
        <q-btn
          color="primary"
          label="Go to Dashboard"
          @click="goToDashboard"
          class="q-mt-lg"
        />
      </div>

      <!-- Error State -->
      <div v-else-if="state === 'error'" class="text-center">
        <q-icon name="error" size="80px" color="negative" />
        <h5 class="q-mt-md">{{ errorMessage }}</h5>
        <q-btn
          color="primary"
          label="Try Again"
          @click="resetAndRetry"
          class="q-mt-lg"
        />
      </div>

      <!-- Org Selection/Creation -->
      <div v-else-if="state === 'select_org'" class="text-center">
        <q-icon name="cloud" size="60px" color="primary" />
        <h4 class="q-mt-md">Complete AWS Marketplace Setup</h4>
        <p class="text-grey-7 q-mb-lg">
          Link your AWS Marketplace subscription to an organization
        </p>

        <div class="options-container">
          <!-- Create New Org -->
          <q-card flat bordered class="option-card q-mb-md">
            <q-card-section>
              <div class="text-h6">Create New Organization</div>
              <p class="text-grey-7">
                Create a new organization with AWS Marketplace billing
              </p>
              <q-input
                v-model="newOrgName"
                label="Organization Name"
                outlined
                dense
                class="q-mb-md"
                :rules="[(val) => !!val || 'Organization name is required']"
              />
              <q-btn
                color="primary"
                label="Create & Link"
                @click="createNewOrgWithAws"
                :loading="isProcessing"
                :disable="!newOrgName"
                class="full-width"
              />
            </q-card-section>
          </q-card>

          <!-- Link to Existing Org (only show orgs without billing) -->
          <q-card
            v-if="eligibleOrganizations.length > 0"
            flat
            bordered
            class="option-card"
          >
            <q-card-section>
              <div class="text-h6">Link to Existing Organization</div>
              <p class="text-grey-7">
                Link AWS billing to an existing organization
              </p>
              <q-select
                v-model="selectedOrg"
                :options="eligibleOrganizations"
                option-label="name"
                option-value="identifier"
                label="Select Organization"
                outlined
                dense
                class="q-mb-md"
              />
              <q-btn
                color="primary"
                label="Link AWS Billing"
                @click="linkToExistingOrg"
                :loading="isProcessing"
                :disable="!selectedOrg"
                class="full-width"
              />
            </q-card-section>
          </q-card>
        </div>
      </div>

      <!-- Processing State -->
      <div v-else-if="state === 'processing'" class="text-center">
        <q-spinner-dots size="60px" color="primary" />
        <h5 class="q-mt-md">Setting up your subscription...</h5>
        <p class="text-grey-7">Please wait while we configure your account.</p>
      </div>

      <!-- Pending Activation State -->
      <div v-else-if="state === 'pending_activation'" class="text-center">
        <h5 class="q-mb-lg">Waiting for AWS Confirmation</h5>
        <div class="flex justify-center">
          <q-spinner-gears size="80px" color="primary" />
        </div>
        <p class="text-grey-7 q-mt-lg">
          Please wait while we confirm activation with AWS and set up your account.
        </p>
      </div>

      <!-- Success State -->
      <div v-else-if="state === 'success'" class="text-center">
        <q-icon name="check_circle" size="80px" color="positive" />
        <h4 class="q-mt-md">Subscription Activated!</h4>
        <p class="text-grey-7">
          Your AWS Marketplace subscription is now active.
        </p>
        <q-btn
          color="primary"
          label="Go to Dashboard"
          @click="goToDashboard"
          class="q-mt-lg"
          size="lg"
        />
      </div>

      <!-- Payment Failed State -->
      <div v-else-if="state === 'payment_failed'" class="text-center">
        <q-icon name="error" size="80px" color="negative" />
        <h5 class="q-mt-md">Payment Failed</h5>
        <p class="text-grey-7">
          There was an issue with your AWS Marketplace payment. Please check
          your AWS account or contact AWS support.
        </p>
        <q-btn
          color="primary"
          label="Contact Support"
          href="mailto:support@openobserve.ai"
          class="q-mt-lg"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { getImageURL, useLocalOrganization } from "@/utils/zincutils";
import awsMarketplace from "@/services/awsMarketplace";
import organizationsService from "@/services/organizations";

type SetupState =
  | "select_org"
  | "no_token"
  | "processing"
  | "pending_activation"
  | "success"
  | "payment_failed"
  | "error";

export default defineComponent({
  name: "AwsMarketplaceSetup",
  setup() {
    const store = useStore();
    const router = useRouter();
    const q = useQuasar();

    const state = ref<SetupState>("select_org");
    const errorMessage = ref("");
    const isProcessing = ref(false);
    const newOrgName = ref("");
    const selectedOrg = ref<{ identifier: string; name: string } | null>(null);
    const eligibleOrganizations = ref<{ identifier: string; name: string }[]>(
      []
    );
    const token = ref("");
    const activatedOrgId = ref("");
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    // Helper to get cookie value
    const getCookie = (name: string): string | null => {
      const match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]+)'));
      return match ? decodeURIComponent(match[2]) : null;
    };

    // Helper to delete cookie
    const deleteCookie = (name: string) => {
      document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    };

    onMounted(async () => {
      // Get token from cookie (set by backend at /api/aws-marketplace/register)
      token.value = getCookie("aws_marketplace_token") || "";

      if (!token.value) {
        state.value = "no_token";
        return;
      }

      // Fetch user's organizations
      await fetchOrganizations();
    });

    onUnmounted(() => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
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

    const createNewOrgWithAws = async () => {
      if (!newOrgName.value) {
        q.notify({
          type: "negative",
          message: "Please enter an organization name",
        });
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
        q.notify({
          type: "negative",
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
        const response = await awsMarketplace.linkSubscription(
          orgId,
          token.value
        );

        if (response.data.success) {
          // Clear the token cookie immediately after successful link
          // The token has been used (ResolveCustomer called) and can't be reused
          deleteCookie("aws_marketplace_token");
          token.value = "";

          activatedOrgId.value = orgId;
          state.value = "pending_activation";

          // Start polling for activation status
          startPolling(orgId, response.data.customer_identifier);
        } else {
          throw new Error(response.data.message || "Link subscription failed");
        }
      } catch (error: any) {
        console.error("Failed to link subscription:", error);
        state.value = "error";
        errorMessage.value =
          error.response?.data?.message || "Failed to link AWS subscription";
        isProcessing.value = false;
      }
    };

    const startPolling = (orgId: string, customerIdentifier: string) => {
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes at 5 second intervals

      pollInterval = setInterval(async () => {
        attempts++;

        try {
          const response = await awsMarketplace.getActivationStatus(
            orgId,
            customerIdentifier
          );

          const status = response.data.status;

          if (status === "active") {
            if (pollInterval) clearInterval(pollInterval);
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
          } else if (status === "payment_failed") {
            if (pollInterval) clearInterval(pollInterval);
            state.value = "payment_failed";
            isProcessing.value = false;
          } else if (attempts >= maxAttempts) {
            if (pollInterval) clearInterval(pollInterval);
            state.value = "error";
            errorMessage.value =
              "Activation timeout. Please contact support if the issue persists.";
            isProcessing.value = false;
          }
        } catch (error) {
          console.error("Poll error:", error);
        }
      }, 5000);
    };

    const goToDashboard = () => {
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
      selectedOrg,
      eligibleOrganizations,
      getImageURL,
      createNewOrgWithAws,
      linkToExistingOrg,
      goToDashboard,
      resetAndRetry,
    };
  },
});
</script>

<style lang="scss" scoped>
.aws-marketplace-setup {
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
