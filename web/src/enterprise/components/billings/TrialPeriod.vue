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
  <div
    v-if="showTrialPeriodMsg"
    class="trial-banner tw:flex tw:items-center tw:gap-3 tw:px-4 tw:py-2 tw:rounded-md tw:w-full"
  >
    <!-- Warning icon -->
    <OIcon name="warning" size="sm" class="tw:shrink-0 trial-banner-icon" />

    <!-- Message + subtitle on one line -->
    <p class="tw:flex-1 tw:min-w-0 tw:m-0 tw:text-sm tw:truncate">
      <strong class="tw:font-semibold">{{ getTrialPeriodMessage() }}</strong>
      <span class="tw:mx-1 tw:opacity-60">·</span>
      <span>Upgrade to a plan to continue enjoying the services by OpenObserve.</span>
    </p>

    <!-- CTA button -->
    <OButton
      v-if="currentPage != 'billing'"
      variant="warning"
      size="xs"
      class="tw:shrink-0"
      @click="redirectBilling"
    >{{ t("billing.upgradeNow") }}</OButton>
    <OButton
      v-else
      variant="warning"
      size="xs"
      class="tw:shrink-0"
      @click="redirectContactSupport"
    >{{ t("billing.contactSupport") }}</OButton>
  </div>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { siteURL } from "@/constants/config";
import { getDueDays } from "@/utils/zincutils";
import BillingService from "@/services/billings";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "TrialPeriod",
  components: { OButton, OIcon },
  props: ["currentPage"],
  methods: {
    getTrialPeriodMessage() {
      if(Object.hasOwn(this.store.state.organizationData.organizationSettings, "free_trial_expiry") && this.store.state.organizationData.organizationSettings.free_trial_expiry != "" && this.store.state.organizationData.organizationSettings.free_trial_expiry != null) {
        let dueDays = this.getDueDays(this.store.state.organizationData.organizationSettings.free_trial_expiry);
        if(dueDays >= 0) {
          if(dueDays > 1) {
            return `${dueDays} Days remaining in your trial account`;
          } else {
            return `${dueDays} Day remaining in your trial account`;
          }
        } else {
          return "Your trial period has expired.";
        }
      }
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router: any = useRouter();

    const hasTrialExpiry = Object.hasOwn(store.state.organizationData.organizationSettings, "free_trial_expiry")
      && store.state.organizationData.organizationSettings.free_trial_expiry != ""
      && store.state.organizationData.organizationSettings.free_trial_expiry != null;

    const showTrialPeriodMsg = ref(hasTrialExpiry);

    // Check if org is on AWS billing - don't show trial message for AWS orgs
    onMounted(async () => {
      try {
        if (config.isCloud === "true") {
          const res = await BillingService.list_subscription(
            store.state.selectedOrganization.identifier
          );
          if (res.data?.provider === "aws") {
            // AWS billing - don't show trial period message
            showTrialPeriodMsg.value = false;
          }
        }
      } catch (e) {
        // If fetch fails, keep the default behavior
        console.error("Failed to fetch billing info:", e);
      }
    });

    const redirectBilling = () => {
      router.push('/billings/plans/')
    };

    const redirectContactSupport = () => {
      window.open(siteURL.contactSupport, "_blank");
    }

    return {
      t,
      store,
      router,
      config,
      redirectBilling,
      getDueDays,
      showTrialPeriodMsg,
      redirectContactSupport,
    };
  },
});
</script>

<style scoped>
.trial-banner {
  background-color: var(--o2-status-warning-bg);
  border: 1px solid var(--o2-status-warning-text);
  color: var(--o2-status-warning-text);
}

.trial-banner-icon {
  color: var(--o2-status-warning-text);
}
</style>