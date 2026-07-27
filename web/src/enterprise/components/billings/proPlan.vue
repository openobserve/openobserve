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
  <OCard
    class="border-card-glass-border bg-card-glass-bg rounded-default dark:bg-surface-base dark:border-border-default flex h-full w-full flex-col border shadow-none"
  >
    <div class="flex items-center justify-between px-3 py-2">
      <div>
        <h3 class="text-text-heading m-0 pt-2 text-base leading-6 font-semibold">
          {{ t("billing.proPlanLabel") }}
        </h3>
        <p class="text-text-secondary m-0 mt-2 text-sm leading-4.5 font-normal">
          {{ t("billing.proPlanSubtitle") }}
        </p>
      </div>
      <OTag v-if="planType == planName" type="billingTag" value="subscribed" class="mt-2" />
    </div>

    <OSeparator class="my-2" />

    <div class="px-3 py-2">
      <h4 class="text-compact text-text-heading m-0 leading-[0.983rem] font-semibold">
        {{ t("billing.features") }}
      </h4>
      <p class="text-compact text-text-secondary m-0 mt-1 mb-3 leading-4.5 font-normal">
        {{ t("billing.included") }}
      </p>

      <div
        v-if="pricingError && !features?.length"
        class="text-status-error-text mb-2 flex items-center"
      >
        <OIcon name="warning" size="sm" class="mr-2" />
        <span class="text-text-body text-base leading-5.5"
          >Failed to load pricing details. Please refresh the page.</span
        >
      </div>
      <div
        v-for="(feature, index) in features"
        :key="index"
        class="mb-2 flex items-center justify-between"
      >
        <div class="flex items-center">
          <OIcon
            v-if="feature.is_parent"
            name="check-circle"
            size="md"
            class="text-status-positive check-icon mr-2"
          />
          <div class="text-text-body text-base leading-5.5" :class="{ 'ml-6': !feature.is_parent }">
            {{ feature.name }}
          </div>
        </div>
        <div
          v-if="feature.price !== ''"
          class="border-border-default mx-2 h-0 flex-1 border-t border-dotted opacity-40"
        ></div>
        <div class="text-text-body text-base leading-5.5 font-bold">{{ feature.price }}</div>
      </div>
    </div>

    <OSeparator />

    <p class="text-compact text-text-secondary m-0 px-3 pt-2 leading-4.5 font-normal">
      {{ t("billing.unlimitedNote") }}<br />
      {{ t("billing.paymentNote") }}
    </p>

    <div class="flex justify-between p-3">
      <!-- AWS Marketplace billing - show managed externally message -->
      <div v-if="billingProvider === 'aws'" class="w-full text-center">
        <OTag type="billingManagement" value="aws" class="inline-flex items-center gap-1">
          <template #icon>
            <OIcon name="check-circle" size="xs" />
          </template>
        </OTag>
        <div class="text-text-secondary mt-2 text-xs">
          Billing is handled through your AWS account
        </div>
      </div>
      <div v-else-if="billingProvider === 'azure'" class="w-full text-center">
        <OTag type="billingManagement" value="azure" class="inline-flex items-center gap-1">
          <template #icon>
            <OIcon name="check-circle" size="xs" />
          </template>
        </OTag>
        <div class="text-text-secondary mt-2 text-xs">
          Billing is handled through your Azure account
        </div>
      </div>
      <!-- External contract - billed offline, no Stripe portal to open -->
      <div v-else-if="subscriptionType === 'external-contract'" class="w-full text-center">
        <OTag type="billingManagement" value="contract" class="inline-flex items-center gap-1">
          <template #icon>
            <OIcon name="description" size="xs" />
          </template>
        </OTag>
        <div class="text-text-secondary mt-2 text-xs">
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
      <OButton v-else variant="primary" size="sm-action" block @click="onSubscribe">
        {{ btnSubscribe }}
      </OButton>
    </div>
  </OCard>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCard from "@/lib/core/Card/OCard.vue";

export default defineComponent({
  name: "proPlan",
  components: { OSeparator, OButton, OTag, OIcon, OCard },
  props: ["planType", "billingProvider", "subscriptionType", "features", "pricingError"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const planName = "pay-as-you-go";
    const btnCancelSubscription = ref(t("billing.manageSubscription"));
    const btnSubscribe = ref(t("billing.subscribe"));

    const cancelSubscription = () => {
      btnCancelSubscription.value = "Loading...";
      setTimeout(function () {
        btnCancelSubscription.value = t("billing.manageSubscription");
      }, 1000);
      emit("update:cancelSubscription");
    };

    const onSubscribe = () => {
      btnSubscribe.value = "Loading...";
      setTimeout(function () {
        btnSubscribe.value = t("billing.subscribe");
      }, 1000);
      emit("update:proSubscription");
    };

    return {
      t,
      cancelSubscription,
      onSubscribe,
      planName,
      btnSubscribe,
      btnCancelSubscription,
    };
  },
});
</script>
