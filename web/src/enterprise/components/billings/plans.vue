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
  <div class="tw:rounded-md tw:px-4 tw:pt-3" style="min-height: inherit; overflow: auto">
    <div v-if="!isChildOrg" class="tw:flex tw:justify-between tw:items-center">
      <div>
        <h1 class="tw:text-2xl tw:font-bold tw:leading-9 tw:text-(--o2-text-heading) tw:mt-0 tw:mr-0 tw:mb-2 tw:ml-0 tw:block">{{ t("billing.title") }}</h1>
        <p class="tw:text-base tw:font-semibold tw:leading-[1.375rem] tw:text-(--o2-text-secondary) tw:m-0 tw:block">{{ t("billing.subtitle") }}</p>
      </div>
    </div>
    <!-- Managed billing empty state for child orgs -->
    <div
      v-if="isChildOrg"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:text-center tw:min-h-[calc(100vh-var(--navbar-height)-200px)] tw:py-12 tw:px-6"
      data-test="plans-managed-billing-panel"
    >
      <div class="tw:w-[100px] tw:h-[100px] tw:rounded-full tw:border tw:border-dashed tw:border-[color-mix(in_srgb,var(--color-primary-600)_30%,transparent)] tw:flex tw:items-center tw:justify-center tw:mb-7">
        <div class="tw:w-[68px] tw:h-[68px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] tw:border-[1.5px] tw:border-[color-mix(in_srgb,var(--color-primary-600)_24%,transparent)] tw:border-solid tw:flex tw:items-center tw:justify-center">
          <OIcon name="account-balance" size="lg" class="tw:text-(--color-primary-600) tw:opacity-85" />
        </div>
      </div>

      <div class="tw:text-[1.2rem] tw:font-bold tw:tracking-[-0.2px] tw:mb-[10px]">
        {{ t("billing.billingGroup.plansManagedTitle") }}
      </div>
      <div class="tw:text-[0.88rem] tw:leading-[1.65] tw:opacity-65 tw:max-w-[440px] tw:mb-6">
        {{
          t("billing.billingGroup.plansManagedDescription", {
            name: membership?.payer_org_name,
            id: membership?.payer_org_id,
          })
        }}
      </div>

      <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap tw:justify-center tw:mb-8">
        <span class="tw:inline-flex tw:items-center tw:gap-[5px] tw:text-xs tw:font-medium tw:opacity-85 tw:bg-[color-mix(in_srgb,currentColor_6%,transparent)] tw:border tw:border-(--o2-border-color,rgba(0,0,0,0.1)) tw:rounded-[20px] tw:py-1 tw:px-3">
          <OIcon name="receipt-long" size="xs" />
          {{ t("billing.billingGroup.chipConsolidatedBill") }}
        </span>
        <span class="tw:inline-flex tw:items-center tw:gap-[5px] tw:text-xs tw:font-medium tw:opacity-85 tw:bg-[color-mix(in_srgb,currentColor_6%,transparent)] tw:border tw:border-(--o2-border-color,rgba(0,0,0,0.1)) tw:rounded-[20px] tw:py-1 tw:px-3">
          <OIcon name="lock" size="xs" />
          {{ t("billing.billingGroup.chipPlanManaged") }}
        </span>
        <span class="tw:inline-flex tw:items-center tw:gap-[5px] tw:text-xs tw:font-medium tw:opacity-85 tw:bg-[color-mix(in_srgb,currentColor_6%,transparent)] tw:border tw:border-(--o2-border-color,rgba(0,0,0,0.1)) tw:rounded-[20px] tw:py-1 tw:px-3">
          <OIcon name="description" size="xs" />
          {{ t("billing.billingGroup.chipNoInvoices") }}
        </span>
      </div>

      <OButton
        variant="primary"
        class="tw:h-10 tw:py-0 tw:px-6 tw:font-semibold"
        data-test="plans-view-org-group-btn"
        @click="goToOrgGroup"
      >
        {{ t("billing.billingGroup.viewOrgGroup") }}
        <template #icon-right>
          <OIcon name="arrow-forward" size="sm" class="tw:ml-1" />
        </template>
      </OButton>
    </div>
    <template v-else>
    <trial-period class="tw:mb-3" currentPage="billing"></trial-period>
    <!-- AI Credits card -->
    <div v-if="aiUsage" class="tw:grid tw:grid-cols-1 tw:gap-4 tw:w-full tw:mb-4">
      <div class="feature-card tw:bg-(--o2-card-bg) tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:p-4 tw:shadow-none tw:transition-shadow tw:duration-200 tw:hover:shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
        <div class="tw:min-h-full tw:rounded-lg tw:transition-all tw:duration-300 tw:ease-[cubic-bezier(0.4,0,0.2,1)] tw:text-center tw:flex tw:flex-col tw:justify-between">
          <div class="tw:flex tw:flex-col tw:justify-between">
            <div class="tw:flex tw:justify-between tw:items-center">
              <div class="tw:text-base tw:font-medium tw:leading-5 tw:text-(--o2-text-heading) tw:text-left">{{ t("billing.aiCredits") }}</div>
              <div style="opacity: 0.8;">
                <img :src="aiIcon" />
              </div>
            </div>
            <OBadge
              :variant="aiModeBadgeVariant"
              class="tw:mt-2"
              style="width: fit-content;"
            >{{ aiModeLabel }}</OBadge>
          </div>
          <div class="tw:mt-3 tw:mb-2">
            <OProgressBar
              :value="aiUsageRatio"
              size="sm"
              :variant="aiUsageRatio >= 1 ? 'danger' : aiUsageRatio >= 0.9 ? 'warning' : 'default'"
            />
          </div>
          <div class="tw:text-2xl tw:font-semibold tw:leading-7 tw:text-(--o2-text-heading) tw:text-left tw:flex tw:items-end">
            {{ aiUsage.credits_used }} / {{ aiUsage.credits_limit }} credits used
          </div>
          <div v-if="aiUsage.mode === 'exhausted'" class="tw:text-red-500 tw:mt-2" style="font-size: 13px;">
            {{ t("billing.aiExhaustedMessage") }}
          </div>
          <div v-else-if="aiUsage.mode === 'pay_as_you_go'" class="text-info tw:mt-2" style="font-size: 13px;">
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
      class="tw:flex tw:justify-start tw:items-center tw:gap-2 tw:text-red-500 tw:text-xl tw:font-semibold tw:pl-6 tw:pb-4"
    >
      <OIcon name="warning" size="sm" class="tw:pt-2" />
      >{{ store.state.selectedOrganization.note }}
    </div>
    <div v-if="loading" class="tw:text-xl tw:font-semibold text-weight-medium tw:text-center">
      <OSpinner size="md" class="tw:mx-auto tw:block tw:text-center tw:mt-3" />
    </div>
    <div v-else class="tw:grid tw:grid-cols-2 tw:gap-3 tw:mt-3">
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
import { useLocalOrganization, convertToTitleCase, getImageURL } from "@/utils/zincutils";
import config from "@/aws-exports";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import { siteURL } from "@/constants/config";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
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
    OBadge,
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
      store.state.theme === "dark"
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg")
    );
    const aiUsageRatio = computed(() => {
      if (!aiUsage.value || !aiUsage.value.credits_limit) return 0;
      return Math.min(aiUsage.value.credits_used / aiUsage.value.credits_limit, 1);
    });
    const aiModeBadgeVariant = computed(() => {
      if (!aiUsage.value) return 'default';
      switch (aiUsage.value.mode) {
        case 'pay_as_you_go': return 'primary';
        case 'exhausted': return 'error';
        default: return 'success';
      }
    });
    const aiModeLabel = computed(() => {
      if (!aiUsage.value) return '';
      switch (aiUsage.value.mode) {
        case 'pay_as_you_go': return t("billing.aiModePayAsYouGo");
        case 'exhausted': return t("billing.aiModeExhausted");
        default: return t("billing.aiModeFree");
      }
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
      aiModeBadgeVariant,
      aiModeLabel,
      proPlanFeatures,
      enterprisePlanFeatures,
      pricingError,
      membership,
      isChildOrg,
    };
  },
});
</script>
<style>
.body--dark .feature-card {
  background: var(--o2-card-background);
  border-color: var(--o2-border);
}
</style>
