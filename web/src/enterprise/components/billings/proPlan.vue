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
  <q-card class="col o2-card-wrapper">
    <div class="row items-center justify-between q-px-md q-py-sm">
      <div>
        <div class="o2-card-title q-pt-sm">{{ t("billing.proPlanLabel") }}</div>
        <div class="o2-card-subtitle q-mt-sm">{{ t("billing.proPlanSubtitle") }}</div>
      </div>
      <OBadge
        v-if="planType == planName"
        variant="primary-soft"
        class="q-mt-sm text-caption q-px-sm q-py-md"
        style="border-radius: 0px"
      >
        {{ t('billing.subscribed') }}
      </OBadge>
    </div>

    <OSeparator class="tw:my-2" />

    <div class="q-px-md q-py-sm">
      <div class="o2-page-subtitle1">{{ t("billing.features") }}</div>
      <div class="o2-page-subtitle2 q-mb-md q-mt-xs">{{ t("billing.included") }}</div>

      <div
        v-if="pricingError && !features?.length"
        class="row items-center q-mb-sm text-negative"
      >
        <OIcon name="warning" size="sm" class="q-mr-sm" />
        <span class="o2-page-subtitle3"
          >Failed to load pricing details. Please refresh the page.</span
        >
      </div>
      <div v-for="(feature, index) in features" :key="index" class="row items-center justify-between q-mb-sm">
        <div class="row items-center">
          <OIcon v-if="feature.is_parent" name="check-circle" size="sm" class="q-mr-sm" />
          <OIcon v-else name="" color="green" size="16px" class="q-mr-sm" />
          <div class="o2-page-subtitle3">{{ feature.name }}</div>
        </div>
        <div
          v-if="feature.price !== ''"
          class="q-mx-sm"
          style="flex: 1; border-top: 1px dotted #454F5B; height: 0; opacity: 0.4;"
        ></div>
        <div class="o2-page-subtitle3 text-bold">{{ feature.price }}</div>
      </div>
    </div>

    <OSeparator />

    <div class="o2-page-subtitle2 q-px-md q-pt-sm">
      {{ t("billing.unlimitedNote") }}<br />
      {{ t("billing.paymentNote") }}
    </div>

    <div class="row justify-between q-pa-md">
      <!-- AWS Marketplace billing - show managed externally message -->
      <div v-if="billingProvider === 'aws'" class="full-width text-center">
        <OBadge
          variant="success-soft"
          icon="check_circle"
          class="q-px-md q-py-sm"
        >
          Managed via AWS Marketplace
        </OBadge>
        <div class="text-caption text-grey-7 q-mt-sm">
          Billing is handled through your AWS account
        </div>
      </div>
      <div v-else-if="billingProvider === 'azure'" class="full-width text-center">
        <OBadge
          variant="success-soft"
          icon="check_circle"
          class="q-px-md q-py-sm"
        >
          Managed via Azure Marketplace
        </OBadge>
        <div class="text-caption text-grey-7 q-mt-sm">
          Billing is handled through your Azure account
        </div>
      </div>
      <!-- External contract - billed offline, no Stripe portal to open -->
      <div
        v-else-if="subscriptionType === 'external-contract'"
        class="full-width text-center"
      >
        <OBadge
          variant="default"
          icon="description"
          class="q-px-md q-py-sm"
        >
          Managed via contract
        </OBadge>
        <div class="text-caption text-grey-7 q-mt-sm">
          Billing is handled through your contract — contact your account manager for changes
        </div>
      </div>
      <!-- Stripe billing - show subscribe/manage buttons -->
      <OButton
        v-else-if="planType == planName"
        variant="outline"
        size="sm-action"
        block
        @click="cancelSubscription"
      >
        {{ btnCancelSubscription }}
      </OButton>
      <OButton
        v-else
        variant="primary"
        size="sm-action"
        block
        @click="onSubscribe"
      >
        {{ btnSubscribe }}
      </OButton>
    </div>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from '@/lib/core/Button/OButton.vue';
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

export default defineComponent({
  name: "proPlan",
  components: { OButton,
    OBadge,
    OIcon,
},
  props: ["planType", "billingProvider", "subscriptionType", "features", "pricingError"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const planName = "pay-as-you-go";
    const btnCancelSubscription = ref(t('billing.manageSubscription'));
    const btnSubscribe = ref(t('billing.subscribe'));

    const cancelSubscription = () => {
      btnCancelSubscription.value = "Loading...";
      setTimeout(function(){
        btnCancelSubscription.value = t('billing.manageSubscription');
      }, 1000);
      emit("update:cancelSubscription");
    }

    const onSubscribe = () => {
      btnSubscribe.value = "Loading...";
      setTimeout(function(){
        btnSubscribe.value = t('billing.subscribe');
      }, 1000);
      emit("update:proSubscription");
    }

    return {
      t,
      cancelSubscription,
      onSubscribe,
      planName,
      btnSubscribe,
      btnCancelSubscription,
    }
  }
});
</script>

<style scoped>
.full-width {
  width: 100%;
}
</style>
