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
  <q-page class="q-px-lg q-pt-md" style="min-height: inherit; overflow: auto">
    <div class="row justify-between items-center">
      <div>
        <span class="o2-page-title">{{ t("billing.title") }}</span
        ><br />
        <span class="o2-page-subtitle">{{ t("billing.subtitle") }}</span>
      </div>
    </div>
    <trial-period class="q-mb-md" currentPage="billing"></trial-period>
    <!-- AI Credits card -->
    <div v-if="aiUsage" class="tw:grid tw:grid-cols-1 tw:gap-4 tw:w-full tw:mb-4">
      <div class="feature-card">
        <div class="tile-content text-center column justify-between">
          <div class="column justify-between">
            <div class="row justify-between items-center">
              <div class="usage-tile-title">{{ t("billing.aiCredits") }}</div>
              <div style="opacity: 0.8;">
                <img :src="aiIcon" />
              </div>
            </div>
            <q-badge
              :color="aiModeBadgeColor"
              :label="aiModeLabel"
              class="q-mt-sm"
              style="width: fit-content;"
            />
          </div>
          <div class="q-mt-md q-mb-sm">
            <q-linear-progress
              :value="aiUsageRatio"
              size="12px"
              rounded
              :color="aiUsageRatio >= 1 ? 'negative' : aiUsageRatio >= 0.9 ? 'warning' : 'primary'"
              track-color="grey-3"
            />
          </div>
          <div class="usage-data-to-display row items-end">
            {{ aiUsage.credits_used }} / {{ aiUsage.credits_limit }} credits used
          </div>
          <div v-if="aiUsage.mode === 'exhausted'" class="text-negative q-mt-sm" style="font-size: 13px;">
            {{ t("billing.aiExhaustedMessage") }}
          </div>
          <div v-else-if="aiUsage.mode === 'pay_as_you_go'" class="text-info q-mt-sm" style="font-size: 13px;">
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
      class="row justify-start warning-message text-negative text-h6 q-pl-xl q-pb-lg"
    >
      <q-icon name="warning" class="q-pt-sm"></q-icon
      >{{ store.state.selectedOrganization.note }}
    </div>
    <div v-if="loading">
      <q-spinner-dots
        color="primary"
        size="40px"
        style="margin: 0 auto; display: block"
      />
    </div>
    <div v-else class="row q-gutter-md justify-center">
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
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import EnterprisePlan from "./enterprisePlan.vue";
import ProPlan from "./proPlan.vue";
import BillingService from "@/services/billings";
import { useStore } from "vuex";
import { useQuasar, date } from "quasar";
import { useLocalOrganization, convertToTitleCase, getImageURL } from "@/utils/zincutils";
import config from "@/aws-exports";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import { siteURL } from "@/constants/config";

export default defineComponent({
  name: "plans",
  components: {
    EnterprisePlan,
    ProPlan,
    TrialPeriod,
  },
  emits: ["update:proSubscription"],
  async mounted() {
    this.loading = true;
    await Promise.all([this.loadSubscription(), this.fetchPricingData()]);
    this.fetchAiUsage();
  },
  methods: {
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
            this.$q.notify({
              type: "negative",
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
            this.$q.notify({
              type: "negative",
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
          this.$q.notify({
            type: "negative",
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
          this.$q.notify({
            type: "warning",
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

        this.$q.notify({
          type: "negative",
          message: e.message,
          timeout: 5000,
        });
      }
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
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
    const aiModeBadgeColor = computed(() => {
      if (!aiUsage.value) return 'grey';
      switch (aiUsage.value.mode) {
        case 'pay_as_you_go': return 'blue';
        case 'exhausted': return 'red';
        default: return 'green';
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
      aiModeBadgeColor,
      aiModeLabel,
      proPlanFeatures,
      enterprisePlanFeatures,
      pricingError,
    };
  },
});
</script>
<style lang="scss" scoped>
.subtitle {
  color: $primary;
}
</style>
