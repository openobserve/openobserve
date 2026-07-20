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
  <div class="rounded-default px-4 pt-3 overflow-auto" style="min-height: inherit">
    <!-- Page title is supplied by the parent Billing.vue OPageHeader; no local title here. -->
    <!-- Managed billing empty state for child orgs -->
    <div
      v-if="isChildOrg"
      class="flex flex-col items-center justify-center text-center min-h-[calc(100vh-var(--navbar-height)-200px)] py-12 px-6"
      data-test="plans-managed-billing-panel"
    >
      <div class="w-25 h-25 rounded-full border border-dashed border-[color-mix(in_srgb,var(--color-primary-600)_30%,transparent)] flex items-center justify-center mb-7">
        <div class="w-17 h-17 rounded-full bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] border-[1.5px] border-[color-mix(in_srgb,var(--color-primary-600)_24%,transparent)] border-solid flex items-center justify-center">
          <OIcon name="account-balance" size="lg" class="text-primary-600 opacity-85" />
        </div>
      </div>

      <div class="text-xl font-bold tracking-[-0.2px] mb-2.5">
        {{ t("billing.billingGroup.plansManagedTitle") }}
      </div>
      <div class="text-sm leading-[1.65] opacity-65 max-w-110 mb-6">
        {{
          t("billing.billingGroup.plansManagedDescription", {
            name: membership?.payer_org_name,
            id: membership?.payer_org_id,
          })
        }}
      </div>

      <div class="flex items-center gap-2 flex-wrap justify-center mb-8">
        <span class="inline-flex items-center gap-1.25 text-xs font-medium opacity-85 bg-[color-mix(in_srgb,currentColor_6%,transparent)] border border-(--color-card-glass-border,rgba(0,0,0,0.1)) rounded-full py-1 px-3">
          <OIcon name="receipt-long" size="xs" />
          {{ t("billing.billingGroup.chipConsolidatedBill") }}
        </span>
        <span class="inline-flex items-center gap-1.25 text-xs font-medium opacity-85 bg-[color-mix(in_srgb,currentColor_6%,transparent)] border border-(--color-card-glass-border,rgba(0,0,0,0.1)) rounded-full py-1 px-3">
          <OIcon name="lock" size="xs" />
          {{ t("billing.billingGroup.chipPlanManaged") }}
        </span>
        <span class="inline-flex items-center gap-1.25 text-xs font-medium opacity-85 bg-[color-mix(in_srgb,currentColor_6%,transparent)] border border-(--color-card-glass-border,rgba(0,0,0,0.1)) rounded-full py-1 px-3">
          <OIcon name="description" size="xs" />
          {{ t("billing.billingGroup.chipNoInvoices") }}
        </span>
      </div>

      <OButton
        variant="primary"
        class="h-10 py-0 px-6 font-semibold"
        data-test="plans-view-org-group-btn"
        @click="goToOrgGroup"
      >
        {{ t("billing.billingGroup.viewOrgGroup") }}
        <template #icon-right>
          <OIcon name="arrow-forward" size="sm" class="ml-1" />
        </template>
      </OButton>
    </div>
    <template v-else>
    <trial-period class="mb-3" currentPage="billing"></trial-period>
    <!-- AI Credits card -->
    <div v-if="aiUsage" class="grid grid-cols-1 gap-4 w-full mb-4">
      <div class="bg-card-glass-bg border border-card-glass-border rounded-default p-4 shadow-none transition-shadow duration-200 hover:shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:bg-surface-base dark:border-border-default">
        <div class="min-h-full rounded-default transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] text-center flex flex-col justify-between">
          <div class="flex flex-col justify-between">
            <div class="flex justify-between items-center">
              <div class="text-base font-medium leading-5 text-text-heading text-left">{{ t("billing.aiCredits") }}</div>
              <div class="opacity-80">
                <img :src="aiIcon" />
              </div>
            </div>
            <OTag
              type="aiMode"
              :value="aiUsage.mode"
              class="mt-2"
              style="width: fit-content;"
            />
          </div>
          <div class="mt-3 mb-2">
            <OProgressBar
              :value="aiUsageRatio"
              size="sm"
              :variant="aiUsageRatio >= 1 ? 'danger' : aiUsageRatio >= 0.9 ? 'warning' : 'default'"
            />
          </div>
          <div class="text-2xl font-semibold leading-7 text-text-body text-left flex items-end">
            {{ aiUsage.credits_used }} / {{ aiUsage.credits_limit }} credits used
          </div>
          <div v-if="aiUsage.mode === 'exhausted'" class="text-status-error-text mt-2" style="font-size: var(--text-compact);">
            {{ t("billing.aiExhaustedMessage") }}
          </div>
          <div v-else-if="aiUsage.mode === 'pay_as_you_go'" class="text-info mt-2" style="font-size: var(--text-compact);">
            {{ t("billing.aiPaygMessage") }}
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="
        store.state.selectedOrganization.hasOwnProperty('note') &&
        store.state.selectedOrganization.note
      "
      class="flex justify-start items-center gap-2 text-status-error-text text-xl font-semibold pl-6 pb-4"
    >
      <OIcon name="warning" size="sm" class="pt-2" />
      >{{ store.state.selectedOrganization.note }}
    </div>
    <div v-if="loading" class="text-xl font-semibold font-medium text-center">
      <OSpinner size="md" class="mx-auto block text-center mt-3" />
    </div>
    <div v-else class="grid grid-cols-2 gap-3 mt-3">
      <pro-plan
        :planType="planType"
        :billingProvider="billingProvider"
        :subscriptionType="subscriptionType"
        :features="proPlanFeatures"
        :pricingError="pricingError"
        @update:proSubscription="onLoadSubscription(config.paidPlan)"
        @update:cancelSubscription="onUnsubscribe"
      ></pro-plan>
      <enterprise-plan
        :features="enterprisePlanFeatures"
        :pricingError="pricingError"
      ></enterprise-plan>
    </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import EnterprisePlan from "./enterprisePlan.vue";
import ProPlan from "./proPlan.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import BillingService from "@/services/billings";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import { useLocalOrganization, convertToTitleCase, getImageURL } from "@/utils/zincutils";
import config from "@/aws-exports";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import { siteURL } from "@/constants/config";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "plans",
  components: {
    EnterprisePlan,
    ProPlan,
    TrialPeriod,
    OSpinner,
    OProgressBar,
    OIcon,
    OTag,
    OButton,
  },

  emits: ["update:proSubscription"],
  async mounted() {
    this.loading = true;
    this.fetchMembership();
    await Promise.all([this.loadSubscription(), this.fetchPricingData()]);
    this.fetchAiUsage();
  },
  methods: {
    goToOrgGroup() {
      this.$router.push({
        name: "billing_group",
        query: {
          org_identifier: this.store.state.selectedOrganization.identifier,
        },
      });
    },
    fetchMembership() {
      if (config.isCloud !== "true") return;
      BillingService.get_billing_group_membership(
        this.store.state.selectedOrganization.identifier
      )
        .then((res: any) => {
          this.membership = res.data?.membership ?? null;
        })
        .catch(() => {
          // membership not available
        });
    },
    fetchAiUsage() {
      BillingService.get_ai_usage(
        this.store.state.selectedOrganization.identifier
      )
        .then((res: any) => {
          this.aiUsage = res.data;
        })
        .catch(() => {
          // AI usage not available
        });
    },
    async fetchPricingData() {
      try {
        const response = await fetch(siteURL.pricingJsonUrl);
        const json = await response.json();
        const cloudPlans = json?.data?.[0]?.cloud ?? [];
        const mapFeatures = (jsonFeatures: any[]) =>
          jsonFeatures.map((f: any) => ({
            name: f.title,
            price: f.price ?? "",
            is_parent: !f.isSubItem,
          }));
        const payAsYouGo =
          cloudPlans.find((p: any) =>
            p.title?.toLowerCase().includes("pay as you go"),
          ) ?? cloudPlans[0];
        const enterprise =
          cloudPlans.find((p: any) =>
            p.title?.toLowerCase().includes("enterprise"),
          ) ?? cloudPlans[1];

        const proFeatures = payAsYouGo?.features
          ? mapFeatures(payAsYouGo.features)
          : [];
        const entFeatures = enterprise?.features
          ? mapFeatures(enterprise.features)
          : [];

        const diff = proFeatures.length - entFeatures.length + 3;
        const paddedEntFeatures =
          diff > 0
            ? [
                ...entFeatures,
                ...Array.from({ length: diff }, () => ({
                  name: "",
                  price: "",
                  is_parent: false,
                })),
              ]
            : entFeatures;

        this.proPlanFeatures = proFeatures;
        this.enterprisePlanFeatures = paddedEntFeatures;
      } catch {
        this.pricingError = true;
      }
    },
    onLoadSubscription(planType: string) {
      this.proLoading = true;
      if (this.listSubscriptionResponse.card != undefined) {
        BillingService.resume_subscription(
          this.store.state.selectedOrganization.identifier,
        )
          .then(async (res) => {
            await this.loadSubscription(true);
          })
          .catch((e) => {
            this.proLoading = false;
            toast({
              variant: "error",
              message: e.message,
              timeout: 5000,
            });
          });
      } else {
        BillingService.get_hosted_url(
          this.store.state.selectedOrganization.identifier,
          planType,
        )
          .then((res) => {
            window.location.href = res.data.url;
          })
          .catch((e) => {
            toast({
              variant: "error",
              message: e.message,
              timeout: 5000,
            });
          });
      }
    },
    async onUnsubscribe() {
      this.onChangePaymentDetail(this.currentPlanDetail.customer_id);
    },
    onChangePaymentDetail(customer_id: string) {
      BillingService.get_session_url(
        this.store.state.selectedOrganization.identifier,
        customer_id,
      )
        .then((res) => {
          // this.updatePaymentResponse = res.data.data.url;
          // setInterval(this.retrieveHostedPage, 5000);
          if (res.data?.url) {
            window.location.href = res.data.url;
          }
        })
        .catch((e) => {
          toast({
            variant: "error",
            message: e.message,
            timeout: 5000,
          });
        });
    },
    async loadSubscription(fromPro = false) {
      try {
        const res = await BillingService.list_subscription(
          this.store.state.selectedOrganization.identifier,
        );
        this.currentPlanDetail = res.data;
        this.billingProvider = res.data.provider || "";
        this.subscriptionType = res.data.subscription_type || "";

        if (res.data.subscription_type !== "") {
          if (res.data.subscription_type == config.paidPlan) {
            this.planType = config.paidPlan;
            const localOrg: any = useLocalOrganization();
            localOrg.value.subscription_type = config.paidPlan;
            useLocalOrganization(localOrg.value);
            this.store.dispatch("setSelectedOrganization", localOrg.value);
          } else if (res.data.subscription_type == config.enterprisePlan) {
            this.planType = config.enterprisePlan;
            const localOrg: any = useLocalOrganization();
            localOrg.value.subscription_type = config.enterprisePlan;
            useLocalOrganization(localOrg.value);
            this.store.dispatch("setSelectedOrganization", localOrg.value);
          }
        } else if (
          this.billingProvider === "" ||
          this.billingProvider === "stripe"
        ) {
          // Only show subscribe prompt for Stripe orgs without subscription
          toast({
            variant: "warning",
            message: "Please subscribe to one of the plan.",
            timeout: 5000,
          });

          // Redirect to plans page only when there's no valid subscription
          this.$router.push({
            name: "plans",
            query: {
              org_identifier: this.store.state.selectedOrganization.identifier,
            },
          });
        }

        this.loading = false;
        this.proLoading = false;
      } catch (e: any) {
        this.loading = false;
        this.proLoading = false;

        toast({
          variant: "error",
          message: e.message,
          timeout: 5000,
        });
      }
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const { isDark } = useTheme();
    const frmPayment = ref();
    const planType = ref("");
    const isActiveSubscription = ref(false);
    const loading = ref(false);
    const hostedResponse: any = ref();
    const updatePaymentResponse: any = ref();
    const subscriptionref = ref();
    const listSubscriptionResponse: any = ref({});
    const proLoading: any = ref(false);
    const currentPlanDetail = ref();
    const billingProvider = ref("");
    const subscriptionType = ref("");
    const aiUsage = ref<any>(null);
    const aiIcon = computed(() =>
      isDark.value
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg")
    );
    const aiUsageRatio = computed(() => {
      if (!aiUsage.value || !aiUsage.value.credits_limit) return 0;
      return Math.min(aiUsage.value.credits_used / aiUsage.value.credits_limit, 1);
    });
    const proPlanFeatures: any = ref([]);
    const enterprisePlanFeatures: any = ref([]);
    const pricingError = ref(false);
    const membership = ref<any>(null);
    const isChildOrg = computed(() => membership.value != null);

    const retrieveHostedPage = () => {
      BillingService.retrieve_hosted_page(
        store.state.selectedOrganization.identifier,
        hostedResponse.value.id,
      ).then((res) => {
        if (res.data.data.hosted_page.state == "succeeded") {
          window.location.reload();
        }
        // clearTimeout(hostedPageTimeout);
      });
    };

    return {
      t,
      store,
      config,
      frmPayment,
      planType,
      isActiveSubscription,
      loading,
      hostedResponse,
      subscriptionref,
      listSubscriptionResponse,
      updatePaymentResponse,
      retrieveHostedPage,
      proLoading,
      currentPlanDetail,
      billingProvider,
      subscriptionType,
      aiUsage,
      aiIcon,
      aiUsageRatio,
      proPlanFeatures,
      enterprisePlanFeatures,
      pricingError,
      membership,
      isChildOrg,
    };
  },
});
</script>