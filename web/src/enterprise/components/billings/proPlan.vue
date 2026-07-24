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
  <OCard class="flex flex-col shadow-none border border-card-glass-border bg-card-glass-bg rounded-default w-full h-full dark:bg-surface-base dark:border-border-default">
    <div class="flex items-center justify-between px-3 py-2">
      <div>
        <h3 class="pt-2 text-base font-semibold leading-6 text-text-heading m-0">{{ t("billing.proPlanLabel") }}</h3>
        <p class="mt-2 text-sm font-normal leading-4.5 text-text-secondary m-0">
          {{ t("billing.proPlanSubtitle") }}
        </p>
      </div>
      <OTag
        v-if="planType == planName"
        type="billingTag"
        value="subscribed"
        class="mt-2"
      />
    </div>

    <OSeparator class="my-2" />

    <div class="px-3 py-2">
      <h4 class="text-compact font-semibold leading-[0.983rem] text-text-heading m-0">{{ t("billing.features") }}</h4>
      <p class="mb-3 mt-1 text-compact font-normal leading-4.5 text-text-secondary m-0">
        {{ t("billing.included") }}
      </p>

      <div
        v-if="pricingError && !features?.length"
        class="flex items-center mb-2 text-status-error-text"
      >
        <OIcon name="warning" size="sm" class="mr-2" />
        <span class="text-base leading-5.5 text-text-body"
          >{{ t("billing.pricingErrorMessage") }}</span
        >
      </div>
      <div
        v-for="(feature, index) in features"
        :key="index"
        class="flex items-center justify-between mb-2"
      >
        <div class="flex items-center">
          <OIcon
            v-if="feature.is_parent"
            name="check-circle"
            size="md"
            class="mr-2 text-status-positive check-icon"
          />
          <div class="text-base leading-5.5 text-text-body" :class="{ 'ml-6': !feature.is_parent }">{{ feature.name }}</div>
        </div>
        <div
          v-if="feature.price !== ''"
          class="mx-2 flex-1 h-0 opacity-40 border-t border-dotted border-border-default"
        ></div>
        <div class="text-base leading-5.5 text-text-body font-bold">{{ feature.price }}</div>
      </div>
    </div>

    <OSeparator />

    <p class="px-3 pt-2 text-compact font-normal leading-4.5 text-text-secondary m-0">
      {{ t("billing.unlimitedNote") }}<br />
      {{ t("billing.paymentNote") }}
    </p>

    <div class="flex justify-between p-3">
      <!-- AWS Marketplace billing - show managed externally message -->
      <div v-if="billingProvider === 'aws'" class="w-full text-center">
        <OTag
          type="billingManagement"
          value="aws"
          class="inline-flex items-center gap-1"
        >
          <template #icon>
            <OIcon name="check-circle" size="xs" />
          </template>
        </OTag>
        <div class="text-xs text-text-secondary mt-2">
          {{ t("billing.awsManagedMessage") }}
        </div>
      </div>
      <div
        v-else-if="billingProvider === 'azure'"
        class="w-full text-center"
      >
        <OTag
          type="billingManagement"
          value="azure"
          class="inline-flex items-center gap-1"
        >
          <template #icon>
            <OIcon name="check-circle" size="xs" />
          </template>
        </OTag>
        <div class="text-xs text-text-secondary mt-2">
          {{ t("billing.azureManagedMessage") }}
        </div>
      </div>
      <!-- External contract - billed offline, no Stripe portal to open -->
      <div
        v-else-if="subscriptionType === 'external-contract'"
        class="w-full text-center"
      >
        <OTag
          type="billingManagement"
          value="contract"
          class="inline-flex items-center gap-1"
        >
          <template #icon>
            <OIcon name="description" size="xs" />
          </template>
        </OTag>
        <div class="text-xs text-text-secondary mt-2">
          {{ t("billing.contractManagedMessage") }}
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
  props: [
    "planType",
    "billingProvider",
    "subscriptionType",
    "features",
    "pricingError",
  ],
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
