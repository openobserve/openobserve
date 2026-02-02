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
  <q-page class="q-px-lg q-pt-md" style="min-height: inherit; overflow: auto;">
    <div class="row justify-between items-center">
      <div>
        <span class="o2-page-title">{{ t("billing.title") }}</span><br />
        <span class="o2-page-subtitle">{{ t("billing.subtitle") }}</span>
      </div>
    </div>
    <trial-period class="q-mb-md" currentPage="billing"></trial-period>
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
        @update:proSubscription="onLoadSubscription(config.paidPlan)"
        @update:cancelSubscription="onUnsubscribe"
      ></pro-plan>
      <enterprise-plan></enterprise-plan>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import EnterprisePlan from "./enterprisePlan.vue";
import ProPlan from "./proPlan.vue";
import BillingService from "@/services/billings";
import { useStore } from "vuex";
import { useQuasar, date } from "quasar";
import { useLocalOrganization, convertToTitleCase } from "@/utils/zincutils";
import config from "@/aws-exports";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";

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
    await this.loadSubscription();
  },
  methods: {
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
      this.onChangePaymentDetail(this.currentPlanDetail.customer_id)
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
    try{
      const res = await BillingService.list_subscription(this.store.state.selectedOrganization.identifier);
        this.currentPlanDetail = res.data;

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
        } else {
          this.$q.notify({
            type: "warning",
            message: "Please subscribe to one of the plan.",
            timeout: 5000,
          });
        }
        this.loading = false;
        this.proLoading = false;
        this.$router.push({
          name: "plans",
          query: {
            org_identifier: this.store.state.selectedOrganization.identifier,
          },
        });
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
    };
  },
});
</script>
<style lang="scss" scoped>
.subtitle {
  color: $primary;
}
</style>
