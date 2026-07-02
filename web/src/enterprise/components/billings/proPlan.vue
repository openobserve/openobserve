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
  <OCard class="tw:flex tw:flex-col tw:shadow-none tw:border tw:border-(--o2-border-color) tw:bg-(--o2-card-bg) tw:rounded-lg tw:w-full tw:h-full tw:dark:bg-[var(--o2-card-background)] tw:dark:border-[var(--o2-border)]">
    <div class="tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2">
      <div>
        <h3 class="tw:pt-2 tw:text-base tw:font-semibold tw:leading-6 tw:text-(--o2-text-heading) tw:m-0">{{ t("billing.proPlanLabel") }}</h3>
        <p class="tw:mt-2 tw:text-sm tw:font-normal tw:leading-4.5 tw:text-(--o2-text-secondary) tw:m-0">
          {{ t("billing.proPlanSubtitle") }}
        </p>
      </div>
      <OTag
        v-if="planType == planName"
        type="billingTag"
        value="subscribed"
        class="tw:mt-2"
      />
    </div>

    <OSeparator class="tw:my-2" />

    <div class="tw:px-3 tw:py-2">
      <h4 class="tw:text-[0.8125rem] tw:font-semibold tw:leading-[0.983rem] tw:text-(--o2-text-heading) tw:m-0">{{ t("billing.features") }}</h4>
      <p class="tw:mb-3 tw:mt-1 tw:text-[0.8125rem] tw:font-normal tw:leading-4.5 tw:text-(--o2-text-secondary) tw:m-0">
        {{ t("billing.included") }}
      </p>

      <div
        v-if="pricingError && !features?.length"
        class="tw:flex tw:items-center tw:mb-2 tw:text-red-500"
      >
        <OIcon name="warning" size="sm" class="tw:mr-2" />
        <span class="tw:text-[0.938rem] tw:leading-5.5 tw:text-(--o2-text-body)"
          >Failed to load pricing details. Please refresh the page.</span
        >
      </div>
      <div
        v-for="(feature, index) in features"
        :key="index"
        class="tw:flex tw:items-center tw:justify-between tw:mb-2"
      >
        <div class="tw:flex tw:items-center">
          <OIcon
            v-if="feature.is_parent"
            name="check-circle"
            size="md"
            class="tw:mr-2 tw:text-green-500 check-icon"
          />
          <div class="tw:text-[0.938rem] tw:leading-5.5 tw:text-(--o2-text-body)" :class="{ 'tw:ml-6': !feature.is_parent }">{{ feature.name }}</div>
        </div>
        <div
          v-if="feature.price !== ''"
          class="tw:mx-2"
          style="
            flex: 1;
            border-top: 1px dotted #454f5b;
            height: 0;
            opacity: 0.4;
          "
        ></div>
        <div class="tw:text-[0.938rem] tw:leading-5.5 tw:text-(--o2-text-body) tw:font-bold">{{ feature.price }}</div>
      </div>
    </div>

    <OSeparator />

    <p class="tw:px-3 tw:pt-2 tw:text-[0.8125rem] tw:font-normal tw:leading-4.5 tw:text-(--o2-text-secondary) tw:m-0">
      {{ t("billing.unlimitedNote") }}<br />
      {{ t("billing.paymentNote") }}
    </p>

    <div class="tw:flex tw:justify-between tw:p-3">
      <!-- AWS Marketplace billing - show managed externally message -->
      <div v-if="billingProvider === 'aws'" class="tw:w-full tw:text-center">
        <OTag
          type="billingManagement"
          value="aws"
          class="tw:inline-flex tw:items-center tw:gap-1"
        >
          <template #icon>
            <OIcon name="check-circle" size="xs" />
          </template>
        </OTag>
        <div class="tw:text-xs tw:text-gray-400 tw:mt-2">
          Billing is handled through your AWS account
        </div>
      </div>
      <div
        v-else-if="billingProvider === 'azure'"
        class="tw:w-full tw:text-center"
      >
        <OTag
          type="billingManagement"
          value="azure"
          class="tw:inline-flex tw:items-center tw:gap-1"
        >
          <template #icon>
            <OIcon name="check-circle" size="xs" />
          </template>
        </OTag>
        <div class="tw:text-xs tw:text-gray-400 tw:mt-2">
          Billing is handled through your Azure account
        </div>
      </div>
      <!-- External contract - billed offline, no Stripe portal to open -->
      <div
        v-else-if="subscriptionType === 'external-contract'"
        class="tw:w-full tw:text-center"
      >
        <OTag
          type="billingManagement"
          value="contract"
          class="tw:inline-flex tw:items-center tw:gap-1"
        >
          <template #icon>
            <OIcon name="description" size="xs" />
          </template>
        </OTag>
        <div class="tw:text-xs tw:text-gray-400 tw:mt-2">
          Billing is handled through your contract — contact your account
          manager for changes
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
