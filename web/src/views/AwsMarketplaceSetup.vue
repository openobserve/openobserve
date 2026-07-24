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
  <div class="aws-marketplace-setup bg-surface-base min-h-screen">
    <div class="relative-position flex px-3 pt-2">
      <img
        data-test="aws-marketplace-setup-logo"
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
        <h5 class="mt-3">{{ t("awsMarketplace.noTokenFound") }}</h5>
        <p class="text-text-secondary">
          {{ t("awsMarketplace.noTokenDescription") }}
        </p>
        <OButton variant="primary" size="sm-action" class="mt-4" @click="goToDashboard">{{
          t("awsMarketplace.goToDashboard")
        }}</OButton>
      </div>

      <!-- Error State -->
      <div v-else-if="state === 'error'" class="text-center">
        <OIcon name="error" style="width: 80px; height: 80px" />
        <h5 class="mt-3">{{ errorMessage }}</h5>
        <OButton variant="primary" size="sm-action" class="mt-4" @click="resetAndRetry">{{
          t("awsMarketplace.tryAgain")
        }}</OButton>
      </div>

      <!-- Org Selection/Creation -->
      <div v-else-if="state === 'select_org'" class="text-center">
        <OIcon name="cloud" style="width: 60px; height: 60px" />
        <h4 class="mt-3">{{ t("awsMarketplace.completeSetup") }}</h4>
        <p class="text-text-secondary mb-4">
          {{ t("awsMarketplace.linkSubscriptionDescription") }}
        </p>

        <div class="mx-auto max-w-100">
          <!-- Create New Org -->
          <OCard
            class="rounded-default mb-4 transition-all duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
          >
            <OCardSection role="body">
              <div class="text-xl font-semibold">{{ t("awsMarketplace.createNewOrg") }}</div>
              <p class="text-text-secondary">
                {{ t("awsMarketplace.createNewOrgDescription") }}
              </p>
              <OForm
                id="aws-create-org-form"
                :schema="awsCreateOrgSchema"
                :default-values="awsCreateOrgDefaults()"
                @submit="createNewOrgWithAws"
                v-slot="{ isSubmitting }"
              >
                <OFormInput
                  name="newOrgName"
                  data-test="aws-marketplace-org-name"
                  :label="t('awsMarketplace.orgName')"
                  required
                  class="mb-3"
                />
                <OButton
                  data-test="aws-marketplace-create-link-btn"
                  type="submit"
                  variant="primary"
                  size="sm-action"
                  block
                  :loading="isSubmitting"
                  >{{ t("awsMarketplace.createAndLink") }}</OButton
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
              <div class="text-xl font-semibold">{{ t("awsMarketplace.linkToExisting") }}</div>
              <p class="text-text-secondary">
                {{ t("awsMarketplace.linkBillingDescription") }}
              </p>
              <OForm
                id="aws-link-org-form"
                :schema="awsLinkOrgSchema"
                :default-values="awsLinkOrgDefaults()"
                @submit="linkToExistingOrg"
                v-slot="{ isSubmitting }"
              >
                <!-- label-key/value-key map the fields; SelectOptionInput's required `label` doesn't apply -->
                <OFormSelect
                  name="selectedOrg"
                  :options="eligibleOrganizations as any[]"
                  label-key="name"
                  value-key="identifier"
                  :label="t('awsMarketplace.selectOrganization')"
                  required
                  class="mb-3"
                />
                <OButton
                  type="submit"
                  variant="primary"
                  size="sm-action"
                  block
                  :loading="isSubmitting"
                  >{{ t("awsMarketplace.linkAwsBilling") }}</OButton
                >
              </OForm>
            </OCardSection>
          </OCard>
        </div>
      </div>

      <!-- Processing State -->
      <div v-else-if="state === 'processing'" class="text-center">
        <OSpinner variant="dots" size="xl" />
        <h5 class="mt-3">{{ t("awsMarketplace.settingUp") }}</h5>
        <p class="text-text-secondary">{{ t("awsMarketplace.pleaseWait") }}</p>
      </div>

      <!-- Pending Activation State -->
      <div v-else-if="state === 'pending_activation'" class="text-center">
        <h5 class="mb-4">{{ t("awsMarketplace.waitingConfirmation") }}</h5>
        <div class="flex justify-center">
          <OSpinner size="xl" />
        </div>
        <p class="text-text-secondary mt-4">
          {{ t("awsMarketplace.pendingActivationDescription") }}
        </p>
      </div>

      <!-- Success State -->
      <div v-else-if="state === 'success'" class="text-center">
        <OIcon name="check-circle" style="width: 80px; height: 80px" />
        <h4 class="mt-3">{{ t("awsMarketplace.subscriptionActivated") }}</h4>
        <p class="text-text-secondary">
          {{ t("awsMarketplace.activatedDescription") }}
        </p>
        <OButton variant="primary" size="sm-action" class="mt-4" @click="goToDashboard">{{
          t("awsMarketplace.goToDashboard")
        }}</OButton>
      </div>

      <!-- Payment Failed State -->
      <div v-else-if="state === 'payment_failed'" class="text-center">
        <OIcon name="error" style="width: 80px; height: 80px" />
        <h5 class="mt-3">{{ t("awsMarketplace.paymentFailed") }}</h5>
        <p class="text-text-secondary">
          {{ t("awsMarketplace.paymentFailedDescription") }}
        </p>
        <OButton
          as="a"
          href="mailto:support@openobserve.ai"
          variant="primary"
          size="sm-action"
          class="mt-4"
          >{{ t("awsMarketplace.contactSupport") }}</OButton
        >
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
import { useTheme } from "@/composables/useTheme";
import { useI18n } from "vue-i18n";
import { getImageURL, useLocalOrganization } from "@/utils/zincutils";
import awsMarketplace from "@/services/awsMarketplace";
import organizationsService from "@/services/organizations";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import {
  makeAwsCreateOrgSchema,
  awsCreateOrgDefaults,
  makeAwsLinkOrgSchema,
  awsLinkOrgDefaults,
  type AwsCreateOrgForm,
  type AwsLinkOrgForm,
} from "./AwsMarketplaceSetup.schema";
// NOTE: the old `toast` import was removed — the empty-selection guard is now
// schema-driven (z.string().min(1)), not an imperative toast.

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
  components: { OButton, OSpinner, OForm, OFormInput, OFormSelect, OIcon, OCard, OCardSection },
  setup() {
    const store = useStore();
    const { isDark } = useTheme();
    const router = useRouter();
    const { t } = useI18n();

    // Factory-built so the required messages resolve through i18n.
    const awsCreateOrgSchema = makeAwsCreateOrgSchema(t);
    const awsLinkOrgSchema = makeAwsLinkOrgSchema(t);

    const state = ref<SetupState>("select_org");
    const errorMessage = ref("");
    const eligibleOrganizations = ref<{ identifier: string; name: string }[]>([]);
    const token = ref("");
    const activatedOrgId = ref("");
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    // Helper to get cookie value
    const getCookie = (name: string): string | null => {
      const match = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]+)"));
      return match ? decodeURIComponent(match[2]) : null;
    };

    // Helper to delete cookie
    const deleteCookie = (name: string) => {
      document.cookie = name + "=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;";
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

    // Plain async @submit handler — the schema already gated `value.newOrgName`
    // (required), so no imperative empty-check is needed. The Save spinner is
    // form-driven (OForm awaits this handler).
    const createNewOrgWithAws = async (value: AwsCreateOrgForm) => {
      state.value = "processing";

      try {
        // Create the organization
        const orgRes = await organizationsService.create({
          name: value.newOrgName,
        });

        const orgId = orgRes.data.identifier;

        // Link AWS Marketplace subscription
        await linkSubscription(orgId, value.newOrgName);
      } catch (error: any) {
        console.error("Failed to create organization:", error);
        state.value = "error";
        errorMessage.value = error.response?.data?.message || "Failed to create organization";
      }
    };

    // `value.selectedOrg` is the org identifier (OSelect value-key="identifier").
    const linkToExistingOrg = async (value: AwsLinkOrgForm) => {
      state.value = "processing";

      const org = eligibleOrganizations.value.find((o) => o.identifier === value.selectedOrg);
      await linkSubscription(value.selectedOrg, org?.name ?? value.selectedOrg);
    };

    const linkSubscription = async (orgId: string, orgLabel: string) => {
      try {
        const response = await awsMarketplace.linkSubscription(orgId, token.value);

        if (response.data.success) {
          // Clear the token cookie immediately after successful link
          // The token has been used (ResolveCustomer called) and can't be reused
          deleteCookie("aws_marketplace_token");
          token.value = "";

          activatedOrgId.value = orgId;
          state.value = "pending_activation";

          // Start polling for activation status
          startPolling(orgId, response.data.customer_identifier, orgLabel);
        } else {
          throw new Error(response.data.message || "Link subscription failed");
        }
      } catch (error: any) {
        console.error("Failed to link subscription:", error);
        state.value = "error";
        errorMessage.value = error.response?.data?.message || "Failed to link AWS subscription";
      }
    };

    const startPolling = (orgId: string, customerIdentifier: string, orgLabel: string) => {
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes at 5 second intervals

      pollInterval = setInterval(async () => {
        attempts++;

        try {
          const response = await awsMarketplace.getActivationStatus(orgId, customerIdentifier);

          const status = response.data.status;

          if (status === "active") {
            if (pollInterval) clearInterval(pollInterval);
            state.value = "success";

            // Update selected org in store
            const orgData = {
              identifier: orgId,
              label: orgLabel || orgId,
              user_email: store.state.userInfo?.email,
            };
            useLocalOrganization(orgData);
            store.dispatch("setSelectedOrganization", orgData);
          } else if (status === "payment_failed") {
            if (pollInterval) clearInterval(pollInterval);
            state.value = "payment_failed";
          } else if (attempts >= maxAttempts) {
            if (pollInterval) clearInterval(pollInterval);
            state.value = "error";
            errorMessage.value =
              "Activation timeout. Please contact support if the issue persists.";
          }
        } catch (error) {
          console.error("Poll error:", error);
        }
      }, 5000);
    };

    const goToDashboard = () => {
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
      t,
      store,
      isDark,
      state,
      errorMessage,
      eligibleOrganizations,
      getImageURL,
      // Schemas + typed default factories must be returned from setup() so the
      // Options-API template can resolve `:schema` / `:default-values`
      // (a module-level import would be out of the template's scope).
      awsCreateOrgSchema,
      awsCreateOrgDefaults,
      awsLinkOrgSchema,
      awsLinkOrgDefaults,
      createNewOrgWithAws,
      linkToExistingOrg,
      goToDashboard,
      resetAndRetry,
    };
  },
});
</script>
