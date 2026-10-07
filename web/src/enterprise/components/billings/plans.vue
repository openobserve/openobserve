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
  <div class="rounded-default overflow-auto px-4 pt-3" style="min-height: inherit">
    <!-- Page title is supplied by the parent Billing.vue OPageHeader; no local title here. -->
    <TrialPeriod v-if="!isChildOrg" class="mb-3" currentPage="billing"></TrialPeriod>
    <!-- AI Credits card: shown to child orgs too, whose AI use draws on the same credits -->
    <div v-if="aiUsage" class="mb-4 grid w-full grid-cols-1 gap-4">
      <div
        class="bg-card-glass-bg border-card-glass-border rounded-default dark:bg-surface-base dark:border-border-default border p-4 shadow-none transition-shadow duration-200 hover:shadow-sm"
      >
        <div
          class="rounded-default flex min-h-full flex-col justify-between text-center transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        >
          <div class="flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <div class="text-text-heading text-left text-base leading-5 font-medium">
                {{ t("billing.aiCredits") }}
              </div>
              <div class="opacity-80">
                <img :src="aiIcon" />
              </div>
            </div>
            <OTag type="aiMode" :value="aiUsage.mode" class="mt-2" style="width: fit-content" />
          </div>
          <div class="mt-3 mb-2">
            <OProgressBar :value="aiUsageRatio" size="sm" :variant="aiUsageVariant" />
          </div>
          <div class="text-text-body flex items-end text-left text-2xl leading-7 font-semibold">
            {{ aiUsage.credits_used }} / {{ aiUsage.credits_limit }}
            {{ t("billing.aiFreeUsedLabel") }}
          </div>
          <div class="text-text-secondary text-compact mt-1 text-left">
            {{ t("billing.aiFreeOneTime") }}
          </div>
          <div
            v-if="aiUsage.used_by_feature"
            class="text-text-secondary text-compact text-left"
            data-test="billing-ai-used-by-feature"
          >
            {{
              t("billing.aiUsedByFeature", {
                chat: aiUsage.used_by_feature.chat,
                incident: aiUsage.used_by_feature.incident,
                reanalysis: aiUsage.used_by_feature.incident_reanalysis,
              })
            }}
          </div>
          <div
            v-if="aiUsage.mode === 'exhausted'"
            class="text-status-error-text text-compact mt-2 text-left"
          >
            {{
              aiUsage.requires_additional_credits
                ? t("billing.aiContractExhaustedMessage")
                : aiUsage.payer_org_id
                  ? t("billing.aiPayerSubscribeMessage", { payer: aiUsage.payer_org_id })
                  : t("billing.aiExhaustedMessage")
            }}
            <OButton
              v-if="aiUsage.requires_additional_credits"
              variant="ghost"
              size="sm"
              class="ms-1"
              data-test="billing-ai-contact-sales"
              @click="contactSales"
            >
              {{ t("billing.contactLabel") }}
            </OButton>
          </div>
          <PaidAiUsageControl
            :mode="aiUsage.mode"
            class="border-border-default mt-3 border-t pt-3 text-left"
            @change="fetchAiUsage"
          />
        </div>
      </div>
    </div>
    <!-- Managed billing empty state for child orgs -->
    <!-- eslint-disable local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent -->
    <div
      v-if="isChildOrg"
      class="flex min-h-[calc(100vh-var(--navbar-height)-200px)] flex-col items-center justify-center px-6 py-12 text-center"
      data-test="plans-managed-billing-panel"
    >
      <!-- eslint-enable local/no-hardcoded-px -->
      <div
        class="border-accent/30 mb-7 flex h-25 w-25 items-center justify-center rounded-full border border-dashed"
      >
        <div
          class="border-accent/24 bg-accent/10 flex h-17 w-17 items-center justify-center rounded-full border border-solid"
        >
          <OIcon name="account-balance" size="lg" class="text-accent opacity-85" />
        </div>
      </div>

      <div class="mb-2.5 text-xl font-bold tracking-[-0.0125rem]">
        {{ t("billing.billingGroup.plansManagedTitle") }}
      </div>
      <div class="mb-6 max-w-110 text-sm leading-[1.65] opacity-65">
        {{
          t("billing.billingGroup.plansManagedDescription", {
            name: membership?.payer_org_name,
            id: membership?.payer_org_id,
          })
        }}
      </div>

      <div class="mb-8 flex flex-wrap items-center justify-center gap-2">
        <span
          class="border-card-glass-border inline-flex items-center gap-1.25 rounded-full border bg-[color-mix(in_srgb,currentColor_6%,transparent)] px-3 py-1 text-xs font-medium opacity-85"
        >
          <OIcon name="receipt-long" size="xs" />
          {{ t("billing.billingGroup.chipConsolidatedBill") }}
        </span>
        <span
          class="border-card-glass-border inline-flex items-center gap-1.25 rounded-full border bg-[color-mix(in_srgb,currentColor_6%,transparent)] px-3 py-1 text-xs font-medium opacity-85"
        >
          <OIcon name="lock" size="xs" />
          {{ t("billing.billingGroup.chipPlanManaged") }}
        </span>
        <span
          class="border-card-glass-border inline-flex items-center gap-1.25 rounded-full border bg-[color-mix(in_srgb,currentColor_6%,transparent)] px-3 py-1 text-xs font-medium opacity-85"
        >
          <OIcon name="description" size="xs" />
          {{ t("billing.billingGroup.chipNoInvoices") }}
        </span>
      </div>

      <OButton
        variant="primary"
        class="h-10 px-6 py-0 font-semibold"
        data-test="plans-view-org-group-btn"
        @click="goToOrgGroup"
      >
        {{ t("billing.billingGroup.viewOrgGroup") }}
        <template #icon-right>
          <OIcon name="arrow-forward" size="sm" class="ms-1" />
        </template>
      </OButton>
    </div>
    <template v-else>
      <div
        v-if="
          store.state.selectedOrganization.hasOwnProperty('note') &&
          store.state.selectedOrganization.note
        "
        class="text-status-error-text flex items-center justify-start gap-2 ps-6 pb-4 text-xl font-semibold"
      >
        <OIcon name="warning" size="sm" class="pt-2" />
        >{{ store.state.selectedOrganization.note }}
      </div>
      <div v-if="loading" class="text-center text-xl font-medium font-semibold">
        <OSpinner size="md" class="mx-auto mt-3 block text-center" />
      </div>
      <div v-else class="mt-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <ProPlan
          :planType="planType"
          :billingProvider="billingProvider"
          :subscriptionType="subscriptionType"
          :features="proPlanFeatures"
          :pricingError="pricingError"
          @retry-pricing="fetchPricingData"
          @update:proSubscription="onLoadSubscription(config.paidPlan)"
          @update:cancelSubscription="onUnsubscribe"
        ></ProPlan>
        <EnterprisePlan
          :features="enterprisePlanFeatures"
          :pricingError="pricingError"
          @retry-pricing="fetchPricingData"
        ></EnterprisePlan>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import EnterprisePlan from "./enterprisePlan.vue";
import ProPlan from "./proPlan.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import BillingService, { type AiUsage } from "@/services/billings";
import PaidAiUsageControl from "./PaidAiUsageControl.vue";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import { useLocalOrganization, getImageURL } from "@/utils/zincutils";
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
    PaidAiUsageControl,
  },

  emits: ["update:proSubscription"],
  async mounted() {
    this.loading = true;
    this.fetchMembership();
    // Credits and pricing load independently: neither may hold back the other or the plans.
    this.fetchAiUsage();
    this.fetchPricingData();
    await this.loadSubscription();
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
      BillingService.get_billing_group_membership(this.store.state.selectedOrganization.identifier)
        .then((res: any) => {
          this.membership = res.data?.membership ?? null;
        })
        .catch(() => {
          // membership not available
        });
    },
    async fetchAiUsage() {
      try {
        const orgId = this.store.state.selectedOrganization.identifier;
        this.aiUsage = (await BillingService.get_ai_usage(orgId)).data;
      } catch {
        // AI usage is not available.
      }
    },
    contactSales() {
      window.open(siteURL.contactSales, "_blank");
    },
    async fetchPricingData() {
      this.pricingError = false;
      try {
        const response = await fetch(siteURL.pricingJsonUrl, {
          signal: AbortSignal.timeout(10000),
        });
        const json = await response.json();
        const cloudPlans = json?.data?.[0]?.cloud ?? [];
        const mapFeatures = (jsonFeatures: any[]) =>
          jsonFeatures.map((f: any) => ({
            name: f.title,
            price: f.price ?? "",
            is_parent: !f.isSubItem,
          }));
        const payAsYouGo =
          cloudPlans.find((p: any) => p.title?.toLowerCase().includes("pay as you go")) ??
          cloudPlans[0];
        const enterprise =
          cloudPlans.find((p: any) => p.title?.toLowerCase().includes("enterprise")) ??
          cloudPlans[1];

        const proFeatures = payAsYouGo?.features ? mapFeatures(payAsYouGo.features) : [];
        const entFeatures = enterprise?.features ? mapFeatures(enterprise.features) : [];

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
        BillingService.resume_subscription(this.store.state.selectedOrganization.identifier)
          .then(async () => {
            await this.loadSubscription();
          })
          .catch((e) => {
            this.proLoading = false;
            toast({
              variant: "error",
              // The server explains what to fix; axios's own text is only the status code.
              message: e.response?.data?.message ?? e.message,
              timeout: 5000,
            });
          });
      } else {
        BillingService.get_hosted_url(this.store.state.selectedOrganization.identifier, planType)
          .then((res) => {
            window.location.href = res.data.url;
          })
          .catch((e) => {
            this.proLoading = false;
            toast({
              variant: "error",
              message: e.response?.data?.message ?? e.message,
              timeout: 5000,
            });
          });
      }
    },
    async onUnsubscribe() {
      this.onChangePaymentDetail(this.currentPlanDetail.customer_id);
    },
    onChangePaymentDetail(customer_id: string) {
      BillingService.get_session_url(this.store.state.selectedOrganization.identifier, customer_id)
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
    async loadSubscription() {
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
        } else if (this.billingProvider === "" || this.billingProvider === "stripe") {
          // Only show subscribe prompt for Stripe orgs without subscription
          toast({
            variant: "warning",
            message: this.t("toastMessages.billings.pleaseSubscribeToOneOfThe"),
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
    const { t } = useI18nTyped();
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
    const aiUsage = ref<AiUsage | null>(null);
    const aiIcon = computed(() =>
      isDark.value
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg"),
    );
    const aiUsageRatio = computed(() => {
      if (!aiUsage.value || !aiUsage.value.credits_limit) return 0;
      return Math.min(aiUsage.value.credits_used / aiUsage.value.credits_limit, 1);
    });
    // A full bar is healthy once paid usage carries on; only a blocked org is in danger.
    const aiUsageVariant = computed(() => {
      const mode = aiUsage.value?.mode;
      if (mode === "exhausted") return "danger";
      if (mode === "consent_required") return "warning";
      return mode === "free" && aiUsageRatio.value >= 0.8 ? "warning" : "default";
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
      aiUsageVariant,
      proPlanFeatures,
      enterprisePlanFeatures,
      pricingError,
      membership,
      isChildOrg,
    };
  },
});
</script>
